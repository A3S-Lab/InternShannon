import type { OcrBackendConfig, OcrSettings } from './types';

export const DEFAULT_OCR_BACKENDS: OcrBackendConfig[] = [
    {
        name: 'mineru',
        type: 'mineru',
        enabled: false,
        baseUrl: 'http://localhost:30000',
        endpoint: '/file_parse',
        timeoutMs: 300_000,
        outputFormat: 'markdown',
        requestFormat: 'multipart',
        headers: {},
        options: {
            parseMethod: 'auto',
            returnLayout: true,
            returnInfo: true,
        },
    },
    {
        name: 'paddleocr',
        type: 'paddleocr',
        enabled: false,
        baseUrl: 'http://localhost:8080',
        endpoint: '/ocr',
        timeoutMs: 120_000,
        outputFormat: 'json',
        requestFormat: 'json-base64',
        headers: {},
        options: {
            bodyField: 'file',
            useAngleCls: true,
            det: true,
            rec: true,
        },
    },
    {
        name: 'unlimited-ocr',
        type: 'unlimited-ocr',
        enabled: false,
        baseUrl: 'http://localhost:8000',
        endpoint: '/v1/chat/completions',
        timeoutMs: 180_000,
        model: 'Unlimited-OCR',
        outputFormat: 'markdown',
        requestFormat: 'openai-vision',
        headers: {},
        options: {
            prompt: 'Extract all visible text from this document. Preserve reading order and tables when possible.',
            temperature: 0,
            maxTokens: 4096,
        },
    },
];

export const DEFAULT_OCR_SETTINGS: OcrSettings = {
    defaultBackend: 'mineru',
    backends: DEFAULT_OCR_BACKENDS,
};

export function cloneOcrBackendConfig(backend: OcrBackendConfig): OcrBackendConfig {
    return JSON.parse(JSON.stringify(backend)) as OcrBackendConfig;
}

export function createDefaultOcrSettings(): OcrSettings {
    return {
        defaultBackend: DEFAULT_OCR_SETTINGS.defaultBackend,
        backends: DEFAULT_OCR_BACKENDS.map(cloneOcrBackendConfig),
    };
}

export function builtinOcrBackendTemplate(type: OcrBackendConfig['type']): OcrBackendConfig {
    const template = DEFAULT_OCR_BACKENDS.find(backend => backend.type === type);
    if (!template) {
        return {
            name: 'custom-ocr',
            type: 'custom',
            enabled: false,
            baseUrl: '',
            endpoint: '/ocr',
            timeoutMs: 120_000,
            outputFormat: 'json',
            requestFormat: 'json-base64',
            headers: {},
            options: {},
        };
    }
    return cloneOcrBackendConfig(template);
}
