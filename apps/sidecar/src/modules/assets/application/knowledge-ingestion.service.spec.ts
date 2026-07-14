import JSZip = require("jszip");
import XLSX = require("xlsx");
import { Asset } from "../domain/entities/asset.entity";
import type { IAssetRepository } from "../domain/repositories/asset.repository.interface";
import { AssetServiceImpl } from "./asset.service";
import {
	KNOWLEDGE_MANIFEST_PATH,
	KnowledgeIngestionService,
} from "./knowledge-ingestion.service";

function createHarness() {
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
		readBlobData: jest.fn(
			async (assetId: string, path: string) =>
				externalBlobs.get(`${assetId}:${path}`) ?? null,
		),
		writeBlobData: jest.fn(
			async (assetId: string, path: string, content: Buffer) => {
				externalBlobs.set(`${assetId}:${path}`, Buffer.from(content));
			},
		),
		deleteBlobData: jest.fn(async (assetId: string, path: string) => {
			externalBlobs.delete(`${assetId}:${path}`);
		}),
	} as unknown as IAssetRepository;
	const assets = new AssetServiceImpl(repository);
	return { asset, assets, externalBlobs, ingestion: new KnowledgeIngestionService(assets) };
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

		await assets.updateBlob(
			asset.id,
			"raw/sources/notes.txt",
			"Alpha project decisions.",
			"Add text",
			"main",
		);
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
		const manifest = JSON.parse(
			await assets.getBlobContent(asset.id, KNOWLEDGE_MANIFEST_PATH),
		);

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
		expect(
			Object.keys((asset.metadata?.blobContents ?? {}) as Record<string, string>),
		).not.toEqual(
			expect.arrayContaining([
				expect.stringContaining(".internshannon/knowledge/index/"),
			]),
		);
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

	it("marks images as waiting for OCR and removes stale derived artifacts", async () => {
		const { asset, assets, ingestion } = createHarness();
		await assets.updateBlob(
			asset.id,
			"raw/sources/old.txt",
			"Temporary searchable source.",
			"Add",
			"main",
		);
		await assets.updateBlobBinary(
			asset.id,
			"raw/sources/scan.png",
			Buffer.from([1, 2, 3]),
			"Add image",
			"main",
		);
		const first = await ingestion.reindex(asset.id);
		const old = first.manifest.sources.find((source) =>
			source.path.endsWith("old.txt"),
		);

		await assets.deleteBlob(asset.id, "raw/sources/old.txt", "Delete", "main");
		const second = await ingestion.reindex(asset.id);

		expect(second.manifest.sources).toEqual([
			expect.objectContaining({
				path: "raw/sources/scan.png",
				status: "waiting_for_ocr",
				chunkCount: 0,
			}),
		]);
		await expect(
			assets.getBlobContent(asset.id, old?.extractedTextPath ?? ""),
		).rejects.toThrow();
		await expect(
			assets.getBlobContent(asset.id, old?.chunksPath ?? ""),
		).rejects.toThrow();
	});

	const pdfTest = process.env.NODE_OPTIONS?.includes(
		"--experimental-vm-modules",
	)
		? it
		: it.skip;
	pdfTest(
		"extracts text from a PDF without requiring a rendering canvas",
		async () => {
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
			expect(
				await assets.getBlobContent(asset.id, source.extractedTextPath ?? ""),
			).toContain("PDF source sentence");
		},
	);
});
