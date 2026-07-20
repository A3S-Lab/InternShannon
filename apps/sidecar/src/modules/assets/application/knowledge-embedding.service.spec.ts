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
});
