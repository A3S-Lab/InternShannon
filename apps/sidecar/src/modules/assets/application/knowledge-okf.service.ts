import { Inject, Injectable } from '@nestjs/common';
import JSZip = require('jszip');
import yauzl = require('yauzl');
import { BadRequestException } from '@/shared/common/errors';
import {
    normalizeOkfPath,
    validateOkfBundle,
    type OkfBundleValidation,
} from '../domain/knowledge/open-knowledge-format';
import { ASSET_SERVICE, type IAssetService } from '../domain/services/asset.service.interface';
import { KnowledgeAuditService } from './knowledge-audit.service';
import { KnowledgeContentService } from './knowledge-content.service';

export const MAX_OKF_IMPORT_FILES = 5_000;
export const MAX_OKF_IMPORT_BYTES = 20 * 1024 * 1024;
export const MAX_OKF_IMPORT_ENTRY_BYTES = 4 * 1024 * 1024;
export const MAX_OKF_ARCHIVE_BYTES = 24 * 1024 * 1024;
export const MAX_OKF_ARCHIVE_BASE64_CHARS = Math.ceil(MAX_OKF_ARCHIVE_BYTES / 3) * 4;

export interface KnowledgeOkfFileInput {
    path?: string;
    content?: string;
}

export interface KnowledgeOkfImportInput {
    archiveBase64?: string;
    files?: KnowledgeOkfFileInput[];
    overwrite?: boolean;
}

export interface KnowledgeOkfImportResult {
    imported: number;
    paths: string[];
    validation: OkfBundleValidation;
}

export interface KnowledgeOkfExportResult {
    filename: string;
    contentBase64: string;
    validation: OkfBundleValidation;
}

interface PlannedZipEntry {
    entry: yauzl.Entry;
    path: string;
}

@Injectable()
export class KnowledgeOkfService {
    constructor(
        @Inject(ASSET_SERVICE) private readonly assets: IAssetService,
        private readonly content: KnowledgeContentService,
        private readonly audit: KnowledgeAuditService,
    ) {}

    async validate(id: string): Promise<OkfBundleValidation> {
        const asset = await this.content.requireAsset(id);
        return validateOkfBundle(this.okfFiles(await this.content.loadContents(asset, 'wiki/')));
    }

    async import(id: string, input: KnowledgeOkfImportInput, actorId: string): Promise<KnowledgeOkfImportResult> {
        const asset = await this.content.requireAsset(id);
        const files = input.archiveBase64
            ? await this.readZip(input.archiveBase64)
            : this.readFileInput(input.files ?? []);
        const validation = validateOkfBundle(files);
        if (!validation.valid) {
            const firstError = validation.diagnostics.find(item => item.severity === 'error');
            throw new BadRequestException(firstError?.message || 'OKF bundle 校验失败');
        }

        const existing = this.okfFiles(await this.content.loadContents(asset, 'wiki/'));
        if (input.overwrite !== true) {
            const conflicts = Object.keys(files).filter(path => existing[path] !== undefined);
            if (conflicts.length > 0) {
                throw new BadRequestException(`OKF 文档已存在：${conflicts.slice(0, 3).join('、')}`);
            }
        }

        for (const [path, fileContent] of Object.entries(files)) {
            await this.assets.updateBlob(id, `wiki/${path}`, fileContent, `Import OKF ${path}`, 'main');
        }
        await this.audit.append(id, {
            action: 'okf.import',
            target: 'wiki/',
            actorId,
            metadata: { documentCount: Object.keys(files).length, overwrite: input.overwrite === true },
        });
        return {
            imported: Object.keys(files).length,
            paths: Object.keys(files).map(path => `wiki/${path}`),
            validation,
        };
    }

    async export(id: string): Promise<KnowledgeOkfExportResult> {
        const asset = await this.content.requireAsset(id);
        const files = this.okfFiles(await this.content.loadContents(asset, 'wiki/'));
        const validation = validateOkfBundle(files);
        if (Object.keys(files).length === 0) {
            throw new BadRequestException('知识库中没有可导出的 OKF 文档');
        }
        const archive = new JSZip();
        for (const [path, fileContent] of Object.entries(files)) archive.file(path, fileContent);
        return {
            filename: `${asset.name || 'knowledge'}.okf.zip`,
            contentBase64: await archive.generateAsync({ type: 'base64', compression: 'DEFLATE' }),
            validation,
        };
    }

    readFileInput(files: KnowledgeOkfFileInput[]): Record<string, string> {
        if (files.length > MAX_OKF_IMPORT_FILES) {
            throw new BadRequestException(`OKF 文档数量不能超过 ${MAX_OKF_IMPORT_FILES}`);
        }
        const result: Record<string, string> = {};
        const destinations = new Map<string, string>();
        let totalBytes = 0;
        for (const file of files) {
            const path = this.requireMarkdownPath(file.path ?? '', 'OKF 文档');
            this.assertUniqueDestination(destinations, path, file.path || '(empty)');
            const fileContent = file.content ?? '';
            const bytes = Buffer.byteLength(fileContent, 'utf8');
            this.assertEntryBytes(path, bytes);
            totalBytes += bytes;
            this.assertTotalBytes(totalBytes);
            result[path] = fileContent;
        }
        return result;
    }

    async readZip(archiveBase64: string): Promise<Record<string, string>> {
        const compressed = this.decodeArchive(archiveBase64);
        let archive: yauzl.ZipFile | undefined;
        try {
            archive = await this.openZip(compressed);
            if (archive.entryCount > MAX_OKF_IMPORT_FILES) {
                throw new BadRequestException(`OKF ZIP 条目数量不能超过 ${MAX_OKF_IMPORT_FILES}`);
            }
            const entries = await this.collectEntries(archive);
            const compressedBytes = entries.reduce((sum, entry) => sum + entry.compressedSize, 0);
            if (compressedBytes > MAX_OKF_ARCHIVE_BYTES) {
                throw new BadRequestException(
                    `OKF ZIP 压缩内容不能超过 ${MAX_OKF_ARCHIVE_BYTES / 1024 / 1024} MB`,
                );
            }
            const markdownEntries = entries.filter(
                entry => !entry.fileName.endsWith('/') && entry.fileName.toLowerCase().endsWith('.md'),
            );
            const commonRoot = this.singleArchiveRoot(markdownEntries.map(entry => entry.fileName));
            const destinations = new Map<string, string>();
            const planned: PlannedZipEntry[] = [];
            let declaredTotalBytes = 0;
            for (const entry of markdownEntries) {
                if (entry.isEncrypted()) throw new BadRequestException(`OKF ZIP 文档不能加密：${entry.fileName}`);
                const rawPath = commonRoot ? entry.fileName.slice(commonRoot.length + 1) : entry.fileName;
                const path = this.requireMarkdownPath(rawPath, 'OKF ZIP');
                this.assertUniqueDestination(destinations, path, entry.fileName);
                this.assertEntryBytes(path, entry.uncompressedSize);
                declaredTotalBytes += entry.uncompressedSize;
                this.assertTotalBytes(declaredTotalBytes);
                planned.push({ entry, path });
            }

            const result: Record<string, string> = {};
            const extraction = { totalBytes: 0 };
            for (const item of planned) {
                result[item.path] = await this.extractEntry(archive, item, extraction);
            }
            return result;
        } catch (error) {
            if (error instanceof BadRequestException) throw error;
            throw new BadRequestException(
                error instanceof Error ? `OKF ZIP 无法解析：${error.message}` : 'OKF ZIP 无法解析',
            );
        } finally {
            archive?.close();
        }
    }

    private okfFiles(contents: Record<string, string>): Record<string, string> {
        return Object.fromEntries(
            Object.entries(contents)
                .filter(([path]) => path.startsWith('wiki/') && path.toLowerCase().endsWith('.md'))
                .map(([path, fileContent]) => [path.slice('wiki/'.length), fileContent]),
        );
    }

    private decodeArchive(archiveBase64: string): Buffer {
        if (archiveBase64.length > MAX_OKF_ARCHIVE_BASE64_CHARS) {
            throw new BadRequestException(
                `OKF ZIP Base64 输入不能超过 ${MAX_OKF_ARCHIVE_BASE64_CHARS} 个字符`,
            );
        }
        const encoded = archiveBase64.trim();
        if (
            encoded.length === 0 ||
            encoded.length % 4 !== 0 ||
            !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)
        ) {
            throw new BadRequestException('OKF ZIP Base64 编码无效');
        }
        const compressed = Buffer.from(encoded, 'base64');
        if (compressed.byteLength > MAX_OKF_ARCHIVE_BYTES) {
            throw new BadRequestException(`OKF ZIP 不能超过 ${MAX_OKF_ARCHIVE_BYTES / 1024 / 1024} MB`);
        }
        return compressed;
    }

    private openZip(buffer: Buffer): Promise<yauzl.ZipFile> {
        return new Promise((resolve, reject) => {
            yauzl.fromBuffer(
                buffer,
                {
                    autoClose: false,
                    lazyEntries: true,
                    strictFileNames: false,
                    validateEntrySizes: true,
                },
                (error, archive) => {
                    if (error || !archive) {
                        reject(error ?? new Error('ZIP archive is unavailable'));
                        return;
                    }
                    resolve(archive);
                },
            );
        });
    }

    private collectEntries(archive: yauzl.ZipFile): Promise<yauzl.Entry[]> {
        return new Promise((resolve, reject) => {
            const entries: yauzl.Entry[] = [];
            const onError = (error: Error) => {
                cleanup();
                reject(error);
            };
            const onEnd = () => {
                cleanup();
                resolve(entries);
            };
            const onEntry = (entry: yauzl.Entry) => {
                entries.push(entry);
                archive.readEntry();
            };
            const cleanup = () => {
                archive.off('error', onError);
                archive.off('end', onEnd);
                archive.off('entry', onEntry);
            };
            archive.on('error', onError);
            archive.on('end', onEnd);
            archive.on('entry', onEntry);
            archive.readEntry();
        });
    }

    private extractEntry(
        archive: yauzl.ZipFile,
        planned: PlannedZipEntry,
        extraction: { totalBytes: number },
    ): Promise<string> {
        return new Promise((resolve, reject) => {
            archive.openReadStream(planned.entry, (openError, stream) => {
                if (openError || !stream) {
                    reject(openError ?? new Error(`Unable to read ${planned.entry.fileName}`));
                    return;
                }
                const chunks: Buffer[] = [];
                let entryBytes = 0;
                let settled = false;
                const fail = (error: Error) => {
                    if (settled) return;
                    settled = true;
                    reject(error);
                };
                stream.on('data', (chunk: Buffer) => {
                    if (settled) return;
                    entryBytes += chunk.byteLength;
                    extraction.totalBytes += chunk.byteLength;
                    try {
                        this.assertEntryBytes(planned.path, entryBytes);
                        this.assertTotalBytes(extraction.totalBytes);
                        chunks.push(chunk);
                    } catch (error) {
                        const failure = error instanceof Error ? error : new Error(String(error));
                        settled = true;
                        stream.destroy(failure);
                        reject(failure);
                    }
                });
                stream.once('error', fail);
                stream.once('end', () => {
                    if (settled) return;
                    settled = true;
                    resolve(Buffer.concat(chunks, entryBytes).toString('utf8'));
                });
            });
        });
    }

    private requireMarkdownPath(value: string, source: string): string {
        const path = normalizeOkfPath(value);
        if (!path || !path.toLowerCase().endsWith('.md')) {
            throw new BadRequestException(`非法 ${source} 路径：${value || '(empty)'}`);
        }
        return path;
    }

    private assertUniqueDestination(destinations: Map<string, string>, path: string, inputPath: string): void {
        const key = path.toLowerCase();
        const previous = destinations.get(key);
        if (previous) {
            throw new BadRequestException(`OKF 文档路径规范化后重复：${previous} 与 ${inputPath} → ${path}`);
        }
        destinations.set(key, inputPath);
    }

    private assertEntryBytes(path: string, bytes: number): void {
        if (!Number.isSafeInteger(bytes) || bytes < 0 || bytes > MAX_OKF_IMPORT_ENTRY_BYTES) {
            throw new BadRequestException(
                `OKF 单个文档解压后不能超过 ${MAX_OKF_IMPORT_ENTRY_BYTES / 1024 / 1024} MB：${path}`,
            );
        }
    }

    private assertTotalBytes(bytes: number): void {
        if (!Number.isSafeInteger(bytes) || bytes < 0 || bytes > MAX_OKF_IMPORT_BYTES) {
            throw new BadRequestException(`OKF 解压后不能超过 ${MAX_OKF_IMPORT_BYTES / 1024 / 1024} MB`);
        }
    }

    private singleArchiveRoot(paths: string[]): string | null {
        if (paths.length === 0) return null;
        const roots = new Set(paths.map(path => path.replace(/\\/g, '/').split('/')[0]).filter(Boolean));
        if (roots.size !== 1 || paths.some(path => !path.replace(/\\/g, '/').includes('/'))) return null;
        return Array.from(roots)[0];
    }
}
