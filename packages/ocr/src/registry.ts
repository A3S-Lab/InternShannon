import { builtinOcrBackendTemplate } from './defaults';
import { GenericHttpOcrBackend } from './backends/generic-http';
import { MineruOcrBackend } from './backends/mineru';
import { PaddleOcrBackend } from './backends/paddleocr';
import { UnlimitedOcrBackend } from './backends/unlimited-ocr';
import type { OcrBackend, OcrBackendConfig, OcrFetch, OcrInput, OcrRequestOptions, OcrResult, OcrSettings } from './types';
import { OcrBackendError } from './types';

export function createOcrBackend(config: OcrBackendConfig, fetchImpl: OcrFetch = fetch): OcrBackend {
    const mergedConfig = {
        ...builtinOcrBackendTemplate(config.type),
        ...config,
        headers: config.headers ?? {},
        options: config.options ?? {},
    };

    switch (mergedConfig.type) {
        case 'mineru':
            return new MineruOcrBackend(mergedConfig, fetchImpl);
        case 'paddleocr':
            return new PaddleOcrBackend(mergedConfig, fetchImpl);
        case 'unlimited-ocr':
            return new UnlimitedOcrBackend(mergedConfig, fetchImpl);
        case 'custom':
            return new GenericHttpOcrBackend(mergedConfig, fetchImpl);
        default:
            throw new OcrBackendError(`Unsupported OCR backend type: ${(mergedConfig as OcrBackendConfig).type}`, {
                backend: mergedConfig.name,
            });
    }
}

export class OcrRegistry {
    private readonly backends = new Map<string, OcrBackend>();
    private readonly defaultBackendName: string;

    constructor(settings: OcrSettings, fetchImpl: OcrFetch = fetch) {
        for (const config of settings.backends) {
            if (!config.enabled) continue;
            this.backends.set(config.name, createOcrBackend(config, fetchImpl));
        }
        this.defaultBackendName = this.backends.has(settings.defaultBackend)
            ? settings.defaultBackend
            : (this.backends.keys().next().value as string | undefined) || '';
    }

    list(): string[] {
        return Array.from(this.backends.keys());
    }

    get(name: string): OcrBackend | undefined {
        return this.backends.get(name);
    }

    getDefault(): OcrBackend {
        const backend = this.backends.get(this.defaultBackendName);
        if (!backend) {
            throw new OcrBackendError('No enabled OCR backend is configured', { backend: 'ocr' });
        }
        return backend;
    }

    recognize(input: OcrInput, options?: OcrRequestOptions & { backend?: string }): Promise<OcrResult> {
        const backend = options?.backend ? this.backends.get(options.backend) : this.getDefault();
        if (!backend) {
            throw new OcrBackendError(`OCR backend "${options?.backend}" is not enabled or does not exist`, {
                backend: options?.backend || 'ocr',
            });
        }
        return backend.recognize(input, options);
    }
}

export function createOcrRegistry(settings: OcrSettings, fetchImpl: OcrFetch = fetch): OcrRegistry {
    return new OcrRegistry(settings, fetchImpl);
}
