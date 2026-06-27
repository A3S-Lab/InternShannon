import type { OcrBackend, OcrBackendConfig, OcrFetch, OcrInput, OcrRequestOptions, OcrResult } from '../types';
import { MineruOcrBackend } from './mineru';
import { PaddleOcrBackend } from './paddleocr';
import { UnlimitedOcrBackend } from './unlimited-ocr';

export class GenericHttpOcrBackend implements OcrBackend {
    readonly name: string;
    readonly type = 'custom' as const;
    private readonly delegate: OcrBackend;
    private readonly requestFormat: OcrBackendConfig['requestFormat'];

    constructor(config: OcrBackendConfig, fetchImpl: OcrFetch = fetch) {
        this.name = config.name;
        this.requestFormat = config.requestFormat || 'json-base64';
        this.delegate =
            this.requestFormat === 'multipart'
                ? new MineruOcrBackend({ ...config, type: 'custom' }, fetchImpl)
                : this.requestFormat === 'openai-vision'
                  ? new UnlimitedOcrBackend({ ...config, type: 'custom' }, fetchImpl)
                  : new PaddleOcrBackend({ ...config, type: 'custom' }, fetchImpl);
    }

    async recognize(input: OcrInput, options?: OcrRequestOptions): Promise<OcrResult> {
        const result = await this.delegate.recognize(input, options);
        return {
            ...result,
            metadata: {
                ...(result.metadata ?? {}),
                backend: this.name,
                type: this.type,
                requestFormat: this.requestFormat,
            },
        };
    }
}
