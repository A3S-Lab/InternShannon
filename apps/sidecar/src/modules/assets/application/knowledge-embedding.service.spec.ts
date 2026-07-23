import type { ConfigService } from '../../config/domain/services/config-service.interface';
import { Asset } from '../domain/entities/asset.entity';
import { KnowledgeEmbeddingService } from './knowledge-embedding.service';

function knowledgeAsset(embedding?: Record<string, unknown>) {
    return Asset.create({
        name: 'knowledge',
        ownerId: 'user-1',
        ownerType: 'user',
        category: 'knowledge',
        visibility: 'private',
        metadata: embedding ? { knowledge: { embedding } } : undefined,
    });
}

describe('KnowledgeEmbeddingService', () => {
    it('keeps local-hash-v1 as the offline default', async () => {
        const service = new KnowledgeEmbeddingService();
        const result = await service.embed(knowledgeAsset(), ['revenue renewal']);

        expect(result).toMatchObject({ provider: 'local', model: 'local-hash-v1', dimensions: 192 });
        expect(result.vectors).toHaveLength(1);
    });

    it('uses an explicitly selected OpenAI-compatible provider without exposing its key', async () => {
        const originalFetch = global.fetch;
        global.fetch = jest.fn(async (_url, init) => {
            expect(init?.headers).toEqual(expect.objectContaining({ Authorization: 'Bearer provider-secret' }));
            return new Response(
                JSON.stringify({
                    data: [
                        { index: 0, embedding: [1, 0, 0] },
                        { index: 1, embedding: [0, 1, 0] },
                    ],
                }),
                { status: 200, headers: { 'content-type': 'application/json' } },
            );
        }) as typeof fetch;
        const config = {
            getSettings: jest.fn(async () => ({
                llm: {
                    providers: [
                        {
                            name: 'openai-compatible',
                            apiKey: 'provider-secret',
                            baseUrl: 'https://models.example.test/v1',
                            models: [{ id: 'embed-v1', name: 'embed-v1' }],
                        },
                    ],
                },
            })),
        } as unknown as ConfigService;
        try {
            const service = new KnowledgeEmbeddingService(config);
            const result = await service.embed(
                knowledgeAsset({ provider: 'openai-compatible', model: 'embed-v1', dimensions: 3 }),
                ['first', 'second'],
            );

            expect(result).toEqual({
                provider: 'openai-compatible',
                model: 'embed-v1',
                dimensions: 3,
                vectors: [
                    [1, 0, 0],
                    [0, 1, 0],
                ],
            });
        } finally {
            global.fetch = originalFetch;
        }
    });

    it.each([429, 503])('retries retryable HTTP %i responses and then succeeds', async status => {
        const originalFetch = global.fetch;
        const fetchMock = jest
            .fn()
            .mockResolvedValueOnce(new Response('temporary', { status }))
            .mockResolvedValueOnce(
                new Response(JSON.stringify({ data: [{ index: 0, embedding: [1, 2] }] }), {
                    status: 200,
                    headers: { 'content-type': 'application/json' },
                }),
            );
        global.fetch = fetchMock as typeof fetch;
        try {
            const service = new KnowledgeEmbeddingService(providerConfig('secret-value'));
            await expect(
                service.embed(knowledgeAsset({ provider: 'remote', model: 'embed-v1' }), ['hello']),
            ).resolves.toMatchObject({ vectors: [[1, 2]] });
            expect(fetchMock).toHaveBeenCalledTimes(2);
        } finally {
            global.fetch = originalFetch;
        }
    });

    it('does not retry 401 responses or expose provider response content', async () => {
        const originalFetch = global.fetch;
        const fetchMock = jest.fn(async () => new Response('echoed secret-value', { status: 401 }));
        global.fetch = fetchMock as typeof fetch;
        try {
            const service = new KnowledgeEmbeddingService(providerConfig('secret-value'));
            const promise = service.embed(knowledgeAsset({ provider: 'remote', model: 'embed-v1' }), ['hello']);
            await expect(promise).rejects.toThrow('Embedding request failed (401)');
            await expect(promise).rejects.not.toThrow('secret-value');
            expect(fetchMock).toHaveBeenCalledTimes(1);
        } finally {
            global.fetch = originalFetch;
        }
    });

    it.each([
        ['missing data', {}],
        ['invalid vector', { data: [{ index: 0, embedding: ['not-a-number'] }] }],
        ['wrong vector count', { data: [] }],
        ['inconsistent dimensions', { data: [{ index: 0, embedding: [1, 2] }, { index: 1, embedding: [1] }] }],
    ])('rejects malformed provider output: %s', async (_label, payload) => {
        const originalFetch = global.fetch;
        global.fetch = jest.fn(async () => new Response(JSON.stringify(payload), { status: 200 })) as typeof fetch;
        try {
            const service = new KnowledgeEmbeddingService(providerConfig());
            await expect(
                service.embed(knowledgeAsset({ provider: 'remote', model: 'embed-v1' }), ['one', 'two']),
            ).rejects.toThrow(/Embedding (response|provider returned)/);
        } finally {
            global.fetch = originalFetch;
        }
    });

    it('times out stalled provider requests and retries within the configured bound', async () => {
        const originalFetch = global.fetch;
        const fetchMock = jest.fn(
            (_url: RequestInfo | URL, init?: RequestInit) =>
                new Promise<Response>((_resolve, reject) => {
                    init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true });
                }),
        );
        global.fetch = fetchMock as typeof fetch;
        try {
            const service = new KnowledgeEmbeddingService(providerConfig());
            await expect(
                service.embed(
                    knowledgeAsset({ provider: 'remote', model: 'embed-v1', timeoutMs: 5 }),
                    ['hello'],
                ),
            ).rejects.toThrow('timed out after 5ms');
            expect(fetchMock).toHaveBeenCalledTimes(3);
        } finally {
            global.fetch = originalFetch;
        }
    });

    it('honors caller cancellation without retrying', async () => {
        const originalFetch = global.fetch;
        const fetchMock = jest.fn(
            (_url: RequestInfo | URL, init?: RequestInit) =>
                new Promise<Response>((_resolve, reject) => {
                    init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true });
                }),
        );
        global.fetch = fetchMock as typeof fetch;
        const controller = new AbortController();
        try {
            const service = new KnowledgeEmbeddingService(providerConfig());
            const pending = service.embed(
                knowledgeAsset({ provider: 'remote', model: 'embed-v1', timeoutMs: 1_000 }),
                ['hello'],
                controller.signal,
            );
            controller.abort(new DOMException('cancelled', 'AbortError'));
            await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
            expect(fetchMock.mock.calls.length).toBeLessThanOrEqual(1);
        } finally {
            global.fetch = originalFetch;
        }
    });

    it('switches providers and validates each provider dimension independently', async () => {
        const originalFetch = global.fetch;
        const fetchMock = jest.fn(async (url: RequestInfo | URL) => {
            const dimensions = String(url).includes('provider-a') ? 2 : 3;
            return new Response(
                JSON.stringify({ data: [{ index: 0, embedding: Array.from({ length: dimensions }, (_, index) => index + 1) }] }),
                { status: 200 },
            );
        });
        global.fetch = fetchMock as typeof fetch;
        const config = {
            getSettings: jest.fn(async () => ({
                llm: {
                    providers: [
                        { name: 'provider-a', baseUrl: 'https://provider-a.example/v1', models: [{ id: 'embed-a', name: 'embed-a' }] },
                        { name: 'provider-b', baseUrl: 'https://provider-b.example/v1', models: [{ id: 'embed-b', name: 'embed-b' }] },
                    ],
                },
            })),
        } as unknown as ConfigService;
        try {
            const service = new KnowledgeEmbeddingService(config);
            const first = await service.embed(knowledgeAsset({ provider: 'provider-a', model: 'embed-a' }), ['one']);
            const second = await service.embed(knowledgeAsset({ provider: 'provider-b', model: 'embed-b' }), ['two']);

            expect(first).toMatchObject({ provider: 'provider-a', dimensions: 2, vectors: [[1, 2]] });
            expect(second).toMatchObject({ provider: 'provider-b', dimensions: 3, vectors: [[1, 2, 3]] });
            expect(fetchMock).toHaveBeenCalledTimes(2);
        } finally {
            global.fetch = originalFetch;
        }
    });
});

function providerConfig(apiKey = ''): ConfigService {
    return {
        getSettings: jest.fn(async () => ({
            llm: {
                providers: [
                    {
                        name: 'remote',
                        apiKey,
                        baseUrl: 'https://models.example.test/v1',
                        models: [{ id: 'embed-v1', name: 'embed-v1' }],
                    },
                ],
            },
        })),
    } as unknown as ConfigService;
}
