import { Buffer } from 'node:buffer';
import type {
    OcrBackendConfig,
    OcrFetch,
    OcrInput,
    OcrOutputFormat,
    OcrRequestOptions,
    OcrResult,
    OcrTextBlock,
} from './types';
import { OcrBackendError } from './types';

export function joinUrl(baseUrl: string, endpoint = ''): string {
    const base = baseUrl.trim().replace(/\/+$/, '');
    const path = endpoint.trim();
    if (!path) return base;
    if (/^https?:\/\//i.test(path)) return path;
    return `${base}/${path.replace(/^\/+/, '')}`;
}

export function mergeHeaders(
    config: OcrBackendConfig,
    options?: OcrRequestOptions,
    contentType?: string,
): Record<string, string> {
    const headers: Record<string, string> = {
        ...(config.headers ?? {}),
        ...(options?.headers ?? {}),
    };
    if (contentType) headers['content-type'] = contentType;
    if (config.apiKey && !headers.authorization && !headers.Authorization) {
        headers.authorization = `Bearer ${config.apiKey}`;
    }
    return headers;
}

export async function fetchJson(
    fetchImpl: OcrFetch,
    config: OcrBackendConfig,
    input: RequestInfo | URL,
    init: RequestInit,
    options?: OcrRequestOptions,
): Promise<unknown> {
    const timeoutMs = options?.timeoutMs ?? config.timeoutMs ?? 120_000;
    const timeoutSignal = timeoutMs > 0 ? AbortSignal.timeout(timeoutMs) : undefined;
    const signal = mergeSignals(options?.signal, timeoutSignal);
    const response = await fetchImpl(input, { ...init, signal });
    const text = await response.text();
    const body = safeJsonParse(text);
    if (!response.ok) {
        throw new OcrBackendError(`OCR backend "${config.name}" returned HTTP ${response.status}`, {
            backend: config.name,
            status: response.status,
            response: body ?? text,
        });
    }
    return body ?? text;
}

export function mergeOptions(
    config: OcrBackendConfig,
    options?: OcrRequestOptions,
): Record<string, unknown> {
    return {
        ...(config.options ?? {}),
        ...(options?.options ?? {}),
    };
}

export function inputMimeType(input: OcrInput): string {
    return input.mimeType || guessMimeType(input.filename) || 'application/octet-stream';
}

export function inputFilename(input: OcrInput): string {
    return input.filename || defaultFilename(inputMimeType(input));
}

export function inputUrl(input: OcrInput): string | undefined {
    const candidate = input.url || (typeof input.data === 'string' ? input.data : undefined);
    if (!candidate) return undefined;
    if (candidate.startsWith('data:') || /^https?:\/\//i.test(candidate)) return candidate;
    return undefined;
}

export function inputToBase64(input: OcrInput): string {
    if (input.data == null) {
        throw new OcrBackendError('OCR input data is required for this backend', { backend: 'ocr' });
    }
    if (typeof input.data === 'string') {
        if (input.data.startsWith('data:')) {
            const commaIndex = input.data.indexOf(',');
            return commaIndex >= 0 ? input.data.slice(commaIndex + 1) : input.data;
        }
        if (/^https?:\/\//i.test(input.data)) {
            throw new OcrBackendError('Remote URL input is not supported by this request format', { backend: 'ocr' });
        }
        return input.data;
    }
    return Buffer.from(input.data as ArrayBuffer).toString('base64');
}

export function inputToDataUrl(input: OcrInput): string {
    const url = inputUrl(input);
    if (url) return url;
    return `data:${inputMimeType(input)};base64,${inputToBase64(input)}`;
}

export function inputToBlob(input: OcrInput): Blob {
    if (input.data == null || typeof input.data === 'string') {
        throw new OcrBackendError('Binary OCR input is required for multipart requests', { backend: 'ocr' });
    }
    return new Blob([input.data as BlobPart], { type: inputMimeType(input) });
}

export function appendFormOption(form: FormData, key: string, value: unknown): void {
    if (value === undefined || value === null) return;
    if (typeof value === 'object') {
        form.append(key, JSON.stringify(value));
        return;
    }
    form.append(key, String(value));
}

export function normalizeOcrResult(raw: unknown, metadata: Record<string, unknown> = {}): OcrResult {
    const text = extractText(raw);
    const markdown = extractMarkdown(raw);
    const pages = extractPages(raw);
    const blocks = extractBlocks(raw, pages);
    return {
        text: text || markdown || blocks.map(block => block.text).filter(Boolean).join('\n'),
        markdown,
        pages,
        blocks,
        raw,
        metadata,
    };
}

function mergeSignals(...signals: Array<AbortSignal | undefined>): AbortSignal | undefined {
    const active = signals.filter(Boolean) as AbortSignal[];
    if (active.length === 0) return undefined;
    if (active.length === 1) return active[0];
    const controller = new AbortController();
    for (const signal of active) {
        if (signal.aborted) {
            controller.abort(signal.reason);
            break;
        }
        signal.addEventListener('abort', () => controller.abort(signal.reason), { once: true });
    }
    return controller.signal;
}

function safeJsonParse(text: string): unknown | null {
    if (!text) return null;
    try {
        return JSON.parse(text);
    } catch {
        return null;
    }
}

function guessMimeType(filename?: string): string | undefined {
    const ext = filename?.split('.').pop()?.toLowerCase();
    if (!ext) return undefined;
    if (ext === 'pdf') return 'application/pdf';
    if (ext === 'png') return 'image/png';
    if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
    if (ext === 'webp') return 'image/webp';
    if (ext === 'tif' || ext === 'tiff') return 'image/tiff';
    return undefined;
}

function defaultFilename(mimeType: string): string {
    if (mimeType === 'application/pdf') return 'document.pdf';
    if (mimeType === 'image/png') return 'image.png';
    if (mimeType === 'image/jpeg') return 'image.jpg';
    if (mimeType === 'image/webp') return 'image.webp';
    if (mimeType === 'image/tiff') return 'image.tiff';
    return 'document.bin';
}

function extractText(raw: unknown): string {
    if (typeof raw === 'string') return raw;
    const record = asRecord(raw);
    if (!record) return '';
    const candidates = [
        record.text,
        record.content,
        record.markdown,
        record.md,
        asRecord(record.result)?.text,
        asRecord(record.result)?.markdown,
        asRecord(record.data)?.text,
        asRecord(record.data)?.markdown,
        asRecord(record.data)?.content,
        extractOpenAiContent(record),
    ];
    return candidates.find(value => typeof value === 'string' && value.trim()) as string || '';
}

function extractMarkdown(raw: unknown): string | undefined {
    const record = asRecord(raw);
    if (!record) return undefined;
    const candidates = [
        record.markdown,
        record.md,
        asRecord(record.result)?.markdown,
        asRecord(record.data)?.markdown,
    ];
    return candidates.find(value => typeof value === 'string' && value.trim()) as string | undefined;
}

function extractPages(raw: unknown): OcrResult['pages'] {
    const record = asRecord(raw);
    const candidates = [
        record?.pages,
        asRecord(record?.result)?.pages,
        asRecord(record?.data)?.pages,
        asRecord(record?.data)?.results,
    ];
    const array = candidates.find(Array.isArray) as unknown[] | undefined;
    if (!array) return [];
    return array.map((page, index) => {
        const item = asRecord(page) ?? {};
        const text = typeof item.text === 'string' ? item.text : extractText(item);
        return {
            pageIndex: Number(item.pageIndex ?? item.page_index ?? item.page ?? index),
            text,
            width: numberOrUndefined(item.width),
            height: numberOrUndefined(item.height),
            angle: numberOrUndefined(item.angle),
            blocks: extractBlocks(item, []),
            metadata: item,
        };
    });
}

function extractBlocks(raw: unknown, pages: OcrResult['pages']): OcrTextBlock[] {
    const record = asRecord(raw);
    const candidates = [
        record?.blocks,
        record?.lines,
        asRecord(record?.result)?.blocks,
        asRecord(record?.result)?.lines,
        asRecord(record?.data)?.blocks,
        asRecord(record?.data)?.lines,
    ];
    const array = candidates.find(Array.isArray) as unknown[] | undefined;
    const directBlocks = array
        ? array.map((block, index) => normalizeBlock(block, index)).filter((block): block is OcrTextBlock => Boolean(block))
        : [];
    const pageBlocks = pages.flatMap(page => page.blocks ?? []);
    return [...directBlocks, ...pageBlocks];
}

function normalizeBlock(block: unknown, index: number): OcrTextBlock | null {
    const item = asRecord(block);
    if (!item) return null;
    const text = typeof item.text === 'string' ? item.text : typeof item.content === 'string' ? item.content : '';
    if (!text) return null;
    return {
        id: typeof item.id === 'string' ? item.id : String(index),
        pageIndex: numberOrUndefined(item.pageIndex ?? item.page_index ?? item.page),
        type: typeof item.type === 'string' ? item.type : typeof item.kind === 'string' ? item.kind : 'text',
        text,
        confidence: numberOrUndefined(item.confidence ?? item.score),
        bbox: Array.isArray(item.bbox) ? item.bbox.map(Number) : Array.isArray(item.box) ? item.box.map(Number) : undefined,
        polygon: Array.isArray(item.polygon) ? (item.polygon as number[][]) : undefined,
        metadata: item,
    };
}

function extractOpenAiContent(record: Record<string, unknown>): string | undefined {
    const choices = Array.isArray(record.choices) ? record.choices : undefined;
    const firstChoice = asRecord(choices?.[0]);
    const message = asRecord(firstChoice?.message);
    return typeof message?.content === 'string' ? message.content : undefined;
}

function asRecord(value: unknown): Record<string, unknown> | null {
    return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function numberOrUndefined(value: unknown): number | undefined {
    const number = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN;
    return Number.isFinite(number) ? number : undefined;
}

export function outputFormat(options: OcrRequestOptions | undefined, config: OcrBackendConfig): OcrOutputFormat {
    return options?.outputFormat ?? config.outputFormat ?? 'json';
}
