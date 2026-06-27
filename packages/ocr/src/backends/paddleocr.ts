import type { OcrBackend, OcrBackendConfig, OcrFetch, OcrInput, OcrRequestOptions, OcrResult } from '../types';
import {
    fetchJson,
    inputFilename,
    inputMimeType,
    inputToBase64,
    joinUrl,
    mergeHeaders,
    mergeOptions,
    normalizeOcrResult,
    outputFormat,
} from '../http';

export class PaddleOcrBackend implements OcrBackend {
    readonly name: string;
    readonly type = 'paddleocr' as const;
    private readonly fetchImpl: OcrFetch;

    constructor(private readonly config: OcrBackendConfig, fetchImpl: OcrFetch = fetch) {
        this.name = config.name;
        this.fetchImpl = fetchImpl;
    }

    async recognize(input: OcrInput, options?: OcrRequestOptions): Promise<OcrResult> {
        const mergedOptions = mergeOptions(this.config, options);
        const bodyField = String(mergedOptions.bodyField || 'file');
        const body: Record<string, unknown> = {
            filename: inputFilename(input),
            mimeType: inputMimeType(input),
            outputFormat: outputFormat(options, this.config),
            ...mergedOptions,
            [bodyField]: inputToBase64(input),
        };

        const raw = await fetchJson(
            this.fetchImpl,
            this.config,
            joinUrl(this.config.baseUrl, this.config.endpoint || '/ocr'),
            {
                method: 'POST',
                headers: mergeHeaders(this.config, options, 'application/json'),
                body: JSON.stringify(body),
            },
            options,
        );
        return normalizeOcrResult(raw, { backend: this.name, type: this.type });
    }
}
