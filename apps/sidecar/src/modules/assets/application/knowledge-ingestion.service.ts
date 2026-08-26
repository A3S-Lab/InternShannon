import { createHash, type Hash } from "node:crypto";
import { Inject, Injectable, Optional } from "@nestjs/common";

import JSZip = require("jszip");
import XLSX = require("xlsx");
import yauzl = require("yauzl");

import { createOcrRegistry, OcrBackendError } from "@a3s-lab/ocr";
import { CONFIG_SERVICE, ConfigService } from "@/modules/config/domain/services/config-service.interface";
import type { Asset } from "../domain/entities/asset.entity";
import { isInternalKnowledgePath, isPublicKnowledgeSourcePath } from "../domain/knowledge/knowledge-source-path.policy";
import { LOCAL_EMBEDDING_DIMENSIONS, LOCAL_EMBEDDING_MODEL, localEmbedding } from "../domain/knowledge/local-embedding";
import { ASSET_SERVICE, type IAssetService } from "../domain/services/asset.service.interface";
import { KnowledgeEmbeddingService, MAX_KNOWLEDGE_EMBEDDING_DIMENSIONS } from "./knowledge-embedding.service";

export const KNOWLEDGE_INDEX_ROOT = ".internshannon/knowledge/index";
export const KNOWLEDGE_MANIFEST_PATH = `${KNOWLEDGE_INDEX_ROOT}/manifest.json`;
export const KNOWLEDGE_INGESTION_LIMITS = Symbol("KNOWLEDGE_INGESTION_LIMITS");

export const DEFAULT_KNOWLEDGE_INGESTION_LIMITS = Object.freeze({
    maxSourceCount: 2_000,
    maxExtractedCharacters: 32 * 1024 * 1024,
    maxChunkCount: 32_000,
    embeddingBatchSize: 64,
});

export const MAX_KNOWLEDGE_CHUNK_ARTIFACT_BYTES = 32 * 1024 * 1024;
export const MAX_KNOWLEDGE_VECTOR_INDEX_BYTES = 256 * 1024 * 1024;
export const MAX_KNOWLEDGE_VECTOR_INDEX_RECORDS = DEFAULT_KNOWLEDGE_INGESTION_LIMITS.maxChunkCount;
export const MAX_KNOWLEDGE_VECTOR_INDEX_SCALARS = 16_777_216;

export interface KnowledgeIngestionLimits {
    maxSourceCount: number;
    maxExtractedCharacters: number;
    maxChunkCount: number;
    embeddingBatchSize: number;
}

export type KnowledgeSourceStatus = "indexed" | "waiting_for_ocr" | "unsupported" | "error";

export interface KnowledgeSourceChunk {
    id: string;
    index: number;
    sourcePath: string;
    mime: string;
    contentSha: string;
    charStart: number;
    charEnd: number;
    lineStart: number;
    lineEnd: number;
    pageStart: number;
    pageEnd: number;
    text: string;
}

export interface KnowledgeVectorRecord {
    id: string;
    sourcePath: string;
    chunkIndex: number;
    contentSha: string;
    charStart: number;
    charEnd: number;
    lineStart: number;
    lineEnd: number;
    pageStart: number;
    pageEnd: number;
    embedding: number[];
}

export interface KnowledgeVectorIndex {
    version: 1;
    model: string;
    provider?: string;
    generatedAt: string;
    dimensions: number;
    records: KnowledgeVectorRecord[];
}

export interface KnowledgeSourceManifestEntry {
    path: string;
    mime: string;
    sha: string;
    size: number;
    status: KnowledgeSourceStatus;
    extractedTextPath?: string;
    chunksPath?: string;
    chunkCount: number;
    extractedCharCount?: number;
    extractedAt: string;
    error?: string;
    retryable?: boolean;
    extractionMethod?: "native" | "ocr";
    ocrBackend?: string;
    ocrModel?: string;
}

export type KnowledgeResourceLimitName = "source_count" | "extracted_characters" | "chunk_count";

export interface KnowledgeResourceLimitState {
    maxSourceCount: number;
    sourceCount: number;
    maxExtractedCharacters: number;
    extractedCharacterCount: number;
    indexedExtractedCharacters: number;
    maxChunkCount: number;
    chunkCount: number;
    indexedChunkCount: number;
    exceeded: KnowledgeResourceLimitName[];
}

export interface KnowledgeSourceManifest {
    version: 1;
    /** Stable content/config identity for the atomically published source index. */
    revision?: string;
    schemaSha?: string;
    generatedAt: string;
    embeddingModel?: string;
    embeddingProvider?: string;
    embeddingDimensions?: number;
    vectorIndexPath?: string;
    resourceLimits?: KnowledgeResourceLimitState;
    incompleteReasons?: string[];
    sources: KnowledgeSourceManifestEntry[];
}

export interface KnowledgeIndexSnapshot {
    revision: string;
    generatedAt: string;
    indexedSourceCount: number;
    incompleteSourceCount: number;
    waitingForOcrCount: number;
    errorSourceCount: number;
    unsupportedSourceCount: number;
    staleSourceCount: number;
    resourceLimits?: KnowledgeResourceLimitState;
    wikiResourceLimits: KnowledgeWikiResourceLimitState;
    incompleteReasons: string[];
}

export interface KnowledgeWikiResourceLimitState {
    maxDocumentCount: number;
    documentCount: number;
    selectedDocumentCount: number;
    omittedDocumentCount: number;
    maxDocumentCharacters: number;
    oversizedDocumentCount: number;
    maxTotalCharacters: number;
    selectedCharacterCount: number;
    totalCharacterOmissionCount: number;
}

export interface KnowledgeReindexResult {
    manifest: KnowledgeSourceManifest;
    sourceCount: number;
    indexedSourceCount: number;
    reusedSourceCount: number;
    waitingForOcrCount: number;
    unsupportedSourceCount: number;
    errorSourceCount: number;
    chunkCount: number;
}

type ExtractionResult =
    | { status: "indexed"; text: string; method?: "native" | "ocr"; ocrBackend?: string; ocrModel?: string }
    | { status: "waiting_for_ocr" | "unsupported" | "error"; error: string; retryable?: boolean };

export interface KnowledgeReindexProgress {
    percent: number;
    stage: string;
    message: string;
}

export interface KnowledgeReindexOptions {
    sourcePaths?: string[];
    signal?: AbortSignal;
    onProgress?: (progress: KnowledgeReindexProgress) => void | Promise<void>;
}

const TEXT_EXTENSIONS = new Set([
    "txt",
    "md",
    "markdown",
    "csv",
    "tsv",
    "json",
    "jsonl",
    "yaml",
    "yml",
    "xml",
    "html",
    "htm",
    "log",
    "rst",
]);
const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "gif", "webp", "bmp", "tif", "tiff", "heic"]);
const MAX_SOURCE_BYTES = 50 * 1024 * 1024;
const MAX_EXTRACTED_CHARS = 10 * 1024 * 1024;
const MAX_OFFICE_ARCHIVE_ENTRIES = 10_000;
const MAX_OFFICE_ARCHIVE_ENTRY_BYTES = 64 * 1024 * 1024;
const MAX_OFFICE_ARCHIVE_TOTAL_BYTES = 128 * 1024 * 1024;
const MAX_OFFICE_ARCHIVE_COMPRESSION_RATIO = 200;
const MAX_WIKI_DOCUMENTS = 2_000;
const MAX_WIKI_DOCUMENT_CHARACTERS = 2 * 1024 * 1024;
const MAX_WIKI_TOTAL_CHARACTERS = 32 * 1024 * 1024;
const CHUNK_SIZE = 1_200;
const CHUNK_OVERLAP = 160;
const MAX_CHUNK_TEXT_CHARACTERS = CHUNK_SIZE + CHUNK_OVERLAP;

interface WikiSnapshotEntry {
    path: string;
    size: number;
    sha: string;
    selected: boolean;
    omission?: "document_limit" | "document_size" | "total_characters";
}

interface CurrentWikiSnapshot {
    entries: WikiSnapshotEntry[];
    omittedMetadataSha: string;
    limits: KnowledgeWikiResourceLimitState;
    incompleteReasons: string[];
}

@Injectable()
export class KnowledgeIngestionService {
    private readonly chunkCache = new Map<string, Promise<KnowledgeSourceChunk[]>>();
    private readonly vectorCache = new Map<string, Promise<KnowledgeVectorIndex | null>>();
    private readonly snapshotCache = new Map<string, Promise<KnowledgeIndexSnapshot>>();
    private readonly limits: KnowledgeIngestionLimits;

    constructor(
        @Inject(ASSET_SERVICE) private readonly assets: IAssetService,
        @Optional() @Inject(CONFIG_SERVICE) private readonly config?: ConfigService,
        @Optional() private readonly embeddings?: KnowledgeEmbeddingService,
        @Optional()
        @Inject(KNOWLEDGE_INGESTION_LIMITS)
        limitOverrides?: Partial<KnowledgeIngestionLimits>,
    ) {
        this.limits = {
            maxSourceCount: this.hardLimit(
                limitOverrides?.maxSourceCount,
                DEFAULT_KNOWLEDGE_INGESTION_LIMITS.maxSourceCount,
            ),
            maxExtractedCharacters: this.hardLimit(
                limitOverrides?.maxExtractedCharacters,
                DEFAULT_KNOWLEDGE_INGESTION_LIMITS.maxExtractedCharacters,
            ),
            maxChunkCount: this.hardLimit(
                limitOverrides?.maxChunkCount,
                DEFAULT_KNOWLEDGE_INGESTION_LIMITS.maxChunkCount,
            ),
            embeddingBatchSize: this.hardLimit(
                limitOverrides?.embeddingBatchSize,
                DEFAULT_KNOWLEDGE_INGESTION_LIMITS.embeddingBatchSize,
            ),
        };
    }

    async reindex(assetId: string, options: KnowledgeReindexOptions = {}): Promise<KnowledgeReindexResult> {
        const asset = await this.requireKnowledgeAsset(assetId);
        const previous = await this.readManifest(assetId, true);
        // Capture the currently published vector artifact before writing any
        // new derived files. If the rebuilt records are byte-for-byte
        // equivalent, retaining its timestamp keeps the immutable artifact and
        // manifest revision stable across no-op reindexes.
        const previousVectorIndex = await this.readVectorIndex(assetId, previous).catch(() => null);
        const previousByPath = new Map(previous.sources.map((source) => [source.path, source]));
        const now = new Date().toISOString();
        const allSourcePaths = this.sourcePaths(asset);
        const allowedSourcePaths = new Set(allSourcePaths.slice(0, this.limits.maxSourceCount));
        const requestedPaths = Array.from(new Set((options.sourcePaths ?? []).filter(Boolean)));
        const missingPaths = requestedPaths.filter((path) => !allSourcePaths.includes(path));
        if (missingPaths.length > 0) throw new Error(`Knowledge source not found: ${missingPaths.join(", ")}`);
        const requestedPathsToProcess =
            requestedPaths.length > 0
                ? requestedPaths.filter((path) => allowedSourcePaths.has(path))
                : allSourcePaths.slice(0, this.limits.maxSourceCount);
        // A targeted rebuild must not leave legacy content-SHA-only artifacts
        // beside newly namespaced ones: duplicate legacy sources may still
        // share a chunks file. Migrate every eligible legacy indexed entry in
        // the same atomic publication, once.
        const legacyMigrationPaths = previous.sources
            .filter(
                (entry) =>
                    entry.status === "indexed" &&
                    allowedSourcePaths.has(entry.path) &&
                    allSourcePaths.includes(entry.path) &&
                    !this.hasCurrentArtifactIdentity(entry),
            )
            .map((entry) => entry.path);
        const pathsToProcess = Array.from(new Set([...requestedPathsToProcess, ...legacyMigrationPaths])).sort();
        const processing = new Set(pathsToProcess);
        const sources: KnowledgeSourceManifestEntry[] = [];
        const exceeded = new Set<KnowledgeResourceLimitName>();
        if (allSourcePaths.length > this.limits.maxSourceCount) exceeded.add("source_count");
        let indexedExtractedCharacters = 0;
        let indexedChunkCount = 0;
        let extractedCharacterCount = 0;
        let chunkCount = 0;
        for (const source of previous.sources
            .filter(
                (entry) =>
                    allSourcePaths.includes(entry.path) &&
                    !processing.has(entry.path) &&
                    allowedSourcePaths.has(entry.path),
            )
            .sort((left, right) => left.path.localeCompare(right.path))) {
            if (source.status !== "indexed") {
                sources.push(source);
                continue;
            }
            const extractedCharCount = await this.entryExtractedCharCount(assetId, source);
            extractedCharacterCount += extractedCharCount;
            chunkCount += source.chunkCount;
            if (
                indexedExtractedCharacters + extractedCharCount > this.limits.maxExtractedCharacters ||
                indexedChunkCount + source.chunkCount > this.limits.maxChunkCount
            ) {
                if (indexedExtractedCharacters + extractedCharCount > this.limits.maxExtractedCharacters) {
                    exceeded.add("extracted_characters");
                }
                if (indexedChunkCount + source.chunkCount > this.limits.maxChunkCount) exceeded.add("chunk_count");
                sources.push(
                    this.failedEntry(
                        source.path,
                        source.mime,
                        source.sha,
                        source.size,
                        now,
                        "error",
                        "知识索引全局资源上限已达到；该来源未纳入本次完整索引",
                    ),
                );
                continue;
            }
            indexedExtractedCharacters += extractedCharCount;
            indexedChunkCount += source.chunkCount;
            sources.push({ ...source, extractedCharCount });
        }
        let reusedSourceCount = 0;

        await this.reportProgress(options, 2, "scanning", `发现 ${allSourcePaths.length} 个来源`);
        for (const [sourceIndex, path] of pathsToProcess.entries()) {
            this.assertNotAborted(options.signal);
            await this.reportProgress(
                options,
                5 + (sourceIndex / Math.max(1, pathsToProcess.length)) * 65,
                "extracting",
                `正在处理 ${path}`,
            );
            const blob = await this.assets.getBlobData(assetId, path);
            const bytes =
                blob.encoding === "base64" ? Buffer.from(blob.content, "base64") : Buffer.from(blob.content, "utf8");
            const sha = blob.contentSha || createHash("sha1").update(bytes).digest("hex");
            const previousEntry = previousByPath.get(path);
            if (
                previousEntry?.sha === sha &&
                (previousEntry.status !== "indexed" || this.hasCurrentArtifactIdentity(previousEntry)) &&
                (await this.entryArtifactsExist(assetId, previousEntry))
            ) {
                const extractedCharCount = await this.entryExtractedCharCount(assetId, previousEntry);
                extractedCharacterCount += extractedCharCount;
                chunkCount += previousEntry.chunkCount;
                if (
                    previousEntry.status !== "indexed" ||
                    (indexedExtractedCharacters + extractedCharCount <= this.limits.maxExtractedCharacters &&
                        indexedChunkCount + previousEntry.chunkCount <= this.limits.maxChunkCount)
                ) {
                    sources.push({
                        ...previousEntry,
                        ...(previousEntry.status === "indexed" ? { extractedCharCount } : {}),
                    });
                    if (previousEntry.status === "indexed") {
                        indexedExtractedCharacters += extractedCharCount;
                        indexedChunkCount += previousEntry.chunkCount;
                    }
                    reusedSourceCount += 1;
                    continue;
                }
                if (indexedExtractedCharacters + extractedCharCount > this.limits.maxExtractedCharacters) {
                    exceeded.add("extracted_characters");
                }
                if (indexedChunkCount + previousEntry.chunkCount > this.limits.maxChunkCount) {
                    exceeded.add("chunk_count");
                }
                sources.push(
                    this.failedEntry(
                        path,
                        blob.mime,
                        sha,
                        bytes.byteLength,
                        now,
                        "error",
                        "知识索引全局资源上限已达到；该来源未纳入本次完整索引",
                    ),
                );
                continue;
            }

            if (bytes.byteLength > MAX_SOURCE_BYTES) {
                sources.push(
                    this.failedEntry(path, blob.mime, sha, bytes.byteLength, now, "error", "来源文件超过 50 MB 限制"),
                );
                continue;
            }

            try {
                const extraction = await this.extract(path, blob.mime, bytes, blob.encoding, options.signal);
                if (extraction.status !== "indexed") {
                    sources.push(
                        this.failedEntry(
                            path,
                            blob.mime,
                            sha,
                            bytes.byteLength,
                            now,
                            extraction.status,
                            extraction.error,
                            extraction.retryable,
                        ),
                    );
                    continue;
                }
                const text = extraction.text.trim();
                if (!text) {
                    sources.push(
                        this.failedEntry(
                            path,
                            blob.mime,
                            sha,
                            bytes.byteLength,
                            now,
                            "waiting_for_ocr",
                            "未抽取到文本，且 OCR 后端未启用",
                        ),
                    );
                    continue;
                }
                extractedCharacterCount += text.length;
                if (text.length > MAX_EXTRACTED_CHARS) {
                    sources.push(
                        this.failedEntry(
                            path,
                            blob.mime,
                            sha,
                            bytes.byteLength,
                            now,
                            "error",
                            `单个来源抽取文本超过 ${MAX_EXTRACTED_CHARS} 字符硬限制；未进行静默截断`,
                        ),
                    );
                    continue;
                }
                if (indexedExtractedCharacters + text.length > this.limits.maxExtractedCharacters) {
                    exceeded.add("extracted_characters");
                    sources.push(
                        this.failedEntry(
                            path,
                            blob.mime,
                            sha,
                            bytes.byteLength,
                            now,
                            "error",
                            `知识索引抽取文本总量超过 ${this.limits.maxExtractedCharacters} 字符硬限制；该来源未建立索引`,
                        ),
                    );
                    continue;
                }
                const sourceFingerprint = this.sourceFingerprint(path, sha);
                const extractedTextSha = this.textSha(text);
                const extractedTextPath = `${KNOWLEDGE_INDEX_ROOT}/extracted/${sourceFingerprint}-${extractedTextSha}.txt`;
                const chunks = await this.chunkText(path, blob.mime, sha, sourceFingerprint, text, options.signal);
                const chunksContent = `${JSON.stringify(chunks, null, 2)}\n`;
                const chunksPath = `${KNOWLEDGE_INDEX_ROOT}/chunks/${sourceFingerprint}-${this.textSha(chunksContent)}.json`;
                chunkCount += chunks.length;
                if (indexedChunkCount + chunks.length > this.limits.maxChunkCount) {
                    exceeded.add("chunk_count");
                    sources.push(
                        this.failedEntry(
                            path,
                            blob.mime,
                            sha,
                            bytes.byteLength,
                            now,
                            "error",
                            `知识索引分块总数超过 ${this.limits.maxChunkCount} 个硬限制；该来源未建立索引`,
                        ),
                    );
                    continue;
                }
                await this.writeTextIfChanged(assetId, extractedTextPath, text, `Extract knowledge source ${path}`);
                await this.writeTextIfChanged(assetId, chunksPath, chunksContent, `Chunk knowledge source ${path}`);
                sources.push({
                    path,
                    mime: blob.mime,
                    sha,
                    size: bytes.byteLength,
                    status: "indexed",
                    extractedTextPath,
                    chunksPath,
                    chunkCount: chunks.length,
                    extractedCharCount: text.length,
                    extractedAt: now,
                    extractionMethod: extraction.method ?? "native",
                    ocrBackend: extraction.ocrBackend,
                    ocrModel: extraction.ocrModel,
                });
                indexedExtractedCharacters += text.length;
                indexedChunkCount += chunks.length;
            } catch (error) {
                sources.push(
                    this.failedEntry(
                        path,
                        blob.mime,
                        sha,
                        bytes.byteLength,
                        now,
                        "error",
                        error instanceof Error ? error.message : String(error),
                    ),
                );
            }
        }

        this.assertNotAborted(options.signal);
        await this.reportProgress(options, 74, "embedding", "正在构建向量索引");
        this.assertNotAborted(options.signal);
        // Partial and full reindexes must publish the same vector record order
        // for the same logical index; processing order is not index identity.
        sources.sort((left, right) => left.path.localeCompare(right.path));
        const vectorIndex = await this.buildVectorIndex(asset, sources, now, options.signal);
        this.assertNotAborted(options.signal);
        if (
            previousVectorIndex &&
            this.vectorSemanticFingerprint(previousVectorIndex) === this.vectorSemanticFingerprint(vectorIndex)
        ) {
            vectorIndex.generatedAt = previousVectorIndex.generatedAt;
        }
        const vectorIndexContent = `${JSON.stringify(vectorIndex)}\n`;
        if (Buffer.byteLength(vectorIndexContent, "utf8") > MAX_KNOWLEDGE_VECTOR_INDEX_BYTES) {
            throw new Error(`Knowledge vector index exceeds ${MAX_KNOWLEDGE_VECTOR_INDEX_BYTES} bytes`);
        }
        // Bind the path and manifest revision to the complete serialized
        // artifact, including every embedding scalar. The full SHA-256 keeps
        // vector artifacts immutable and prevents a changed provider response
        // from remaining reachable through an old revision/cursor.
        const vectorArtifactSha = this.textSha(vectorIndexContent);
        const vectorIndexPath = `${KNOWLEDGE_INDEX_ROOT}/vectors/${this.safeModelPath(vectorIndex.provider, vectorIndex.model)}-${vectorArtifactSha}.json`;
        await this.writeTextIfChanged(
            assetId,
            vectorIndexPath,
            vectorIndexContent,
            `Build knowledge vector index (${vectorIndex.model})`,
        );
        // Vector files are immutable and only become visible when the manifest
        // below is published. An abort here leaves the previous manifest and
        // its vector revision untouched.
        this.assertNotAborted(options.signal);
        const schemaSha = await this.blobContentSha(assetId, "schema.md");
        const resourceLimits: KnowledgeResourceLimitState = {
            maxSourceCount: this.limits.maxSourceCount,
            sourceCount: allSourcePaths.length,
            maxExtractedCharacters: this.limits.maxExtractedCharacters,
            extractedCharacterCount,
            indexedExtractedCharacters,
            maxChunkCount: this.limits.maxChunkCount,
            chunkCount,
            indexedChunkCount,
            exceeded: Array.from(exceeded).sort(),
        };
        const incompleteReasons = this.resourceLimitReasons(resourceLimits);
        const manifest: KnowledgeSourceManifest = {
            version: 1,
            revision: this.indexRevision(sources, vectorIndex, vectorArtifactSha, schemaSha, resourceLimits),
            ...(schemaSha ? { schemaSha } : {}),
            generatedAt: now,
            embeddingModel: vectorIndex.model,
            embeddingProvider: vectorIndex.provider,
            embeddingDimensions: vectorIndex.dimensions,
            vectorIndexPath,
            resourceLimits,
            incompleteReasons,
            sources,
        };
        // Publishing the manifest is the commit point. Once this write starts,
        // callers treat the completed reindex as successful even if a cancel
        // request races with the final write.
        await this.writeTextIfChanged(
            assetId,
            KNOWLEDGE_MANIFEST_PATH,
            `${JSON.stringify(manifest, null, 2)}\n`,
            "Rebuild knowledge source manifest",
        );
        await this.removeStaleArtifacts(assetId, previous, manifest);
        await this.reportProgress(options, 98, "finalizing", "正在更新知识库状态");

        return {
            manifest,
            sourceCount: sources.length,
            indexedSourceCount: sources.filter((source) => source.status === "indexed").length,
            reusedSourceCount,
            waitingForOcrCount: sources.filter((source) => source.status === "waiting_for_ocr").length,
            unsupportedSourceCount: sources.filter((source) => source.status === "unsupported").length,
            errorSourceCount: sources.filter((source) => source.status === "error").length,
            chunkCount: sources.reduce((sum, source) => sum + source.chunkCount, 0),
        };
    }

    async getManifest(assetId: string): Promise<KnowledgeSourceManifest> {
        return this.readManifest(assetId, false);
    }

    async getIndexSnapshot(
        assetId: string,
        providedManifest?: KnowledgeSourceManifest,
    ): Promise<KnowledgeIndexSnapshot> {
        const asset = await this.requireKnowledgeAsset(assetId);
        const manifest = providedManifest ?? (await this.getManifest(assetId));
        const cacheKey = `${assetId}:${manifest.revision ?? ""}:${this.snapshotFingerprint(asset)}`;
        const cached = this.snapshotCache.get(cacheKey);
        if (cached) return cached;
        const pending = this.buildIndexSnapshot(asset, manifest).catch((error) => {
            this.snapshotCache.delete(cacheKey);
            throw error;
        });
        this.remember(this.snapshotCache, cacheKey, pending, 64);
        return pending;
    }

    private async readManifest(assetId: string, includeInternal: boolean): Promise<KnowledgeSourceManifest> {
        const content = await this.assets.getBlobContent(assetId, KNOWLEDGE_MANIFEST_PATH).catch(() => null);
        if (!content) return { version: 1, generatedAt: "", sources: [] };
        try {
            const parsed = JSON.parse(content) as Partial<KnowledgeSourceManifest>;
            if (parsed.version !== 1 || !Array.isArray(parsed.sources)) throw new Error("unsupported manifest");
            return {
                version: 1,
                revision:
                    typeof parsed.revision === "string" && parsed.revision
                        ? parsed.revision
                        : this.legacyIndexRevision(parsed),
                schemaSha: typeof parsed.schemaSha === "string" ? parsed.schemaSha : undefined,
                generatedAt: typeof parsed.generatedAt === "string" ? parsed.generatedAt : "",
                embeddingModel: typeof parsed.embeddingModel === "string" ? parsed.embeddingModel : undefined,
                embeddingProvider: typeof parsed.embeddingProvider === "string" ? parsed.embeddingProvider : undefined,
                embeddingDimensions:
                    typeof parsed.embeddingDimensions === "number" ? parsed.embeddingDimensions : undefined,
                vectorIndexPath: typeof parsed.vectorIndexPath === "string" ? parsed.vectorIndexPath : undefined,
                resourceLimits: this.parseResourceLimits(parsed.resourceLimits),
                incompleteReasons: Array.isArray(parsed.incompleteReasons)
                    ? parsed.incompleteReasons.filter((reason): reason is string => typeof reason === "string")
                    : [],
                sources: parsed.sources
                    .filter(this.isManifestEntry)
                    .filter((source) => includeInternal || isPublicKnowledgeSourcePath(source.path)),
            };
        } catch {
            return { version: 1, generatedAt: "", sources: [] };
        }
    }

    async readChunks(assetId: string, entry: KnowledgeSourceManifestEntry): Promise<KnowledgeSourceChunk[]> {
        if (!isPublicKnowledgeSourcePath(entry.path)) return [];
        if (!entry.chunksPath) return [];
        const cacheKey = `${assetId}:${entry.chunksPath}:${this.sourceFingerprint(entry.path, entry.sha)}`;
        const cached = this.chunkCache.get(cacheKey);
        if (cached) return cached;
        const pending = (async () => {
            if (
                await this.artifactExceedsLimit(assetId, entry.chunksPath as string, MAX_KNOWLEDGE_CHUNK_ARTIFACT_BYTES)
            ) {
                throw new Error(`Knowledge chunk artifact exceeds ${MAX_KNOWLEDGE_CHUNK_ARTIFACT_BYTES} bytes`);
            }
            const content = await this.assets.getBlobContent(assetId, entry.chunksPath as string).catch(() => null);
            if (!content) return [];
            try {
                const parsed = JSON.parse(content) as Array<Partial<KnowledgeSourceChunk>>;
                if (
                    Buffer.byteLength(content, "utf8") > MAX_KNOWLEDGE_CHUNK_ARTIFACT_BYTES ||
                    !Array.isArray(parsed) ||
                    !Number.isSafeInteger(entry.chunkCount) ||
                    entry.chunkCount < 0 ||
                    entry.chunkCount > DEFAULT_KNOWLEDGE_INGESTION_LIMITS.maxChunkCount ||
                    parsed.length !== entry.chunkCount
                ) {
                    throw new Error("invalid chunk artifact shape");
                }
                const ids = new Set<string>();
                return parsed.map((chunk, index) => {
                    if (!chunk || typeof chunk.text !== "string" || chunk.text.length > MAX_CHUNK_TEXT_CHARACTERS) {
                        throw new Error("invalid chunk text");
                    }
                    if (chunk.index !== undefined && (!Number.isSafeInteger(chunk.index) || chunk.index !== index)) {
                        throw new Error("invalid chunk index");
                    }
                    if (chunk.sourcePath !== undefined && chunk.sourcePath !== entry.path) {
                        throw new Error("invalid chunk source path");
                    }
                    if (chunk.contentSha !== undefined && chunk.contentSha !== entry.sha) {
                        throw new Error("invalid chunk source sha");
                    }
                    if (
                        [
                            chunk.charStart,
                            chunk.charEnd,
                            chunk.lineStart,
                            chunk.lineEnd,
                            chunk.pageStart,
                            chunk.pageEnd,
                        ].some(
                            (value) =>
                                value !== undefined &&
                                (!Number.isSafeInteger(value) || (typeof value === "number" && value < 0)),
                        )
                    ) {
                        throw new Error("invalid chunk locator");
                    }
                    const charStart = this.nonNegativeNumber(chunk.charStart, 0);
                    const charEnd = this.nonNegativeNumber(chunk.charEnd, charStart + chunk.text.length);
                    if (charEnd < charStart) throw new Error("invalid chunk character range");
                    const id =
                        typeof chunk.id === "string" && chunk.id
                            ? chunk.id
                            : `${this.sourceFingerprint(entry.path, entry.sha)}:${index}`;
                    if (ids.has(id)) throw new Error("duplicate chunk id");
                    ids.add(id);
                    return {
                        id,
                        index,
                        sourcePath: entry.path,
                        mime: typeof chunk.mime === "string" ? chunk.mime : entry.mime,
                        contentSha: entry.sha,
                        charStart,
                        charEnd,
                        lineStart: this.positiveNumber(chunk.lineStart, 1),
                        lineEnd: this.positiveNumber(chunk.lineEnd, 1),
                        pageStart: this.positiveNumber(chunk.pageStart, 1),
                        pageEnd: this.positiveNumber(chunk.pageEnd, 1),
                        text: chunk.text,
                    };
                });
            } catch (error) {
                throw new Error(
                    `Knowledge chunk artifact is invalid; reindex is required: ${error instanceof Error ? error.message : String(error)}`,
                );
            }
        })();
        this.remember(this.chunkCache, cacheKey, pending, 256);
        return pending;
    }

    async readVectorIndex(assetId: string, manifest?: KnowledgeSourceManifest): Promise<KnowledgeVectorIndex | null> {
        const current = manifest ?? (await this.getManifest(assetId));
        if (!current.vectorIndexPath) return null;
        const cacheKey = `${assetId}:${current.vectorIndexPath}`;
        const cached = this.vectorCache.get(cacheKey);
        if (cached) return cached;
        const pending = (async () => {
            if (
                await this.artifactExceedsLimit(
                    assetId,
                    current.vectorIndexPath as string,
                    MAX_KNOWLEDGE_VECTOR_INDEX_BYTES,
                )
            ) {
                return null;
            }
            const content = await this.assets
                .getBlobContent(assetId, current.vectorIndexPath as string)
                .catch(() => null);
            if (!content) return null;
            try {
                if (Buffer.byteLength(content, "utf8") > MAX_KNOWLEDGE_VECTOR_INDEX_BYTES) return null;
                return await this.validVectorIndex(assetId, JSON.parse(content), current);
            } catch {
                return null;
            }
        })();
        this.remember(this.vectorCache, cacheKey, pending, 8);
        return pending;
    }

    private async validVectorIndex(
        assetId: string,
        value: unknown,
        manifest: KnowledgeSourceManifest,
    ): Promise<KnowledgeVectorIndex | null> {
        if (!value || typeof value !== "object" || Array.isArray(value)) return null;
        const parsed = value as Partial<KnowledgeVectorIndex>;
        if (
            parsed.version !== 1 ||
            typeof parsed.model !== "string" ||
            !parsed.model ||
            (parsed.provider !== undefined && typeof parsed.provider !== "string") ||
            typeof parsed.generatedAt !== "string" ||
            !Number.isSafeInteger(parsed.dimensions) ||
            (parsed.dimensions ?? 0) <= 0 ||
            (parsed.dimensions ?? 0) > MAX_KNOWLEDGE_EMBEDDING_DIMENSIONS ||
            !Array.isArray(parsed.records) ||
            parsed.records.length > MAX_KNOWLEDGE_VECTOR_INDEX_RECORDS ||
            (manifest.embeddingDimensions !== undefined && parsed.dimensions !== manifest.embeddingDimensions) ||
            (manifest.embeddingModel !== undefined && parsed.model !== manifest.embeddingModel) ||
            (manifest.embeddingProvider !== undefined && (parsed.provider ?? "local") !== manifest.embeddingProvider)
        ) {
            return null;
        }
        const dimensions = parsed.dimensions as number;
        if (parsed.records.length * dimensions > MAX_KNOWLEDGE_VECTOR_INDEX_SCALARS) return null;
        const expectedChunkCount = manifest.sources
            .filter((source) => source.status === "indexed")
            .reduce((sum, source) => sum + source.chunkCount, 0);
        const declaredChunkCount = Math.max(
            expectedChunkCount,
            manifest.resourceLimits?.indexedChunkCount ?? expectedChunkCount,
        );
        if (
            parsed.records.length !== expectedChunkCount ||
            parsed.records.length > Math.min(MAX_KNOWLEDGE_VECTOR_INDEX_RECORDS, declaredChunkCount)
        )
            return null;
        const sourceByPath = new Map(
            manifest.sources
                .filter((source) => source.status === "indexed")
                .map((source) => [source.path, source] as const),
        );
        const expectedChunksBySource = new Map<string, KnowledgeSourceChunk[]>();
        const expectedPairs = new Set<string>();
        for (const source of sourceByPath.values()) {
            const chunks = await this.readChunks(assetId, source);
            if (chunks.length !== source.chunkCount) return null;
            expectedChunksBySource.set(source.path, chunks);
            for (const chunk of chunks) expectedPairs.add(this.vectorRecordPairKey(source.path, chunk.index));
        }
        if (expectedPairs.size !== expectedChunkCount) return null;
        const ids = new Set<string>();
        const pairs = new Set<string>();
        for (const record of parsed.records) {
            if (!record || typeof record !== "object") return null;
            const source = typeof record.sourcePath === "string" ? sourceByPath.get(record.sourcePath) : undefined;
            const pairKey =
                typeof record.sourcePath === "string" && Number.isSafeInteger(record.chunkIndex)
                    ? this.vectorRecordPairKey(record.sourcePath, record.chunkIndex)
                    : "";
            const expectedChunk = source ? expectedChunksBySource.get(source.path)?.[record.chunkIndex] : undefined;
            if (
                typeof record.id !== "string" ||
                !record.id ||
                ids.has(record.id) ||
                !pairKey ||
                pairs.has(pairKey) ||
                !source ||
                !expectedChunk ||
                record.id !== expectedChunk.id ||
                record.contentSha !== source.sha ||
                record.contentSha !== expectedChunk.contentSha ||
                !Number.isSafeInteger(record.chunkIndex) ||
                record.chunkIndex < 0 ||
                record.chunkIndex >= source.chunkCount ||
                !Array.isArray(record.embedding) ||
                record.embedding.length !== dimensions ||
                record.embedding.some((scalar) => typeof scalar !== "number" || !Number.isFinite(scalar))
            ) {
                return null;
            }
            ids.add(record.id);
            pairs.add(pairKey);
        }
        if (pairs.size !== expectedPairs.size || Array.from(expectedPairs).some((pair) => !pairs.has(pair)))
            return null;
        return parsed as KnowledgeVectorIndex;
    }

    private vectorRecordPairKey(sourcePath: string, chunkIndex: number): string {
        return `${sourcePath.length}:${sourcePath}:${chunkIndex}`;
    }

    private async artifactExceedsLimit(assetId: string, path: string, limit: number): Promise<boolean> {
        const blob = await this.assets.getBlob(assetId, path).catch(() => null);
        return Boolean(blob && Number.isFinite(blob.size) && blob.size > limit);
    }

    private async extract(
        path: string,
        mime: string,
        bytes: Buffer,
        encoding: "utf8" | "base64",
        signal?: AbortSignal,
    ): Promise<ExtractionResult> {
        this.assertNotAborted(signal);
        const extension = this.extension(path);
        if (TEXT_EXTENSIONS.has(extension) || mime.startsWith("text/")) {
            return {
                status: "indexed",
                text: encoding === "utf8" ? bytes.toString("utf8") : bytes.toString("utf8"),
                method: "native",
            };
        }
        if (extension === "pdf" || mime === "application/pdf") {
            this.ensurePdfMatrix();
            const { PDFParse } = require("pdf-parse") as typeof import("pdf-parse");
            const { getPath } = require("pdf-parse/worker") as { getPath(): string };
            PDFParse.setWorker(getPath());
            const parser = new PDFParse({ data: new Uint8Array(bytes) });
            try {
                const result = await parser.getText();
                const text = result.pages
                    .map((page) => page.text)
                    .join("\n\f\n")
                    .trim();
                return text
                    ? { status: "indexed", text, method: "native" }
                    : this.extractWithOcr(path, mime, bytes, signal);
            } finally {
                await parser.destroy().catch(() => undefined);
            }
        }
        if (extension === "docx" || mime.includes("wordprocessingml.document")) {
            return { status: "indexed", text: await this.extractDocx(bytes, signal), method: "native" };
        }
        if (["xlsx", "xls", "ods"].includes(extension) || mime.includes("spreadsheet")) {
            return {
                status: "indexed",
                text: await this.extractWorkbook(path, bytes, signal),
                method: "native",
            };
        }
        if (IMAGE_EXTENSIONS.has(extension) || mime.startsWith("image/")) {
            return this.extractWithOcr(path, mime, bytes, signal);
        }
        return { status: "unsupported", error: `暂不支持抽取 ${extension || mime || "unknown"} 格式` };
    }

    private async extractWithOcr(
        path: string,
        mime: string,
        bytes: Buffer,
        signal?: AbortSignal,
    ): Promise<ExtractionResult> {
        const settings = await this.config?.getSettings().catch(() => null);
        const ocrSettings = settings?.ocr;
        if (!ocrSettings?.backends?.some((backend) => backend.enabled)) {
            return { status: "waiting_for_ocr", error: "需要 OCR，但当前没有启用 OCR 后端" };
        }
        try {
            const registry = createOcrRegistry(ocrSettings);
            const backend = registry.getDefault();
            const configured = ocrSettings.backends.find((item) => item.name === backend.name);
            const result = await registry.recognize(
                { data: bytes, filename: path.split("/").pop() || path, mimeType: mime },
                { signal, model: configured?.model, outputFormat: configured?.outputFormat },
            );
            this.assertNotAborted(signal);
            const pageText = result.pages
                .map((page) => page.text?.trim())
                .filter((text): text is string => Boolean(text))
                .join("\n\f\n");
            const text = (pageText || result.markdown || result.text).trim();
            if (!text)
                return { status: "error", error: `OCR backend ${backend.name} returned no text`, retryable: true };
            return {
                status: "indexed",
                text,
                method: "ocr",
                ocrBackend: backend.name,
                ocrModel: configured?.model,
            };
        } catch (error) {
            if (signal?.aborted) throw new DOMException("Ingest cancelled", "AbortError");
            const message = error instanceof Error ? error.message : String(error);
            return {
                status: "error",
                error: `OCR failed: ${message}`,
                retryable: error instanceof OcrBackendError ? error.status === undefined || error.status >= 429 : true,
            };
        }
    }

    private ensurePdfMatrix(): void {
        const target = globalThis as unknown as { DOMMatrix?: typeof Matrix2D };
        if (!target.DOMMatrix) target.DOMMatrix = Matrix2D;
    }

    private async extractDocx(bytes: Buffer, signal?: AbortSignal): Promise<string> {
        const archive = await this.loadSafeOfficeArchive(bytes, signal);
        const paths = Object.keys(archive.files)
            .filter((path) => /^word\/(document|footnotes|endnotes|comments|header\d+|footer\d+)\.xml$/i.test(path))
            .sort((left, right) =>
                left === "word/document.xml" ? -1 : right === "word/document.xml" ? 1 : left.localeCompare(right),
            );
        const sections: string[] = [];
        for (const path of paths) {
            this.assertNotAborted(signal);
            const xml = await archive.file(path)?.async("string");
            if (!xml) continue;
            const text = this.xmlText(xml);
            if (text) sections.push(text);
        }
        return sections.join("\n\n");
    }

    private async extractWorkbook(path: string, bytes: Buffer, signal?: AbortSignal): Promise<string> {
        const extension = this.extension(path);
        if (extension === "xlsx" || extension === "ods" || (extension !== "xls" && this.looksLikeZip(bytes))) {
            await this.loadSafeOfficeArchive(bytes, signal);
        }
        this.assertNotAborted(signal);
        const workbook = XLSX.read(bytes, { type: "buffer", cellDates: true });
        return workbook.SheetNames.map((name) => {
            const sheet = workbook.Sheets[name];
            return [`# ${name}`, XLSX.utils.sheet_to_csv(sheet, { blankrows: false })].join("\n");
        }).join("\n\n");
    }

    /** Read and validate ZIP central-directory metadata before any Office parser inflates entry bodies. */
    private async loadSafeOfficeArchive(bytes: Buffer, signal?: AbortSignal): Promise<JSZip> {
        await this.preflightOfficeArchive(bytes, signal);
        this.assertNotAborted(signal);
        return JSZip.loadAsync(bytes, { checkCRC32: false, createFolders: false });
    }

    private async preflightOfficeArchive(bytes: Buffer, signal?: AbortSignal): Promise<void> {
        const zip = await new Promise<yauzl.ZipFile>((resolve, reject) => {
            yauzl.fromBuffer(
                bytes,
                { autoClose: false, lazyEntries: true, strictFileNames: true, validateEntrySizes: true },
                (error, opened) =>
                    error || !opened ? reject(error ?? new Error("Office 压缩包无法打开")) : resolve(opened),
            );
        });
        try {
            if (zip.entryCount > MAX_OFFICE_ARCHIVE_ENTRIES) {
                throw new Error(`Office 压缩包条目数超过 ${MAX_OFFICE_ARCHIVE_ENTRIES} 个硬限制；已拒绝解析`);
            }
            await new Promise<void>((resolve, reject) => {
                let totalUncompressedBytes = 0;
                let settled = false;
                const fail = (error: unknown) => {
                    if (settled) return;
                    settled = true;
                    reject(error instanceof Error ? error : new Error(String(error)));
                    zip.close();
                };
                zip.once("error", fail);
                zip.on("entry", (entry) => {
                    if (settled) return;
                    try {
                        this.assertNotAborted(signal);
                        if (!entry.fileName.endsWith("/")) {
                            const compressedBytes = entry.compressedSize;
                            const uncompressedBytes = entry.uncompressedSize;
                            if (uncompressedBytes > MAX_OFFICE_ARCHIVE_ENTRY_BYTES) {
                                throw new Error(
                                    `Office 压缩包条目 ${entry.fileName} 解压大小超过 ${MAX_OFFICE_ARCHIVE_ENTRY_BYTES} 字节硬限制；已拒绝解析`,
                                );
                            }
                            if (totalUncompressedBytes > MAX_OFFICE_ARCHIVE_TOTAL_BYTES - uncompressedBytes) {
                                throw new Error(
                                    `Office 压缩包累计解压大小超过 ${MAX_OFFICE_ARCHIVE_TOTAL_BYTES} 字节硬限制；已拒绝解析`,
                                );
                            }
                            totalUncompressedBytes += uncompressedBytes;
                            if (uncompressedBytes > 0 && compressedBytes === 0) {
                                throw new Error(`Office 压缩包条目 ${entry.fileName} 的压缩大小异常；已拒绝解析`);
                            }
                            if (
                                uncompressedBytes > 0 &&
                                uncompressedBytes / Math.max(1, compressedBytes) > MAX_OFFICE_ARCHIVE_COMPRESSION_RATIO
                            ) {
                                throw new Error(
                                    `Office 压缩包条目 ${entry.fileName} 的压缩比超过 ${MAX_OFFICE_ARCHIVE_COMPRESSION_RATIO}:1 硬限制；已拒绝解析`,
                                );
                            }
                        }
                        zip.readEntry();
                    } catch (error) {
                        fail(error);
                    }
                });
                zip.once("end", () => {
                    if (settled) return;
                    settled = true;
                    resolve();
                });
                zip.readEntry();
            });
        } finally {
            zip.close();
        }
    }

    private looksLikeZip(bytes: Buffer): boolean {
        if (bytes.byteLength < 4) return false;
        const signature = bytes.readUInt32LE(0);
        return signature === 0x04034b50 || signature === 0x06054b50 || signature === 0x08074b50;
    }

    private xmlText(xml: string): string {
        return this.decodeXmlEntities(
            xml
                .replace(/<w:tab\b[^>]*\/>/gi, "\t")
                .replace(/<w:br\b[^>]*\/>/gi, "\n")
                .replace(/<\/w:p>/gi, "\n")
                .replace(/<[^>]+>/g, ""),
        )
            .replace(/[ \t]+\n/g, "\n")
            .replace(/\n{3,}/g, "\n\n")
            .trim();
    }

    private decodeXmlEntities(value: string): string {
        return value.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (match) => {
            const entity = match.slice(1, -1).toLowerCase();
            if (entity === "amp") return "&";
            if (entity === "lt") return "<";
            if (entity === "gt") return ">";
            if (entity === "quot") return '"';
            if (entity === "apos") return "'";
            const code = entity.startsWith("#x")
                ? Number.parseInt(entity.slice(2), 16)
                : Number.parseInt(entity.slice(1), 10);
            return Number.isFinite(code) ? String.fromCodePoint(code) : match;
        });
    }

    private async chunkText(
        sourcePath: string,
        mime: string,
        contentSha: string,
        sourceFingerprint: string,
        text: string,
        signal?: AbortSignal,
    ): Promise<KnowledgeSourceChunk[]> {
        const chunks: KnowledgeSourceChunk[] = [];
        const lineBreaks: number[] = [];
        const pageBreaks: number[] = [];
        for (let index = 0; index < text.length; index += 1) {
            if (text[index] === "\n") lineBreaks.push(index);
            if (text[index] === "\f") pageBreaks.push(index);
            if (index > 0 && index % 65_536 === 0) {
                this.assertNotAborted(signal);
                await new Promise<void>((resolve) => setImmediate(resolve));
            }
        }
        let start = 0;
        while (start < text.length) {
            let end = Math.min(text.length, start + CHUNK_SIZE);
            if (end < text.length) {
                const boundary = Math.max(
                    text.lastIndexOf("\n\n", end),
                    text.lastIndexOf("。", end),
                    text.lastIndexOf(". ", end),
                );
                if (boundary > start + CHUNK_SIZE / 2) end = boundary + 1;
            }
            const chunkText = text.slice(start, end).trim();
            if (chunkText) {
                chunks.push({
                    id: `${sourceFingerprint}:${chunks.length}`,
                    index: chunks.length,
                    sourcePath,
                    mime,
                    contentSha,
                    charStart: start,
                    charEnd: end,
                    lineStart: this.positionFromBreaks(lineBreaks, start),
                    lineEnd: this.positionFromBreaks(lineBreaks, end),
                    pageStart: this.positionFromBreaks(pageBreaks, start),
                    pageEnd: this.positionFromBreaks(pageBreaks, end),
                    text: chunkText,
                });
            }
            if (chunks.length > 0 && chunks.length % 128 === 0) {
                this.assertNotAborted(signal);
                await new Promise<void>((resolve) => setImmediate(resolve));
            }
            if (end >= text.length) break;
            start = Math.max(start + 1, end - CHUNK_OVERLAP);
        }
        return chunks;
    }

    private async buildVectorIndex(
        asset: Asset,
        sources: KnowledgeSourceManifestEntry[],
        generatedAt: string,
        signal?: AbortSignal,
    ): Promise<KnowledgeVectorIndex> {
        const records: KnowledgeVectorRecord[] = [];
        let provider = "local";
        let model = LOCAL_EMBEDDING_MODEL;
        let dimensions = LOCAL_EMBEDDING_DIMENSIONS;
        let pending: KnowledgeSourceChunk[] = [];
        const flush = async () => {
            if (pending.length === 0) return;
            this.assertNotAborted(signal);
            const chunks = pending;
            pending = [];
            const batch = this.embeddings
                ? await this.embeddings.embed(
                      asset,
                      chunks.map((chunk) => chunk.text),
                      signal,
                  )
                : {
                      provider: "local",
                      model: LOCAL_EMBEDDING_MODEL,
                      dimensions: LOCAL_EMBEDDING_DIMENSIONS,
                      vectors: chunks.map((chunk) => localEmbedding(chunk.text)),
                  };
            if (batch.vectors.length !== chunks.length)
                throw new Error("Embedding provider returned an invalid vector batch");
            if (
                !Number.isSafeInteger(batch.dimensions) ||
                batch.dimensions <= 0 ||
                batch.dimensions > MAX_KNOWLEDGE_EMBEDDING_DIMENSIONS ||
                batch.vectors.some(
                    (vector) =>
                        vector.length !== batch.dimensions ||
                        vector.some((scalar) => typeof scalar !== "number" || !Number.isFinite(scalar)),
                )
            ) {
                throw new Error("Embedding provider returned invalid vector dimensions or scalar values");
            }
            const resultingRecordCount = records.length + chunks.length;
            if (resultingRecordCount > MAX_KNOWLEDGE_VECTOR_INDEX_RECORDS) {
                throw new Error(`Knowledge vector index exceeds ${MAX_KNOWLEDGE_VECTOR_INDEX_RECORDS} records`);
            }
            if (resultingRecordCount * batch.dimensions > MAX_KNOWLEDGE_VECTOR_INDEX_SCALARS) {
                throw new Error(`Knowledge vector index exceeds ${MAX_KNOWLEDGE_VECTOR_INDEX_SCALARS} scalar values`);
            }
            if (
                records.length > 0 &&
                (batch.provider !== provider || batch.model !== model || batch.dimensions !== dimensions)
            ) {
                throw new Error("Embedding provider changed during index construction");
            }
            provider = batch.provider;
            model = batch.model;
            dimensions = batch.dimensions;
            records.push(
                ...chunks.map((chunk, index) => ({
                    id: chunk.id,
                    sourcePath: chunk.sourcePath,
                    chunkIndex: chunk.index,
                    contentSha: chunk.contentSha,
                    charStart: chunk.charStart,
                    charEnd: chunk.charEnd,
                    lineStart: chunk.lineStart,
                    lineEnd: chunk.lineEnd,
                    pageStart: chunk.pageStart,
                    pageEnd: chunk.pageEnd,
                    embedding: batch.vectors[index],
                })),
            );
            await new Promise<void>((resolve) => setImmediate(resolve));
        };
        for (const source of sources) {
            if (source.status !== "indexed") continue;
            for (const chunk of await this.readChunks(asset.id, source)) {
                pending.push(chunk);
                if (pending.length >= this.limits.embeddingBatchSize) await flush();
            }
        }
        await flush();
        return {
            version: 1,
            provider,
            model,
            generatedAt,
            dimensions,
            records,
        };
    }

    private safeModelPath(provider: string | undefined, model: string): string {
        return `${provider || "local"}-${model}`.replace(/[^a-z0-9._-]+/gi, "-").replace(/^-+|-+$/g, "") || "embedding";
    }

    private indexRevision(
        sources: KnowledgeSourceManifestEntry[],
        vectorIndex: KnowledgeVectorIndex,
        vectorArtifactSha: string,
        schemaSha: string,
        resourceLimits?: KnowledgeResourceLimitState,
    ): string {
        return createHash("sha256")
            .update(
                JSON.stringify({
                    version: 1,
                    schemaSha,
                    embedding: {
                        provider: vectorIndex.provider,
                        model: vectorIndex.model,
                        dimensions: vectorIndex.dimensions,
                        artifactSha: vectorArtifactSha,
                    },
                    resourceLimits,
                    sources: sources
                        .map((source) => ({
                            path: source.path,
                            sha: source.sha,
                            status: source.status,
                            extractedTextPath: source.extractedTextPath,
                            chunksPath: source.chunksPath,
                            chunkCount: source.chunkCount,
                            extractedCharCount: source.extractedCharCount,
                            extractionMethod: source.extractionMethod,
                            ocrBackend: source.ocrBackend,
                            ocrModel: source.ocrModel,
                        }))
                        .sort((left, right) => left.path.localeCompare(right.path)),
                }),
            )
            .digest("hex")
            .slice(0, 24);
    }

    /**
     * A source's derived identity must include its path as well as its bytes.
     * NUL is an unambiguous separator because public knowledge paths cannot
     * contain it, while hashing keeps internal artifact names bounded and safe.
     */
    private sourceFingerprint(sourcePath: string, contentSha: string): string {
        return createHash("sha256").update(sourcePath, "utf8").update("\0").update(contentSha, "utf8").digest("hex");
    }

    private textSha(content: string): string {
        return createHash("sha256").update(content, "utf8").digest("hex");
    }

    private hasCurrentArtifactIdentity(entry: KnowledgeSourceManifestEntry): boolean {
        if (entry.status !== "indexed") return true;
        const fingerprint = this.sourceFingerprint(entry.path, entry.sha);
        return Boolean(
            entry.extractedTextPath?.startsWith(`${KNOWLEDGE_INDEX_ROOT}/extracted/${fingerprint}-`) &&
                entry.chunksPath?.startsWith(`${KNOWLEDGE_INDEX_ROOT}/chunks/${fingerprint}-`),
        );
    }

    /** Hash vector semantics without the publication timestamp. */
    private vectorSemanticFingerprint(index: KnowledgeVectorIndex): string {
        const hash = createHash("sha256").update(
            JSON.stringify({
                version: index.version,
                provider: index.provider,
                model: index.model,
                dimensions: index.dimensions,
            }),
        );
        for (const record of index.records) hash.update("\0").update(JSON.stringify(record));
        return hash.digest("hex");
    }

    private async buildIndexSnapshot(asset: Asset, manifest: KnowledgeSourceManifest): Promise<KnowledgeIndexSnapshot> {
        const indexedSourceCount = manifest.sources.filter((source) => source.status === "indexed").length;
        const waitingForOcrCount = manifest.sources.filter((source) => source.status === "waiting_for_ocr").length;
        const errorSourceCount = manifest.sources.filter((source) => source.status === "error").length;
        const unsupportedSourceCount = manifest.sources.filter((source) => source.status === "unsupported").length;
        const allCurrentPaths = this.sourcePaths(asset);
        const currentPaths = allCurrentPaths.slice(0, DEFAULT_KNOWLEDGE_INGESTION_LIMITS.maxSourceCount);
        const snapshotSourceOverflow = Math.max(
            0,
            allCurrentPaths.length - DEFAULT_KNOWLEDGE_INGESTION_LIMITS.maxSourceCount,
        );
        const blobByPath = new Map(asset.blobs.map((blob) => [blob.path, blob] as const));
        const inlineContents = this.inlineBlobContents(asset);
        // Snapshot probes run on every search. Use the immutable blob metadata
        // written by AssetService instead of loading as many as 2,000 source
        // bodies in parallel. Legacy inline-only entries have no trustworthy
        // content SHA, so mark them stale and version the marker with the asset
        // update timestamp rather than silently treating them as current.
        const currentShas = new Map(
            currentPaths.map((path) => {
                const metadataSha = blobByPath.get(path)?.contentSha;
                if (metadataSha) return [path, metadataSha] as const;
                const inline = typeof inlineContents[path] === "string" ? inlineContents[path] : undefined;
                return [
                    path,
                    inline === undefined ? "" : `legacy-inline:${asset.updatedAt.getTime()}:${inline.length}`,
                ] as const;
            }),
        );
        // The manifest intentionally indexes at most 2,000 sources, but every
        // omitted source must still participate in the snapshot identity.
        // Stream immutable metadata into a fixed-size digest so probing never
        // reads omitted bodies or allocates one revision entry per source.
        const omittedSourceMetadataHash = createHash("sha256");
        for (const path of allCurrentPaths.slice(DEFAULT_KNOWLEDGE_INGESTION_LIMITS.maxSourceCount)) {
            const blob = blobByPath.get(path);
            const inline = typeof inlineContents[path] === "string" ? inlineContents[path] : undefined;
            this.updateMetadataHash(
                omittedSourceMetadataHash,
                path,
                blob?.contentSha ??
                    (inline === undefined ? "" : `legacy-inline:${asset.updatedAt.getTime()}:${inline.length}`),
                blob?.size ?? inline?.length ?? -1,
            );
        }
        const omittedSourceMetadataSha = omittedSourceMetadataHash.digest("hex");
        const manifestByPath = new Map(manifest.sources.map((source) => [source.path, source]));
        let staleSourceCount = currentPaths.filter((path) => !manifestByPath.has(path)).length;
        const incompletePaths = new Set(
            manifest.sources.filter((source) => source.status !== "indexed").map((source) => source.path),
        );
        const incompleteReasons = new Set(manifest.incompleteReasons ?? []);
        for (const reason of this.resourceLimitReasons(manifest.resourceLimits)) incompleteReasons.add(reason);
        for (const path of currentPaths) if (!manifestByPath.has(path)) incompletePaths.add(path);
        for (const source of manifest.sources) {
            const currentSha = currentShas.get(source.path);
            if (!currentSha || currentSha !== source.sha) {
                staleSourceCount += 1;
                incompletePaths.add(source.path);
            }
        }
        // A resource limit can omit sources before blob loading. Preserve that
        // omission in the aggregate count without allocating placeholder
        // manifest entries for every skipped source.
        const sourceLimitOmissions = Math.max(
            0,
            (manifest.resourceLimits?.sourceCount ?? 0) - (manifest.resourceLimits?.maxSourceCount ?? 0),
        );
        let incompleteSourceCount = Math.max(
            incompletePaths.size,
            sourceLimitOmissions,
            snapshotSourceOverflow,
            incompleteReasons.size > 0 ? 1 : 0,
        );
        const currentSchemaSha = await this.blobContentSha(asset.id, "schema.md");
        const currentWiki = await this.currentWikiEntries(asset);
        for (const reason of currentWiki.incompleteReasons) incompleteReasons.add(reason);
        if (currentWiki.incompleteReasons.length > 0) incompleteSourceCount = Math.max(1, incompleteSourceCount);
        const revision = createHash("sha256")
            .update(
                JSON.stringify({
                    manifestRevision: manifest.revision ?? this.legacyIndexRevision(manifest),
                    currentSchemaSha,
                    currentSources: Array.from(currentShas.entries()).sort(([left], [right]) =>
                        left.localeCompare(right),
                    ),
                    omittedSourceMetadataSha,
                    currentWiki: {
                        entries: currentWiki.entries,
                        omittedMetadataSha: currentWiki.omittedMetadataSha,
                    },
                }),
            )
            .digest("hex")
            .slice(0, 24);
        return {
            revision,
            generatedAt: manifest.generatedAt,
            indexedSourceCount,
            incompleteSourceCount,
            waitingForOcrCount,
            errorSourceCount,
            unsupportedSourceCount,
            staleSourceCount,
            resourceLimits: manifest.resourceLimits,
            wikiResourceLimits: currentWiki.limits,
            incompleteReasons: Array.from(incompleteReasons).concat(
                snapshotSourceOverflow > 0
                    ? [
                          `knowledge_index_snapshot_source_limit_exceeded:${allCurrentPaths.length}/${DEFAULT_KNOWLEDGE_INGESTION_LIMITS.maxSourceCount}`,
                      ]
                    : [],
            ),
        };
    }

    private async blobContentSha(assetId: string, path: string): Promise<string> {
        return this.assets
            .getBlobData(assetId, path)
            .then(
                (blob) =>
                    blob.contentSha ||
                    createHash("sha1")
                        .update(
                            blob.encoding === "base64"
                                ? Buffer.from(blob.content, "base64")
                                : Buffer.from(blob.content),
                        )
                        .digest("hex"),
            )
            .catch(() => "");
    }

    private async currentWikiEntries(asset: Asset): Promise<CurrentWikiSnapshot> {
        const isWikiPath = (path: string) =>
            path.startsWith("wiki/") && path.toLowerCase().endsWith(".md") && !isInternalKnowledgePath(path);
        const blobByPath = new Map(
            asset.blobs.filter((blob) => isWikiPath(blob.path)).map((blob) => [blob.path, blob]),
        );
        const inlineContents = this.inlineBlobContents(asset);
        const paths = new Set(blobByPath.keys());
        for (const [path, content] of Object.entries(inlineContents)) {
            if (isWikiPath(path) && typeof content === "string") paths.add(path);
        }

        const sortedPaths = Array.from(paths).sort();
        const entries: WikiSnapshotEntry[] = [];
        let selectedCharacterCount = 0;
        let selectedDocumentCount = 0;
        let oversizedDocumentCount = 0;
        let totalCharacterOmissionCount = 0;
        const omittedMetadataHash = createHash("sha256");

        // Read sequentially and only within the same count/size/total budget as
        // query. Blob metadata is enough to reject oversized/omitted documents
        // without materializing their bodies.
        for (let index = 0; index < sortedPaths.length; index += 1) {
            const path = sortedPaths[index];
            const blob = blobByPath.get(path);
            const inline = typeof inlineContents[path] === "string" ? (inlineContents[path] as string) : undefined;
            const metadataSize = blob?.size ?? (inline === undefined ? -1 : inline.length);
            const metadataSha =
                blob?.contentSha ||
                (inline === undefined ? "" : `legacy-inline:${asset.updatedAt.getTime()}:${inline.length}`);

            if (index >= MAX_WIKI_DOCUMENTS) {
                this.updateMetadataHash(omittedMetadataHash, path, metadataSha, metadataSize);
                continue;
            }
            if (metadataSize > MAX_WIKI_DOCUMENT_CHARACTERS) {
                oversizedDocumentCount += 1;
                entries.push({
                    path,
                    size: metadataSize,
                    sha: metadataSha,
                    selected: false,
                    omission: "document_size",
                });
                continue;
            }

            // UTF-8 can be larger than the JavaScript character count. Only
            // measure/hash inline bodies after the O(1) character-count gate;
            // therefore omitted or obviously oversized legacy entries never
            // trigger an unbounded full-content scan.
            const inlineByteSize = inline === undefined ? undefined : Buffer.byteLength(inline, "utf8");
            if (inlineByteSize !== undefined && inlineByteSize > MAX_WIKI_DOCUMENT_CHARACTERS) {
                oversizedDocumentCount += 1;
                entries.push({
                    path,
                    size: inlineByteSize,
                    sha: metadataSha,
                    selected: false,
                    omission: "document_size",
                });
                continue;
            }

            if (
                inline === undefined &&
                metadataSize >= 0 &&
                selectedCharacterCount + metadataSize > MAX_WIKI_TOTAL_CHARACTERS
            ) {
                totalCharacterOmissionCount += 1;
                entries.push({
                    path,
                    size: metadataSize,
                    sha: metadataSha,
                    selected: false,
                    omission: "total_characters",
                });
                continue;
            }

            const data = inline === undefined ? await this.assets.getBlobData(asset.id, path).catch(() => null) : null;
            const content = inline ?? (data?.encoding === "utf8" ? data.content : "");
            const size = data?.size ?? inlineByteSize ?? metadataSize;
            if (data === null && inline === undefined) {
                entries.push({ path, size, sha: metadataSha, selected: false, omission: "total_characters" });
                totalCharacterOmissionCount += 1;
                continue;
            }
            const contentBytes = Buffer.byteLength(content, "utf8");
            const resourceSize = Math.max(content.length, contentBytes, size);
            if (resourceSize > MAX_WIKI_DOCUMENT_CHARACTERS) {
                oversizedDocumentCount += 1;
                entries.push({
                    path,
                    size: resourceSize,
                    sha: metadataSha,
                    selected: false,
                    omission: "document_size",
                });
                continue;
            }
            if (selectedCharacterCount + resourceSize > MAX_WIKI_TOTAL_CHARACTERS) {
                totalCharacterOmissionCount += 1;
                entries.push({
                    path,
                    size: resourceSize,
                    sha: metadataSha,
                    selected: false,
                    omission: "total_characters",
                });
                continue;
            }
            const sha =
                data?.contentSha ||
                (inline !== undefined ? createHash("sha1").update(inline).digest("hex") : metadataSha);
            selectedCharacterCount += resourceSize;
            selectedDocumentCount += 1;
            entries.push({ path, size: resourceSize, sha, selected: true });
        }

        const omittedDocumentCount = Math.max(0, sortedPaths.length - MAX_WIKI_DOCUMENTS);
        const incompleteReasons: string[] = [];
        if (omittedDocumentCount > 0) {
            incompleteReasons.push(
                `knowledge_wiki_document_limit_exceeded:${sortedPaths.length}/${MAX_WIKI_DOCUMENTS}`,
            );
        }
        if (oversizedDocumentCount > 0) {
            incompleteReasons.push(
                `knowledge_wiki_document_size_limit_exceeded:${oversizedDocumentCount}/${MAX_WIKI_DOCUMENT_CHARACTERS}`,
            );
        }
        if (totalCharacterOmissionCount > 0) {
            incompleteReasons.push(
                `knowledge_wiki_total_character_limit_exceeded:${selectedCharacterCount}/${MAX_WIKI_TOTAL_CHARACTERS}`,
            );
        }
        return {
            entries,
            omittedMetadataSha: omittedMetadataHash.digest("hex"),
            limits: {
                maxDocumentCount: MAX_WIKI_DOCUMENTS,
                documentCount: sortedPaths.length,
                selectedDocumentCount,
                omittedDocumentCount,
                maxDocumentCharacters: MAX_WIKI_DOCUMENT_CHARACTERS,
                oversizedDocumentCount,
                maxTotalCharacters: MAX_WIKI_TOTAL_CHARACTERS,
                selectedCharacterCount,
                totalCharacterOmissionCount,
            },
            incompleteReasons,
        };
    }

    private updateMetadataHash(hash: Hash, path: string, contentSha: string, size: number): void {
        // Length-prefix variable fields to keep the stream unambiguous without
        // assembling a potentially unbounded JSON metadata array.
        hash.update(String(Buffer.byteLength(path, "utf8")))
            .update(":")
            .update(path);
        hash.update(String(Buffer.byteLength(contentSha, "utf8")))
            .update(":")
            .update(contentSha);
        hash.update(String(size)).update(";");
    }

    private snapshotFingerprint(asset: Asset): string {
        const relevantPath = (path: string) =>
            path === "schema.md" ||
            isPublicKnowledgeSourcePath(path) ||
            (path.startsWith("wiki/") && !isInternalKnowledgePath(path));
        const blobs = asset.blobs
            .filter((blob) => relevantPath(blob.path))
            .map((blob) => [blob.path, blob.contentSha, blob.size])
            .sort(([left], [right]) => String(left).localeCompare(String(right)));
        const inline = Object.entries(this.inlineBlobContents(asset))
            .filter(([path]) => relevantPath(path))
            // Normal writes are already represented by blobs/contentSha. For
            // legacy inline-only data, updatedAt invalidates the cache without
            // hashing an arbitrarily large body on every search.
            .map(([path, content]): [string, number] => [path, content.length])
            .sort(([left], [right]) => left.localeCompare(right));
        return createHash("sha256")
            .update(JSON.stringify({ blobs, inline, updatedAt: asset.updatedAt.toISOString() }))
            .digest("hex")
            .slice(0, 20);
    }

    private inlineBlobContents(asset: Asset): Record<string, string> {
        const raw = asset.metadata?.blobContents;
        if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
        return Object.fromEntries(
            Object.entries(raw).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
        );
    }

    private legacyIndexRevision(manifest: Partial<KnowledgeSourceManifest>): string {
        return createHash("sha256")
            .update(
                JSON.stringify({
                    version: 1,
                    embedding: {
                        provider: manifest.embeddingProvider,
                        model: manifest.embeddingModel,
                        dimensions: manifest.embeddingDimensions,
                    },
                    resourceLimits: manifest.resourceLimits,
                    sources: (manifest.sources ?? [])
                        .filter(this.isManifestEntry)
                        .map((source) => ({ path: source.path, sha: source.sha, status: source.status }))
                        .sort((left, right) => left.path.localeCompare(right.path)),
                }),
            )
            .digest("hex")
            .slice(0, 24);
    }

    private async entryArtifactsExist(assetId: string, entry: KnowledgeSourceManifestEntry): Promise<boolean> {
        if (entry.status !== "indexed") return entry.status === "unsupported";
        if (!entry.extractedTextPath || !entry.chunksPath) return false;
        const [text, chunks] = await Promise.all([
            this.assets.getBlobData(assetId, entry.extractedTextPath).catch(() => null),
            this.assets.getBlobData(assetId, entry.chunksPath).catch(() => null),
        ]);
        return Boolean(text && chunks);
    }

    private async entryExtractedCharCount(assetId: string, entry: KnowledgeSourceManifestEntry): Promise<number> {
        if (entry.status !== "indexed") return 0;
        if (typeof entry.extractedCharCount === "number" && entry.extractedCharCount >= 0) {
            return entry.extractedCharCount;
        }
        if (!entry.extractedTextPath) return 0;
        return this.assets
            .getBlobContent(assetId, entry.extractedTextPath)
            .then((content) => content.length)
            .catch(() => 0);
    }

    private parseResourceLimits(value: unknown): KnowledgeResourceLimitState | undefined {
        if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
        const record = value as Partial<KnowledgeResourceLimitState>;
        const numbers = [
            record.maxSourceCount,
            record.sourceCount,
            record.maxExtractedCharacters,
            record.extractedCharacterCount,
            record.indexedExtractedCharacters,
            record.maxChunkCount,
            record.chunkCount,
            record.indexedChunkCount,
        ];
        if (numbers.some((number) => typeof number !== "number" || !Number.isFinite(number) || number < 0)) {
            return undefined;
        }
        const permitted = new Set<KnowledgeResourceLimitName>(["source_count", "extracted_characters", "chunk_count"]);
        const exceeded = Array.isArray(record.exceeded)
            ? record.exceeded.filter((name): name is KnowledgeResourceLimitName =>
                  permitted.has(name as KnowledgeResourceLimitName),
              )
            : [];
        return {
            maxSourceCount: record.maxSourceCount as number,
            sourceCount: record.sourceCount as number,
            maxExtractedCharacters: record.maxExtractedCharacters as number,
            extractedCharacterCount: record.extractedCharacterCount as number,
            indexedExtractedCharacters: record.indexedExtractedCharacters as number,
            maxChunkCount: record.maxChunkCount as number,
            chunkCount: record.chunkCount as number,
            indexedChunkCount: record.indexedChunkCount as number,
            exceeded,
        };
    }

    private resourceLimitReasons(state?: KnowledgeResourceLimitState): string[] {
        if (!state) return [];
        return state.exceeded.map((name) => {
            if (name === "source_count") {
                return `knowledge_index_source_limit_exceeded:${state.sourceCount}/${state.maxSourceCount}`;
            }
            if (name === "extracted_characters") {
                return `knowledge_index_extracted_character_limit_exceeded:${state.extractedCharacterCount}/${state.maxExtractedCharacters}`;
            }
            return `knowledge_index_chunk_limit_exceeded:${state.chunkCount}/${state.maxChunkCount}`;
        });
    }

    private hardLimit(value: number | undefined, productionMaximum: number): number {
        if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) return productionMaximum;
        return Math.min(value, productionMaximum);
    }

    private async writeTextIfChanged(assetId: string, path: string, content: string, message: string): Promise<void> {
        const current = await this.assets.getBlobContent(assetId, path).catch(() => null);
        if (current === content) return;
        await this.assets.updateBlob(assetId, path, content, message, "main");
        this.invalidateParsedArtifact(assetId, path);
    }

    private async removeStaleArtifacts(
        assetId: string,
        previous: KnowledgeSourceManifest,
        current: KnowledgeSourceManifest,
    ): Promise<void> {
        const retained = new Set(
            [
                current.vectorIndexPath,
                ...current.sources.flatMap((source) => [source.extractedTextPath, source.chunksPath]),
            ].filter((path): path is string => Boolean(path)),
        );
        const stale = new Set(
            [
                previous.vectorIndexPath,
                ...previous.sources.flatMap((source) => [source.extractedTextPath, source.chunksPath]),
            ].filter((path): path is string => typeof path === "string" && !retained.has(path)),
        );
        for (const path of stale) {
            await this.assets
                .deleteBlob(assetId, path, `Remove stale knowledge index ${path}`, "main")
                .catch(() => undefined);
            this.invalidateParsedArtifact(assetId, path);
        }
    }

    private remember<T>(cache: Map<string, Promise<T>>, key: string, value: Promise<T>, maxEntries: number): void {
        cache.set(key, value);
        while (cache.size > maxEntries) cache.delete(cache.keys().next().value as string);
    }

    private invalidateParsedArtifact(assetId: string, path: string): void {
        const prefix = `${assetId}:${path}`;
        for (const key of this.chunkCache.keys()) if (key.startsWith(prefix)) this.chunkCache.delete(key);
        this.vectorCache.delete(prefix);
        for (const key of this.snapshotCache.keys()) if (key.startsWith(`${assetId}:`)) this.snapshotCache.delete(key);
    }

    private sourcePaths(asset: Asset): string[] {
        const paths = new Set(asset.blobs.map((blob) => blob.path).filter(isPublicKnowledgeSourcePath));
        const contents = asset.metadata?.blobContents;
        if (contents && typeof contents === "object" && !Array.isArray(contents)) {
            for (const path of Object.keys(contents)) if (isPublicKnowledgeSourcePath(path)) paths.add(path);
        }
        return Array.from(paths).sort();
    }

    private failedEntry(
        path: string,
        mime: string,
        sha: string,
        size: number,
        extractedAt: string,
        status: Exclude<KnowledgeSourceStatus, "indexed">,
        error: string,
        retryable?: boolean,
    ): KnowledgeSourceManifestEntry {
        return { path, mime, sha, size, status, chunkCount: 0, extractedAt, error: error.slice(0, 1_000), retryable };
    }

    private assertNotAborted(signal?: AbortSignal): void {
        if (signal?.aborted) throw new DOMException("Ingest cancelled", "AbortError");
    }

    private async reportProgress(
        options: KnowledgeReindexOptions,
        percent: number,
        stage: string,
        message: string,
    ): Promise<void> {
        await options.onProgress?.({ percent, stage, message });
    }

    private isManifestEntry(value: unknown): value is KnowledgeSourceManifestEntry {
        if (!value || typeof value !== "object") return false;
        const entry = value as Partial<KnowledgeSourceManifestEntry>;
        return typeof entry.path === "string" && typeof entry.sha === "string" && typeof entry.status === "string";
    }

    private extension(path: string): string {
        const name = path.split("/").pop() || "";
        return name.includes(".") ? name.split(".").pop()?.toLowerCase() || "" : "";
    }

    private positionFromBreaks(breaks: number[], offset: number): number {
        let low = 0;
        let high = breaks.length;
        while (low < high) {
            const middle = Math.floor((low + high) / 2);
            if (breaks[middle] < offset) low = middle + 1;
            else high = middle;
        }
        return low + 1;
    }

    private nonNegativeNumber(value: unknown, fallback: number): number {
        return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : fallback;
    }

    private positiveNumber(value: unknown, fallback: number): number {
        return typeof value === "number" && Number.isFinite(value) && value >= 1 ? value : fallback;
    }

    private async requireKnowledgeAsset(assetId: string): Promise<Asset> {
        const asset = await this.assets.getAsset(assetId);
        if (!asset || asset.category !== "knowledge") throw new Error("Knowledge asset not found");
        return asset;
    }
}

class Matrix2D {
    a = 1;
    b = 0;
    c = 0;
    d = 1;
    e = 0;
    f = 0;

    constructor(values?: number[] | Float32Array | Float64Array) {
        if (values && values.length >= 6) [this.a, this.b, this.c, this.d, this.e, this.f] = Array.from(values);
    }

    multiplySelf(other: Matrix2D): this {
        const { a, b, c, d, e, f } = this;
        this.a = a * other.a + c * other.b;
        this.b = b * other.a + d * other.b;
        this.c = a * other.c + c * other.d;
        this.d = b * other.c + d * other.d;
        this.e = a * other.e + c * other.f + e;
        this.f = b * other.e + d * other.f + f;
        return this;
    }

    preMultiplySelf(other: Matrix2D): this {
        const result = new Matrix2D([other.a, other.b, other.c, other.d, other.e, other.f]).multiplySelf(this);
        Object.assign(this, result);
        return this;
    }

    translate(x = 0, y = 0): Matrix2D {
        return new Matrix2D([this.a, this.b, this.c, this.d, this.e, this.f]).multiplySelf(
            new Matrix2D([1, 0, 0, 1, x, y]),
        );
    }

    scale(x = 1, y = x): Matrix2D {
        return new Matrix2D([this.a, this.b, this.c, this.d, this.e, this.f]).multiplySelf(
            new Matrix2D([x, 0, 0, y, 0, 0]),
        );
    }

    invertSelf(): this {
        const determinant = this.a * this.d - this.b * this.c;
        if (!determinant) return this;
        const { a, b, c, d, e, f } = this;
        this.a = d / determinant;
        this.b = -b / determinant;
        this.c = -c / determinant;
        this.d = a / determinant;
        this.e = (c * f - d * e) / determinant;
        this.f = (b * e - a * f) / determinant;
        return this;
    }
}
