import { Inject, Injectable, Optional } from '@nestjs/common';
import { CONFIG_SERVICE, ConfigService } from '@/modules/config/domain/services/config-service.interface';
import type { Asset } from '../domain/entities/asset.entity';
import { LOCAL_EMBEDDING_DIMENSIONS, LOCAL_EMBEDDING_MODEL, localEmbedding } from '../domain/knowledge/local-embedding';

export interface KnowledgeEmbeddingConfig {
    provider: string;
    model: string;
    dimensions?: number;
    keywordWeight: number;
    vectorWeight: number;
    mmrLambda: number;
    timeoutMs: number;
}

export interface KnowledgeEmbeddingBatch {
    provider: string;
    model: string;
    dimensions: number;
    vectors: number[][];
}

export const MAX_KNOWLEDGE_EMBEDDING_DIMENSIONS = 4_096;
const REMOTE_EMBEDDING_BATCH_SIZE = 64;
export const MAX_KNOWLEDGE_EMBEDDING_BATCH_SCALARS = REMOTE_EMBEDDING_BATCH_SIZE * MAX_KNOWLEDGE_EMBEDDING_DIMENSIONS;

@Injectable()
export class KnowledgeEmbeddingService {
    constructor(@Optional() @Inject(CONFIG_SERVICE) private readonly config?: ConfigService) {}

    getAssetConfig(asset: Asset): KnowledgeEmbeddingConfig {
        const knowledge = this.record(asset.metadata?.knowledge);
        const embedding = this.record(knowledge.embedding);
        return {
            provider: this.stringValue(embedding.provider) || 'local',
            model: this.stringValue(embedding.model) || LOCAL_EMBEDDING_MODEL,
            dimensions: this.embeddingDimensions(embedding.dimensions),
            keywordWeight: this.boundedNumber(embedding.keywordWeight, 1, 0, 10),
            vectorWeight: this.boundedNumber(embedding.vectorWeight, 6, 0, 10),
            mmrLambda: this.boundedNumber(embedding.mmrLambda, 0.78, 0, 1),
            timeoutMs: this.boundedNumber(embedding.timeoutMs, 120_000, 1, 600_000),
        };
    }

    async embed(asset: Asset, texts: string[], signal?: AbortSignal): Promise<KnowledgeEmbeddingBatch> {
        const selected = this.getAssetConfig(asset);
        if (selected.provider === 'local' || selected.model === LOCAL_EMBEDDING_MODEL) {
            const vectors: number[][] = [];
            for (let offset = 0; offset < texts.length; offset += 32) {
                if (signal?.aborted) throw new DOMException('Embedding cancelled', 'AbortError');
                vectors.push(...texts.slice(offset, offset + 32).map((text) => localEmbedding(text)));
                await new Promise<void>((resolve) => setImmediate(resolve));
            }
            return {
                provider: 'local',
                model: LOCAL_EMBEDDING_MODEL,
                dimensions: LOCAL_EMBEDDING_DIMENSIONS,
                vectors,
            };
        }
        const settings = await this.config?.getSettings();
        const provider = settings?.llm.providers.find((item) => item.name === selected.provider);
        if (!provider) throw new Error(`Embedding provider is not configured: ${selected.provider}`);
        const model = provider.models.find((item) => item.id === selected.model || item.name === selected.model);
        const baseUrl = (model?.baseUrl || provider.baseUrl || '').replace(/\/+$/, '');
        const apiKey = model?.apiKey || provider.apiKey;
        if (!baseUrl) throw new Error(`Embedding provider has no baseUrl: ${selected.provider}`);

        const vectors: number[][] = [];
        let returnedDimensions: number | undefined;
        for (let offset = 0; offset < texts.length; offset += REMOTE_EMBEDDING_BATCH_SIZE) {
            const batch = texts.slice(offset, offset + REMOTE_EMBEDDING_BATCH_SIZE);
            const batchVectors = await this.requestBatch(
                `${baseUrl}/embeddings`,
                selected.model,
                batch,
                selected.dimensions,
                {
                    ...provider.headers,
                    ...model?.headers,
                    ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
                },
                signal,
                selected.timeoutMs,
            );
            const batchDimensions = batchVectors[0]?.length ?? 0;
            if (selected.dimensions !== undefined && batchDimensions !== selected.dimensions) {
                throw new Error(
                    `Embedding provider returned ${batchDimensions} dimensions; expected ${selected.dimensions}`,
                );
            }
            if (returnedDimensions !== undefined && batchDimensions !== returnedDimensions) {
                throw new Error('Embedding provider changed vector dimensions between batches');
            }
            returnedDimensions = batchDimensions;
            vectors.push(...batchVectors);
        }
        const dimensions = returnedDimensions ?? selected.dimensions ?? 0;
        if (
            vectors.length !== texts.length ||
            dimensions <= 0 ||
            vectors.some((vector) => vector.length !== dimensions)
        ) {
            throw new Error('Embedding provider returned an invalid vector batch');
        }
        return { provider: selected.provider, model: selected.model, dimensions, vectors };
    }

    private async requestBatch(
        url: string,
        model: string,
        input: string[],
        dimensions: number | undefined,
        headers: Record<string, string>,
        signal?: AbortSignal,
        timeoutMs = 120_000,
    ): Promise<number[][]> {
        let lastError: Error | undefined;
        for (let attempt = 0; attempt < 3; attempt += 1) {
            if (signal?.aborted) throw new DOMException('Embedding cancelled', 'AbortError');
            const timeoutController = new AbortController();
            const timeout = setTimeout(
                () => timeoutController.abort(new DOMException('Embedding request timed out', 'TimeoutError')),
                timeoutMs,
            );
            const requestSignal = signal
                ? AbortSignal.any([signal, timeoutController.signal])
                : timeoutController.signal;
            try {
                const response = await fetch(url, {
                    method: 'POST',
                    headers: { 'content-type': 'application/json', ...headers },
                    body: JSON.stringify({ model, input, ...(dimensions ? { dimensions } : {}) }),
                    signal: requestSignal,
                });
                if (!response.ok) {
                    // Do not copy provider response bodies into errors: some
                    // gateways echo request headers or credentials.
                    const error = new Error(`Embedding request failed (${response.status})`);
                    if (response.status !== 429 && response.status < 500) {
                        throw new NonRetryableEmbeddingError(error.message);
                    }
                    lastError = error;
                    continue;
                }
                const payload = (await response.json()) as { data?: Array<{ index?: number; embedding?: unknown }> };
                if (!Array.isArray(payload.data)) throw new Error('Embedding response is missing data');
                if (payload.data.length !== input.length) {
                    throw new NonRetryableEmbeddingError(
                        `Embedding provider returned ${payload.data.length} vectors; expected ${input.length}`,
                    );
                }
                let scalarCount = 0;
                let batchDimensions: number | undefined;
                return payload.data
                    .slice()
                    .sort((left, right) => (left.index ?? 0) - (right.index ?? 0))
                    .map((item) => {
                        if (
                            !Array.isArray(item.embedding) ||
                            item.embedding.length === 0 ||
                            item.embedding.length > MAX_KNOWLEDGE_EMBEDDING_DIMENSIONS ||
                            item.embedding.some((value) => typeof value !== 'number' || !Number.isFinite(value))
                        ) {
                            throw new NonRetryableEmbeddingError('Embedding response contains an invalid vector');
                        }
                        batchDimensions ??= item.embedding.length;
                        if (item.embedding.length !== batchDimensions) {
                            throw new NonRetryableEmbeddingError(
                                'Embedding response contains inconsistent vector dimensions',
                            );
                        }
                        scalarCount += item.embedding.length;
                        if (scalarCount > MAX_KNOWLEDGE_EMBEDDING_BATCH_SCALARS) {
                            throw new NonRetryableEmbeddingError(
                                `Embedding response exceeds ${MAX_KNOWLEDGE_EMBEDDING_BATCH_SCALARS} scalar values per batch`,
                            );
                        }
                        return item.embedding as number[];
                    });
            } catch (error) {
                if (signal?.aborted) throw error;
                if (error instanceof NonRetryableEmbeddingError) throw error;
                lastError = timeoutController.signal.aborted
                    ? new Error(`Embedding request timed out after ${timeoutMs}ms`)
                    : error instanceof Error
                      ? error
                      : new Error(String(error));
            } finally {
                clearTimeout(timeout);
            }
        }
        throw lastError ?? new Error('Embedding request failed');
    }

    private record(value: unknown): Record<string, unknown> {
        return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
    }

    private stringValue(value: unknown): string {
        return typeof value === 'string' ? value.trim() : '';
    }

    private embeddingDimensions(value: unknown): number | undefined {
        if (value === undefined || value === null) return undefined;
        if (
            typeof value !== 'number' ||
            !Number.isInteger(value) ||
            value <= 0 ||
            value > MAX_KNOWLEDGE_EMBEDDING_DIMENSIONS
        ) {
            throw new Error(
                `Embedding dimensions must be an integer between 1 and ${MAX_KNOWLEDGE_EMBEDDING_DIMENSIONS}`,
            );
        }
        return value;
    }

    private boundedNumber(value: unknown, fallback: number, min: number, max: number): number {
        return typeof value === 'number' && Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback;
    }
}

class NonRetryableEmbeddingError extends Error {}
