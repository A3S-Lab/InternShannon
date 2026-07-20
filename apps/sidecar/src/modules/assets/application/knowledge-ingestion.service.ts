import { Inject, Injectable, Optional } from '@nestjs/common';
import { createHash } from 'node:crypto';
import JSZip = require('jszip');
import XLSX = require('xlsx');
import { createOcrRegistry, OcrBackendError } from '@a3s-lab/ocr';
import { CONFIG_SERVICE, ConfigService } from '@/modules/config/domain/services/config-service.interface';
import type { Asset } from '../domain/entities/asset.entity';
import {
    LOCAL_EMBEDDING_DIMENSIONS,
    LOCAL_EMBEDDING_MODEL,
    localEmbedding,
} from '../domain/knowledge/local-embedding';
import { ASSET_SERVICE, type IAssetService } from '../domain/services/asset.service.interface';
import { KnowledgeEmbeddingService } from './knowledge-embedding.service';

export const KNOWLEDGE_INDEX_ROOT = '.internshannon/knowledge/index';
export const KNOWLEDGE_MANIFEST_PATH = `${KNOWLEDGE_INDEX_ROOT}/manifest.json`;

export type KnowledgeSourceStatus = 'indexed' | 'waiting_for_ocr' | 'unsupported' | 'error';

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
    extractedAt: string;
    error?: string;
    retryable?: boolean;
    extractionMethod?: 'native' | 'ocr';
    ocrBackend?: string;
    ocrModel?: string;
}

export interface KnowledgeSourceManifest {
    version: 1;
    generatedAt: string;
    embeddingModel?: string;
    embeddingProvider?: string;
    embeddingDimensions?: number;
    vectorIndexPath?: string;
    sources: KnowledgeSourceManifestEntry[];
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
    | { status: 'indexed'; text: string; method?: 'native' | 'ocr'; ocrBackend?: string; ocrModel?: string }
    | { status: 'waiting_for_ocr' | 'unsupported' | 'error'; error: string; retryable?: boolean };

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
    'txt',
    'md',
    'markdown',
    'csv',
    'tsv',
    'json',
    'jsonl',
    'yaml',
    'yml',
    'xml',
    'html',
    'htm',
    'log',
    'rst',
]);
const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'tif', 'tiff', 'heic']);
const MAX_SOURCE_BYTES = 50 * 1024 * 1024;
const MAX_EXTRACTED_CHARS = 10 * 1024 * 1024;
const CHUNK_SIZE = 1_200;
const CHUNK_OVERLAP = 160;

@Injectable()
export class KnowledgeIngestionService {
    constructor(
        @Inject(ASSET_SERVICE) private readonly assets: IAssetService,
        @Optional() @Inject(CONFIG_SERVICE) private readonly config?: ConfigService,
        @Optional() private readonly embeddings?: KnowledgeEmbeddingService,
    ) {}

    async reindex(assetId: string, options: KnowledgeReindexOptions = {}): Promise<KnowledgeReindexResult> {
        const asset = await this.requireKnowledgeAsset(assetId);
        const previous = await this.getManifest(assetId);
        const previousByPath = new Map(previous.sources.map(source => [source.path, source]));
        const now = new Date().toISOString();
        const allSourcePaths = this.sourcePaths(asset);
        const requestedPaths = Array.from(new Set((options.sourcePaths ?? []).filter(Boolean)));
        const pathsToProcess = requestedPaths.length > 0 ? requestedPaths : allSourcePaths;
        const missingPaths = pathsToProcess.filter(path => !allSourcePaths.includes(path));
        if (missingPaths.length > 0) throw new Error(`Knowledge source not found: ${missingPaths.join(', ')}`);
        const processing = new Set(pathsToProcess);
        const sources: KnowledgeSourceManifestEntry[] = previous.sources.filter(
            source => allSourcePaths.includes(source.path) && !processing.has(source.path),
        );
        let reusedSourceCount = 0;

        await this.reportProgress(options, 2, 'scanning', `发现 ${allSourcePaths.length} 个来源`);
        for (const [sourceIndex, path] of pathsToProcess.entries()) {
            this.assertNotAborted(options.signal);
            await this.reportProgress(
                options,
                5 + (sourceIndex / Math.max(1, pathsToProcess.length)) * 65,
                'extracting',
                `正在处理 ${path}`,
            );
            const blob = await this.assets.getBlobData(assetId, path);
            const bytes = blob.encoding === 'base64' ? Buffer.from(blob.content, 'base64') : Buffer.from(blob.content, 'utf8');
            const sha = blob.contentSha || createHash('sha1').update(bytes).digest('hex');
            const previousEntry = previousByPath.get(path);
            if (previousEntry?.sha === sha && (await this.entryArtifactsExist(assetId, previousEntry))) {
                sources.push(previousEntry);
                reusedSourceCount += 1;
                continue;
            }

            if (bytes.byteLength > MAX_SOURCE_BYTES) {
                sources.push(this.failedEntry(path, blob.mime, sha, bytes.byteLength, now, 'error', '来源文件超过 50 MB 限制'));
                continue;
            }

            try {
                const extraction = await this.extract(path, blob.mime, bytes, blob.encoding, options.signal);
                if (extraction.status !== 'indexed') {
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
                const text = extraction.text.trim().slice(0, MAX_EXTRACTED_CHARS);
                if (!text) {
                    sources.push(
                        this.failedEntry(path, blob.mime, sha, bytes.byteLength, now, 'waiting_for_ocr', '未抽取到文本，且 OCR 后端未启用'),
                    );
                    continue;
                }
                const extractedTextPath = `${KNOWLEDGE_INDEX_ROOT}/extracted/${sha}.txt`;
                const chunksPath = `${KNOWLEDGE_INDEX_ROOT}/chunks/${sha}.json`;
                const chunks = await this.chunkText(path, blob.mime, sha, text, options.signal);
                await this.writeTextIfChanged(assetId, extractedTextPath, text, `Extract knowledge source ${path}`);
                await this.writeTextIfChanged(
                    assetId,
                    chunksPath,
                    `${JSON.stringify(chunks, null, 2)}\n`,
                    `Chunk knowledge source ${path}`,
                );
                sources.push({
                    path,
                    mime: blob.mime,
                    sha,
                    size: bytes.byteLength,
                    status: 'indexed',
                    extractedTextPath,
                    chunksPath,
                    chunkCount: chunks.length,
                    extractedAt: now,
                    extractionMethod: extraction.method ?? 'native',
                    ocrBackend: extraction.ocrBackend,
                    ocrModel: extraction.ocrModel,
                });
            } catch (error) {
                sources.push(
                    this.failedEntry(
                        path,
                        blob.mime,
                        sha,
                        bytes.byteLength,
                        now,
                        'error',
                        error instanceof Error ? error.message : String(error),
                    ),
                );
            }
        }

        this.assertNotAborted(options.signal);
        await this.reportProgress(options, 74, 'embedding', '正在构建向量索引');
        const vectorIndex = await this.buildVectorIndex(asset, sources, now, options.signal);
        const vectorIndexPath = `${KNOWLEDGE_INDEX_ROOT}/vectors/${this.safeModelPath(vectorIndex.provider, vectorIndex.model)}.json`;
        await this.writeTextIfChanged(
            assetId,
            vectorIndexPath,
            `${JSON.stringify(vectorIndex)}\n`,
            `Build knowledge vector index (${vectorIndex.model})`,
        );
        const manifest: KnowledgeSourceManifest = {
            version: 1,
            generatedAt: now,
            embeddingModel: vectorIndex.model,
            embeddingProvider: vectorIndex.provider,
            embeddingDimensions: vectorIndex.dimensions,
            vectorIndexPath,
            sources: sources.sort((left, right) => left.path.localeCompare(right.path)),
        };
        await this.writeTextIfChanged(
            assetId,
            KNOWLEDGE_MANIFEST_PATH,
            `${JSON.stringify(manifest, null, 2)}\n`,
            'Rebuild knowledge source manifest',
        );
        await this.removeStaleArtifacts(assetId, previous, manifest);
        await this.reportProgress(options, 98, 'finalizing', '正在更新知识库状态');

        return {
            manifest,
            sourceCount: sources.length,
            indexedSourceCount: sources.filter(source => source.status === 'indexed').length,
            reusedSourceCount,
            waitingForOcrCount: sources.filter(source => source.status === 'waiting_for_ocr').length,
            unsupportedSourceCount: sources.filter(source => source.status === 'unsupported').length,
            errorSourceCount: sources.filter(source => source.status === 'error').length,
            chunkCount: sources.reduce((sum, source) => sum + source.chunkCount, 0),
        };
    }

    async getManifest(assetId: string): Promise<KnowledgeSourceManifest> {
        const content = await this.assets.getBlobContent(assetId, KNOWLEDGE_MANIFEST_PATH).catch(() => null);
        if (!content) return { version: 1, generatedAt: '', sources: [] };
        try {
            const parsed = JSON.parse(content) as Partial<KnowledgeSourceManifest>;
            if (parsed.version !== 1 || !Array.isArray(parsed.sources)) throw new Error('unsupported manifest');
            return {
                version: 1,
                generatedAt: typeof parsed.generatedAt === 'string' ? parsed.generatedAt : '',
                embeddingModel: typeof parsed.embeddingModel === 'string' ? parsed.embeddingModel : undefined,
                embeddingProvider: typeof parsed.embeddingProvider === 'string' ? parsed.embeddingProvider : undefined,
                embeddingDimensions:
                    typeof parsed.embeddingDimensions === 'number' ? parsed.embeddingDimensions : undefined,
                vectorIndexPath: typeof parsed.vectorIndexPath === 'string' ? parsed.vectorIndexPath : undefined,
                sources: parsed.sources.filter(this.isManifestEntry),
            };
        } catch {
            return { version: 1, generatedAt: '', sources: [] };
        }
    }

    async readChunks(assetId: string, entry: KnowledgeSourceManifestEntry): Promise<KnowledgeSourceChunk[]> {
        if (!entry.chunksPath) return [];
        const content = await this.assets.getBlobContent(assetId, entry.chunksPath).catch(() => null);
        if (!content) return [];
        try {
            const parsed = JSON.parse(content) as Array<Partial<KnowledgeSourceChunk>>;
            if (!Array.isArray(parsed)) return [];
            return parsed.flatMap((chunk, index) => {
                if (typeof chunk?.text !== 'string') return [];
                const charStart = this.nonNegativeNumber(chunk.charStart, 0);
                const charEnd = this.nonNegativeNumber(chunk.charEnd, charStart + chunk.text.length);
                return [
                    {
                        id: typeof chunk.id === 'string' ? chunk.id : `${entry.sha}:${index}`,
                        index: this.nonNegativeNumber(chunk.index, index),
                        sourcePath: typeof chunk.sourcePath === 'string' ? chunk.sourcePath : entry.path,
                        mime: typeof chunk.mime === 'string' ? chunk.mime : entry.mime,
                        contentSha: typeof chunk.contentSha === 'string' ? chunk.contentSha : entry.sha,
                        charStart,
                        charEnd,
                        lineStart: this.positiveNumber(chunk.lineStart, 1),
                        lineEnd: this.positiveNumber(chunk.lineEnd, 1),
                        pageStart: this.positiveNumber(chunk.pageStart, 1),
                        pageEnd: this.positiveNumber(chunk.pageEnd, 1),
                        text: chunk.text,
                    },
                ];
            });
        } catch {
            return [];
        }
    }

    async readVectorIndex(assetId: string, manifest?: KnowledgeSourceManifest): Promise<KnowledgeVectorIndex | null> {
        const current = manifest ?? (await this.getManifest(assetId));
        if (!current.vectorIndexPath) return null;
        const content = await this.assets.getBlobContent(assetId, current.vectorIndexPath).catch(() => null);
        if (!content) return null;
        try {
            const parsed = JSON.parse(content) as KnowledgeVectorIndex;
            return parsed.version === 1 && Array.isArray(parsed.records) ? parsed : null;
        } catch {
            return null;
        }
    }

    private async extract(
        path: string,
        mime: string,
        bytes: Buffer,
        encoding: 'utf8' | 'base64',
        signal?: AbortSignal,
    ): Promise<ExtractionResult> {
        this.assertNotAborted(signal);
        const extension = this.extension(path);
        if (TEXT_EXTENSIONS.has(extension) || mime.startsWith('text/')) {
            return {
                status: 'indexed',
                text: encoding === 'utf8' ? bytes.toString('utf8') : bytes.toString('utf8'),
                method: 'native',
            };
        }
        if (extension === 'pdf' || mime === 'application/pdf') {
            this.ensurePdfMatrix();
            const { PDFParse } = require('pdf-parse') as typeof import('pdf-parse');
            const { getPath } = require('pdf-parse/worker') as { getPath(): string };
            PDFParse.setWorker(getPath());
            const parser = new PDFParse({ data: new Uint8Array(bytes) });
            try {
                const result = await parser.getText();
                const text = result.pages.map(page => page.text).join('\n\f\n').trim();
                return text ? { status: 'indexed', text, method: 'native' } : this.extractWithOcr(path, mime, bytes, signal);
            } finally {
                await parser.destroy().catch(() => undefined);
            }
        }
        if (extension === 'docx' || mime.includes('wordprocessingml.document')) {
            return { status: 'indexed', text: await this.extractDocx(bytes), method: 'native' };
        }
        if (['xlsx', 'xls', 'ods'].includes(extension) || mime.includes('spreadsheet')) {
            return { status: 'indexed', text: this.extractWorkbook(bytes), method: 'native' };
        }
        if (IMAGE_EXTENSIONS.has(extension) || mime.startsWith('image/')) {
            return this.extractWithOcr(path, mime, bytes, signal);
        }
        return { status: 'unsupported', error: `暂不支持抽取 ${extension || mime || 'unknown'} 格式` };
    }

    private async extractWithOcr(path: string, mime: string, bytes: Buffer, signal?: AbortSignal): Promise<ExtractionResult> {
        const settings = await this.config?.getSettings().catch(() => null);
        const ocrSettings = settings?.ocr;
        if (!ocrSettings?.backends?.some(backend => backend.enabled)) {
            return { status: 'waiting_for_ocr', error: '需要 OCR，但当前没有启用 OCR 后端' };
        }
        try {
            const registry = createOcrRegistry(ocrSettings);
            const backend = registry.getDefault();
            const configured = ocrSettings.backends.find(item => item.name === backend.name);
            const result = await registry.recognize(
                { data: bytes, filename: path.split('/').pop() || path, mimeType: mime },
                { signal, model: configured?.model, outputFormat: configured?.outputFormat },
            );
            this.assertNotAborted(signal);
            const pageText = result.pages
                .map(page => page.text?.trim())
                .filter((text): text is string => Boolean(text))
                .join('\n\f\n');
            const text = (pageText || result.markdown || result.text).trim();
            if (!text) return { status: 'error', error: `OCR backend ${backend.name} returned no text`, retryable: true };
            return {
                status: 'indexed',
                text,
                method: 'ocr',
                ocrBackend: backend.name,
                ocrModel: configured?.model,
            };
        } catch (error) {
            if (signal?.aborted) throw new DOMException('Ingest cancelled', 'AbortError');
            const message = error instanceof Error ? error.message : String(error);
            return {
                status: 'error',
                error: `OCR failed: ${message}`,
                retryable: error instanceof OcrBackendError ? error.status === undefined || error.status >= 429 : true,
            };
        }
    }

    private ensurePdfMatrix(): void {
        const target = globalThis as unknown as { DOMMatrix?: typeof Matrix2D };
        if (!target.DOMMatrix) target.DOMMatrix = Matrix2D;
    }

    private async extractDocx(bytes: Buffer): Promise<string> {
        const archive = await JSZip.loadAsync(bytes);
        const paths = Object.keys(archive.files)
            .filter(path => /^word\/(document|footnotes|endnotes|comments|header\d+|footer\d+)\.xml$/i.test(path))
            .sort((left, right) => (left === 'word/document.xml' ? -1 : right === 'word/document.xml' ? 1 : left.localeCompare(right)));
        const sections: string[] = [];
        for (const path of paths) {
            const xml = await archive.file(path)?.async('string');
            if (!xml) continue;
            const text = this.xmlText(xml);
            if (text) sections.push(text);
        }
        return sections.join('\n\n');
    }

    private extractWorkbook(bytes: Buffer): string {
        const workbook = XLSX.read(bytes, { type: 'buffer', cellDates: true });
        return workbook.SheetNames.map(name => {
            const sheet = workbook.Sheets[name];
            return [`# ${name}`, XLSX.utils.sheet_to_csv(sheet, { blankrows: false })].join('\n');
        }).join('\n\n');
    }

    private xmlText(xml: string): string {
        return this.decodeXmlEntities(
            xml
                .replace(/<w:tab\b[^>]*\/>/gi, '\t')
                .replace(/<w:br\b[^>]*\/>/gi, '\n')
                .replace(/<\/w:p>/gi, '\n')
                .replace(/<[^>]+>/g, ''),
        )
            .replace(/[ \t]+\n/g, '\n')
            .replace(/\n{3,}/g, '\n\n')
            .trim();
    }

    private decodeXmlEntities(value: string): string {
        return value.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, match => {
            const entity = match.slice(1, -1).toLowerCase();
            if (entity === 'amp') return '&';
            if (entity === 'lt') return '<';
            if (entity === 'gt') return '>';
            if (entity === 'quot') return '"';
            if (entity === 'apos') return "'";
            const code = entity.startsWith('#x') ? Number.parseInt(entity.slice(2), 16) : Number.parseInt(entity.slice(1), 10);
            return Number.isFinite(code) ? String.fromCodePoint(code) : match;
        });
    }

    private async chunkText(
        sourcePath: string,
        mime: string,
        contentSha: string,
        text: string,
        signal?: AbortSignal,
    ): Promise<KnowledgeSourceChunk[]> {
        const chunks: KnowledgeSourceChunk[] = [];
        const lineBreaks: number[] = [];
        const pageBreaks: number[] = [];
        for (let index = 0; index < text.length; index += 1) {
            if (text[index] === '\n') lineBreaks.push(index);
            if (text[index] === '\f') pageBreaks.push(index);
            if (index > 0 && index % 65_536 === 0) {
                this.assertNotAborted(signal);
                await new Promise<void>(resolve => setImmediate(resolve));
            }
        }
        let start = 0;
        while (start < text.length) {
            let end = Math.min(text.length, start + CHUNK_SIZE);
            if (end < text.length) {
                const boundary = Math.max(text.lastIndexOf('\n\n', end), text.lastIndexOf('。', end), text.lastIndexOf('. ', end));
                if (boundary > start + CHUNK_SIZE / 2) end = boundary + 1;
            }
            const chunkText = text.slice(start, end).trim();
            if (chunkText) {
                chunks.push({
                    id: `${contentSha}:${chunks.length}`,
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
                await new Promise<void>(resolve => setImmediate(resolve));
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
        const chunks: KnowledgeSourceChunk[] = [];
        for (const source of sources) {
            if (source.status !== 'indexed') continue;
            chunks.push(...(await this.readChunks(asset.id, source)));
        }
        const batch = this.embeddings
            ? await this.embeddings.embed(asset, chunks.map(chunk => chunk.text), signal)
            : {
                  provider: 'local',
                  model: LOCAL_EMBEDDING_MODEL,
                  dimensions: LOCAL_EMBEDDING_DIMENSIONS,
                  vectors: chunks.map(chunk => localEmbedding(chunk.text)),
              };
        const records: KnowledgeVectorRecord[] = chunks.map((chunk, index) => ({
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
                }));
        return {
            version: 1,
            provider: batch.provider,
            model: batch.model,
            generatedAt,
            dimensions: batch.dimensions,
            records,
        };
    }

    private safeModelPath(provider: string | undefined, model: string): string {
        return `${provider || 'local'}-${model}`.replace(/[^a-z0-9._-]+/gi, '-').replace(/^-+|-+$/g, '') || 'embedding';
    }

    private async entryArtifactsExist(assetId: string, entry: KnowledgeSourceManifestEntry): Promise<boolean> {
        if (entry.status !== 'indexed') return entry.status === 'unsupported';
        if (!entry.extractedTextPath || !entry.chunksPath) return false;
        const [text, chunks] = await Promise.all([
            this.assets.getBlobData(assetId, entry.extractedTextPath).catch(() => null),
            this.assets.getBlobData(assetId, entry.chunksPath).catch(() => null),
        ]);
        return Boolean(text && chunks);
    }

    private async writeTextIfChanged(assetId: string, path: string, content: string, message: string): Promise<void> {
        const current = await this.assets.getBlobContent(assetId, path).catch(() => null);
        if (current === content) return;
        await this.assets.updateBlob(assetId, path, content, message, 'main');
    }

    private async removeStaleArtifacts(
        assetId: string,
        previous: KnowledgeSourceManifest,
        current: KnowledgeSourceManifest,
    ): Promise<void> {
        const retained = new Set(
            [
                current.vectorIndexPath,
                ...current.sources.flatMap(source => [source.extractedTextPath, source.chunksPath]),
            ].filter((path): path is string => Boolean(path)),
        );
        const stale = new Set(
            [
                previous.vectorIndexPath,
                ...previous.sources.flatMap(source => [source.extractedTextPath, source.chunksPath]),
            ]
                .filter((path): path is string => typeof path === 'string' && !retained.has(path)),
        );
        for (const path of stale) {
            await this.assets.deleteBlob(assetId, path, `Remove stale knowledge index ${path}`, 'main').catch(() => undefined);
        }
    }

    private sourcePaths(asset: Asset): string[] {
        const paths = new Set(asset.blobs.map(blob => blob.path).filter(path => path.startsWith('raw/sources/')));
        const contents = asset.metadata?.blobContents;
        if (contents && typeof contents === 'object' && !Array.isArray(contents)) {
            for (const path of Object.keys(contents)) if (path.startsWith('raw/sources/')) paths.add(path);
        }
        return Array.from(paths).sort();
    }

    private failedEntry(
        path: string,
        mime: string,
        sha: string,
        size: number,
        extractedAt: string,
        status: Exclude<KnowledgeSourceStatus, 'indexed'>,
        error: string,
        retryable?: boolean,
    ): KnowledgeSourceManifestEntry {
        return { path, mime, sha, size, status, chunkCount: 0, extractedAt, error: error.slice(0, 1_000), retryable };
    }

    private assertNotAborted(signal?: AbortSignal): void {
        if (signal?.aborted) throw new DOMException('Ingest cancelled', 'AbortError');
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
        if (!value || typeof value !== 'object') return false;
        const entry = value as Partial<KnowledgeSourceManifestEntry>;
        return typeof entry.path === 'string' && typeof entry.sha === 'string' && typeof entry.status === 'string';
    }

    private extension(path: string): string {
        const name = path.split('/').pop() || '';
        return name.includes('.') ? name.split('.').pop()?.toLowerCase() || '' : '';
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
        return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : fallback;
    }

    private positiveNumber(value: unknown, fallback: number): number {
        return typeof value === 'number' && Number.isFinite(value) && value >= 1 ? value : fallback;
    }

    private async requireKnowledgeAsset(assetId: string): Promise<Asset> {
        const asset = await this.assets.getAsset(assetId);
        if (!asset || asset.category !== 'knowledge') throw new Error('Knowledge asset not found');
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
