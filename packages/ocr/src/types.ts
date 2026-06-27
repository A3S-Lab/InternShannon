import type { Buffer } from 'node:buffer';

export const OCR_BACKEND_TYPES = ['mineru', 'paddleocr', 'unlimited-ocr', 'custom'] as const;
export type OcrBackendType = (typeof OCR_BACKEND_TYPES)[number];

export const OCR_REQUEST_FORMATS = ['multipart', 'json-base64', 'openai-vision'] as const;
export type OcrRequestFormat = (typeof OCR_REQUEST_FORMATS)[number];

export const OCR_OUTPUT_FORMATS = ['text', 'markdown', 'json'] as const;
export type OcrOutputFormat = (typeof OCR_OUTPUT_FORMATS)[number];

export type OcrBinaryData = Buffer | Uint8Array | ArrayBuffer;

export interface OcrInput {
    data?: OcrBinaryData | string;
    url?: string;
    mimeType?: string;
    filename?: string;
}

export interface OcrBackendConfig {
    name: string;
    type: OcrBackendType;
    enabled: boolean;
    baseUrl: string;
    endpoint?: string;
    apiKey?: string;
    headers?: Record<string, string>;
    timeoutMs?: number;
    model?: string;
    outputFormat?: OcrOutputFormat;
    requestFormat?: OcrRequestFormat;
    options?: Record<string, unknown>;
}

export interface OcrSettings {
    defaultBackend: string;
    backends: OcrBackendConfig[];
}

export interface OcrRequestOptions {
    timeoutMs?: number;
    signal?: AbortSignal;
    headers?: Record<string, string>;
    model?: string;
    outputFormat?: OcrOutputFormat;
    options?: Record<string, unknown>;
}

export interface OcrTextBlock {
    id?: string;
    pageIndex?: number;
    type?: 'text' | 'line' | 'paragraph' | 'table' | 'formula' | 'figure' | string;
    text: string;
    confidence?: number;
    bbox?: number[];
    polygon?: number[][];
    metadata?: Record<string, unknown>;
}

export interface OcrPage {
    pageIndex: number;
    text?: string;
    width?: number;
    height?: number;
    angle?: number;
    blocks?: OcrTextBlock[];
    metadata?: Record<string, unknown>;
}

export interface OcrResult {
    text: string;
    markdown?: string;
    pages: OcrPage[];
    blocks: OcrTextBlock[];
    raw?: unknown;
    metadata?: Record<string, unknown>;
}

export interface OcrBackend {
    readonly name: string;
    readonly type: OcrBackendType;
    recognize(input: OcrInput, options?: OcrRequestOptions): Promise<OcrResult>;
}

export type OcrFetch = typeof fetch;

export class OcrBackendError extends Error {
    readonly backend: string;
    readonly status?: number;
    readonly response?: unknown;

    constructor(message: string, options: { backend: string; status?: number; response?: unknown }) {
        super(message);
        this.name = 'OcrBackendError';
        this.backend = options.backend;
        this.status = options.status;
        this.response = options.response;
    }
}
