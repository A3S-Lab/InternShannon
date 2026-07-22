import { Inject, Injectable, Optional } from '@nestjs/common';
import { BadRequestException, NotFoundException } from '@/shared/common/errors';
import type { Asset } from '../domain/entities/asset.entity';
import { isReservedOkfPath, normalizeOkfPath, parseOkfDocument } from '../domain/knowledge/open-knowledge-format';
import {
    cosineSimilarity,
    hasLocalSemanticTokenOverlap,
    localEmbedding,
} from '../domain/knowledge/local-embedding';
import { ASSET_SERVICE, type IAssetService } from '../domain/services/asset.service.interface';
import { KnowledgeIngestionService } from './knowledge-ingestion.service';
import { KnowledgeEmbeddingService } from './knowledge-embedding.service';

export type KnowledgeScope = 'personal' | 'docs' | 'global';

export interface KnowledgeSearchHit {
    kind: 'concept' | 'source';
    assetId: string;
    bundle: string;
    conceptId: string;
    path: string;
    title: string;
    type: string | null;
    description?: string;
    resource?: string;
    tags: string[];
    snippet: string;
    score: number;
    semanticScore?: number;
    citations: string[];
    chunkIndex?: number;
}

export interface KnowledgeSearchResult {
    scope: KnowledgeScope | 'asset';
    assetId?: string;
    query: string;
    hits: KnowledgeSearchHit[];
    ranking?: 'hybrid-mmr-v1';
}

const LOCAL_SEMANTIC_MIN_SIMILARITY = 0.12;
const EXTERNAL_SEMANTIC_MIN_SIMILARITY = 0.3;

@Injectable()
export class KnowledgeQueryService {
    constructor(
        @Inject(ASSET_SERVICE) private readonly assets: IAssetService,
        private readonly ingestion: KnowledgeIngestionService,
        @Optional() private readonly embeddings?: KnowledgeEmbeddingService,
    ) {}

    async searchAsset(assetId: string, query: string, limit = 8): Promise<KnowledgeSearchResult> {
        const asset = await this.requireAsset(assetId);
        return {
            scope: 'asset',
            assetId: asset.id,
            query: this.requireQuery(query),
            hits: await this.searchAssets([asset], query, limit),
            ranking: 'hybrid-mmr-v1',
        };
    }

    async searchScope(
        scope: KnowledgeScope,
        userId: string,
        query: string,
        limit = 8,
    ): Promise<KnowledgeSearchResult> {
        const assets = await this.resolveScopeAssets(scope, userId);
        return {
            scope,
            assetId: assets.length === 1 ? assets[0].id : undefined,
            query: this.requireQuery(query),
            hits: await this.searchAssets(assets, query, limit),
            ranking: 'hybrid-mmr-v1',
        };
    }

    async evaluateAsset(
        assetId: string,
        cases: Array<{ query: string; expectedPaths: string[] }>,
        requestedK = 5,
    ) {
        const k = Math.max(1, Math.min(20, Number(requestedK) || 5));
        const startedAt = Date.now();
        const results = [];
        let reciprocalRankTotal = 0;
        let recalled = 0;
        let empty = 0;
        for (const testCase of cases.slice(0, 200)) {
            const search = await this.searchAsset(assetId, testCase.query, k);
            const expected = new Set(testCase.expectedPaths);
            const rank = search.hits.findIndex(hit => expected.has(hit.path)) + 1;
            if (rank > 0) {
                recalled += 1;
                reciprocalRankTotal += 1 / rank;
            }
            if (search.hits.length === 0) empty += 1;
            results.push({ query: testCase.query, expectedPaths: testCase.expectedPaths, rank: rank || null, hits: search.hits });
        }
        const count = results.length;
        return {
            assetId,
            k,
            caseCount: count,
            recallAtK: count ? recalled / count : 0,
            mrr: count ? reciprocalRankTotal / count : 0,
            emptyResultRate: count ? empty / count : 0,
            elapsedMs: Date.now() - startedAt,
            ranking: 'hybrid-mmr-v1' as const,
            results,
        };
    }

    async readConcept(assetId: string, pathOrConceptId: string) {
        const asset = await this.requireAsset(assetId);
        const path = this.normalizeConceptPath(pathOrConceptId);
        const content = await this.assets.getBlobContent(asset.id, `wiki/${path}`);
        const document = parseOkfDocument(path, content);
        const explicitCitations = this.extractCitations(document.body);
        const resource = this.stringValue(document.frontmatter.resource);
        return {
            assetId: asset.id,
            bundle: this.bundleName(asset),
            conceptId: path.replace(/\.md$/i, ''),
            path: `wiki/${path}`,
            reserved: document.reserved,
            frontmatter: document.frontmatter,
            body: document.body,
            content,
            citations: explicitCitations.length > 0
                ? explicitCitations
                : [resource || `asset://${asset.id}/wiki/${path}`],
        };
    }

    async readScopedConcept(
        scope: KnowledgeScope,
        userId: string,
        pathOrConceptId: string,
        assetId?: string,
    ) {
        const assets = await this.resolveScopeAssets(scope, userId);
        const asset = assetId ? assets.find(item => item.id === assetId) : assets[0];
        if (!asset) throw new NotFoundException('知识库不可用或无权访问');
        return this.readItem(asset.id, pathOrConceptId);
    }

    async readItem(assetId: string, pathOrConceptId: string) {
        if (pathOrConceptId.startsWith('source:') || pathOrConceptId.startsWith('raw/sources/')) {
            return this.readSource(assetId, pathOrConceptId);
        }
        return this.readConcept(assetId, pathOrConceptId);
    }

    async listScopedDirectory(
        scope: KnowledgeScope,
        userId: string,
        directory = '',
        assetId?: string,
    ) {
        const assets = await this.resolveScopeAssets(scope, userId);
        const asset = assetId ? assets.find(item => item.id === assetId) : assets[0];
        if (!asset) throw new NotFoundException('知识库不可用或无权访问');
        return this.listDirectory(asset.id, directory);
    }

    async listScopedTags(scope: KnowledgeScope, userId: string, assetId?: string) {
        const assets = await this.resolveScopeAssets(scope, userId);
        const asset = assetId ? assets.find(item => item.id === assetId) : assets[0];
        if (!asset) throw new NotFoundException('知识库不可用或无权访问');
        return this.listTags(asset.id);
    }

    async listDirectory(assetId: string, directory = '') {
        const asset = await this.requireAsset(assetId);
        const normalized = normalizeOkfPath(directory) ?? '';
        const prefix = normalized ? `${normalized.replace(/\/$/, '')}/` : '';
        const entries = new Map<string, { name: string; path: string; type: 'directory' | 'concept' }>();
        for (const path of this.wikiPaths(asset)) {
            const bundlePath = path.slice('wiki/'.length);
            if (!bundlePath.startsWith(prefix)) continue;
            const rest = bundlePath.slice(prefix.length);
            if (!rest) continue;
            const [name] = rest.split('/');
            if (!name) continue;
            const childPath = `${prefix}${name}`;
            entries.set(childPath, {
                name,
                path: rest.includes('/') ? `${childPath}/` : childPath,
                type: rest.includes('/') ? 'directory' : 'concept',
            });
        }
        return {
            assetId: asset.id,
            bundle: this.bundleName(asset),
            directory: prefix,
            entries: Array.from(entries.values()).sort((left, right) => {
                if (left.type !== right.type) return left.type === 'directory' ? -1 : 1;
                return left.name.localeCompare(right.name);
            }),
        };
    }

    async listTags(assetId: string) {
        const asset = await this.requireAsset(assetId);
        const counts = new Map<string, number>();
        for (const path of this.wikiPaths(asset)) {
            const content = await this.assets.getBlobContent(asset.id, path).catch(() => null);
            if (content === null) continue;
            const document = parseOkfDocument(path.slice('wiki/'.length), content);
            for (const tag of this.stringArray(document.frontmatter.tags)) {
                counts.set(tag, (counts.get(tag) ?? 0) + 1);
            }
        }
        return {
            tags: Array.from(counts, ([tag, count]) => ({ tag, count })).sort(
                (left, right) => right.count - left.count || left.tag.localeCompare(right.tag),
            ),
        };
    }

    async findSimilarConcepts(assetId: string, pathOrConceptId: string, requestedLimit = 8) {
        const asset = await this.requireAsset(assetId);
        const targetPath = `wiki/${this.normalizeConceptPath(pathOrConceptId)}`;
        const targetContent = await this.assets.getBlobContent(asset.id, targetPath);
        const targetDocument = parseOkfDocument(targetPath.slice('wiki/'.length), targetContent);
        const candidates: Array<{ path: string; title: string; type: string | null; text: string }> = [];
        for (const path of this.wikiPaths(asset)) {
            if (path === targetPath) continue;
            const content = await this.assets.getBlobContent(asset.id, path).catch(() => null);
            if (!content) continue;
            const document = parseOkfDocument(path.slice('wiki/'.length), content);
            const title = this.stringValue(document.frontmatter.title) || this.titleFromPath(path);
            candidates.push({
                path,
                title,
                type: this.stringValue(document.frontmatter.type) || null,
                text: `${title}\n${this.stringValue(document.frontmatter.description)}\n${document.body}`,
            });
        }
        const batch = await this.embedTexts(asset, [
            `${this.stringValue(targetDocument.frontmatter.title)}\n${targetDocument.body}`,
            ...candidates.map(candidate => candidate.text),
        ]);
        const targetEmbedding = batch.vectors[0];
        const hits: Array<{ path: string; title: string; type: string | null; similarity: number }> = [];
        for (const [index, candidate] of candidates.entries()) {
            const similarity = cosineSimilarity(targetEmbedding, batch.vectors[index + 1]);
            if (similarity < 0.08) continue;
            hits.push({
                path: candidate.path,
                title: candidate.title,
                type: candidate.type,
                similarity,
            });
        }
        return {
            path: targetPath,
            model: batch.model,
            provider: batch.provider,
            hits: hits
                .sort((left, right) => right.similarity - left.similarity || left.path.localeCompare(right.path))
                .slice(0, Math.max(1, Math.min(50, Number(requestedLimit) || 8))),
        };
    }

    private async searchAssets(assets: Asset[], query: string, requestedLimit: number): Promise<KnowledgeSearchHit[]> {
        const normalizedQuery = this.requireQuery(query);
        const limit = Math.max(1, Math.min(50, Number(requestedLimit) || 8));
        const terms = this.queryTerms(normalizedQuery);
        const hits: KnowledgeSearchHit[] = [];

        for (const asset of assets) {
            const weights = this.embeddings?.getAssetConfig(asset) ?? {
                keywordWeight: 1,
                vectorWeight: 6,
                mmrLambda: 0.78,
            };
            const concepts: Array<{
                path: string;
                bundlePath: string;
                title: string;
                type: string | null;
                description?: string;
                resource?: string;
                tags: string[];
                body: string;
                keywordScore: number;
                semanticText: string;
            }> = [];
            for (const path of this.wikiPaths(asset)) {
                const content = await this.assets.getBlobContent(asset.id, path).catch(() => null);
                if (content === null) continue;
                const bundlePath = path.slice('wiki/'.length);
                let document;
                try {
                    document = parseOkfDocument(bundlePath, content);
                } catch {
                    continue;
                }
                const frontmatter = document.frontmatter;
                const title = this.stringValue(frontmatter.title) || this.titleFromPath(bundlePath);
                const type = this.stringValue(frontmatter.type) || (isReservedOkfPath(bundlePath) ? 'Index' : null);
                const description = this.stringValue(frontmatter.description) || undefined;
                const resource = this.stringValue(frontmatter.resource) || undefined;
                const tags = this.stringArray(frontmatter.tags);
                const keywordScore = this.scoreDocument(
                    terms,
                    normalizedQuery,
                    title,
                    description ?? '',
                    tags,
                    bundlePath,
                    document.body,
                );
                concepts.push({
                    path,
                    bundlePath,
                    title,
                    type,
                    description,
                    resource,
                    tags,
                    body: document.body,
                    keywordScore,
                    semanticText: `${title}\n${description ?? ''}\n${document.body}`,
                });
            }
            const batch = await this.embedTexts(asset, [normalizedQuery, ...concepts.map(concept => concept.semanticText)]);
            const queryEmbedding = batch.vectors[0];
            for (const [index, concept] of concepts.entries()) {
                const semanticScore = cosineSimilarity(queryEmbedding, batch.vectors[index + 1]);
                const { path, bundlePath, title, type, description, resource, tags, body, keywordScore } = concept;
                if (
                    keywordScore <= 0 &&
                    !this.acceptSemanticOnlyHit(
                        normalizedQuery,
                        concept.semanticText,
                        semanticScore,
                        batch.provider,
                    )
                ) continue;
                const explicitCitations = this.extractCitations(body);
                hits.push({
                    kind: 'concept',
                    assetId: asset.id,
                    bundle: this.bundleName(asset),
                    conceptId: bundlePath.replace(/\.md$/i, ''),
                    path,
                    title,
                    type,
                    description,
                    resource,
                    tags,
                    snippet: this.snippet(body || description || title, terms),
                    score: keywordScore * weights.keywordWeight + semanticScore * weights.vectorWeight,
                    semanticScore,
                    citations: explicitCitations.length > 0
                        ? explicitCitations
                        : [resource || `asset://${asset.id}/${path}`],
                });
            }
            hits.push(
                ...(await this.searchSourceChunks(
                    asset,
                    terms,
                    normalizedQuery,
                    queryEmbedding,
                    weights.keywordWeight,
                    weights.vectorWeight,
                    batch.provider,
                )),
            );
        }
        const sorted = hits.sort((left, right) => right.score - left.score || left.path.localeCompare(right.path));
        const lambda = assets[0] && this.embeddings ? this.embeddings.getAssetConfig(assets[0]).mmrLambda : 0.78;
        return this.diversify(sorted, limit, lambda);
    }

    private async searchSourceChunks(
        asset: Asset,
        terms: string[],
        fullQuery: string,
        queryEmbedding: number[],
        keywordWeight: number,
        vectorWeight: number,
        embeddingProvider: string,
    ): Promise<KnowledgeSearchHit[]> {
        const manifest = await this.ingestion.getManifest(asset.id);
        const vectorIndex = await this.ingestion.readVectorIndex(asset.id, manifest);
        const vectors = new Map(vectorIndex?.records.map(record => [record.id, record.embedding]) ?? []);
        const hits: KnowledgeSearchHit[] = [];
        const sourceCandidateLimit = this.sourceCandidateLimit(fullQuery);
        for (const source of manifest.sources) {
            if (source.status !== 'indexed') continue;
            const title = this.titleFromSourcePath(source.path);
            const citation = `asset://${asset.id}/${source.path}`;
            const sourceHits: KnowledgeSearchHit[] = [];
            for (const chunk of await this.ingestion.readChunks(asset.id, source)) {
                const keywordScore = this.scoreDocument(terms, fullQuery, title, '', [], source.path, chunk.text);
                const semanticScore = cosineSimilarity(
                    queryEmbedding,
                    vectors.get(chunk.id) ?? localEmbedding(chunk.text),
                );
                if (
                    keywordScore <= 0 &&
                    !this.acceptSemanticOnlyHit(
                        fullQuery,
                        `${title}\n${source.path}\n${chunk.text}`,
                        semanticScore,
                        embeddingProvider,
                    )
                ) continue;
                sourceHits.push({
                    kind: 'source',
                    assetId: asset.id,
                    bundle: this.bundleName(asset),
                    conceptId: `source:${source.path}#${chunk.index}`,
                    path: source.path,
                    title,
                    type: 'Source',
                    resource: citation,
                    tags: [],
                    snippet: this.snippet(chunk.text, terms),
                    score: keywordScore * keywordWeight + semanticScore * vectorWeight,
                    semanticScore,
                    citations: [citation],
                    chunkIndex: chunk.index,
                });
                // An identifier can appear in every chunk of a generated log or
                // repeated export. Only a small per-source pool can contribute
                // to the final top eight, and bounding it before MMR prevents a
                // single source from monopolizing CPU under concurrent search.
                if (sourceHits.length >= sourceCandidateLimit * 2) {
                    this.retainTopHits(sourceHits, sourceCandidateLimit);
                }
            }
            this.retainTopHits(sourceHits, sourceCandidateLimit);
            hits.push(...sourceHits);
            if (hits.length >= 1_024) this.retainTopHits(hits, 512);
        }
        this.retainTopHits(hits, 512);
        return hits;
    }

    private retainTopHits(hits: KnowledgeSearchHit[], limit: number): void {
        if (hits.length <= limit) return;
        hits.sort((left, right) => right.score - left.score || left.path.localeCompare(right.path));
        hits.length = limit;
    }

    private sourceCandidateLimit(query: string): number {
        return this.isIdentifierQuery(query) ? 32 : 512;
    }

    private acceptSemanticOnlyHit(query: string, candidate: string, similarity: number, provider: string): boolean {
        // Identifiers are lexical keys, not natural-language concepts. Expanding
        // them semantically turns shared prefixes (for example incident IDs or
        // soak-test markers) into large false-positive candidate sets and makes
        // concurrent searches spend most of their time reranking unrelated
        // chunks. Exact/partial lexical matches have already received a positive
        // keyword score before this method is called.
        if (this.isIdentifierQuery(query)) return false;
        if (provider === 'local') {
            return similarity >= LOCAL_SEMANTIC_MIN_SIMILARITY && hasLocalSemanticTokenOverlap(query, candidate);
        }
        if (similarity < EXTERNAL_SEMANTIC_MIN_SIMILARITY) return false;
        return true;
    }

    private isIdentifierQuery(query: string): boolean {
        const compact = query.replace(/\s+/g, '');
        return compact.length >= 8 && /[a-z]/i.test(compact) && /\d/.test(compact);
    }

    private async readSource(assetId: string, sourceId: string) {
        const match = /^source:(raw\/sources\/[^#]+)(?:#(\d+))?$/.exec(sourceId);
        const sourcePath = match?.[1] || sourceId;
        const requestedChunk = match?.[2] === undefined ? undefined : Number(match[2]);
        if (!sourcePath.startsWith('raw/sources/')) throw new BadRequestException('source path is required');
        const asset = await this.requireAsset(assetId);
        const manifest = await this.ingestion.getManifest(asset.id);
        const source = manifest.sources.find(entry => entry.path === sourcePath && entry.status === 'indexed');
        if (!source) throw new NotFoundException('Knowledge source is not indexed');
        const chunks = await this.ingestion.readChunks(asset.id, source);
        const selected = requestedChunk === undefined ? chunks : chunks.filter(chunk => chunk.index === requestedChunk);
        if (selected.length === 0) throw new NotFoundException('Knowledge source chunk not found');
        const citation = `asset://${asset.id}/${source.path}`;
        return {
            kind: 'source' as const,
            assetId: asset.id,
            bundle: this.bundleName(asset),
            conceptId: requestedChunk === undefined ? `source:${source.path}` : `source:${source.path}#${requestedChunk}`,
            path: source.path,
            title: this.titleFromSourcePath(source.path),
            type: 'Source',
            mime: source.mime,
            sha: source.sha,
            content: selected.map(chunk => chunk.text).join('\n\n'),
            chunks: selected,
            resource: citation,
            citations: [citation],
        };
    }

    private async resolveScopeAssets(scope: KnowledgeScope, userId: string): Promise<Asset[]> {
        if (scope === 'personal') return [await this.assets.getOrCreatePersonalKnowledge(userId)];
        if (scope === 'docs') return [await this.assets.getOrCreateGlobalDocsKnowledge()];
        const assets = await this.assets.listGlobalKnowledge();
        return assets.filter(asset => {
            const knowledge = asset.metadata?.knowledge;
            return !knowledge || typeof knowledge !== 'object' || (knowledge as Record<string, unknown>).archived !== true;
        });
    }

    private async embedTexts(asset: Asset, texts: string[]) {
        if (this.embeddings) return this.embeddings.embed(asset, texts);
        return {
            provider: 'local',
            model: 'local-hash-v1',
            dimensions: localEmbedding('').length,
            vectors: texts.map(text => localEmbedding(text)),
        };
    }

    private diversify(hits: KnowledgeSearchHit[], limit: number, lambda: number): KnowledgeSearchHit[] {
        if (hits.length <= 1 || lambda >= 1) return hits.slice(0, limit);
        // MMR is a reranker, not the initial retriever. Running its pairwise
        // comparisons over every matching chunk makes broad queries scale
        // quadratically and can block all concurrent searches. The input is
        // already sorted by hybrid relevance, so rerank a bounded top pool.
        const candidateLimit = Math.max(limit, Math.min(512, limit * 32));
        const candidates = hits
            .slice(0, candidateLimit)
            .map(hit => ({ hit, embedding: localEmbedding(`${hit.title}\n${hit.snippet}`) }));
        const selected: typeof candidates = [];
        const maxScore = Math.max(...hits.map(hit => hit.score), 1);
        while (candidates.length > 0 && selected.length < limit) {
            let bestIndex = 0;
            let bestScore = Number.NEGATIVE_INFINITY;
            for (const [index, candidate] of candidates.entries()) {
                const relevance = candidate.hit.score / maxScore;
                const redundancy = selected.length
                    ? Math.max(...selected.map(item => cosineSimilarity(candidate.embedding, item.embedding)))
                    : 0;
                const score = lambda * relevance - (1 - lambda) * redundancy;
                if (score > bestScore) {
                    bestScore = score;
                    bestIndex = index;
                }
            }
            selected.push(candidates.splice(bestIndex, 1)[0]);
        }
        return selected.map(item => item.hit);
    }

    private async requireAsset(assetId: string): Promise<Asset> {
        const asset = await this.assets.getAsset(assetId);
        if (!asset || asset.category !== 'knowledge') throw new NotFoundException('Knowledge asset not found');
        return asset;
    }

    private wikiPaths(asset: Asset): string[] {
        const paths = new Set(
            asset.blobs
                .map(blob => blob.path)
                .filter(path => path.startsWith('wiki/') && path.toLowerCase().endsWith('.md')),
        );
        const contents = asset.metadata?.blobContents;
        if (contents && typeof contents === 'object' && !Array.isArray(contents)) {
            for (const path of Object.keys(contents)) {
                if (path.startsWith('wiki/') && path.toLowerCase().endsWith('.md')) paths.add(path);
            }
        }
        return Array.from(paths).sort();
    }

    private scoreDocument(
        terms: string[],
        fullQuery: string,
        title: string,
        description: string,
        tags: string[],
        path: string,
        body: string,
    ): number {
        const values = {
            title: title.toLowerCase(),
            description: description.toLowerCase(),
            tags: tags.join(' ').toLowerCase(),
            path: path.toLowerCase(),
            body: body.toLowerCase(),
        };
        let score = 0;
        for (const term of terms) {
            if (values.title.includes(term)) score += 8;
            if (values.description.includes(term)) score += 5;
            if (values.tags.includes(term)) score += 4;
            if (values.path.includes(term)) score += 2;
            if (values.body.includes(term)) score += 1;
        }
        const phrase = fullQuery.toLowerCase();
        if (values.title.includes(phrase)) score += 6;
        if (values.body.includes(phrase)) score += 3;
        return score;
    }

    private snippet(value: string, terms: string[]): string {
        const compact = value.replace(/\s+/g, ' ').trim();
        if (!compact) return '';
        const lower = compact.toLowerCase();
        const indexes = terms.map(term => lower.indexOf(term)).filter(index => index >= 0);
        const matchAt = indexes.length > 0 ? Math.min(...indexes) : 0;
        const start = Math.max(0, matchAt - 80);
        const end = Math.min(compact.length, start + 240);
        return `${start > 0 ? '...' : ''}${compact.slice(start, end)}${end < compact.length ? '...' : ''}`;
    }

    private extractCitations(body: string): string[] {
        const citations: string[] = [];
        const pattern = /\[[^\]\n]+\]\((https?:\/\/[^)\s]+)\)/g;
        let match: RegExpExecArray | null;
        while ((match = pattern.exec(body)) !== null) {
            if (match[1] && !citations.includes(match[1])) citations.push(match[1]);
        }
        return citations.slice(0, 20);
    }

    private normalizeConceptPath(value: string): string {
        const withoutWiki = value.replace(/^wiki\//i, '');
        const withExtension = withoutWiki.toLowerCase().endsWith('.md') ? withoutWiki : `${withoutWiki}.md`;
        const normalized = normalizeOkfPath(withExtension);
        if (!normalized) throw new BadRequestException('concept path is required');
        return normalized;
    }

    private queryTerms(query: string): string[] {
        const lower = query.toLowerCase();
        const terms = lower.split(/[\s,，。！？;；:：]+/).filter(Boolean);
        return Array.from(new Set([lower, ...terms])).slice(0, 16);
    }

    private requireQuery(query: string): string {
        const normalized = query?.trim();
        if (!normalized) throw new BadRequestException('query is required');
        return normalized;
    }

    private bundleName(asset: Asset): string {
        const knowledge = asset.metadata?.knowledge;
        if (knowledge && typeof knowledge === 'object') {
            const domain = this.stringValue((knowledge as Record<string, unknown>).globalDomain);
            if (domain) return domain;
        }
        return asset.name;
    }

    private titleFromPath(path: string): string {
        return (path.split('/').pop() || path).replace(/\.md$/i, '').replace(/[-_]+/g, ' ');
    }

    private titleFromSourcePath(path: string): string {
        return decodeURIComponent(path.split('/').pop() || path).replace(/[-_]+/g, ' ');
    }

    private stringValue(value: unknown): string {
        return typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '';
    }

    private stringArray(value: unknown): string[] {
        return Array.isArray(value) ? value.map(item => this.stringValue(item)).filter(Boolean) : [];
    }
}
