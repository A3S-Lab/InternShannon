import { Inject, Injectable, Optional } from '@nestjs/common';
import { createOcrRegistry, OcrBackendError, type OcrFetch, type OcrOutputFormat, type OcrResult } from '@a3s-lab/ocr';
import * as path from 'path';
import { BadRequestException } from '@/shared/common/errors';
import { CONFIG_SERVICE, type ConfigService } from '../../config/domain/services/config-service.interface';
import { type IWorkspaceStorage, WORKSPACE_STORAGE } from '../domain/services/workspace-storage.interface';

export const WORKSPACE_OCR_FETCH = 'WORKSPACE_OCR_FETCH';

export interface WorkspaceOcrInput {
    path: string;
    backend?: string;
    outputFormat?: OcrOutputFormat;
    timeoutMs?: number;
}

export interface WorkspaceOcrOutput {
    file: {
        path: string;
        name: string;
        size?: number;
        mimeType: string;
    };
    text: string;
    markdown?: string;
    pages: OcrResult['pages'];
    blocks: OcrResult['blocks'];
    metadata?: Record<string, unknown>;
}

@Injectable()
export class WorkspaceOcrService {
    constructor(
        @Inject(WORKSPACE_STORAGE)
        private readonly storage: IWorkspaceStorage,
        @Optional()
        @Inject(CONFIG_SERVICE)
        private readonly config?: ConfigService,
        @Optional()
        @Inject(WORKSPACE_OCR_FETCH)
        private readonly fetchImpl: OcrFetch = fetch,
    ) {}

    async recognize(input: WorkspaceOcrInput): Promise<WorkspaceOcrOutput> {
        const filePath = input.path.trim();
        if (!filePath) {
            throw new BadRequestException('OCR 文件路径不能为空');
        }

        const settings = await this.config?.getSettings().catch(() => null);
        if (!settings?.ocr) {
            throw new BadRequestException('OCR 设置未配置');
        }

        const enabledBackends = settings.ocr.backends?.filter(backend => backend.enabled) ?? [];
        if (enabledBackends.length === 0) {
            throw new BadRequestException('未启用任何 OCR 后端，请先在系统设置中启用并配置 OCR 服务');
        }

        const stat = await this.storage.stat(filePath);
        if (!stat.isFile) {
            throw new BadRequestException('OCR 路径必须指向文件');
        }

        const data = await this.storage.readBinaryFile(filePath);
        try {
            const registry = createOcrRegistry(settings.ocr, this.fetchImpl);
            const result = await registry.recognize(
                {
                    data,
                    filename: path.basename(filePath),
                    mimeType: this.mimeType(filePath),
                },
                {
                    backend: input.backend,
                    outputFormat: input.outputFormat,
                    timeoutMs: input.timeoutMs,
                },
            );

            return {
                file: {
                    path: filePath,
                    name: path.basename(filePath),
                    size: stat.size,
                    mimeType: this.mimeType(filePath),
                },
                text: result.text,
                markdown: result.markdown,
                pages: result.pages,
                blocks: result.blocks,
                metadata: result.metadata,
            };
        } catch (error) {
            if (error instanceof OcrBackendError) {
                const status = error.status ? ` HTTP ${error.status}` : '';
                throw new BadRequestException(`OCR 后端识别失败（${error.backend}${status}）：${error.message}`);
            }
            throw new BadRequestException(`OCR 识别失败：${error instanceof Error ? error.message : String(error)}`);
        }
    }

    private mimeType(filePath: string): string {
        switch (path.extname(filePath).toLowerCase()) {
            case '.png':
                return 'image/png';
            case '.jpg':
            case '.jpeg':
                return 'image/jpeg';
            case '.gif':
                return 'image/gif';
            case '.webp':
                return 'image/webp';
            case '.bmp':
                return 'image/bmp';
            case '.tif':
            case '.tiff':
                return 'image/tiff';
            case '.pdf':
                return 'application/pdf';
            default:
                return 'application/octet-stream';
        }
    }
}
