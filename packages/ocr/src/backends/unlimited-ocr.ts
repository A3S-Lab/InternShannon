import type { OcrBackend, OcrBackendConfig, OcrFetch, OcrInput, OcrRequestOptions, OcrResult } from '../types';
import { fetchJson, inputToDataUrl, joinUrl, mergeHeaders, mergeOptions, normalizeOcrResult } from '../http';

export class UnlimitedOcrBackend implements OcrBackend {
    readonly name: string;
    readonly type = 'unlimited-ocr' as const;
    private readonly fetchImpl: OcrFetch;

    constructor(private readonly config: OcrBackendConfig, fetchImpl: OcrFetch = fetch) {
        this.name = config.name;
        this.fetchImpl = fetchImpl;
    }

    async recognize(input: OcrInput, options?: OcrRequestOptions): Promise<OcrResult> {
        const mergedOptions = mergeOptions(this.config, options);
        const prompt =
            typeof mergedOptions.prompt === 'string'
                ? mergedOptions.prompt
                : 'Extract all visible text from this document. Preserve reading order.';
        const body = {
            model: options?.model || this.config.model || 'Unlimited-OCR',
            messages: [
                {
                    role: 'user',
                    content: [
                        { type: 'text', text: prompt },
                        { type: 'image_url', image_url: { url: inputToDataUrl(input) } },
                    ],
                },
            ],
            temperature: typeof mergedOptions.temperature === 'number' ? mergedOptions.temperature : 0,
            max_tokens: typeof mergedOptions.maxTokens === 'number' ? mergedOptions.maxTokens : 4096,
            stream: false,
        };

        const raw = await fetchJson(
            this.fetchImpl,
            this.config,
            joinUrl(this.config.baseUrl, this.config.endpoint || '/v1/chat/completions'),
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
