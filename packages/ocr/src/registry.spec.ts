import { Buffer } from 'node:buffer';
import { createDefaultOcrSettings, DEFAULT_OCR_SETTINGS } from './defaults';
import { createOcrBackend, createOcrRegistry } from './registry';
import { OcrBackendError, type OcrBackendConfig, type OcrFetch } from './types';

function jsonFetch(responseBody: unknown, status = 200) {
    return jest.fn(async () => new Response(JSON.stringify(responseBody), { status })) as jest.MockedFunction<OcrFetch>;
}

describe('@a3s-lab/ocr', () => {
    it('ships disabled built-in backend templates for internShannon config backfill', () => {
        expect(DEFAULT_OCR_SETTINGS.defaultBackend).toBe('mineru');
        expect(DEFAULT_OCR_SETTINGS.backends.map(backend => backend.type)).toEqual([
            'mineru',
            'paddleocr',
            'unlimited-ocr',
        ]);
        expect(DEFAULT_OCR_SETTINGS.backends.every(backend => backend.enabled === false)).toBe(true);
    });

    it('creates cloned default settings so callers cannot mutate package templates', () => {
        const defaults = createDefaultOcrSettings();
        defaults.backends[0].name = 'changed';
        defaults.backends[0].options = { parseMethod: 'txt' };

        expect(DEFAULT_OCR_SETTINGS.backends[0].name).toBe('mineru');
        expect(DEFAULT_OCR_SETTINGS.backends[0].options).toMatchObject({ parseMethod: 'auto' });
        expect(createDefaultOcrSettings().backends[0].name).toBe('mineru');
    });

    it('creates a registry from enabled backends and falls back to the first enabled backend', async () => {
        const fetchImpl = jsonFetch({ data: { text: 'recognized text' } });
        const registry = createOcrRegistry(
            {
                defaultBackend: 'missing',
                backends: [
                    { ...DEFAULT_OCR_SETTINGS.backends[0], enabled: false },
                    { ...DEFAULT_OCR_SETTINGS.backends[1], enabled: true, baseUrl: 'http://paddle.local' },
                ],
            },
            fetchImpl,
        );

        await expect(registry.recognize({ data: Buffer.from('image'), filename: 'scan.png' })).resolves.toMatchObject({
            text: 'recognized text',
            metadata: { backend: 'paddleocr', type: 'paddleocr' },
        });
        expect(registry.list()).toEqual(['paddleocr']);
    });

    it('serializes PaddleOCR JSON Base64 requests', async () => {
        const fetchImpl = jsonFetch({ text: 'hello' });
        const backend = createOcrBackend(
            {
                ...(DEFAULT_OCR_SETTINGS.backends[1] as OcrBackendConfig),
                enabled: true,
                apiKey: 'secret',
                baseUrl: 'http://paddle.local/',
            },
            fetchImpl,
        );

        await backend.recognize({ data: Buffer.from('png'), filename: 'scan.png', mimeType: 'image/png' });

        expect(fetchImpl).toHaveBeenCalledWith(
            'http://paddle.local/ocr',
            expect.objectContaining({
                method: 'POST',
                headers: expect.objectContaining({
                    authorization: 'Bearer secret',
                    'content-type': 'application/json',
                }),
            }),
        );
        const init = fetchImpl.mock.calls[0][1] as RequestInit;
        expect(JSON.parse(String(init.body))).toMatchObject({
            filename: 'scan.png',
            mimeType: 'image/png',
            file: Buffer.from('png').toString('base64'),
        });
    });

    it('serializes MinerU remote URL requests without requiring a file body', async () => {
        const fetchImpl = jsonFetch({ markdown: '# OCR' });
        const backend = createOcrBackend(
            {
                ...(DEFAULT_OCR_SETTINGS.backends[0] as OcrBackendConfig),
                enabled: true,
                baseUrl: 'http://mineru.local',
            },
            fetchImpl,
        );

        await backend.recognize({ url: 'https://files.example.com/doc.pdf' });

        const init = fetchImpl.mock.calls[0][1] as RequestInit;
        expect(fetchImpl.mock.calls[0][0]).toBe('http://mineru.local/file_parse');
        expect(JSON.parse(String(init.body))).toMatchObject({
            url: 'https://files.example.com/doc.pdf',
            outputFormat: 'markdown',
        });
    });

    it('serializes Unlimited-OCR OpenAI-compatible vision requests', async () => {
        const fetchImpl = jsonFetch({
            choices: [{ message: { content: 'vision text' } }],
        });
        const backend = createOcrBackend(
            {
                ...(DEFAULT_OCR_SETTINGS.backends[2] as OcrBackendConfig),
                enabled: true,
                baseUrl: 'http://unlimited.local',
            },
            fetchImpl,
        );

        await backend.recognize({ data: Buffer.from('jpg'), filename: 'scan.jpg', mimeType: 'image/jpeg' });

        const init = fetchImpl.mock.calls[0][1] as RequestInit;
        const body = JSON.parse(String(init.body));
        expect(fetchImpl.mock.calls[0][0]).toBe('http://unlimited.local/v1/chat/completions');
        expect(body).toMatchObject({
            model: 'Unlimited-OCR',
            stream: false,
            messages: [
                {
                    role: 'user',
                },
            ],
        });
        expect(body.messages[0].content[1].image_url.url).toMatch(/^data:image\/jpeg;base64,/);
    });

    it('keeps custom backend metadata while reusing standard request formats', async () => {
        const fetchImpl = jsonFetch({ text: 'custom text' });
        const backend = createOcrBackend(
            {
                name: 'my-http-ocr',
                type: 'custom',
                enabled: true,
                baseUrl: 'http://ocr.local',
                endpoint: '/recognize',
                requestFormat: 'json-base64',
                outputFormat: 'json',
            },
            fetchImpl,
        );

        await expect(backend.recognize({ data: Buffer.from('png'), filename: 'scan.png' })).resolves.toMatchObject({
            text: 'custom text',
            metadata: {
                backend: 'my-http-ocr',
                type: 'custom',
                requestFormat: 'json-base64',
            },
        });
    });

    it('throws a typed error when no backend is enabled', () => {
        const registry = createOcrRegistry(DEFAULT_OCR_SETTINGS, jsonFetch({}));

        expect(() => registry.getDefault()).toThrow(OcrBackendError);
    });
});
