import type { OcrFetch } from '@a3s-lab/ocr';
import { BadRequestException } from '@/shared/common/errors';
import type { ConfigService } from '../../config/domain/services/config-service.interface';
import type { IWorkspaceStorage, WsDirEntry } from '../domain/services/workspace-storage.interface';
import { WorkspaceOcrService } from './workspace-ocr.service';

class MemoryStorage implements Partial<IWorkspaceStorage> {
    data = Buffer.from('image');

    async stat(): Promise<WsDirEntry> {
        return {
            name: 'scan.png',
            isDirectory: false,
            isFile: true,
            size: this.data.length,
        };
    }

    async readBinaryFile(): Promise<Buffer> {
        return this.data;
    }
}

function config(fetchUrl: string): ConfigService {
    return {
        getSettings: async () =>
            ({
                ocr: {
                    defaultBackend: 'test-ocr',
                    backends: [
                        {
                            name: 'test-ocr',
                            type: 'paddleocr',
                            enabled: true,
                            baseUrl: fetchUrl,
                            endpoint: '/ocr',
                            requestFormat: 'multipart',
                            outputFormat: 'text',
                        },
                    ],
                },
            }) as Awaited<ReturnType<ConfigService['getSettings']>>,
    } as ConfigService;
}

describe('WorkspaceOcrService', () => {
    it('runs explicit OCR through configured backend', async () => {
        const fetchImpl: OcrFetch = jest.fn(async () =>
            new Response(JSON.stringify({ text: 'OCR_OK', pages: [], blocks: [] }), {
                status: 200,
                headers: { 'content-type': 'application/json' },
            }),
        ) as OcrFetch;
        const service = new WorkspaceOcrService(new MemoryStorage() as IWorkspaceStorage, config('http://ocr.local'), fetchImpl);

        const result = await service.recognize({ path: '/tmp/scan.png' });

        expect(result.text).toBe('OCR_OK');
        expect(result.file).toMatchObject({ name: 'scan.png', mimeType: 'image/png' });
        expect(fetchImpl).toHaveBeenCalledTimes(1);
    });

    it('surfaces OCR backend failures as bad requests', async () => {
        const fetchImpl: OcrFetch = jest.fn(async () =>
            new Response(JSON.stringify({ error: 'backend failed' }), {
                status: 500,
                headers: { 'content-type': 'application/json' },
            }),
        ) as OcrFetch;
        const service = new WorkspaceOcrService(new MemoryStorage() as IWorkspaceStorage, config('http://ocr.local'), fetchImpl);

        await expect(service.recognize({ path: '/tmp/scan.png' })).rejects.toBeInstanceOf(BadRequestException);
    });

    it('fails clearly when no OCR backend is enabled', async () => {
        const cfg = {
            getSettings: async () =>
                ({
                    ocr: {
                        defaultBackend: 'none',
                        backends: [],
                    },
                }) as Awaited<ReturnType<ConfigService['getSettings']>>,
        } as ConfigService;
        const service = new WorkspaceOcrService(new MemoryStorage() as IWorkspaceStorage, cfg);

        await expect(service.recognize({ path: '/tmp/scan.png' })).rejects.toThrow('未启用任何 OCR 后端');
    });
});
