import JSZip = require("jszip");
import XLSX = require("xlsx");

import type { ConfigService } from "../../config/domain/services/config-service.interface";
import { Asset } from "../domain/entities/asset.entity";
import type { IAssetRepository } from "../domain/repositories/asset.repository.interface";
import { AssetServiceImpl } from "./asset.service";
import type { KnowledgeEmbeddingService } from "./knowledge-embedding.service";
import {
    KNOWLEDGE_MANIFEST_PATH,
    type KnowledgeIngestionLimits,
    KnowledgeIngestionService,
    MAX_KNOWLEDGE_CHUNK_ARTIFACT_BYTES,
    MAX_KNOWLEDGE_VECTOR_INDEX_BYTES,
} from "./knowledge-ingestion.service";

function createHarness(
    options: {
        afterWrite?: (path: string) => void | Promise<void>;
        config?: ConfigService;
        embeddings?: KnowledgeEmbeddingService;
        limits?: Partial<KnowledgeIngestionLimits>;
    } = {},
) {
    const asset = Asset.create({
        name: "knowledge",
        ownerId: "user-1",
        ownerType: "user",
        category: "knowledge",
        visibility: "private",
    });
    const externalBlobs = new Map<string, Buffer>();
    const repository = {
        findById: jest.fn(async (id: string) => (id === asset.id ? asset : null)),
        save: jest.fn(async () => undefined),
        readBlobData: jest.fn(async (assetId: string, path: string) => externalBlobs.get(`${assetId}:${path}`) ?? null),
        writeBlobData: jest.fn(async (assetId: string, path: string, content: Buffer) => {
            externalBlobs.set(`${assetId}:${path}`, Buffer.from(content));
            await options.afterWrite?.(path);
        }),
        deleteBlobData: jest.fn(async (assetId: string, path: string) => {
            externalBlobs.delete(`${assetId}:${path}`);
        }),
    } as unknown as IAssetRepository;
    const assets = new AssetServiceImpl(repository);
    return {
        asset,
        assets,
        externalBlobs,
        ingestion: new KnowledgeIngestionService(assets, options.config, options.embeddings, options.limits),
    };
}

function createTextPdf(text: string): Buffer {
    const escaped = text.replace(/([\\()])/g, "\\$1");
    const stream = `BT /F1 14 Tf 72 720 Td (${escaped}) Tj ET`;
    const objects = [
        "<< /Type /Catalog /Pages 2 0 R >>",
        "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
        `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
        "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    ];
    let pdf = "%PDF-1.4\n";
    const offsets = [0];
    objects.forEach((object, index) => {
        offsets.push(Buffer.byteLength(pdf));
        pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
    });
    const xref = Buffer.byteLength(pdf);
    pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
    pdf += offsets
        .slice(1)
        .map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`)
        .join("");
    pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
    return Buffer.from(pdf, "ascii");
}

describe("KnowledgeIngestionService", () => {
    it("publishes an explicitly incomplete snapshot when the source-count hard limit is reached", async () => {
        const { asset, assets, ingestion } = createHarness({ limits: { maxSourceCount: 2 } });
        await assets.updateBlob(asset.id, "raw/sources/a.txt", "Alpha", "Add", "main");
        await assets.updateBlob(asset.id, "raw/sources/b.txt", "Bravo", "Add", "main");
        await assets.updateBlob(asset.id, "raw/sources/c.txt", "Charlie", "Add", "main");

        const result = await ingestion.reindex(asset.id);
        const snapshot = await ingestion.getIndexSnapshot(asset.id, result.manifest);

        expect(result.manifest.resourceLimits).toMatchObject({
            maxSourceCount: 2,
            sourceCount: 3,
            exceeded: ["source_count"],
        });
        expect(result.manifest.sources).toEqual([
            expect.objectContaining({ path: "raw/sources/a.txt", status: "indexed" }),
            expect.objectContaining({ path: "raw/sources/b.txt", status: "indexed" }),
        ]);
        expect(snapshot).toMatchObject({ errorSourceCount: 0, incompleteSourceCount: 1 });
        expect(snapshot.incompleteReasons).toContain("knowledge_index_source_limit_exceeded:3/2");
    });

    it("does not silently truncate when the global extracted-character or chunk limit is reached", async () => {
        const characterHarness = createHarness({
            limits: { maxExtractedCharacters: 20, maxChunkCount: 100 },
        });
        await characterHarness.assets.updateBlob(
            characterHarness.asset.id,
            "raw/sources/a.txt",
            "123456789012345",
            "Add",
            "main",
        );
        await characterHarness.assets.updateBlob(
            characterHarness.asset.id,
            "raw/sources/b.txt",
            "abcdefghijklmno",
            "Add",
            "main",
        );
        const characters = await characterHarness.ingestion.reindex(characterHarness.asset.id);
        expect(characters.manifest.resourceLimits).toMatchObject({
            extractedCharacterCount: 30,
            indexedExtractedCharacters: 15,
            exceeded: ["extracted_characters"],
        });
        expect(characters.manifest.sources[1]).toMatchObject({ status: "error", chunkCount: 0 });
        expect(characters.manifest.sources[1]?.error).toContain("20");

        const chunkHarness = createHarness({ limits: { maxExtractedCharacters: 100_000, maxChunkCount: 2 } });
        await chunkHarness.assets.updateBlob(
            chunkHarness.asset.id,
            "raw/sources/chunks.txt",
            "x".repeat(2_600),
            "Add",
            "main",
        );
        const chunks = await chunkHarness.ingestion.reindex(chunkHarness.asset.id);
        expect(chunks.manifest.resourceLimits).toMatchObject({
            chunkCount: 3,
            indexedChunkCount: 0,
            exceeded: ["chunk_count"],
        });
        expect(chunks.manifest.sources[0]).toMatchObject({ status: "error", chunkCount: 0 });
    });

    it("embeds chunks in bounded batches instead of materializing every input text at once", async () => {
        const batchSizes: number[] = [];
        const embeddings = {
            embed: jest.fn(async (_asset: Asset, texts: string[]) => {
                batchSizes.push(texts.length);
                return {
                    provider: "test",
                    model: "test-embedding",
                    dimensions: 2,
                    vectors: texts.map((_, index) => [index, 1]),
                };
            }),
        } as unknown as KnowledgeEmbeddingService;
        const { asset, assets, ingestion } = createHarness({
            embeddings,
            limits: { embeddingBatchSize: 2, maxExtractedCharacters: 100_000, maxChunkCount: 100 },
        });
        await assets.updateBlob(asset.id, "raw/sources/large.txt", "x".repeat(5_000), "Add", "main");

        const result = await ingestion.reindex(asset.id);
        const vectorIndex = await ingestion.readVectorIndex(asset.id, result.manifest);

        expect(batchSizes.length).toBeGreaterThan(1);
        expect(Math.max(...batchSizes)).toBe(2);
        expect(batchSizes.reduce((sum, size) => sum + size, 0)).toBe(result.chunkCount);
        expect(vectorIndex?.records).toHaveLength(result.chunkCount);
    });

    it("extracts text, DOCX, and XLSX sources into deterministic chunks", async () => {
        const { asset, assets, ingestion } = createHarness();
        const docx = new JSZip();
        docx.file(
            "word/document.xml",
            '<?xml version="1.0"?><w:document xmlns:w="urn:w"><w:body><w:p><w:r><w:t>Contract renewal policy</w:t></w:r></w:p></w:body></w:document>',
        );
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(
            workbook,
            XLSX.utils.aoa_to_sheet([
                ["Region", "Revenue"],
                ["East", 42],
            ]),
            "Metrics",
        );

        await assets.updateBlob(asset.id, "raw/sources/notes.txt", "Alpha project decisions.", "Add text", "main");
        await assets.updateBlobBinary(
            asset.id,
            "raw/sources/policy.docx",
            await docx.generateAsync({ type: "nodebuffer" }),
            "Add DOCX",
            "main",
        );
        await assets.updateBlobBinary(
            asset.id,
            "raw/sources/metrics.xlsx",
            Buffer.from(XLSX.write(workbook, { type: "buffer", bookType: "xlsx" })),
            "Add XLSX",
            "main",
        );

        const first = await ingestion.reindex(asset.id);
        const second = await ingestion.reindex(asset.id);
        const manifest = JSON.parse(await assets.getBlobContent(asset.id, KNOWLEDGE_MANIFEST_PATH));

        expect(first).toMatchObject({
            sourceCount: 3,
            indexedSourceCount: 3,
            errorSourceCount: 0,
        });
        expect(first.chunkCount).toBe(3);
        expect(second.reusedSourceCount).toBe(3);
        expect(first.manifest.embeddingModel).toBe("local-hash-v1");
        const vectorIndex = await ingestion.readVectorIndex(asset.id, first.manifest);
        expect(vectorIndex).toMatchObject({ model: "local-hash-v1", dimensions: 192 });
        expect(vectorIndex?.records).toHaveLength(3);
        expect(vectorIndex?.records[0]).toEqual(
            expect.objectContaining({
                lineStart: expect.any(Number),
                pageStart: expect.any(Number),
                charStart: expect.any(Number),
            }),
        );
        expect(manifest.sources).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    path: "raw/sources/notes.txt",
                    status: "indexed",
                    chunkCount: 1,
                }),
                expect.objectContaining({
                    path: "raw/sources/policy.docx",
                    status: "indexed",
                    chunkCount: 1,
                }),
                expect.objectContaining({
                    path: "raw/sources/metrics.xlsx",
                    status: "indexed",
                    chunkCount: 1,
                }),
            ]),
        );
        const extracted = await Promise.all(
            manifest.sources.map((source: { extractedTextPath: string }) =>
                assets.getBlobContent(asset.id, source.extractedTextPath),
            ),
        );
        expect(extracted.join("\n")).toContain("Contract renewal policy");
        expect(extracted.join("\n")).toContain("East,42");
        expect(Object.keys((asset.metadata?.blobContents ?? {}) as Record<string, string>)).not.toEqual(
            expect.arrayContaining([expect.stringContaining(".internshannon/knowledge/index/")]),
        );
    });

    it("keeps identical source bytes isolated by source path across reindex and vector construction", async () => {
        const { asset, assets, ingestion } = createHarness();
        const identical = "IDENTICAL-PATH-ISOLATION searchable content shared by two files.";
        await assets.updateBlob(asset.id, "raw/sources/alpha/same.txt", identical, "Add alpha copy", "main");
        await assets.updateBlob(asset.id, "raw/sources/bravo/same.txt", identical, "Add bravo copy", "main");

        const first = await ingestion.reindex(asset.id);
        const second = await ingestion.reindex(asset.id);
        const [alpha, bravo] = first.manifest.sources;
        const alphaChunks = await ingestion.readChunks(asset.id, alpha);
        const bravoChunks = await ingestion.readChunks(asset.id, bravo);
        const vectors = await ingestion.readVectorIndex(asset.id, first.manifest);

        expect(first).toMatchObject({ indexedSourceCount: 2, errorSourceCount: 0, chunkCount: 2 });
        expect(second).toMatchObject({ indexedSourceCount: 2, reusedSourceCount: 2, errorSourceCount: 0 });
        expect(second.manifest.revision).toBe(first.manifest.revision);
        expect(second.manifest.vectorIndexPath).toBe(first.manifest.vectorIndexPath);
        expect(alpha.sha).toBe(bravo.sha);
        expect(alpha.extractedTextPath).not.toBe(bravo.extractedTextPath);
        expect(alpha.chunksPath).not.toBe(bravo.chunksPath);
        expect(alphaChunks).toEqual([
            expect.objectContaining({ sourcePath: alpha.path, contentSha: alpha.sha, text: identical }),
        ]);
        expect(bravoChunks).toEqual([
            expect.objectContaining({ sourcePath: bravo.path, contentSha: bravo.sha, text: identical }),
        ]);
        expect(alphaChunks[0]?.id).not.toBe(bravoChunks[0]?.id);
        expect(new Set(vectors?.records.map((record) => record.id))).toEqual(
            new Set([alphaChunks[0]?.id, bravoChunks[0]?.id]),
        );
    });

    it("atomically migrates colliding legacy paths during a targeted reindex without deleting source bytes", async () => {
        const { asset, assets, ingestion } = createHarness();
        const alphaPath = "raw/sources/alpha/legacy-path.txt";
        const bravoPath = "raw/sources/bravo/legacy-path.txt";
        const identical = "Legacy path migration remains searchable for both copies.";
        await assets.updateBlob(asset.id, alphaPath, identical, "Add alpha source", "main");
        await assets.updateBlob(asset.id, bravoPath, identical, "Add bravo source", "main");
        const first = await ingestion.reindex(asset.id);
        const [alpha, bravo] = first.manifest.sources;
        const legacyExtractedPath = `.internshannon/knowledge/index/extracted/${alpha.sha}.txt`;
        const legacyChunksPath = `.internshannon/knowledge/index/chunks/${alpha.sha}.json`;
        await assets.updateBlob(
            asset.id,
            legacyExtractedPath,
            await assets.getBlobContent(asset.id, alpha.extractedTextPath as string),
            "Restore legacy extracted path",
            "main",
        );
        await assets.updateBlob(
            asset.id,
            legacyChunksPath,
            await assets.getBlobContent(asset.id, alpha.chunksPath as string),
            "Restore legacy chunks path",
            "main",
        );
        await assets.updateBlob(
            asset.id,
            KNOWLEDGE_MANIFEST_PATH,
            `${JSON.stringify(
                {
                    ...first.manifest,
                    sources: [alpha, bravo].map((source) => ({
                        ...source,
                        extractedTextPath: legacyExtractedPath,
                        chunksPath: legacyChunksPath,
                    })),
                },
                null,
                2,
            )}\n`,
            "Publish legacy manifest fixture",
            "main",
        );

        const migratedService = new KnowledgeIngestionService(assets);
        const migrated = await migratedService.reindex(asset.id, { sourcePaths: [alphaPath] });
        const [migratedAlpha, migratedBravo] = migrated.manifest.sources;

        expect(migrated).toMatchObject({ indexedSourceCount: 2, reusedSourceCount: 0, errorSourceCount: 0 });
        expect(migratedAlpha.extractedTextPath).not.toBe(legacyExtractedPath);
        expect(migratedBravo.extractedTextPath).not.toBe(legacyExtractedPath);
        expect(migratedAlpha.extractedTextPath).not.toBe(migratedBravo.extractedTextPath);
        expect(migratedAlpha.chunksPath).not.toBe(legacyChunksPath);
        expect(migratedBravo.chunksPath).not.toBe(legacyChunksPath);
        expect(migratedAlpha.chunksPath).not.toBe(migratedBravo.chunksPath);
        expect(await assets.getBlobContent(asset.id, alphaPath)).toBe(identical);
        expect(await assets.getBlobContent(asset.id, bravoPath)).toBe(identical);
        expect(await migratedService.readChunks(asset.id, migratedAlpha)).toEqual([
            expect.objectContaining({ sourcePath: alphaPath, text: identical }),
        ]);
        expect(await migratedService.readChunks(asset.id, migratedBravo)).toEqual([
            expect.objectContaining({ sourcePath: bravoPath, text: identical }),
        ]);
        await expect(assets.getBlobContent(asset.id, legacyExtractedPath)).rejects.toThrow();
        await expect(assets.getBlobContent(asset.id, legacyChunksPath)).rejects.toThrow();
    });

    it.each(["docx", "xlsx"])("rejects a high-ratio %s archive before inflating Office entries", async (extension) => {
        const { asset, assets, ingestion } = createHarness();
        const archive = new JSZip();
        archive.file(extension === "docx" ? "word/document.xml" : "xl/worksheets/sheet1.xml", "A".repeat(512 * 1024));
        await assets.updateBlobBinary(
            asset.id,
            `raw/sources/archive-bomb.${extension}`,
            await archive.generateAsync({
                type: "nodebuffer",
                compression: "DEFLATE",
                compressionOptions: { level: 9 },
            }),
            "Add hostile Office archive",
            "main",
        );

        const result = await ingestion.reindex(asset.id);

        expect(result).toMatchObject({ indexedSourceCount: 0, errorSourceCount: 1 });
        expect(result.manifest.sources[0]).toMatchObject({ status: "error", chunkCount: 0 });
        expect(result.manifest.sources[0]?.error).toContain("压缩比");
        expect(result.manifest.sources[0]?.error).toContain("已拒绝解析");
    });

    it("creates a valid empty vector index and fills locators for legacy chunks", async () => {
        const { asset, assets, ingestion } = createHarness();
        const empty = await ingestion.reindex(asset.id);
        const emptyIndex = await ingestion.readVectorIndex(asset.id, empty.manifest);
        expect(emptyIndex).toMatchObject({ dimensions: 192, records: [] });

        const chunksPath = ".internshannon/knowledge/index/chunks/legacy.json";
        await assets.updateBlob(
            asset.id,
            chunksPath,
            JSON.stringify([{ id: "legacy:0", index: 0, text: "Legacy source text" }]),
            "Add legacy chunks",
            "main",
        );
        const chunks = await ingestion.readChunks(asset.id, {
            path: "raw/sources/legacy.txt",
            mime: "text/plain",
            sha: "legacy",
            size: 18,
            status: "indexed",
            chunksPath,
            chunkCount: 1,
            extractedAt: "2026-07-10T00:00:00.000Z",
        });
        expect(chunks[0]).toMatchObject({
            sourcePath: "raw/sources/legacy.txt",
            contentSha: "legacy",
            charStart: 0,
            charEnd: 18,
            lineStart: 1,
            lineEnd: 1,
            pageStart: 1,
            pageEnd: 1,
        });
    });

    it("rejects oversized chunk metadata before reading the artifact body", async () => {
        const { asset, assets, ingestion } = createHarness();
        const chunksPath = ".internshannon/knowledge/index/chunks/oversized.json";
        await assets.updateBlob(
            asset.id,
            chunksPath,
            JSON.stringify([{ id: "oversized:0", index: 0, text: "small body" }]),
            "Add oversized chunk metadata fixture",
            "main",
        );
        const chunksBlob = await assets.getBlob(asset.id, chunksPath);
        if (!chunksBlob) throw new Error("Chunk fixture blob was not persisted");
        Object.defineProperty(chunksBlob, "size", {
            configurable: true,
            value: MAX_KNOWLEDGE_CHUNK_ARTIFACT_BYTES + 1,
        });
        jest.spyOn(assets, "getBlob").mockResolvedValue(chunksBlob);
        const readBody = jest.spyOn(assets, "getBlobContent");

        await expect(
            ingestion.readChunks(asset.id, {
                path: "raw/sources/oversized.txt",
                mime: "text/plain",
                sha: "oversized",
                size: 10,
                status: "indexed",
                chunksPath,
                chunkCount: 1,
                extractedAt: "2026-08-13T00:00:00.000Z",
            }),
        ).rejects.toThrow("exceeds");
        expect(readBody).not.toHaveBeenCalledWith(asset.id, chunksPath);
    });

    it("fails closed for invalid vectors and oversized vector metadata", async () => {
        const { asset, assets, ingestion } = createHarness();
        const vectorIndexPath = ".internshannon/knowledge/index/vectors/hostile.json";
        const source = {
            path: "raw/sources/vector.txt",
            mime: "text/plain",
            sha: "vector-sha",
            size: 10,
            status: "indexed" as const,
            chunksPath: ".internshannon/knowledge/index/chunks/vector.json",
            chunkCount: 1,
            extractedAt: "2026-08-13T00:00:00.000Z",
        };
        const manifest = {
            version: 1 as const,
            generatedAt: "2026-08-13T00:00:00.000Z",
            embeddingModel: "local-hash-v1",
            embeddingProvider: "local",
            embeddingDimensions: 2,
            vectorIndexPath,
            sources: [source],
        };
        await assets.updateBlob(
            asset.id,
            vectorIndexPath,
            JSON.stringify({
                version: 1,
                provider: "local",
                model: "local-hash-v1",
                generatedAt: manifest.generatedAt,
                dimensions: 2,
                records: [
                    {
                        id: "vector-sha:0",
                        sourcePath: source.path,
                        chunkIndex: 0,
                        contentSha: source.sha,
                        embedding: [1, "not-a-number"],
                    },
                ],
            }),
            "Add invalid vector fixture",
            "main",
        );
        await expect(ingestion.readVectorIndex(asset.id, manifest)).resolves.toBeNull();

        const vectorBlob = await assets.getBlob(asset.id, vectorIndexPath);
        if (!vectorBlob) throw new Error("Vector fixture blob was not persisted");
        Object.defineProperty(vectorBlob, "size", {
            configurable: true,
            value: MAX_KNOWLEDGE_VECTOR_INDEX_BYTES + 1,
        });
        jest.spyOn(assets, "getBlob").mockResolvedValue(vectorBlob);
        const fresh = new KnowledgeIngestionService(assets);
        const readBody = jest.spyOn(assets, "getBlobContent");
        await expect(fresh.readVectorIndex(asset.id, manifest)).resolves.toBeNull();
        expect(readBody).not.toHaveBeenCalledWith(asset.id, vectorIndexPath);
    });

    it("rejects vector records whose IDs are bound to a different source chunk", async () => {
        const { asset, assets, ingestion } = createHarness();
        await assets.updateBlob(asset.id, "raw/sources/a.txt", "Alpha vector source.", "Add source A", "main");
        await assets.updateBlob(asset.id, "raw/sources/b.txt", "Bravo vector source.", "Add source B", "main");
        const indexed = await ingestion.reindex(asset.id);
        const vectorIndexPath = indexed.manifest.vectorIndexPath as string;
        const vectorIndex = JSON.parse(await assets.getBlobContent(asset.id, vectorIndexPath)) as {
            records: Array<Record<string, unknown>>;
        };
        const [first, second] = vectorIndex.records;
        vectorIndex.records = [
            { ...first, id: second.id },
            { ...second, id: first.id },
        ];
        await assets.updateBlob(
            asset.id,
            vectorIndexPath,
            JSON.stringify(vectorIndex),
            "Cross-wire vector chunk IDs",
            "main",
        );

        await expect(ingestion.readVectorIndex(asset.id, indexed.manifest)).resolves.toBeNull();
    });

    it("rejects duplicate vector source/chunk pairs even when record IDs are unique", async () => {
        const { asset, assets, ingestion } = createHarness();
        await assets.updateBlob(asset.id, "raw/sources/a.txt", "Alpha vector source.", "Add source A", "main");
        await assets.updateBlob(asset.id, "raw/sources/b.txt", "Bravo vector source.", "Add source B", "main");
        const indexed = await ingestion.reindex(asset.id);
        const vectorIndexPath = indexed.manifest.vectorIndexPath as string;
        const vectorIndex = JSON.parse(await assets.getBlobContent(asset.id, vectorIndexPath)) as {
            records: Array<Record<string, unknown>>;
        };
        const [first, second] = vectorIndex.records;
        vectorIndex.records[1] = {
            ...second,
            id: `${String(second.id)}:duplicate-pair`,
            sourcePath: first.sourcePath,
            chunkIndex: first.chunkIndex,
            contentSha: first.contentSha,
        };
        await assets.updateBlob(
            asset.id,
            vectorIndexPath,
            JSON.stringify(vectorIndex),
            "Duplicate vector chunk pair",
            "main",
        );

        await expect(ingestion.readVectorIndex(asset.id, indexed.manifest)).resolves.toBeNull();
    });

    it("rejects vector indexes that omit an indexed source chunk", async () => {
        const { asset, assets, ingestion } = createHarness();
        await assets.updateBlob(asset.id, "raw/sources/a.txt", "Alpha vector source.", "Add source A", "main");
        await assets.updateBlob(asset.id, "raw/sources/b.txt", "Bravo vector source.", "Add source B", "main");
        const indexed = await ingestion.reindex(asset.id);
        const vectorIndexPath = indexed.manifest.vectorIndexPath as string;
        const vectorIndex = JSON.parse(await assets.getBlobContent(asset.id, vectorIndexPath)) as {
            records: Array<Record<string, unknown>>;
        };
        vectorIndex.records = vectorIndex.records.slice(0, -1);
        await assets.updateBlob(
            asset.id,
            vectorIndexPath,
            JSON.stringify(vectorIndex),
            "Omit vector chunk record",
            "main",
        );

        await expect(ingestion.readVectorIndex(asset.id, indexed.manifest)).resolves.toBeNull();
    });

    it("marks images as waiting for OCR and removes stale derived artifacts", async () => {
        const { asset, assets, ingestion } = createHarness();
        await assets.updateBlob(asset.id, "raw/sources/old.txt", "Temporary searchable source.", "Add", "main");
        await assets.updateBlobBinary(asset.id, "raw/sources/scan.png", Buffer.from([1, 2, 3]), "Add image", "main");
        const first = await ingestion.reindex(asset.id);
        const old = first.manifest.sources.find((source) => source.path.endsWith("old.txt"));

        await assets.deleteBlob(asset.id, "raw/sources/old.txt", "Delete", "main");
        const second = await ingestion.reindex(asset.id);

        expect(second.manifest.sources).toEqual([
            expect.objectContaining({
                path: "raw/sources/scan.png",
                status: "waiting_for_ocr",
                chunkCount: 0,
            }),
        ]);
        await expect(assets.getBlobContent(asset.id, old?.extractedTextPath ?? "")).rejects.toThrow();
        await expect(assets.getBlobContent(asset.id, old?.chunksPath ?? "")).rejects.toThrow();
    });

    it("publishes stable revisions and reports source drift before reindex", async () => {
        const { asset, assets, ingestion } = createHarness();
        await assets.updateBlob(asset.id, "raw/sources/revision.txt", "Revision one.", "Add", "main");
        await assets.updateBlob(asset.id, "schema.md", "# Schema one", "Schema", "main");

        const first = await ingestion.reindex(asset.id);
        const repeated = await ingestion.reindex(asset.id);
        const published = await ingestion.getIndexSnapshot(asset.id, repeated.manifest);
        expect(first.manifest.revision).toMatch(/^[a-f0-9]{24}$/);
        expect(repeated.manifest.revision).toBe(first.manifest.revision);
        expect(published).toMatchObject({ staleSourceCount: 0, incompleteSourceCount: 0 });

        await assets.updateBlob(asset.id, "raw/sources/revision.txt", "Revision two.", "Change", "main");
        const stale = await ingestion.getIndexSnapshot(asset.id);
        expect(stale.revision).not.toBe(published.revision);
        expect(stale).toMatchObject({ staleSourceCount: 1, incompleteSourceCount: 1 });

        await ingestion.reindex(asset.id);
        await assets.updateBlob(asset.id, "schema.md", "# Schema two", "Change schema", "main");
        const schemaDrift = await ingestion.getIndexSnapshot(asset.id);
        expect(schemaDrift.revision).not.toBe(stale.revision);
    });

    it("versions added, changed, and removed sources beyond the snapshot limit without reading their bodies", async () => {
        const { asset, assets, ingestion } = createHarness();
        const baseBlobs = Array.from({ length: 2_000 }, (_, index) => {
            const contentSha = `source-sha-${index}`;
            return {
                id: contentSha,
                assetId: asset.id,
                path: `raw/sources/source-${String(index).padStart(4, "0")}.txt`,
                size: index + 1,
                contentSha,
                isBinary: false,
            };
        });
        asset.updateMetadata({ blobs: baseBlobs });
        const bodyReads = jest.spyOn(assets, "getBlobData");

        const atLimit = await ingestion.getIndexSnapshot(asset.id);
        const omittedPath = "raw/sources/source-2000.txt";
        const omitted = {
            id: "source-sha-2000",
            assetId: asset.id,
            path: omittedPath,
            size: 2_001,
            contentSha: "source-sha-2000",
            isBinary: false,
        };
        asset.updateMetadata({ blobs: [...baseBlobs, omitted] });
        const added = await ingestion.getIndexSnapshot(asset.id);

        asset.updateMetadata({
            blobs: [
                ...baseBlobs,
                { ...omitted, id: "source-sha-2000-changed", contentSha: "source-sha-2000-changed", size: 9_999 },
            ],
        });
        const changed = await ingestion.getIndexSnapshot(asset.id);

        asset.updateMetadata({ blobs: baseBlobs });
        const removed = await ingestion.getIndexSnapshot(asset.id);

        expect(added.revision).not.toBe(atLimit.revision);
        expect(changed.revision).not.toBe(added.revision);
        expect(removed.revision).not.toBe(changed.revision);
        expect(added.incompleteReasons).toContain("knowledge_index_snapshot_source_limit_exceeded:2001/2000");
        expect(bodyReads.mock.calls.filter(([, path]) => String(path).startsWith("raw/sources/"))).toHaveLength(0);
    });

    it("bounds wiki snapshot reads and invalidates revisions for omitted wiki metadata changes", async () => {
        const { asset, assets, ingestion, externalBlobs } = createHarness();
        const blobs = Array.from({ length: 2_001 }, (_, index) => {
            const path = `wiki/page-${String(index).padStart(4, "0")}.md`;
            const content = Buffer.from(`# Wiki ${index}`);
            const contentSha = `wiki-sha-${index}`;
            externalBlobs.set(`${asset.id}:${path}`, content);
            return { id: contentSha, assetId: asset.id, path, size: content.byteLength, contentSha, isBinary: false };
        });
        asset.updateMetadata({ blobs });
        const repositoryReads = jest.spyOn(assets, "getBlobData");
        const first = await ingestion.getIndexSnapshot(asset.id);

        expect(first.wikiResourceLimits).toMatchObject({
            documentCount: 2_001,
            selectedDocumentCount: 2_000,
            omittedDocumentCount: 1,
        });
        expect(first.incompleteReasons).toContain("knowledge_wiki_document_limit_exceeded:2001/2000");
        expect(first.incompleteSourceCount).toBeGreaterThan(0);
        expect(repositoryReads.mock.calls.filter(([, path]) => String(path).startsWith("wiki/"))).toHaveLength(2_000);

        const omittedPath = "wiki/page-2000.md";
        const changedContent = Buffer.from("# Changed omitted wiki");
        externalBlobs.set(`${asset.id}:${omittedPath}`, changedContent);
        asset.updateMetadata({
            blobs: blobs.map((blob) =>
                blob.path === omittedPath
                    ? {
                          ...blob,
                          id: "wiki-sha-2000-changed",
                          contentSha: "wiki-sha-2000-changed",
                          size: changedContent.byteLength,
                      }
                    : blob,
            ),
        });
        expect(externalBlobs.get(`${asset.id}:${omittedPath}`)?.toString()).toContain("Changed omitted wiki");
        const changed = await ingestion.getIndexSnapshot(asset.id);
        expect(changed.revision).not.toBe(first.revision);
    }, 30_000);

    it("reports oversized wiki pages from metadata without reading their bodies", async () => {
        const { asset, assets, ingestion, externalBlobs } = createHarness();
        const path = "wiki/oversized.md";
        const content = Buffer.from("x".repeat(2 * 1024 * 1024 + 1));
        externalBlobs.set(`${asset.id}:${path}`, content);
        asset.updateMetadata({
            blobs: [
                {
                    id: "oversized-wiki-sha",
                    assetId: asset.id,
                    path,
                    size: content.byteLength,
                    contentSha: "oversized-wiki-sha",
                    isBinary: false,
                },
            ],
        });
        const repositoryReads = jest.spyOn(assets, "getBlobData");

        const snapshot = await ingestion.getIndexSnapshot(asset.id);

        expect(snapshot.wikiResourceLimits).toMatchObject({
            documentCount: 1,
            selectedDocumentCount: 0,
            oversizedDocumentCount: 1,
        });
        expect(snapshot.incompleteReasons).toContain("knowledge_wiki_document_size_limit_exceeded:1/2097152");
        expect(snapshot.incompleteSourceCount).toBeGreaterThan(0);
        expect(repositoryReads.mock.calls.filter(([, path]) => path === "wiki/oversized.md")).toHaveLength(0);
    });

    it("uses the larger UTF-8 byte count for the wiki total budget, matching query selection", async () => {
        const { asset, assets, ingestion, externalBlobs } = createHarness();
        const content = Buffer.from("中".repeat(600_000));
        const blobs = Array.from({ length: 19 }, (_, index) => {
            const path = `wiki/cjk-${String(index).padStart(2, "0")}.md`;
            const contentSha = `cjk-sha-${index}`;
            externalBlobs.set(`${asset.id}:${path}`, content);
            return { id: contentSha, assetId: asset.id, path, size: content.byteLength, contentSha, isBinary: false };
        });
        asset.updateMetadata({ blobs });
        const bodyReads = jest.spyOn(assets, "getBlobData");

        const snapshot = await ingestion.getIndexSnapshot(asset.id);

        expect(snapshot.wikiResourceLimits).toMatchObject({
            documentCount: 19,
            selectedDocumentCount: 18,
            selectedCharacterCount: 32_400_000,
            totalCharacterOmissionCount: 1,
        });
        expect(snapshot.incompleteReasons).toContain("knowledge_wiki_total_character_limit_exceeded:32400000/33554432");
        expect(bodyReads.mock.calls.filter(([, path]) => String(path).startsWith("wiki/"))).toHaveLength(18);
    }, 30_000);

    it("rejects an oversized inline wiki document before loading or hashing it as a selected entry", async () => {
        const { asset, assets, ingestion } = createHarness();
        asset.updateMetadata({
            blobContents: {
                "wiki/oversized-inline.md": "x".repeat(2 * 1024 * 1024 + 1),
            },
        });
        const bodyReads = jest.spyOn(assets, "getBlobData");

        const snapshot = await ingestion.getIndexSnapshot(asset.id);

        expect(snapshot.wikiResourceLimits).toMatchObject({
            documentCount: 1,
            selectedDocumentCount: 0,
            oversizedDocumentCount: 1,
        });
        expect(bodyReads.mock.calls.filter(([, path]) => path === "wiki/oversized-inline.md")).toHaveLength(0);
    });

    it("purges legacy internal source entries and artifacts on the next reindex", async () => {
        const { asset, assets, ingestion } = createHarness();
        await assets.updateBlob(asset.id, "raw/sources/live.txt", "Current source.", "Add", "main");
        const current = await ingestion.reindex(asset.id);
        const legacyExtractedPath = ".internshannon/knowledge/index/extracted/internal.txt";
        const legacyChunksPath = ".internshannon/knowledge/index/chunks/internal.json";
        await assets.updateBlob(asset.id, legacyExtractedPath, "Stale internal source.", "Legacy", "main");
        await assets.updateBlob(asset.id, legacyChunksPath, "[]", "Legacy", "main");
        await assets.updateBlob(
            asset.id,
            KNOWLEDGE_MANIFEST_PATH,
            JSON.stringify({
                ...current.manifest,
                sources: [
                    ...current.manifest.sources,
                    {
                        path: "raw/sources/.shuan-os-snapshots/live.txt",
                        mime: "text/plain",
                        sha: "internal",
                        size: 22,
                        status: "indexed",
                        extractedTextPath: legacyExtractedPath,
                        chunksPath: legacyChunksPath,
                        chunkCount: 1,
                        extractedAt: "2026-08-01T00:00:00.000Z",
                    },
                ],
            }),
            "Legacy manifest",
            "main",
        );

        expect((await ingestion.getManifest(asset.id)).sources.map((source) => source.path)).toEqual([
            "raw/sources/live.txt",
        ]);
        await ingestion.reindex(asset.id);
        await expect(assets.getBlobContent(asset.id, legacyExtractedPath)).rejects.toThrow();
        await expect(assets.getBlobContent(asset.id, legacyChunksPath)).rejects.toThrow();
    });

    it.each([
        [429, true],
        [500, true],
        [401, false],
    ])("records OCR HTTP %i failures with the correct retryability", async (status, retryable) => {
        const originalFetch = global.fetch;
        global.fetch = jest.fn(
            async () => new Response(JSON.stringify({ error: "remote failure" }), { status }),
        ) as typeof fetch;
        const config = {
            getSettings: jest.fn(async () => ({
                ocr: {
                    defaultBackend: "paddleocr",
                    backends: [
                        {
                            name: "paddleocr",
                            type: "paddleocr",
                            enabled: true,
                            baseUrl: "http://ocr.example.test",
                            requestFormat: "json-base64",
                            outputFormat: "json",
                        },
                    ],
                },
            })),
        } as unknown as ConfigService;
        try {
            const { asset, assets, ingestion } = createHarness({ config });
            await assets.updateBlobBinary(asset.id, "raw/sources/scan.png", Buffer.from([1, 2, 3]), "Add scan", "main");

            const result = await ingestion.reindex(asset.id);

            expect(result.manifest.sources[0]).toMatchObject({ status: "error", retryable });
            expect(result.manifest.sources[0]?.error).toContain(`HTTP ${status}`);
        } finally {
            global.fetch = originalFetch;
        }
    });

    it("marks an empty OCR success as retryable without indexing fabricated text", async () => {
        const originalFetch = global.fetch;
        global.fetch = jest.fn(
            async () => new Response(JSON.stringify({ pages: [] }), { status: 200 }),
        ) as typeof fetch;
        const config = {
            getSettings: jest.fn(async () => ({
                ocr: {
                    defaultBackend: "paddleocr",
                    backends: [
                        {
                            name: "paddleocr",
                            type: "paddleocr",
                            enabled: true,
                            baseUrl: "http://ocr.example.test",
                            requestFormat: "json-base64",
                            outputFormat: "json",
                        },
                    ],
                },
            })),
        } as unknown as ConfigService;
        try {
            const { asset, assets, ingestion } = createHarness({ config });
            await assets.updateBlobBinary(
                asset.id,
                "raw/sources/empty.png",
                Buffer.from([1, 2, 3]),
                "Add scan",
                "main",
            );

            const result = await ingestion.reindex(asset.id);

            expect(result.manifest.sources[0]).toMatchObject({ status: "error", retryable: true, chunkCount: 0 });
            expect(result.manifest.sources[0]?.error).toContain("returned no text");
        } finally {
            global.fetch = originalFetch;
        }
    });

    it("keeps the published manifest and vector index unchanged when a rebuild is cancelled", async () => {
        const { asset, assets, ingestion } = createHarness();
        await assets.updateBlob(
            asset.id,
            "raw/sources/recovery.txt",
            "RECOVERY-OLD stable published content.",
            "Add recovery source",
            "main",
        );
        const published = await ingestion.reindex(asset.id);
        const publishedSource = published.manifest.sources[0];
        const publishedExtracted = await assets.getBlobContent(asset.id, publishedSource.extractedTextPath as string);
        const publishedChunks = await ingestion.readChunks(asset.id, publishedSource);
        const publishedVector = await ingestion.readVectorIndex(asset.id, published.manifest);

        await assets.updateBlob(
            asset.id,
            "raw/sources/recovery.txt",
            "RECOVERY-NEW content from an interrupted rebuild.",
            "Change recovery source",
            "main",
        );
        const controller = new AbortController();
        await expect(
            ingestion.reindex(asset.id, {
                signal: controller.signal,
                onProgress: ({ stage }) => {
                    if (stage === "embedding") controller.abort();
                },
            }),
        ).rejects.toMatchObject({ name: "AbortError" });

        const afterAbort = await ingestion.getManifest(asset.id);
        const afterAbortVector = await ingestion.readVectorIndex(asset.id, afterAbort);
        expect(afterAbort.sources[0]?.sha).toBe(publishedSource.sha);
        expect(await assets.getBlobContent(asset.id, publishedSource.extractedTextPath as string)).toBe(
            publishedExtracted,
        );
        expect(await ingestion.readChunks(asset.id, publishedSource)).toEqual(publishedChunks);
        expect(afterAbortVector?.records).toEqual(publishedVector?.records);
        expect(await assets.getBlobContent(asset.id, "raw/sources/recovery.txt")).toContain("RECOVERY-NEW");
    });

    it("keeps the previous vector revision readable when cancellation races with vector persistence", async () => {
        const controller = new AbortController();
        let injectAbort = false;
        const { asset, assets, ingestion } = createHarness({
            afterWrite: (path) => {
                if (injectAbort && path.includes("/vectors/")) controller.abort();
            },
        });
        await assets.updateBlob(
            asset.id,
            "raw/sources/commit-point.txt",
            "COMMIT-POINT-OLD published vector.",
            "Add commit point fixture",
            "main",
        );
        const published = await ingestion.reindex(asset.id);
        const publishedVector = await ingestion.readVectorIndex(asset.id, published.manifest);

        await assets.updateBlob(
            asset.id,
            "raw/sources/commit-point.txt",
            "COMMIT-POINT-NEW interrupted vector.",
            "Change commit point fixture",
            "main",
        );
        injectAbort = true;
        await expect(ingestion.reindex(asset.id, { signal: controller.signal })).rejects.toMatchObject({
            name: "AbortError",
        });

        const afterAbort = await ingestion.getManifest(asset.id);
        const afterAbortVector = await ingestion.readVectorIndex(asset.id, afterAbort);
        expect(afterAbort.vectorIndexPath).toBe(published.manifest.vectorIndexPath);
        expect(afterAbortVector?.records).toEqual(publishedVector?.records);
    });

    it.each([
        "vector",
        "manifest",
    ])("keeps the published revision and raw source intact when the %s write fails", async (failurePoint) => {
        const { asset, assets, ingestion } = createHarness();
        await assets.updateBlob(
            asset.id,
            "raw/sources/write-failure.txt",
            "WRITE-FAILURE-OLD published content.",
            "Add write failure fixture",
            "main",
        );
        const published = await ingestion.reindex(asset.id);
        const publishedVector = await ingestion.readVectorIndex(asset.id, published.manifest);
        await assets.updateBlob(
            asset.id,
            "raw/sources/write-failure.txt",
            "WRITE-FAILURE-NEW raw source must survive a derived-index failure.",
            "Update write failure fixture",
            "main",
        );
        const rawBefore = await assets.getBlobData(asset.id, "raw/sources/write-failure.txt");
        const originalUpdateBlob = assets.updateBlob.bind(assets);
        jest.spyOn(assets, "updateBlob").mockImplementation(
            async (id, path, content, message, branch, authorName, authorEmail) => {
                const shouldFail =
                    failurePoint === "manifest"
                        ? path === KNOWLEDGE_MANIFEST_PATH
                        : path.includes("/.internshannon/knowledge/index/vectors/") ||
                          path.includes(".internshannon/knowledge/index/vectors/");
                if (shouldFail) throw new Error(`simulated ${failurePoint} write failure`);
                return originalUpdateBlob(id, path, content, message, branch, authorName, authorEmail);
            },
        );

        await expect(ingestion.reindex(asset.id)).rejects.toThrow(`simulated ${failurePoint} write failure`);
        const after = await ingestion.getManifest(asset.id);
        const afterVector = await ingestion.readVectorIndex(asset.id, after);
        const rawAfter = await assets.getBlobData(asset.id, "raw/sources/write-failure.txt");

        expect(after.vectorIndexPath).toBe(published.manifest.vectorIndexPath);
        expect(after.sources[0]?.sha).toBe(published.manifest.sources[0]?.sha);
        expect(afterVector?.records).toEqual(publishedVector?.records);
        expect(rawAfter.contentSha).toBe(rawBefore.contentSha);
        expect(rawAfter.content).toContain("WRITE-FAILURE-NEW");
    });

    it("rebuilds malformed manifest, chunk, and vector artifacts without changing the source bytes", async () => {
        const { asset, assets, ingestion } = createHarness();
        await assets.updateBlob(
            asset.id,
            "raw/sources/corruption.txt",
            "CORRUPTION-RECOVERY source bytes must survive derived index damage.",
            "Add corruption fixture",
            "main",
        );
        const beforeSource = await assets.getBlobData(asset.id, "raw/sources/corruption.txt");
        const first = await ingestion.reindex(asset.id);
        const firstSource = first.manifest.sources[0];

        await assets.updateBlob(asset.id, KNOWLEDGE_MANIFEST_PATH, "{broken", "Corrupt manifest", "main");
        await assets.updateBlob(asset.id, firstSource.chunksPath ?? "", "not-json", "Corrupt chunks", "main");
        await assets.updateBlob(asset.id, first.manifest.vectorIndexPath ?? "", "[]", "Corrupt vector index", "main");

        expect((await ingestion.getManifest(asset.id)).sources).toEqual([]);
        const rebuilt = await ingestion.reindex(asset.id);
        const rebuiltSource = rebuilt.manifest.sources[0];
        const rebuiltVector = await ingestion.readVectorIndex(asset.id, rebuilt.manifest);
        const afterSource = await assets.getBlobData(asset.id, "raw/sources/corruption.txt");

        expect(afterSource.contentSha).toBe(beforeSource.contentSha);
        expect(rebuiltSource).toMatchObject({ status: "indexed", sha: firstSource.sha });
        expect(await ingestion.readChunks(asset.id, rebuiltSource)).toHaveLength(1);
        expect(rebuiltVector?.records).toHaveLength(1);
    });

    const pdfTest = process.env.NODE_OPTIONS?.includes("--experimental-vm-modules") ? it : it.skip;
    pdfTest("extracts text from a PDF without requiring a rendering canvas", async () => {
        const { asset, assets, ingestion } = createHarness();
        await assets.updateBlobBinary(
            asset.id,
            "raw/sources/report.pdf",
            createTextPdf("PDF source sentence"),
            "Add PDF",
            "main",
        );

        const result = await ingestion.reindex(asset.id);
        const source = result.manifest.sources[0];

        expect(source.error).toBeUndefined();
        expect(source).toMatchObject({
            path: "raw/sources/report.pdf",
            status: "indexed",
            chunkCount: 1,
        });
        expect(await assets.getBlobContent(asset.id, source.extractedTextPath ?? "")).toContain("PDF source sentence");
    });
});
