import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import {
    chmodSync,
    closeSync,
    existsSync,
    fsyncSync,
    linkSync,
    mkdirSync,
    openSync,
    readFileSync,
    rmSync,
    writeSync,
} from "node:fs";
import { Inject, Injectable, Optional } from "@nestjs/common";

import path = require("node:path");
import XLSX = require("xlsx");

import type { KnowledgeReadFilter } from "@/modules/kernel/domain/services/knowledge-query.port";
import { BadRequestException, NotFoundException } from "@/shared/common/errors";
import { desktopDataDir } from "@/shared/infrastructure/desktop/desktop-paths";
import type { Asset } from "../domain/entities/asset.entity";
import { knowledgeSearchTokens } from "../domain/knowledge/knowledge-search-tokenizer";
import { isInternalKnowledgePath, isPublicKnowledgeSourcePath } from "../domain/knowledge/knowledge-source-path.policy";
import { cosineSimilarity, hasLocalSemanticTokenOverlap, localEmbedding } from "../domain/knowledge/local-embedding";
import { isReservedOkfPath, normalizeOkfPath, parseOkfDocument } from "../domain/knowledge/open-knowledge-format";
import { ASSET_SERVICE, type IAssetService } from "../domain/services/asset.service.interface";
import { KnowledgeEmbeddingService } from "./knowledge-embedding.service";
import {
    type KnowledgeIndexSnapshot,
    KnowledgeIngestionService,
    type KnowledgeSourceChunk,
    type KnowledgeSourceManifest,
    type KnowledgeSourceManifestEntry,
} from "./knowledge-ingestion.service";
import {
    type KnowledgeStructuredQueryInput,
    KnowledgeStructuredQueryService,
} from "./knowledge-structured-query.service";
import {
    buildKnowledgeTableCatalog,
    type KnowledgeTableCatalogEntry,
    type KnowledgeTableRelation,
    parseKnowledgeGroundingSchema,
} from "./knowledge-table-catalog";

export type KnowledgeScope = "personal" | "docs" | "global";

export interface KnowledgeSearchHit {
    kind: "concept" | "source";
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
    sourceSha?: string;
}

export interface KnowledgeSearchResult {
    scope: KnowledgeScope | "asset";
    assetId?: string;
    query: string;
    hits: KnowledgeSearchHit[];
    searchCandidateCount: number;
    searchTruncated: boolean;
    searchOffset: number;
    nextSearchCursor?: string;
    ranking?: "hybrid-mmr-v1";
    tableSummaries?: KnowledgeTableSummary[];
    catalogCandidateCount?: number;
    catalogTruncated?: boolean;
    catalogOmittedCount?: number;
    catalogOffset?: number;
    nextCatalogCursor?: string;
    catalogUnretrievableCount?: number;
    indexSnapshot: KnowledgeIndexSnapshot | KnowledgeIndexSnapshot[];
}

export interface KnowledgeTableSummary {
    assetId?: string;
    path: string;
    title: string;
    mime: string;
    columns: string[];
    primaryKey: string | null;
    recordCount: number;
    recordIds: string[];
    recordIdsTruncated: boolean;
    resource: string;
    aliases?: string[];
    relations?: KnowledgeTableRelation[];
}

interface PinnedKnowledgeAsset {
    asset: Asset;
    manifest: KnowledgeSourceManifest;
    snapshot: KnowledgeIndexSnapshot;
}

interface KnowledgeSearchSelection {
    hits: KnowledgeSearchHit[];
    candidateCount: number;
    resourceTruncatedCount: number;
    incompleteReasons: string[];
}

interface KnowledgeTableCatalogResult {
    summaries: KnowledgeTableSummary[];
    candidateCount: number;
    omittedCount: number;
    offset: number;
    nextOffset?: number;
    unretrievableCount: number;
    truncated: boolean;
}

export interface KnowledgeSearchPageOptions {
    searchCursor?: string;
    catalogCursor?: string;
}

interface KnowledgePageCursorPayload {
    version: 1;
    kind: "search" | "catalog";
    scope: KnowledgeScope | "asset";
    query: string;
    assetIds: string[];
    revisions: Array<{ assetId: string; revision: string }>;
    rankingFingerprint?: string;
    offset: number;
    limit?: number;
}

interface BoundedWikiSelection {
    paths: string[];
    selectedCharacters: number;
    omittedCount: number;
    oversizedCount: number;
    totalLimitCount: number;
    incompleteReasons: Set<string>;
}

interface WikiPathCandidate {
    path: string;
    knownSize?: number;
}

const LOCAL_SEMANTIC_MIN_SIMILARITY = 0.12;
const EXTERNAL_SEMANTIC_MIN_SIMILARITY = 0.3;
const MAX_TABLE_CATALOG_SOURCES = 32;
const MAX_TABLE_SUMMARY_BYTES = 2 * 1024 * 1024;
const MAX_TABLE_RECORD_IDS = 200;
const TABLE_CATALOG_CACHE_TTL_MS = 60_000;
const MAX_WIKI_SEARCH_DOCUMENTS = 2_000;
const MAX_WIKI_DOCUMENT_CHARACTERS = 2 * 1024 * 1024;
const MAX_WIKI_TOTAL_CHARACTERS = 32 * 1024 * 1024;
const MAX_GLOBAL_KNOWLEDGE_SEARCH_ASSETS = 16;
const DEFAULT_MMR_LAMBDA = 0.78;
const CURSOR_SECRET_BYTES = 32;
const CURSOR_SECRET_FILENAME = "knowledge-cursor-signing-key";

@Injectable()
export class KnowledgeQueryService {
    private readonly cursorSecret = this.loadCursorSecret();
    private readonly tableCatalogCache = new Map<
        string,
        { expiresAt: number; value: Promise<KnowledgeTableCatalogResult> }
    >();

    constructor(
        @Inject(ASSET_SERVICE) private readonly assets: IAssetService,
        private readonly ingestion: KnowledgeIngestionService,
        @Optional() private readonly embeddings?: KnowledgeEmbeddingService,
        @Optional() private readonly structuredQueries?: KnowledgeStructuredQueryService,
    ) {}

    async queryStructuredScope(scope: KnowledgeScope, userId: string, input: KnowledgeStructuredQueryInput) {
        if (!this.structuredQueries) throw new BadRequestException("结构化知识查询服务不可用");
        return this.structuredQueries.queryScope(scope, userId, input);
    }

    async searchAsset(
        assetId: string,
        query: string,
        limit = 8,
        includeTableCatalog = false,
        options: KnowledgeSearchPageOptions = {},
    ): Promise<KnowledgeSearchResult> {
        const asset = await this.requireAsset(assetId);
        const normalizedQuery = this.requireQuery(query);
        return this.searchConsistent("asset", [asset.id], normalizedQuery, limit, includeTableCatalog, options);
    }

    async searchScope(
        scope: KnowledgeScope,
        userId: string,
        query: string,
        limit = 8,
        includeTableCatalog = false,
        options: KnowledgeSearchPageOptions = {},
    ): Promise<KnowledgeSearchResult> {
        const assets = await this.resolveScopeAssets(scope, userId);
        const normalizedQuery = this.requireQuery(query);
        return this.searchConsistent(
            scope,
            assets.map((asset) => asset.id),
            normalizedQuery,
            limit,
            includeTableCatalog,
            options,
        );
    }

    private async searchConsistent(
        scope: KnowledgeScope | "asset",
        assetIds: string[],
        query: string,
        limit: number,
        includeTableCatalog: boolean,
        options: KnowledgeSearchPageOptions,
    ): Promise<KnowledgeSearchResult> {
        for (let attempt = 0; attempt < 2; attempt += 1) {
            // Refresh the asset objects on every attempt. A manifest is then pinned
            // for the whole retrieval pass so chunks and vectors cannot come from
            // different atomically-published index generations.
            const assets: Asset[] = [];
            const pinned: PinnedKnowledgeAsset[] = [];
            // A global search already has an explicit asset-count ceiling. Pin
            // those assets sequentially as well so the per-asset 32 MiB wiki
            // snapshot budget cannot become a 16-way peak allocation.
            for (const assetId of assetIds) {
                const asset = await this.requireAsset(assetId);
                assets.push(asset);
                const manifest = await this.ingestion.getManifest(asset.id);
                const snapshot = await this.ingestion.getIndexSnapshot(asset.id, manifest);
                pinned.push({ asset, manifest, snapshot });
            }
            pinned.sort((left, right) => left.asset.id.localeCompare(right.asset.id));
            const normalizedLimit = Math.max(1, Math.min(50, Number(limit) || 8));
            const rankingFingerprint = this.rankingFingerprint(pinned);
            const searchOffset = options.searchCursor
                ? this.assertPageCursor(
                      options.searchCursor,
                      "search",
                      scope,
                      query,
                      pinned,
                      normalizedLimit,
                      rankingFingerprint,
                  ).offset
                : 0;
            const includeCatalog =
                includeTableCatalog || Boolean(options.catalogCursor) || this.isTableInventoryQuery(query);
            const catalogOffset = options.catalogCursor
                ? this.assertPageCursor(options.catalogCursor, "catalog", scope, query, pinned).offset
                : 0;
            const selection = await this.searchAssets(pinned, query, normalizedLimit, searchOffset);
            const tableCatalog = includeCatalog ? await this.tableSummaries(pinned, catalogOffset) : undefined;
            const endingSnapshots: Array<{ assetId: string; snapshot: KnowledgeIndexSnapshot }> = [];
            for (const asset of assets) {
                endingSnapshots.push({ assetId: asset.id, snapshot: await this.ingestion.getIndexSnapshot(asset.id) });
            }
            const endingByAsset = new Map(endingSnapshots.map((item) => [item.assetId, item.snapshot] as const));
            const stable = pinned.every(
                ({ asset, snapshot }) => endingByAsset.get(asset.id)?.revision === snapshot.revision,
            );
            if (!stable) continue;

            const snapshots = pinned.map(({ asset, snapshot }) => ({
                asset,
                snapshot: this.withSearchIncompleteReasons(snapshot, selection.incompleteReasons),
            }));
            const effectiveCandidateCount = selection.candidateCount + selection.resourceTruncatedCount;
            return {
                scope,
                assetId: assets.length === 1 ? assets[0].id : undefined,
                query,
                hits: selection.hits,
                searchCandidateCount: effectiveCandidateCount,
                searchTruncated: searchOffset + selection.hits.length < effectiveCandidateCount,
                searchOffset,
                ...(searchOffset + selection.hits.length < selection.candidateCount
                    ? {
                          nextSearchCursor: this.encodePageCursor(
                              this.pageCursorPayload(
                                  "search",
                                  scope,
                                  query,
                                  pinned,
                                  searchOffset + selection.hits.length,
                                  normalizedLimit,
                                  rankingFingerprint,
                              ),
                          ),
                      }
                    : {}),
                indexSnapshot:
                    snapshots.length === 1
                        ? snapshots[0].snapshot
                        : snapshots.map(({ asset, snapshot }) => ({ assetId: asset.id, ...snapshot })),
                ranking: "hybrid-mmr-v1",
                ...(tableCatalog
                    ? {
                          tableSummaries: tableCatalog.summaries,
                          catalogCandidateCount: tableCatalog.candidateCount,
                          catalogTruncated: tableCatalog.truncated,
                          catalogOmittedCount: tableCatalog.omittedCount,
                          catalogOffset: tableCatalog.offset,
                          catalogUnretrievableCount: tableCatalog.unretrievableCount,
                          ...(tableCatalog.nextOffset !== undefined
                              ? {
                                    nextCatalogCursor: this.encodePageCursor(
                                        this.pageCursorPayload(
                                            "catalog",
                                            scope,
                                            query,
                                            pinned,
                                            tableCatalog.nextOffset,
                                        ),
                                    ),
                                }
                              : {}),
                      }
                    : {}),
            };
        }
        throw new BadRequestException("知识库索引在检索期间持续变化，请重试");
    }

    async evaluateAsset(assetId: string, cases: Array<{ query: string; expectedPaths: string[] }>, requestedK = 5) {
        const k = Math.max(1, Math.min(20, Number(requestedK) || 5));
        const startedAt = Date.now();
        const results = [];
        let reciprocalRankTotal = 0;
        let recalled = 0;
        let empty = 0;
        for (const testCase of cases.slice(0, 200)) {
            const search = await this.searchAsset(assetId, testCase.query, k);
            const expected = new Set(testCase.expectedPaths);
            const rank = search.hits.findIndex((hit) => expected.has(hit.path)) + 1;
            if (rank > 0) {
                recalled += 1;
                reciprocalRankTotal += 1 / rank;
            }
            if (search.hits.length === 0) empty += 1;
            results.push({
                query: testCase.query,
                expectedPaths: testCase.expectedPaths,
                rank: rank || null,
                hits: search.hits,
            });
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
            ranking: "hybrid-mmr-v1" as const,
            results,
        };
    }

    async readConcept(assetId: string, pathOrConceptId: string, expectedRevision?: string) {
        const asset = await this.requireAsset(assetId);
        const path = this.normalizeConceptPath(pathOrConceptId);
        if (isInternalKnowledgePath(path)) throw new NotFoundException("Knowledge concept not found");
        const snapshot = await this.ingestion.getIndexSnapshot(asset.id);
        this.assertExpectedRevision(expectedRevision, snapshot);
        const content = await this.assets.getBlobContent(asset.id, `wiki/${path}`);
        const endingSnapshot = await this.ingestion.getIndexSnapshot(asset.id);
        this.assertExpectedRevision(snapshot.revision, endingSnapshot);
        const document = parseOkfDocument(path, content);
        const explicitCitations = this.extractCitations(document.body);
        const resource = this.stringValue(document.frontmatter.resource);
        return {
            assetId: asset.id,
            bundle: this.bundleName(asset),
            conceptId: path.replace(/\.md$/i, ""),
            path: `wiki/${path}`,
            reserved: document.reserved,
            frontmatter: document.frontmatter,
            body: document.body,
            content,
            indexSnapshot: endingSnapshot,
            citations:
                explicitCitations.length > 0 ? explicitCitations : [resource || `asset://${asset.id}/wiki/${path}`],
        };
    }

    async readScopedConcept(
        scope: KnowledgeScope,
        userId: string,
        pathOrConceptId: string,
        assetId?: string,
        identifiers?: string[],
        expectedRevision?: string,
        filters?: KnowledgeReadFilter[],
    ) {
        const assets = await this.resolveScopeAssets(scope, userId);
        const asset = assetId ? assets.find((item) => item.id === assetId) : assets[0];
        if (!asset) throw new NotFoundException("知识库不可用或无权访问");
        return this.readItem(asset.id, pathOrConceptId, identifiers, expectedRevision, filters);
    }

    async readItem(
        assetId: string,
        pathOrConceptId: string,
        identifiers?: string[],
        expectedRevision?: string,
        filters?: KnowledgeReadFilter[],
    ) {
        if (pathOrConceptId.startsWith("source:") || pathOrConceptId.startsWith("raw/sources/")) {
            return this.readSource(assetId, pathOrConceptId, identifiers, expectedRevision, filters);
        }
        return this.readConcept(assetId, pathOrConceptId, expectedRevision);
    }

    async listScopedDirectory(scope: KnowledgeScope, userId: string, directory = "", assetId?: string) {
        const assets = await this.resolveScopeAssets(scope, userId);
        const asset = assetId ? assets.find((item) => item.id === assetId) : assets[0];
        if (!asset) throw new NotFoundException("知识库不可用或无权访问");
        return this.listDirectory(asset.id, directory);
    }

    async listScopedTags(scope: KnowledgeScope, userId: string, assetId?: string) {
        const assets = await this.resolveScopeAssets(scope, userId);
        const asset = assetId ? assets.find((item) => item.id === assetId) : assets[0];
        if (!asset) throw new NotFoundException("知识库不可用或无权访问");
        return this.listTags(asset.id);
    }

    async listDirectory(assetId: string, directory = "") {
        const asset = await this.requireAsset(assetId);
        const normalized = normalizeOkfPath(directory) ?? "";
        const prefix = normalized ? `${normalized.replace(/\/$/, "")}/` : "";
        const entries = new Map<string, { name: string; path: string; type: "directory" | "concept" }>();
        for (const path of this.wikiPaths(asset)) {
            const bundlePath = path.slice("wiki/".length);
            if (!bundlePath.startsWith(prefix)) continue;
            const rest = bundlePath.slice(prefix.length);
            if (!rest) continue;
            const [name] = rest.split("/");
            if (!name) continue;
            const childPath = `${prefix}${name}`;
            entries.set(childPath, {
                name,
                path: rest.includes("/") ? `${childPath}/` : childPath,
                type: rest.includes("/") ? "directory" : "concept",
            });
        }
        return {
            assetId: asset.id,
            bundle: this.bundleName(asset),
            directory: prefix,
            entries: Array.from(entries.values()).sort((left, right) => {
                if (left.type !== right.type) return left.type === "directory" ? -1 : 1;
                return left.name.localeCompare(right.name);
            }),
        };
    }

    async listTags(assetId: string) {
        const asset = await this.requireAsset(assetId);
        const counts = new Map<string, number>();
        const bounded = this.boundedWikiPaths(asset);
        for (const path of bounded.paths) {
            const content = await this.assets.getBlobContent(asset.id, path).catch(() => null);
            if (content === null) continue;
            if (!this.acceptWikiContent(content, bounded)) continue;
            const document = parseOkfDocument(path.slice("wiki/".length), content);
            for (const tag of this.stringArray(document.frontmatter.tags)) {
                counts.set(tag, (counts.get(tag) ?? 0) + 1);
            }
        }
        return {
            tags: Array.from(counts, ([tag, count]) => ({ tag, count })).sort(
                (left, right) => right.count - left.count || left.tag.localeCompare(right.tag),
            ),
            truncated: bounded.omittedCount > 0,
            omittedCount: bounded.omittedCount,
            incompleteReasons: Array.from(bounded.incompleteReasons).sort(),
        };
    }

    async findSimilarConcepts(assetId: string, pathOrConceptId: string, requestedLimit = 8) {
        const asset = await this.requireAsset(assetId);
        const targetPath = `wiki/${this.normalizeConceptPath(pathOrConceptId)}`;
        const targetContent = await this.assets.getBlobContent(asset.id, targetPath);
        if (
            targetContent.length > MAX_WIKI_DOCUMENT_CHARACTERS ||
            Buffer.byteLength(targetContent, "utf8") > MAX_WIKI_DOCUMENT_CHARACTERS
        ) {
            throw new BadRequestException("目标知识页超过单页处理上限");
        }
        const targetDocument = parseOkfDocument(targetPath.slice("wiki/".length), targetContent);
        const candidates: Array<{ path: string; title: string; type: string | null; text: string }> = [];
        const bounded = this.boundedWikiPaths(asset);
        bounded.selectedCharacters = Math.max(targetContent.length, Buffer.byteLength(targetContent, "utf8"));
        for (const path of bounded.paths) {
            if (path === targetPath) continue;
            const content = await this.assets.getBlobContent(asset.id, path).catch(() => null);
            if (!content) continue;
            if (!this.acceptWikiContent(content, bounded)) continue;
            const document = parseOkfDocument(path.slice("wiki/".length), content);
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
            ...candidates.map((candidate) => candidate.text),
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
            truncated: bounded.omittedCount > 0,
            omittedCount: bounded.omittedCount,
            incompleteReasons: Array.from(bounded.incompleteReasons).sort(),
        };
    }

    private async searchAssets(
        pinnedAssets: PinnedKnowledgeAsset[],
        query: string,
        requestedLimit: number,
        offset = 0,
    ): Promise<KnowledgeSearchSelection> {
        const normalizedQuery = this.requireQuery(query);
        const limit = Math.max(1, Math.min(50, Number(requestedLimit) || 8));
        const terms = this.queryTerms(normalizedQuery);
        const hits: KnowledgeSearchHit[] = [];
        let resourceTruncatedCount = 0;
        const incompleteReasons = new Set<string>();

        for (const { asset, manifest } of pinnedAssets) {
            const weights = this.embeddings?.getAssetConfig(asset) ?? {
                keywordWeight: 1,
                vectorWeight: 6,
                mmrLambda: DEFAULT_MMR_LAMBDA,
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
            const wikiPaths = this.wikiPathCandidates(asset);
            const boundedWikiPaths = wikiPaths.slice(0, MAX_WIKI_SEARCH_DOCUMENTS);
            const documentOverflow = wikiPaths.length - boundedWikiPaths.length;
            if (documentOverflow > 0) {
                resourceTruncatedCount += documentOverflow;
                incompleteReasons.add(
                    `knowledge_wiki_document_limit_exceeded:${wikiPaths.length}/${MAX_WIKI_SEARCH_DOCUMENTS}`,
                );
            }
            let selectedWikiCharacters = 0;
            let oversizedWikiCount = 0;
            let totalCharacterOmissions = 0;
            for (const { path, knownSize } of boundedWikiPaths) {
                if (knownSize !== undefined && knownSize > MAX_WIKI_DOCUMENT_CHARACTERS) {
                    oversizedWikiCount += 1;
                    resourceTruncatedCount += 1;
                    continue;
                }
                const content = await this.assets.getBlobContent(asset.id, path).catch(() => null);
                if (content === null) continue;
                const contentBytes = Buffer.byteLength(content, "utf8");
                if (content.length > MAX_WIKI_DOCUMENT_CHARACTERS || contentBytes > MAX_WIKI_DOCUMENT_CHARACTERS) {
                    oversizedWikiCount += 1;
                    resourceTruncatedCount += 1;
                    continue;
                }
                const resourceSize = Math.max(content.length, contentBytes);
                if (selectedWikiCharacters + resourceSize > MAX_WIKI_TOTAL_CHARACTERS) {
                    totalCharacterOmissions += 1;
                    resourceTruncatedCount += 1;
                    continue;
                }
                selectedWikiCharacters += resourceSize;
                const bundlePath = path.slice("wiki/".length);
                let document;
                try {
                    document = parseOkfDocument(bundlePath, content);
                } catch {
                    continue;
                }
                const frontmatter = document.frontmatter;
                const title = this.stringValue(frontmatter.title) || this.titleFromPath(bundlePath);
                const type = this.stringValue(frontmatter.type) || (isReservedOkfPath(bundlePath) ? "Index" : null);
                const description = this.stringValue(frontmatter.description) || undefined;
                const resource = this.stringValue(frontmatter.resource) || undefined;
                const tags = this.stringArray(frontmatter.tags);
                const keywordScore = this.scoreDocument(
                    terms,
                    normalizedQuery,
                    title,
                    description ?? "",
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
                    semanticText: `${title}\n${description ?? ""}\n${document.body}`,
                });
            }
            if (oversizedWikiCount > 0) {
                incompleteReasons.add(
                    `knowledge_wiki_document_size_limit_exceeded:${oversizedWikiCount}/${MAX_WIKI_DOCUMENT_CHARACTERS}`,
                );
            }
            if (totalCharacterOmissions > 0) {
                incompleteReasons.add(
                    `knowledge_wiki_total_character_limit_exceeded:${selectedWikiCharacters}/${MAX_WIKI_TOTAL_CHARACTERS}`,
                );
            }
            const batch = await this.embedTexts(asset, [
                normalizedQuery,
                ...concepts.map((concept) => concept.semanticText),
            ]);
            const queryEmbedding = batch.vectors[0];
            for (const [index, concept] of concepts.entries()) {
                const semanticScore = cosineSimilarity(queryEmbedding, batch.vectors[index + 1]);
                const { path, bundlePath, title, type, description, resource, tags, body, keywordScore } = concept;
                if (
                    keywordScore <= 0 &&
                    !this.acceptSemanticOnlyHit(normalizedQuery, concept.semanticText, semanticScore, batch.provider)
                )
                    continue;
                const explicitCitations = this.extractCitations(body);
                hits.push({
                    kind: "concept",
                    assetId: asset.id,
                    bundle: this.bundleName(asset),
                    conceptId: bundlePath.replace(/\.md$/i, ""),
                    path,
                    title,
                    type,
                    description,
                    resource,
                    tags,
                    snippet: this.snippet(body || description || title, terms),
                    score: keywordScore * weights.keywordWeight + semanticScore * weights.vectorWeight,
                    semanticScore,
                    citations:
                        explicitCitations.length > 0 ? explicitCitations : [resource || `asset://${asset.id}/${path}`],
                });
            }
            hits.push(
                ...(await this.searchSourceChunks(
                    asset,
                    manifest,
                    terms,
                    normalizedQuery,
                    queryEmbedding,
                    weights.keywordWeight,
                    weights.vectorWeight,
                    batch.provider,
                )),
            );
        }
        const sorted = hits.sort((left, right) => this.compareSearchHits(left, right));
        const candidateCount = sorted.length;
        const lambda = this.mmrLambda(pinnedAssets);
        // hybrid-mmr-v1 defines one deterministic global ranking for the pinned
        // snapshot. Page boundaries are applied only after MMR, otherwise page
        // size changes the ranking and duplicate near-neighbours crowd out
        // diverse candidates on page 1.
        const globallyRanked = this.diversify(sorted, sorted.length, lambda);
        if (offset < 0 || offset > globallyRanked.length) throw new BadRequestException("知识库检索分页游标越界");
        const page = globallyRanked.slice(offset, offset + limit);
        return {
            hits: page,
            candidateCount,
            resourceTruncatedCount,
            incompleteReasons: Array.from(incompleteReasons).sort(),
        };
    }

    private async searchSourceChunks(
        asset: Asset,
        manifest: KnowledgeSourceManifest,
        terms: string[],
        fullQuery: string,
        queryEmbedding: number[],
        keywordWeight: number,
        vectorWeight: number,
        embeddingProvider: string,
    ): Promise<KnowledgeSearchHit[]> {
        const vectorIndex = await this.ingestion.readVectorIndex(asset.id, manifest);
        const vectors = new Map(vectorIndex?.records.map((record) => [record.id, record.embedding]) ?? []);
        const hits: KnowledgeSearchHit[] = [];
        for (const source of manifest.sources) {
            if (source.status !== "indexed" || !isPublicKnowledgeSourcePath(source.path)) continue;
            const title = this.titleFromSourcePath(source.path);
            const citation = `asset://${asset.id}/${source.path}`;
            const sourceHits: KnowledgeSearchHit[] = [];
            for (const chunk of await this.ingestion.readChunks(asset.id, source)) {
                const keywordScore = this.scoreDocument(terms, fullQuery, title, "", [], source.path, chunk.text);
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
                )
                    continue;
                sourceHits.push({
                    kind: "source",
                    assetId: asset.id,
                    bundle: this.bundleName(asset),
                    conceptId: `source:${source.path}#${chunk.index}`,
                    path: source.path,
                    title,
                    type: "Source",
                    resource: citation,
                    tags: [],
                    snippet: this.snippet(chunk.text, terms),
                    score: keywordScore * keywordWeight + semanticScore * vectorWeight,
                    semanticScore,
                    citations: [citation],
                    chunkIndex: chunk.index,
                    sourceSha: source.sha,
                });
            }
            hits.push(...sourceHits);
        }
        return hits;
    }

    private acceptSemanticOnlyHit(query: string, candidate: string, similarity: number, provider: string): boolean {
        // Identifiers are lexical keys, not natural-language concepts. Expanding
        // them semantically turns shared prefixes (for example incident IDs or
        // soak-test markers) into large false-positive candidate sets and makes
        // concurrent searches spend most of their time reranking unrelated
        // chunks. Exact/partial lexical matches have already received a positive
        // keyword score before this method is called.
        if (this.isIdentifierQuery(query)) return false;
        if (provider === "local") {
            return similarity >= LOCAL_SEMANTIC_MIN_SIMILARITY && hasLocalSemanticTokenOverlap(query, candidate);
        }
        if (similarity < EXTERNAL_SEMANTIC_MIN_SIMILARITY) return false;
        return true;
    }

    private isIdentifierQuery(query: string): boolean {
        const compact = query.replace(/\s+/g, "");
        return compact.length >= 8 && /[a-z]/i.test(compact) && /\d/.test(compact);
    }

    private async readSource(
        assetId: string,
        sourceId: string,
        identifiers?: string[],
        expectedRevision?: string,
        filters?: KnowledgeReadFilter[],
    ) {
        const match = /^source:(raw\/sources\/[^#]+)(?:#(\d+))?$/.exec(sourceId);
        const sourcePath = match?.[1] || sourceId;
        const requestedChunk = match?.[2] === undefined ? undefined : Number(match[2]);
        if (!isPublicKnowledgeSourcePath(sourcePath)) throw new BadRequestException("public source path is required");
        const asset = await this.requireAsset(assetId);
        const manifest = await this.ingestion.getManifest(asset.id);
        const snapshot = await this.ingestion.getIndexSnapshot(asset.id, manifest);
        this.assertExpectedRevision(expectedRevision, snapshot);
        const source = manifest.sources.find((entry) => entry.path === sourcePath && entry.status === "indexed");
        if (!source) throw new NotFoundException("Knowledge source is not indexed");
        const chunks = await this.ingestion.readChunks(asset.id, source);
        if (
            expectedRevision &&
            (chunks.length !== source.chunkCount ||
                chunks.some((chunk) => chunk.sourcePath !== source.path || chunk.contentSha !== source.sha))
        ) {
            throw new BadRequestException("固定索引版本的分块文件不完整，请重新建立索引");
        }
        const selected =
            requestedChunk === undefined ? chunks : chunks.filter((chunk) => chunk.index === requestedChunk);
        if (selected.length === 0) throw new NotFoundException("Knowledge source chunk not found");
        const sourceText = await this.sourceText(asset.id, source, Boolean(expectedRevision));
        const isCsv = source.path.toLowerCase().endsWith(".csv");
        const schemaMarkdown = isCsv ? await this.assets.getBlobContent(asset.id, "schema.md").catch(() => "") : "";
        const tableSummary = isCsv ? this.parseTableSummary(asset, source, sourceText, schemaMarkdown) : undefined;
        const identifierSelection = isCsv
            ? this.selectCsvIdentifierRows(sourceText, identifiers, tableSummary?.primaryKey, filters)
            : undefined;
        const content = identifierSelection
            ? identifierSelection.content
            : requestedChunk === undefined
              ? sourceText
              : this.lineAlignedChunk(sourceText, selected[0], isCsv);
        const currentSource = await this.assets.getBlobData(asset.id, source.path).catch(() => null);
        if (!currentSource || currentSource.contentSha !== source.sha) {
            throw new BadRequestException("知识库来源在读取期间已变化，请重新检索");
        }
        const endingSnapshot = await this.ingestion.getIndexSnapshot(asset.id);
        this.assertExpectedRevision(snapshot.revision, endingSnapshot);
        const citation = `asset://${asset.id}/${source.path}`;
        return {
            kind: "source" as const,
            assetId: asset.id,
            bundle: this.bundleName(asset),
            conceptId:
                requestedChunk === undefined ? `source:${source.path}` : `source:${source.path}#${requestedChunk}`,
            path: source.path,
            title: this.titleFromSourcePath(source.path),
            type: "Source",
            mime: source.mime,
            sha: source.sha,
            sourceSha: source.sha,
            indexSnapshot: endingSnapshot,
            content,
            chunks: selected,
            ...(identifierSelection
                ? {
                      requestedIdentifiers: identifierSelection.requestedIdentifiers,
                      matchedIdentifiers: identifierSelection.matchedIdentifiers,
                      missingIdentifiers: identifierSelection.missingIdentifiers,
                      matchedRecordIds: identifierSelection.matchedRecordIds,
                  }
                : {}),
            ...(tableSummary ? { tableSummary } : {}),
            resource: citation,
            citations: [citation],
        };
    }

    private selectCsvIdentifierRows(
        sourceText: string,
        identifiers: string[] | undefined,
        primaryKey: string | null | undefined,
        filters?: KnowledgeReadFilter[],
    ):
        | {
              content: string;
              requestedIdentifiers: string[];
              matchedIdentifiers: string[];
              missingIdentifiers: string[];
              matchedRecordIds: string[];
          }
        | undefined {
        const requestedIdentifiers = Array.from(
            new Set(
                (identifiers ?? [])
                    .map((value) => value.trim())
                    .filter((value) => value.length > 0 && value.length <= 160),
            ),
        ).slice(0, 64);
        const requestedFilters = (filters ?? []).slice(0, 16);
        if (requestedIdentifiers.length === 0 && requestedFilters.length === 0) return undefined;

        const workbook = XLSX.read(sourceText, { type: "string", raw: true });
        const sheetName = workbook.SheetNames[0];
        const sheet = sheetName ? workbook.Sheets[sheetName] : undefined;
        const rows = sheet ? XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: true, defval: "" }) : [];
        const header = rows[0] ?? [];
        const normalizedPrimaryKey = primaryKey?.trim().toLowerCase();
        const primaryKeyIndexes = normalizedPrimaryKey
            ? header.flatMap((value, index) =>
                  this.stringValue(value).trim().toLowerCase() === normalizedPrimaryKey ? [index] : [],
              )
            : [];
        // Exact-identifier coverage is record identity evidence. Never promote a
        // status, foreign-key or arbitrary cell match into a primary-key match;
        // an absent or ambiguous declared key therefore fails closed.
        const primaryKeyIndex = primaryKeyIndexes.length === 1 ? primaryKeyIndexes[0] : undefined;
        const columnIndexes = new Map<string, number[]>();
        for (const [index, rawHeader] of header.entries()) {
            const normalizedHeader = this.stringValue(rawHeader).trim().toLowerCase();
            if (!normalizedHeader) continue;
            columnIndexes.set(normalizedHeader, [...(columnIndexes.get(normalizedHeader) ?? []), index]);
        }
        const normalizedFilters = requestedFilters.flatMap((filter) => {
            const column = filter.column.trim();
            const indexes = columnIndexes.get(column.toLowerCase()) ?? [];
            // A revision-pinned relation filter must name exactly one physical
            // column. Silently choosing one duplicate header would make the same
            // obligation resolve differently across spreadsheet parsers.
            if (indexes.length !== 1) return [];
            const columnIndex = indexes[0];
            const values = (Array.isArray(filter.value) ? filter.value : [filter.value])
                .map((value) => this.stringValue(value).trim())
                .filter(Boolean);
            return values.length > 0 ? [{ column, columnIndex, values }] : [];
        });
        const invalidFilter = normalizedFilters.length !== requestedFilters.length;
        const filterIdentifiers = requestedFilters.flatMap((filter) =>
            (Array.isArray(filter.value) ? filter.value : [filter.value])
                .map((value) => this.stringValue(value).trim())
                .filter(Boolean),
        );
        const allRequestedIdentifiers = Array.from(new Set([...requestedIdentifiers, ...filterIdentifiers]));
        const normalizedRequested = new Map(requestedIdentifiers.map((value) => [value.toLowerCase(), value] as const));
        const matched = new Set<string>();
        const matchingRows = invalidFilter
            ? []
            : rows.slice(1).filter((row) => {
                  if (!Array.isArray(row)) return false;
                  const primaryMatches =
                      requestedIdentifiers.length === 0
                          ? true
                          : primaryKeyIndex !== undefined &&
                            normalizedRequested.has(this.stringValue(row[primaryKeyIndex]).trim().toLowerCase());
                  if (!primaryMatches) return false;
                  const filtersMatch = normalizedFilters.every((filter) =>
                      filter.values.some(
                          (value) =>
                              this.stringValue(row[filter.columnIndex]).trim().toLowerCase() === value.toLowerCase(),
                      ),
                  );
                  if (!filtersMatch) return false;
                  if (primaryKeyIndex !== undefined) {
                      const requested = normalizedRequested.get(
                          this.stringValue(row[primaryKeyIndex]).trim().toLowerCase(),
                      );
                      if (requested) matched.add(requested);
                  }
                  for (const filter of normalizedFilters) {
                      const cell = this.stringValue(row[filter.columnIndex]).trim().toLowerCase();
                      for (const value of filter.values) if (cell === value.toLowerCase()) matched.add(value);
                  }
                  return true;
              });
        const selectedSheet = XLSX.utils.aoa_to_sheet([header, ...matchingRows]);
        const content = XLSX.utils.sheet_to_csv(selectedSheet, { FS: ",", RS: "\n", blankrows: false }).trimEnd();
        return {
            content,
            requestedIdentifiers: allRequestedIdentifiers,
            matchedIdentifiers: allRequestedIdentifiers.filter((value) => matched.has(value)),
            missingIdentifiers: allRequestedIdentifiers.filter((value) => !matched.has(value)),
            matchedRecordIds:
                primaryKeyIndex === undefined
                    ? []
                    : matchingRows.map((row) => this.stringValue(row[primaryKeyIndex]).trim()).filter(Boolean),
        };
    }

    private async sourceText(
        assetId: string,
        source: KnowledgeSourceManifestEntry,
        requireIndexedArtifact = false,
    ): Promise<string> {
        const indexed = source.extractedTextPath
            ? await this.assets.getBlobContent(assetId, source.extractedTextPath).catch(() => null)
            : null;
        if (indexed !== null) return indexed;
        if (requireIndexedArtifact) {
            throw new BadRequestException("固定索引版本的派生文本不可用，请重新建立索引");
        }
        return this.assets.getBlobContent(assetId, source.path);
    }

    private lineAlignedChunk(sourceText: string, chunk: KnowledgeSourceChunk, includeCsvHeader: boolean): string {
        const startBreak = sourceText.lastIndexOf("\n", Math.max(0, chunk.charStart - 1));
        const start = startBreak < 0 ? 0 : startBreak + 1;
        const endBreak = sourceText.indexOf("\n", Math.min(sourceText.length, chunk.charEnd));
        const end = endBreak < 0 ? sourceText.length : endBreak;
        const body = sourceText.slice(start, end).trim();
        if (!includeCsvHeader || start === 0) return body;
        const headerEnd = sourceText.indexOf("\n");
        const header = sourceText.slice(0, headerEnd < 0 ? sourceText.length : headerEnd).trim();
        return header && body ? `${header}\n${body}` : body;
    }

    private async tableSummaries(
        pinnedAssets: PinnedKnowledgeAsset[],
        offset: number,
    ): Promise<KnowledgeTableCatalogResult> {
        const cacheKey = `${pinnedAssets
            .map(({ asset, snapshot }) => `${asset.id}:${snapshot.revision}`)
            .sort()
            .join("|")}|offset:${offset}`;
        const cached = this.tableCatalogCache.get(cacheKey);
        if (cached && cached.expiresAt > Date.now()) return cached.value;
        if (this.tableCatalogCache.size >= 20) this.tableCatalogCache.clear();
        const value = this.buildTableSummaries(pinnedAssets, offset).catch((error) => {
            this.tableCatalogCache.delete(cacheKey);
            throw error;
        });
        this.tableCatalogCache.set(cacheKey, { expiresAt: Date.now() + TABLE_CATALOG_CACHE_TTL_MS, value });
        return value;
    }

    private async buildTableSummaries(
        pinnedAssets: PinnedKnowledgeAsset[],
        offset: number,
    ): Promise<KnowledgeTableCatalogResult> {
        const eligible: Array<{ asset: Asset; source: KnowledgeSourceManifestEntry }> = [];
        let oversizedCount = 0;
        for (const { asset, manifest } of pinnedAssets) {
            for (const source of manifest.sources) {
                if (
                    source.status !== "indexed" ||
                    !isPublicKnowledgeSourcePath(source.path) ||
                    !source.path.toLowerCase().endsWith(".csv")
                )
                    continue;
                if (source.size > MAX_TABLE_SUMMARY_BYTES) {
                    oversizedCount += 1;
                    continue;
                }
                eligible.push({ asset, source });
            }
        }
        eligible.sort(
            (left, right) =>
                left.asset.id.localeCompare(right.asset.id) || left.source.path.localeCompare(right.source.path),
        );
        if (offset < 0 || offset > eligible.length) throw new BadRequestException("知识库表目录游标越界");
        const candidates = eligible.slice(offset, offset + MAX_TABLE_CATALOG_SOURCES);
        const schemaByAsset = new Map<string, string>();
        await Promise.all(
            pinnedAssets.map(async ({ asset }) => {
                const schema = await this.assets.getBlobContent(asset.id, "schema.md").catch(() => "");
                if (schema) schemaByAsset.set(asset.id, schema);
            }),
        );
        const summaries = await Promise.all(
            candidates.map(async ({ asset, source }) =>
                this.parseTableSummary(
                    asset,
                    source,
                    await this.sourceText(asset.id, source),
                    schemaByAsset.get(asset.id),
                ),
            ),
        );
        const catalog = buildKnowledgeTableCatalog(summaries as KnowledgeTableCatalogEntry[], schemaByAsset);
        const nextOffset = offset + candidates.length < eligible.length ? offset + candidates.length : undefined;
        const omittedCount = Math.max(0, eligible.length - offset - candidates.length) + oversizedCount;
        return {
            summaries: catalog,
            candidateCount: eligible.length + oversizedCount,
            omittedCount,
            offset,
            ...(nextOffset !== undefined ? { nextOffset } : {}),
            unretrievableCount: oversizedCount,
            truncated: nextOffset !== undefined || oversizedCount > 0,
        };
    }

    private parseTableSummary(
        asset: Asset,
        source: KnowledgeSourceManifestEntry,
        content: string,
        schemaMarkdown = "",
    ): KnowledgeTableSummary {
        const workbook = XLSX.read(content, { type: "string", raw: true });
        const firstSheet = workbook.SheetNames[0];
        const sheet = firstSheet ? workbook.Sheets[firstSheet] : undefined;
        const rows = sheet ? XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: true, defval: "" }) : [];
        const columns = (rows[0] ?? []).map((value) => this.stringValue(value));
        const records = rows
            .slice(1)
            .filter((row) => Array.isArray(row) && row.some((value) => this.stringValue(value).length > 0));
        const declaredPrimaryKey = parseKnowledgeGroundingSchema(schemaMarkdown).find(
            (table) => table.path === source.path,
        )?.primaryKey;
        const primaryKey =
            declaredPrimaryKey && columns.includes(declaredPrimaryKey)
                ? declaredPrimaryKey
                : (columns.find((column) => /(?:^id$|_id$)/iu.test(column)) ?? columns[0] ?? null);
        const primaryKeyIndex = primaryKey ? columns.indexOf(primaryKey) : -1;
        const allRecordIds =
            primaryKeyIndex >= 0 ? records.map((row) => this.stringValue(row[primaryKeyIndex])).filter(Boolean) : [];
        return {
            assetId: asset.id,
            path: source.path,
            title: this.titleFromSourcePath(source.path),
            mime: source.mime,
            columns,
            primaryKey,
            recordCount: records.length,
            recordIds: allRecordIds.slice(0, MAX_TABLE_RECORD_IDS),
            recordIdsTruncated: allRecordIds.length > MAX_TABLE_RECORD_IDS,
            resource: `asset://${asset.id}/${source.path}`,
        };
    }

    private isTableInventoryQuery(query: string): boolean {
        return /(?:盘点|统计|记录数|条数|总数|数量|多少)|\b(?:count|inventory|total|how\s+many)\b/i.test(query);
    }

    private compareSearchHits(left: KnowledgeSearchHit, right: KnowledgeSearchHit): number {
        return (
            right.score - left.score ||
            left.assetId.localeCompare(right.assetId) ||
            left.path.localeCompare(right.path) ||
            left.kind.localeCompare(right.kind) ||
            (left.chunkIndex ?? -1) - (right.chunkIndex ?? -1) ||
            left.conceptId.localeCompare(right.conceptId)
        );
    }

    private withSearchIncompleteReasons(snapshot: KnowledgeIndexSnapshot, reasons: string[]): KnowledgeIndexSnapshot {
        if (reasons.length === 0) return snapshot;
        return {
            ...snapshot,
            incompleteSourceCount: Math.max(1, snapshot.incompleteSourceCount),
            incompleteReasons: Array.from(new Set([...snapshot.incompleteReasons, ...reasons])).sort(),
        };
    }

    private pageCursorPayload(
        kind: "search" | "catalog",
        scope: KnowledgeScope | "asset",
        query: string,
        pinnedAssets: PinnedKnowledgeAsset[],
        offset: number,
        limit?: number,
        rankingFingerprint?: string,
    ): KnowledgePageCursorPayload {
        return {
            version: 1,
            kind,
            scope,
            query,
            assetIds: pinnedAssets.map(({ asset }) => asset.id).sort(),
            revisions: pinnedAssets
                .map(({ asset, snapshot }) => ({ assetId: asset.id, revision: snapshot.revision }))
                .sort((left, right) => left.assetId.localeCompare(right.assetId)),
            offset,
            ...(limit !== undefined ? { limit } : {}),
            ...(kind === "search" && rankingFingerprint ? { rankingFingerprint } : {}),
        };
    }

    private encodePageCursor(payload: KnowledgePageCursorPayload): string {
        const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
        const signature = createHmac("sha256", this.cursorSecret).update(encoded).digest("base64url");
        return `${encoded}.${signature}`;
    }

    private assertPageCursor(
        cursor: string,
        kind: "search" | "catalog",
        scope: KnowledgeScope | "asset",
        query: string,
        pinnedAssets: PinnedKnowledgeAsset[],
        limit?: number,
        rankingFingerprint?: string,
    ): KnowledgePageCursorPayload {
        const payload = this.decodePageCursor(cursor);
        const expected = this.pageCursorPayload(
            kind,
            scope,
            query,
            pinnedAssets,
            payload.offset,
            limit,
            rankingFingerprint,
        );
        if (
            payload.version !== expected.version ||
            payload.kind !== expected.kind ||
            payload.scope !== expected.scope ||
            payload.query !== expected.query ||
            payload.limit !== expected.limit ||
            payload.rankingFingerprint !== expected.rankingFingerprint ||
            JSON.stringify(payload.assetIds) !== JSON.stringify(expected.assetIds) ||
            JSON.stringify(payload.revisions) !== JSON.stringify(expected.revisions)
        ) {
            throw new BadRequestException("知识库分页游标与当前查询、范围或索引版本不匹配");
        }
        return payload;
    }

    private decodePageCursor(cursor: string): KnowledgePageCursorPayload {
        try {
            const [encoded, signature, extra] = cursor.split(".");
            if (!encoded || !signature || extra !== undefined) throw new Error("invalid cursor shape");
            const supplied = Buffer.from(signature, "base64url");
            const expected = createHmac("sha256", this.cursorSecret).update(encoded).digest();
            if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
                throw new Error("invalid cursor signature");
            }
            const parsed = JSON.parse(
                Buffer.from(encoded, "base64url").toString("utf8"),
            ) as Partial<KnowledgePageCursorPayload>;
            if (
                parsed.version !== 1 ||
                (parsed.kind !== "search" && parsed.kind !== "catalog") ||
                !["asset", "personal", "docs", "global"].includes(parsed.scope ?? "") ||
                typeof parsed.query !== "string" ||
                !Array.isArray(parsed.assetIds) ||
                parsed.assetIds.some((assetId) => typeof assetId !== "string") ||
                !Array.isArray(parsed.revisions) ||
                parsed.revisions.some(
                    (item) =>
                        !item ||
                        typeof item !== "object" ||
                        typeof item.assetId !== "string" ||
                        typeof item.revision !== "string",
                ) ||
                (parsed.rankingFingerprint !== undefined && typeof parsed.rankingFingerprint !== "string") ||
                !Number.isSafeInteger(parsed.offset) ||
                (parsed.offset ?? -1) < 0 ||
                (parsed.limit !== undefined && (!Number.isSafeInteger(parsed.limit) || parsed.limit <= 0))
            ) {
                throw new Error("invalid cursor payload");
            }
            return parsed as KnowledgePageCursorPayload;
        } catch {
            throw new BadRequestException("知识库分页游标无效或已过期");
        }
    }

    private assertExpectedRevision(expectedRevision: string | undefined, snapshot: KnowledgeIndexSnapshot): void {
        if (!expectedRevision || expectedRevision === snapshot.revision) return;
        throw new BadRequestException(`知识库索引版本已变化：期望 ${expectedRevision}，当前 ${snapshot.revision}`);
    }

    private rankingFingerprint(pinnedAssets: PinnedKnowledgeAsset[]): string {
        return createHash("sha256")
            .update(
                JSON.stringify(
                    pinnedAssets.map(({ asset }) => {
                        const config = this.embeddings?.getAssetConfig(asset) ?? {
                            provider: "local",
                            model: "local-hash-v1",
                            dimensions: undefined,
                            keywordWeight: 1,
                            vectorWeight: 6,
                            mmrLambda: DEFAULT_MMR_LAMBDA,
                        };
                        return {
                            assetId: asset.id,
                            provider: config.provider,
                            model: config.model,
                            dimensions: config.dimensions,
                            keywordWeight: config.keywordWeight,
                            vectorWeight: config.vectorWeight,
                            mmrLambda: config.mmrLambda,
                        };
                    }),
                ),
            )
            .digest("hex")
            .slice(0, 24);
    }

    private async resolveScopeAssets(scope: KnowledgeScope, userId: string): Promise<Asset[]> {
        if (scope === "personal") return [await this.assets.getOrCreatePersonalKnowledge(userId)];
        if (scope === "docs") return [await this.assets.getOrCreateGlobalDocsKnowledge()];
        const assets = await this.assets.listGlobalKnowledge();
        const active = assets
            .filter((asset) => {
                const knowledge = asset.metadata?.knowledge;
                return (
                    !knowledge ||
                    typeof knowledge !== "object" ||
                    (knowledge as Record<string, unknown>).archived !== true
                );
            })
            .sort((left, right) => left.id.localeCompare(right.id));
        if (active.length > MAX_GLOBAL_KNOWLEDGE_SEARCH_ASSETS) {
            throw new BadRequestException(
                `全局知识库包含 ${active.length} 个活动域，超过单次跨域检索上限 ${MAX_GLOBAL_KNOWLEDGE_SEARCH_ASSETS}；请指定知识库域`,
            );
        }
        return active;
    }

    private async embedTexts(asset: Asset, texts: string[]) {
        if (this.embeddings) return this.embeddings.embed(asset, texts);
        return {
            provider: "local",
            model: "local-hash-v1",
            dimensions: localEmbedding("").length,
            vectors: texts.map((text) => localEmbedding(text)),
        };
    }

    private diversify(hits: KnowledgeSearchHit[], limit: number, lambda: number): KnowledgeSearchHit[] {
        if (hits.length <= 1 || lambda >= 1) return hits.slice(0, limit);
        // MMR is a reranker, not the initial retriever. Running its pairwise
        // comparisons over every matching chunk makes broad queries scale
        // quadratically and can block all concurrent searches. The input is
        // already sorted by hybrid relevance, so rerank a bounded top pool.
        const candidateLimit = Math.min(hits.length, 512);
        const candidates = hits.slice(0, candidateLimit).map((hit) => ({
            hit,
            embedding: localEmbedding(`${hit.title}\n${hit.snippet}`),
            maxRedundancy: Number.NEGATIVE_INFINITY,
        }));
        const selected: typeof candidates = [];
        const maxScore = Math.max(...hits.map((hit) => hit.score), 1);
        while (candidates.length > 0 && selected.length < limit) {
            let bestIndex = 0;
            let bestScore = Number.NEGATIVE_INFINITY;
            for (const [index, candidate] of candidates.entries()) {
                const relevance = candidate.hit.score / maxScore;
                const redundancy = selected.length > 0 ? Math.max(0, candidate.maxRedundancy) : 0;
                const score = lambda * relevance - (1 - lambda) * redundancy;
                if (score > bestScore) {
                    bestScore = score;
                    bestIndex = index;
                }
            }
            const chosen = candidates.splice(bestIndex, 1)[0];
            selected.push(chosen);
            for (const candidate of candidates) {
                candidate.maxRedundancy = Math.max(
                    candidate.maxRedundancy,
                    cosineSimilarity(candidate.embedding, chosen.embedding),
                );
            }
        }
        return [...selected.map((item) => item.hit), ...hits.slice(candidateLimit)].slice(0, limit);
    }

    private mmrLambda(pinnedAssets: PinnedKnowledgeAsset[]): number {
        const configured = pinnedAssets.map(({ asset }) =>
            this.embeddings ? this.embeddings.getAssetConfig(asset).mmrLambda : DEFAULT_MMR_LAMBDA,
        );
        if (configured.length === 0) return DEFAULT_MMR_LAMBDA;
        // Cross-asset search must not inherit an arbitrary first asset. A stable
        // aggregate makes the global ranking independent of input enumeration.
        return configured.reduce((sum, value) => sum + value, 0) / configured.length;
    }

    private loadCursorSecret(): Buffer {
        const dataDirectory = desktopDataDir();
        mkdirSync(dataDirectory, { recursive: true, mode: 0o700 });
        const secretPath = path.join(dataDirectory, CURSOR_SECRET_FILENAME);
        if (existsSync(secretPath)) return this.readCursorSecret(secretPath);

        const temporary = `${secretPath}.${process.pid}.${randomBytes(12).toString("hex")}.tmp`;
        const generated = randomBytes(CURSOR_SECRET_BYTES);
        let descriptor: number | undefined;
        try {
            descriptor = openSync(temporary, "wx", 0o600);
            writeSync(descriptor, generated);
            fsyncSync(descriptor);
            closeSync(descriptor);
            descriptor = undefined;
            // link(2) is an atomic no-replace publication: exactly one creator
            // wins, while every loser reads the complete, fsynced winner.
            linkSync(temporary, secretPath);
            chmodSync(secretPath, 0o600);
            return this.readCursorSecret(secretPath);
        } catch (error) {
            if (!existsSync(secretPath)) throw error;
            return this.readCursorSecret(secretPath);
        } finally {
            if (descriptor !== undefined) closeSync(descriptor);
            rmSync(temporary, { force: true });
        }
    }

    private readCursorSecret(secretPath: string): Buffer {
        const secret = readFileSync(secretPath);
        if (secret.length !== CURSOR_SECRET_BYTES) {
            throw new Error("知识库分页签名密钥损坏：期望 32 字节；为保护持久游标已拒绝自动轮换");
        }
        chmodSync(secretPath, 0o600);
        return secret;
    }

    private async requireAsset(assetId: string): Promise<Asset> {
        const asset = await this.assets.getAsset(assetId);
        if (!asset || asset.category !== "knowledge") throw new NotFoundException("Knowledge asset not found");
        return asset;
    }

    private wikiPaths(asset: Asset): string[] {
        return this.wikiPathCandidates(asset).map(({ path }) => path);
    }

    private wikiPathCandidates(asset: Asset): WikiPathCandidate[] {
        const sizes = new Map<string, number>();
        const paths = new Set(
            asset.blobs
                .filter(
                    (blob) =>
                        blob.path.startsWith("wiki/") &&
                        blob.path.toLowerCase().endsWith(".md") &&
                        !isInternalKnowledgePath(blob.path),
                )
                .map((blob) => {
                    sizes.set(blob.path, blob.size);
                    return blob.path;
                }),
        );
        const contents = asset.metadata?.blobContents;
        if (contents && typeof contents === "object" && !Array.isArray(contents)) {
            for (const path of Object.keys(contents)) {
                if (path.startsWith("wiki/") && path.toLowerCase().endsWith(".md") && !isInternalKnowledgePath(path)) {
                    paths.add(path);
                }
            }
        }
        return Array.from(paths)
            .sort()
            .map((path) => ({ path, ...(sizes.has(path) ? { knownSize: sizes.get(path) } : {}) }));
    }

    private boundedWikiPaths(asset: Asset): BoundedWikiSelection {
        const paths = this.wikiPathCandidates(asset);
        const selected = paths.slice(0, MAX_WIKI_SEARCH_DOCUMENTS);
        const omittedCount = paths.length - selected.length;
        return {
            paths: selected
                .filter(({ knownSize }) => knownSize === undefined || knownSize <= MAX_WIKI_DOCUMENT_CHARACTERS)
                .map(({ path }) => path),
            selectedCharacters: 0,
            omittedCount:
                omittedCount +
                selected.filter(({ knownSize }) => knownSize !== undefined && knownSize > MAX_WIKI_DOCUMENT_CHARACTERS)
                    .length,
            oversizedCount: selected.filter(
                ({ knownSize }) => knownSize !== undefined && knownSize > MAX_WIKI_DOCUMENT_CHARACTERS,
            ).length,
            totalLimitCount: 0,
            incompleteReasons: new Set([
                ...(omittedCount > 0
                    ? [`knowledge_wiki_document_limit_exceeded:${paths.length}/${MAX_WIKI_SEARCH_DOCUMENTS}`]
                    : []),
                ...(selected.some(
                    ({ knownSize }) => knownSize !== undefined && knownSize > MAX_WIKI_DOCUMENT_CHARACTERS,
                )
                    ? [
                          `knowledge_wiki_document_size_limit_exceeded:${selected.filter(({ knownSize }) => knownSize !== undefined && knownSize > MAX_WIKI_DOCUMENT_CHARACTERS).length}/${MAX_WIKI_DOCUMENT_CHARACTERS}`,
                      ]
                    : []),
            ]),
        };
    }

    private acceptWikiContent(content: string, selection: BoundedWikiSelection): boolean {
        const bytes = Buffer.byteLength(content, "utf8");
        if (content.length > MAX_WIKI_DOCUMENT_CHARACTERS || bytes > MAX_WIKI_DOCUMENT_CHARACTERS) {
            selection.oversizedCount += 1;
            selection.omittedCount += 1;
            for (const reason of selection.incompleteReasons) {
                if (reason.startsWith("knowledge_wiki_document_size_limit_exceeded:")) {
                    selection.incompleteReasons.delete(reason);
                }
            }
            selection.incompleteReasons.add(
                `knowledge_wiki_document_size_limit_exceeded:${selection.oversizedCount}/${MAX_WIKI_DOCUMENT_CHARACTERS}`,
            );
            return false;
        }
        const resourceSize = Math.max(content.length, bytes);
        if (selection.selectedCharacters + resourceSize > MAX_WIKI_TOTAL_CHARACTERS) {
            selection.totalLimitCount += 1;
            selection.omittedCount += 1;
            selection.incompleteReasons.add(
                `knowledge_wiki_total_character_limit_exceeded:${selection.selectedCharacters}/${MAX_WIKI_TOTAL_CHARACTERS}`,
            );
            return false;
        }
        selection.selectedCharacters += resourceSize;
        return true;
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
            tags: tags.join(" ").toLowerCase(),
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
        const compact = value.replace(/\s+/g, " ").trim();
        if (!compact) return "";
        const lower = compact.toLowerCase();
        const indexes = terms.map((term) => lower.indexOf(term)).filter((index) => index >= 0);
        const matchAt = indexes.length > 0 ? Math.min(...indexes) : 0;
        const start = Math.max(0, matchAt - 80);
        const end = Math.min(compact.length, start + 240);
        return `${start > 0 ? "..." : ""}${compact.slice(start, end)}${end < compact.length ? "..." : ""}`;
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
        const withoutWiki = value.replace(/^wiki\//i, "");
        const withExtension = withoutWiki.toLowerCase().endsWith(".md") ? withoutWiki : `${withoutWiki}.md`;
        const normalized = normalizeOkfPath(withExtension);
        if (!normalized) throw new BadRequestException("concept path is required");
        return normalized;
    }

    private queryTerms(query: string): string[] {
        const lower = query.toLowerCase();
        const terms = lower.split(/[\s,，。！？;；:：]+/).filter(Boolean);
        const intentStripped = lower
            .replace(/(?:请问|帮我|麻烦|搜索|查找|查询|找一下|搜一下)/gu, " ")
            .replace(/(?:是什么时候|什么时候|是何时|是什么|在哪里|在哪儿|怎么做|如何|为何|为什么|吗|呢|呀|啊)/gu, " ")
            .split(/[\s,，。！？;；:：]+/)
            .map((term) => term.trim())
            .filter((term) => term.length >= 2);
        return Array.from(
            new Set([
                lower,
                ...terms,
                ...intentStripped,
                ...knowledgeSearchTokens(intentStripped.join(" ") || lower, { maxTokens: 64 }),
            ]),
        ).slice(0, 80);
    }

    private requireQuery(query: string): string {
        const normalized = query?.trim();
        if (!normalized) throw new BadRequestException("query is required");
        return normalized;
    }

    private bundleName(asset: Asset): string {
        const knowledge = asset.metadata?.knowledge;
        if (knowledge && typeof knowledge === "object") {
            const domain = this.stringValue((knowledge as Record<string, unknown>).globalDomain);
            if (domain) return domain;
        }
        return asset.name;
    }

    private titleFromPath(path: string): string {
        return (path.split("/").pop() || path).replace(/\.md$/i, "").replace(/[-_]+/g, " ");
    }

    private titleFromSourcePath(path: string): string {
        return decodeURIComponent(path.split("/").pop() || path).replace(/[-_]+/g, " ");
    }

    private stringValue(value: unknown): string {
        return typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
    }

    private stringArray(value: unknown): string[] {
        return Array.isArray(value) ? value.map((item) => this.stringValue(item)).filter(Boolean) : [];
    }
}
