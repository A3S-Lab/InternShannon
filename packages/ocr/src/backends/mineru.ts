import type { OcrBackend, OcrBackendConfig, OcrFetch, OcrInput, OcrRequestOptions, OcrResult } from '../types';
import {
    appendFormOption,
    fetchJson,
    inputFilename,
    inputToBlob,
    inputUrl,
    joinUrl,
    mergeHeaders,
    mergeOptions,
    normalizeOcrResult,
    outputFormat,
} from '../http';

export class MineruOcrBackend implements OcrBackend {
    readonly name: string;
    readonly type = 'mineru' as const;
    private readonly fetchImpl: OcrFetch;

    constructor(private readonly config: OcrBackendConfig, fetchImpl: OcrFetch = fetch) {
        this.name = config.name;
        this.fetchImpl = fetchImpl;
    }

    async recognize(input: OcrInput, options?: OcrRequestOptions): Promise<OcrResult> {
        const body = this.createBody(input, options);
        const raw = await fetchJson(
            this.fetchImpl,
            this.config,
            joinUrl(this.config.baseUrl, this.config.endpoint || '/file_parse'),
            {
                method: 'POST',
                headers: body instanceof FormData ? mergeHeaders(this.config, options) : mergeHeaders(this.config, options, 'application/json'),
                body: body instanceof FormData ? body : JSON.stringify(body),
            },
            options,
        );
        return normalizeOcrResult(raw, { backend: this.name, type: this.type });
    }

    private createBody(input: OcrInput, options?: OcrRequestOptions): FormData | Record<string, unknown> {
        const mergedOptions = mergeOptions(this.config, options);
        const url = inputUrl(input);
        if (url && input.data == null) {
            return {
                url,
                outputFormat: outputFormat(options, this.config),
                ...mergedOptions,
            };
        }

        const form = new FormData();
        form.append(String(mergedOptions.fileField || 'file'), inputToBlob(input), inputFilename(input));
        form.append('outputFormat', outputFormat(options, this.config));
        for (const [key, value] of Object.entries(mergedOptions)) {
            if (key === 'fileField') continue;
            appendFormOption(form, key, value);
        }
        return form;
    }
}
