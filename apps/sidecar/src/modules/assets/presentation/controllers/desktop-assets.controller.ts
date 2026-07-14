import { Body, Controller, Delete, Get, Inject, Optional, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { createHash } from 'node:crypto';
import JSZip = require('jszip');
import { DesktopOwnerId } from '@/shared/security/decorators/desktop-owner.decorator';
import { DesktopApi } from '@/shared/security/desktop-access';
import { BadRequestException, ConflictException, NotFoundException } from '@/shared/common/errors';
import { ApiCreatedResponse, ApiOkResponse } from '@/shared/api/openapi';
import { ASSET_SERVICE, type IAssetService } from '@/modules/assets/domain/services/asset.service.interface';
import type { Asset } from '@/modules/assets/domain/entities/asset.entity';
import type { Blob } from '@/modules/assets/domain/entities/blob.entity';
import { KnowledgeQueryService } from '@/modules/assets/application/knowledge-query.service';
import { KnowledgeIngestionService } from '@/modules/assets/application/knowledge-ingestion.service';
import { KnowledgeAuditService } from '@/modules/assets/application/knowledge-audit.service';
import { KnowledgeIngestJobService } from '@/modules/assets/application/knowledge-ingest-job.service';
import {
    extractOkfLinks,
    normalizeOkfPath,
    validateOkfBundle,
} from '@/modules/assets/domain/knowledge/open-knowledge-format';

type RepositoryTreeItem = {
    path: string;
    name: string;
    type: 'tree' | 'blob' | 'commit';
    mode: string;
    sha: string;
    size: number | null;
    isBinary?: boolean;
};

type WikiPageType = string;

interface UpdateBlobBody {
    content?: string;
    encoding?: 'utf8' | 'base64';
    message?: string;
    branch?: string;
    authorName?: string;
    authorEmail?: string;
}

interface DeleteBlobBody {
    message?: string;
    branch?: string;
    authorName?: string;
    authorEmail?: string;
}

interface RenameBlobBody extends DeleteBlobBody {
    toPath?: string;
}

interface UploadSourcesBody {
    sources?: Array<{ name?: string; contentBase64?: string }>;
    ingest?: boolean;
}

interface ImportOkfBody {
    archiveBase64?: string;
    files?: Array<{ path?: string; content?: string }>;
    overwrite?: boolean;
}

interface KnowledgeCurationSuggestion {
    id: string;
    kind: 'link' | 'summary' | 'page' | 'merge';
    status: 'pending' | 'accepted' | 'rejected' | 'reverted';
    sourcePath: string;
    targetPath: string;
    targetTitle: string;
    reason: string;
    similarity: number;
    createdAt: string;
    reviewedAt?: string;
    reviewedBy?: string;
    appliedText?: string;
    appliedContentSha?: string;
    commitSha?: string;
    proposedContent?: string;
    citations?: string[];
    appliedMode?: 'append' | 'create';
}

const MAX_OKF_IMPORT_FILES = 5_000;
const MAX_OKF_IMPORT_BYTES = 20 * 1024 * 1024;
const TEXT_SOURCE_EXTENSIONS = new Set(['txt', 'csv', 'tsv', 'md', 'json', 'jsonl', 'yaml', 'yml', 'xml', 'html', 'htm', 'log']);

@DesktopApi()
@Controller('assets')
export class DesktopAssetsController {
    private readonly curationQueues = new Map<string, Promise<void>>();

    constructor(
        @Inject(ASSET_SERVICE) private readonly assets: IAssetService,
        private readonly ingestion: KnowledgeIngestionService,
        private readonly knowledge: KnowledgeQueryService,
        @Optional() private readonly ingestJobs?: KnowledgeIngestJobService,
        @Optional() private readonly audit?: KnowledgeAuditService,
    ) {}

    @Get('me/knowledge')
    @ApiOkResponse({ summary: '获取我的个人知识库资产' })
    async getMyKnowledge(@DesktopOwnerId() userId: string) {
        return this.assetDto(await this.assets.getOrCreatePersonalKnowledge(userId));
    }

    @Get('me/knowledge/search')
    @ApiOkResponse({ summary: '搜索当前用户的 OKF 个人知识库' })
    async searchMyKnowledge(
        @DesktopOwnerId() userId: string,
        @Query('q') query: string,
        @Query('limit') limit?: string,
    ) {
        return this.knowledge.searchScope('personal', userId, query, this.searchLimit(limit));
    }

    @Get('docs/knowledge/search')
    @ApiOkResponse({ summary: '搜索书小安文档 OKF 知识库' })
    async searchDocsKnowledge(
        @DesktopOwnerId() userId: string,
        @Query('q') query: string,
        @Query('limit') limit?: string,
    ) {
        return this.knowledge.searchScope('docs', userId, query, this.searchLimit(limit));
    }

    @Get('docs/knowledge/search-all')
    @ApiOkResponse({ summary: '跨域搜索全部公开 OKF 知识库' })
    async searchAllKnowledge(
        @DesktopOwnerId() userId: string,
        @Query('q') query: string,
        @Query('limit') limit?: string,
    ) {
        return this.knowledge.searchScope('global', userId, query, this.searchLimit(limit));
    }

    @Get(':id/repository')
    @ApiOkResponse({ summary: '获取资产仓库信息' })
    async repository(@Param('id') id: string) {
        const asset = await this.requireAsset(id);
        return {
            assetId: asset.id,
            cloneUrl: asset.cloneUrl,
            defaultBranch: asset.defaultBranch || 'main',
            refs: this.repositoryRefs(asset),
        };
    }

    @Get(':id/repository/tree')
    @ApiOkResponse({ summary: '列出资产仓库目录树' })
    async repositoryTree(
        @Param('id') id: string,
        @Query('ref') ref?: string,
        @Query('path') treePath?: string,
        @Query('page') pageValue?: string,
        @Query('limit') limitValue?: string,
    ) {
        const asset = await this.requireAsset(id);
        const normalizedPath = this.normalizeBlobPath(treePath);
        const allItems = this.treeItems(asset, normalizedPath);
        const page = Math.max(1, Number(pageValue) || 1);
        const limit = Math.max(1, Math.min(1000, Number(limitValue) || 1000));
        const offset = (page - 1) * limit;
        const items = allItems.slice(offset, offset + limit);
        const totalPages = Math.max(1, Math.ceil(allItems.length / limit));

        return {
            assetId: asset.id,
            ref: ref?.trim() || asset.defaultBranch || 'main',
            path: normalizedPath,
            items,
            total: allItems.length,
            page,
            limit,
            totalPages,
            hasNext: page < totalPages,
            hasPrevious: page > 1,
        };
    }

    @Get(':id/repository/blob')
    @ApiOkResponse({ summary: '读取资产仓库文件内容' })
    async repositoryBlob(@Param('id') id: string, @Query('path') path: string, @Query('ref') ref?: string) {
        const asset = await this.requireAsset(id);
        const normalizedPath = this.requireBlobPath(path);
        const blob = await this.assets.getBlobData(asset.id, normalizedPath);
        return {
            assetId: asset.id,
            ref: ref?.trim() || asset.defaultBranch || 'main',
            ...blob,
        };
    }

    @Post(':id/blobs/update')
    @ApiCreatedResponse({ summary: '更新资产仓库文件' })
    async updateBlob(@Param('id') id: string, @Query('path') path: string, @Body() body: UpdateBlobBody) {
        const normalizedPath = this.requireBlobPath(path);
        if (body.encoding === 'base64') {
            return this.assets.updateBlobBinary(
                id,
                normalizedPath,
                Buffer.from(body.content || '', 'base64'),
                body.message || `Update ${normalizedPath}`,
                body.branch || 'main',
                body.authorName,
                body.authorEmail,
            );
        }
        return this.assets.updateBlob(
            id,
            normalizedPath,
            typeof body.content === 'string' ? body.content : '',
            body.message || `Update ${normalizedPath}`,
            body.branch || 'main',
            body.authorName,
            body.authorEmail,
        );
    }

    @Post(':id/blobs/delete')
    @ApiCreatedResponse({ summary: '删除资产仓库文件' })
    async deleteBlob(@Param('id') id: string, @Query('path') path: string, @Body() body: DeleteBlobBody) {
        const normalizedPath = this.requireBlobPath(path);
        return this.assets.deleteBlob(
            id,
            normalizedPath,
            body.message || `Delete ${normalizedPath}`,
            body.branch || 'main',
            body.authorName,
            body.authorEmail,
        );
    }

    @Post(':id/blobs/rename')
    @ApiCreatedResponse({ summary: '重命名资产仓库文件' })
    async renameBlob(@Param('id') id: string, @Query('path') path: string, @Body() body: RenameBlobBody) {
        const normalizedPath = this.requireBlobPath(path);
        const toPath = this.requireBlobPath(body.toPath);
        return this.assets.renameBlob(
            id,
            normalizedPath,
            toPath,
            body.message || `Rename ${normalizedPath} to ${toPath}`,
            body.branch || 'main',
            body.authorName,
            body.authorEmail,
        );
    }

    @Get(':id/wiki/sources')
    @ApiOkResponse({ summary: '列出资产 Wiki 来源' })
    async listWikiSources(@Param('id') id: string) {
        const asset = await this.requireAsset(id);
        const manifest = await this.ingestion.getManifest(id);
        const byPath = new Map(manifest.sources.map(source => [source.path, source]));
        return this.sourceEntries(asset).map(source => {
            const indexed = byPath.get(source.path);
            return {
                ...source,
                status: indexed?.status ?? 'pending',
                error: indexed?.error,
                retryable: indexed?.retryable,
                chunkCount: indexed?.chunkCount ?? 0,
                extractionMethod: indexed?.extractionMethod,
            };
        });
    }

    @Post(':id/wiki/sources')
    @ApiCreatedResponse({ summary: '上传资产 Wiki 来源' })
    async uploadWikiSources(
        @Param('id') id: string,
        @Body() body: UploadSourcesBody,
        @DesktopOwnerId() userId = 'system',
    ) {
        const sources = Array.isArray(body.sources) ? body.sources : [];
        if (sources.length === 0) {
            throw new BadRequestException('sources is required');
        }
        const paths: string[] = [];
        for (const source of sources) {
            const name = this.safeSourceName(source.name);
            const contentBase64 = source.contentBase64 || '';
            const buffer = Buffer.from(contentBase64, 'base64');
            const path = `raw/sources/${name}`;
            const extension = name.split('.').pop()?.toLowerCase() ?? '';
            const update = TEXT_SOURCE_EXTENSIONS.has(extension)
                ? await this.assets.updateBlob(id, path, buffer.toString('utf8'), `Import ${name}`, 'main')
                : await this.assets.updateBlobBinary(id, path, buffer, `Import ${name}`, 'main');
            await this.recordAudit(id, {
                action: 'source.upload',
                target: path,
                actorId: userId,
                commitSha: update.commitSha,
                metadata: { size: buffer.byteLength },
            });
            paths.push(path);
        }
        const job = body.ingest === true && this.ingestJobs ? await this.ingestJobs.start(id, paths, userId) : undefined;
        const ingestion = body.ingest === true && !this.ingestJobs ? await this.ingestion.reindex(id) : undefined;
        return { paths, job, ingestion };
    }

    @Delete(':id/wiki/sources')
    @ApiOkResponse({ summary: '删除资产 Wiki 来源' })
    async deleteWikiSource(
        @Param('id') id: string,
        @Query('path') path: string,
        @DesktopOwnerId() userId = 'system',
    ) {
        const normalizedPath = this.requireBlobPath(path);
        const result = await this.assets.deleteBlob(id, normalizedPath, `Delete ${normalizedPath}`, 'main');
        await this.recordAudit(id, {
            action: 'source.delete',
            target: normalizedPath,
            actorId: userId,
            commitSha: result.commitSha,
        });
        return { deleted: result.deleted, path: normalizedPath };
    }

    @Post(':id/wiki/ingest-jobs')
    @ApiCreatedResponse({ summary: '启动异步知识库摄取任务' })
    async startWikiIngestJob(
        @Param('id') id: string,
        @Body() body: { sourcePaths?: string[] },
        @DesktopOwnerId() userId = 'system',
    ) {
        return this.requireIngestJobs().start(id, Array.isArray(body.sourcePaths) ? body.sourcePaths : [], userId);
    }

    @Get(':id/wiki/ingest-jobs')
    @ApiOkResponse({ summary: '列出知识库摄取任务' })
    async listWikiIngestJobs(@Param('id') id: string, @Query('limit') limit?: string) {
        return this.requireIngestJobs().list(id, this.searchLimit(limit));
    }

    @Get(':id/wiki/ingest-jobs/:jobId')
    @ApiOkResponse({ summary: '获取知识库摄取任务状态' })
    async wikiIngestJobStatus(@Param('id') id: string, @Param('jobId') jobId: string) {
        return this.requireIngestJobs().get(id, jobId);
    }

    @Post(':id/wiki/ingest-jobs/:jobId/cancel')
    @ApiCreatedResponse({ summary: '取消知识库摄取任务' })
    async cancelWikiIngestJob(@Param('id') id: string, @Param('jobId') jobId: string) {
        return this.requireIngestJobs().cancel(id, jobId);
    }

    @Post(':id/wiki/ingest-jobs/:jobId/retry')
    @ApiCreatedResponse({ summary: '重试失败的知识库摄取任务' })
    async retryWikiIngestJob(
        @Param('id') id: string,
        @Param('jobId') jobId: string,
        @DesktopOwnerId() userId = 'system',
    ) {
        return this.requireIngestJobs().retry(id, jobId, userId);
    }

    @Get(':id/wiki/pages')
    @ApiOkResponse({ summary: '列出资产 Wiki 页面' })
    async listWikiPages(@Param('id') id: string) {
        const asset = await this.requireAsset(id);
        return this.pageEntries(asset, await this.loadKnowledgeContents(asset, 'wiki/'));
    }

    @Get(':id/wiki/graph')
    @ApiOkResponse({ summary: '获取资产 Wiki 图谱' })
    async wikiGraph(
        @Param('id') id: string,
        @Query('q') query?: string,
        @Query('type') requestedType?: string,
        @Query('tag') requestedTag?: string,
    ) {
        const asset = await this.requireAsset(id);
        const contents = await this.loadKnowledgeContents(asset, 'wiki/');
        const pages = this.pageEntries(asset, contents);
        const byAlias = new Map<string, string>();
        for (const page of pages) {
            byAlias.set(page.title.toLowerCase(), page.path);
            byAlias.set(this.titleFromPath(page.path).toLowerCase(), page.path);
            byAlias.set(page.path.toLowerCase(), page.path);
        }

        const edgeWeights = new Map<string, { source: string; target: string; weight: number }>();
        for (const page of pages) {
            const content = contents[page.path] ?? '';
            for (const targetAlias of this.knowledgeLinkTargets(page.path, content)) {
                const target = byAlias.get(targetAlias.toLowerCase());
                if (!target || target === page.path) continue;
                const key = `${page.path}\n${target}`;
                const previous = edgeWeights.get(key);
                edgeWeights.set(key, {
                    source: page.path,
                    target,
                    weight: (previous?.weight ?? 0) + 1,
                });
            }
        }

        const degree = new Map<string, number>();
        const edges: Array<{
            source: string;
            target: string;
            weight: number;
            kind: 'concept-link' | 'source-concept';
            signals: { directLink: number; sourceOverlap: number; adamicAdar: number; typeAffinity: number };
        }> = Array.from(edgeWeights.values()).map(edge => {
            degree.set(edge.source, (degree.get(edge.source) ?? 0) + 1);
            degree.set(edge.target, (degree.get(edge.target) ?? 0) + 1);
            return {
                ...edge,
                kind: 'concept-link' as const,
                signals: {
                    directLink: edge.weight,
                    sourceOverlap: 0,
                    adamicAdar: 0,
                    typeAffinity: 0,
                },
            };
        });

        const sourceNodes = new Map<string, { path: string; title: string; type: string; tags: string[] }>();
        for (const page of pages) {
            for (const source of page.sources) {
                if (!source.startsWith('raw/sources/')) continue;
                sourceNodes.set(source, { path: source, title: this.titleFromSourcePath(source), type: 'Source', tags: [] });
                degree.set(source, (degree.get(source) ?? 0) + 1);
                degree.set(page.path, (degree.get(page.path) ?? 0) + 1);
                edges.push({
                    source,
                    target: page.path,
                    weight: 1,
                    kind: 'source-concept',
                    signals: { directLink: 1, sourceOverlap: 1, adamicAdar: 0, typeAffinity: 0 },
                });
            }
        }

        const nodes = [
            ...pages.map(page => ({
                path: page.path,
                title: page.title,
                type: page.type,
                tags: page.tags,
                sourceCount: page.sources.length,
                degree: degree.get(page.path) ?? 0,
                kind: 'concept' as const,
            })),
            ...Array.from(sourceNodes.values()).map(source => ({
                ...source,
                sourceCount: 0,
                degree: degree.get(source.path) ?? 0,
                kind: 'source' as const,
            })),
        ];
        const communities = this.graphCommunities(nodes.map(node => node.path), edges);
        const normalizedQuery = query?.trim().toLowerCase();
        const normalizedType = requestedType?.trim().toLowerCase();
        const normalizedTag = requestedTag?.trim().toLowerCase();
        const filteredNodes = nodes.filter(node => {
            if (normalizedQuery && !`${node.title} ${node.path}`.toLowerCase().includes(normalizedQuery)) return false;
            if (normalizedType && (node.type || '').toLowerCase() !== normalizedType) return false;
            if (normalizedTag && !node.tags.some(tag => tag.toLowerCase() === normalizedTag)) return false;
            return true;
        });
        const visible = new Set(filteredNodes.map(node => node.path));

        return {
            nodes: filteredNodes.map(node => ({ ...node, community: communities.get(node.path) ?? 0 })),
            edges: edges.filter(edge => visible.has(edge.source) && visible.has(edge.target)),
            filters: {
                types: Array.from(new Set(nodes.map(node => node.type).filter(Boolean))).sort(),
                tags: Array.from(new Set(nodes.flatMap(node => node.tags))).sort(),
            },
        };
    }

    @Get(':id/wiki/backlinks')
    @ApiOkResponse({ summary: '获取指向指定 Wiki 页面的反向链接' })
    async wikiBacklinks(@Param('id') id: string, @Query('path') path: string) {
        const normalizedPath = this.requireBlobPath(path);
        const [graph, asset] = await Promise.all([this.wikiGraph(id), this.requireAsset(id)]);
        const pages = new Map(
            this.pageEntries(asset, await this.loadKnowledgeContents(asset, 'wiki/')).map(page => [page.path, page]),
        );
        return {
            path: normalizedPath,
            backlinks: graph.edges
                .filter(edge => edge.target === normalizedPath)
                .map(edge => pages.get(edge.source))
                .filter((page): page is NonNullable<typeof page> => Boolean(page)),
        };
    }

    @Get(':id/wiki/similar')
    @ApiOkResponse({ summary: '使用本地 embedding 查找语义相关 Wiki 页面' })
    async wikiSimilar(@Param('id') id: string, @Query('path') path: string, @Query('limit') limit?: string) {
        return this.knowledge.findSimilarConcepts(id, path, this.searchLimit(limit));
    }

    @Get(':id/wiki/search')
    @ApiOkResponse({ summary: '搜索指定资产中的 OKF concept' })
    async wikiSearch(@Param('id') id: string, @Query('q') query: string, @Query('limit') limit?: string) {
        return this.knowledge.searchAsset(id, query, this.searchLimit(limit));
    }

    @Post(':id/wiki/evaluate')
    @ApiCreatedResponse({ summary: '运行知识库检索评测集' })
    async evaluateWikiSearch(
        @Param('id') id: string,
        @Body() body: { cases?: Array<{ query?: string; expectedPaths?: string[] }>; k?: number },
    ) {
        const cases = (Array.isArray(body.cases) ? body.cases : []).flatMap(item => {
            const query = item.query?.trim();
            const expectedPaths = Array.isArray(item.expectedPaths) ? item.expectedPaths.filter(Boolean) : [];
            return query && expectedPaths.length > 0 ? [{ query, expectedPaths }] : [];
        });
        if (cases.length === 0) throw new BadRequestException('evaluation cases are required');
        return this.knowledge.evaluateAsset(id, cases, body.k);
    }

    @Get(':id/wiki/concept')
    @ApiOkResponse({ summary: '读取指定 OKF concept' })
    async readWikiConcept(@Param('id') id: string, @Query('path') path: string) {
        return this.knowledge.readConcept(id, path);
    }

    @Get(':id/wiki/directory')
    @ApiOkResponse({ summary: '渐进式列出 OKF bundle 目录' })
    async listWikiDirectory(@Param('id') id: string, @Query('path') path?: string) {
        return this.knowledge.listDirectory(id, path);
    }

    @Get(':id/wiki/tags')
    @ApiOkResponse({ summary: '聚合 OKF concept 标签' })
    async wikiTags(@Param('id') id: string) {
        return this.knowledge.listTags(id);
    }

    @Patch(':id/wiki/pages')
    @ApiOkResponse({ summary: '保存资产 Wiki 页面' })
    async saveWikiPage(
        @Param('id') id: string,
        @Body() body: { path?: string; content?: string },
        @DesktopOwnerId() userId = 'system',
    ) {
        const path = this.requireBlobPath(body.path);
        const result = await this.assets.updateBlob(id, path, body.content ?? '', `Update ${path}`, 'main');
        await this.recordAudit(id, {
            action: 'page.save',
            target: path,
            actorId: userId,
            commitSha: result.commitSha,
        });
        return { saved: true, path };
    }

    @Delete(':id/wiki/pages')
    @ApiOkResponse({ summary: '删除资产 Wiki 页面' })
    async deleteWikiPage(
        @Param('id') id: string,
        @Query('path') path: string,
        @DesktopOwnerId() userId = 'system',
    ) {
        const normalizedPath = this.requireBlobPath(path);
        const result = await this.assets.deleteBlob(id, normalizedPath, `Delete ${normalizedPath}`, 'main');
        await this.recordAudit(id, {
            action: 'page.delete',
            target: normalizedPath,
            actorId: userId,
            commitSha: result.commitSha,
        });
        return { deleted: result.deleted, path: normalizedPath };
    }

    @Post(':id/wiki/pages/rename')
    @ApiCreatedResponse({ summary: '重命名资产 Wiki 页面' })
    async renameWikiPage(
        @Param('id') id: string,
        @Body() body: { fromPath?: string; toPath?: string },
        @DesktopOwnerId() userId = 'system',
    ) {
        const fromPath = this.requireBlobPath(body.fromPath);
        const toPath = this.requireBlobPath(body.toPath);
        const result = await this.assets.renameBlob(id, fromPath, toPath, `Rename ${fromPath} to ${toPath}`, 'main');
        await this.recordAudit(id, {
            action: 'page.rename',
            target: toPath,
            fromTarget: fromPath,
            actorId: userId,
            commitSha: result.commitSha,
        });
        return { renamed: true, fromPath, toPath };
    }

    @Get(':id/wiki/health')
    @ApiOkResponse({ summary: '获取资产 Wiki 健康状态' })
    async wikiHealth(@Param('id') id: string) {
        const asset = await this.requireAsset(id);
        const contents = await this.loadKnowledgeContents(asset, 'wiki/');
        const pages = this.pageEntries(asset, contents);
        const sources = this.sourceEntries(asset);
        const manifest = await this.ingestion.getManifest(asset.id);
        const analysis = this.wikiLinkAnalysis(pages, contents);
        return {
            pageCount: pages.length,
            sourceCount: sources.length,
            ingestedSourceCount: manifest.sources.filter(source => source.status === 'indexed').length,
            waitingForOcrCount: manifest.sources.filter(source => source.status === 'waiting_for_ocr').length,
            ingestionErrorCount: manifest.sources.filter(source => source.status === 'error').length,
            lastIngestedAt: manifest.generatedAt || null,
            taggedPageCount: pages.filter(page => page.tags.length > 0).length,
            brokenLinks: analysis.brokenLinks,
            orphanPages: pages
                .filter(page => !analysis.incomingPaths.has(page.path) && !this.isReservedWikiPage(page.path))
                .map(page => ({
                    path: page.path,
                    title: page.title,
                    type: page.type,
                })),
        };
    }

    @Get(':id/wiki/config')
    @ApiOkResponse({ summary: '获取知识库配置' })
    async wikiConfig(@Param('id') id: string) {
        const asset = await this.requireAsset(id);
        const knowledge = this.knowledgeMetadata(asset);
        const embedding = this.objectMetadataValue(knowledge.embedding);
        return {
            purpose: await this.assets.getBlobContent(id, 'purpose.md').catch(() => ''),
            schema: await this.assets.getBlobContent(id, 'schema.md').catch(() => ''),
            knowledgeType: this.stringMetadataValue(knowledge.knowledgeType) || null,
            embedding: {
                provider: this.stringMetadataValue(embedding.provider) || 'local',
                model: this.stringMetadataValue(embedding.model) || 'local-hash-v1',
                dimensions: this.numberMetadataValue(embedding.dimensions) || 192,
                keywordWeight: this.numberMetadataValue(embedding.keywordWeight) ?? 1,
                vectorWeight: this.numberMetadataValue(embedding.vectorWeight) ?? 6,
                mmrLambda: this.numberMetadataValue(embedding.mmrLambda) ?? 0.78,
            },
        };
    }

    @Put(':id/wiki/config')
    @ApiOkResponse({ summary: '更新知识库配置' })
    async updateWikiConfig(
        @Param('id') id: string,
        @Body()
        body: {
            purpose?: string;
            schema?: string;
            knowledgeType?: string;
            embedding?: {
                provider?: string;
                model?: string;
                dimensions?: number;
                keywordWeight?: number;
                vectorWeight?: number;
                mmrLambda?: number;
            };
        },
        @DesktopOwnerId() userId = 'system',
    ) {
        if (typeof body.purpose === 'string') {
            await this.assets.updateBlob(id, 'purpose.md', body.purpose, 'Update knowledge purpose', 'main');
        }
        if (typeof body.schema === 'string') {
            await this.assets.updateBlob(id, 'schema.md', body.schema, 'Update knowledge schema', 'main');
        }
        const asset = await this.requireAsset(id);
        const current = this.knowledgeMetadata(asset);
        const currentEmbedding = this.objectMetadataValue(current.embedding);
        const embedding = body.embedding
            ? {
                  ...currentEmbedding,
                  ...Object.fromEntries(
                      Object.entries(body.embedding).filter(([, value]) => value !== undefined && value !== ''),
                  ),
              }
            : currentEmbedding;
        const knowledge = {
            ...current,
            ...(typeof body.knowledgeType === 'string' ? { knowledgeType: body.knowledgeType.trim() } : {}),
            embedding,
        };
        await this.assets.updateAsset(id, { metadata: { knowledge } });
        await this.recordAudit(id, {
            action: 'config.update',
            target: 'knowledge',
            actorId: userId,
            metadata: {
                embeddingProvider: this.stringMetadataValue(embedding.provider) || 'local',
                embeddingModel: this.stringMetadataValue(embedding.model) || 'local-hash-v1',
            },
        });
        return this.wikiConfig(id);
    }

    @Post(':id/wiki/reindex')
    @ApiCreatedResponse({ summary: '重建资产 Wiki 索引' })
    async wikiReindex(@Param('id') id: string, @DesktopOwnerId() userId = 'system') {
        const asset = await this.requireAsset(id);
        const ingestion = await this.ingestion.reindex(asset.id);
        const refreshedAsset = (await this.assets.getAsset(id)) ?? asset;
        const contents = await this.loadKnowledgeContents(refreshedAsset, 'wiki/');
        const pages = this.pageEntries(refreshedAsset, contents);
        const analysis = this.wikiLinkAnalysis(pages, contents);
        const curation =
            this.knowledgeMetadata(refreshedAsset).autoCuration === false
                ? null
                : await this.refreshCurationSuggestions(id).catch(() => null);
        const result = {
            nodeCount: pages.length,
            linkCount: analysis.linkCount,
            brokenLinkCount: analysis.brokenLinks.length,
            ...ingestion,
            curationPendingCount: curation?.pendingCount ?? 0,
        };
        await this.recordAudit(id, {
            action: 'ingest.complete',
            actorId: userId,
            metadata: { sourceCount: ingestion.sourceCount, chunkCount: ingestion.chunkCount, synchronous: true },
        });
        return result;
    }

    @Post(':id/wiki/storage/migrate')
    @ApiCreatedResponse({ summary: '迁移旧知识库 metadata 正文到资产存储' })
    async migrateWikiStorage(@Param('id') id: string, @DesktopOwnerId() userId = 'system') {
        const result = await this.assets.migrateKnowledgeStorage(id);
        await this.recordAudit(id, {
            action: 'storage.migrate',
            target: 'knowledge',
            actorId: userId,
            metadata: result,
        });
        return result;
    }

    @Get(':id/wiki/curation')
    @ApiOkResponse({ summary: '获取知识库策展审阅状态' })
    async wikiCurationStatus(@Param('id') id: string) {
        const asset = await this.requireAsset(id);
        const suggestions = this.curationSuggestions(asset);
        const knowledge = this.knowledgeMetadata(asset);
        return {
            assetId: asset.id,
            personal: knowledge.personal === true,
            curationStatus: suggestions.some(item => item.status === 'pending') ? 'awaiting_review' : 'ready',
            pendingCount: suggestions.filter(item => item.status === 'pending').length,
            processedCount: suggestions.filter(item => item.status !== 'pending').length,
            lastCurationAt: this.stringMetadataValue(knowledge.lastCurationAt) || null,
            autoCuration: knowledge.autoCuration !== false,
            engineEnabled: true,
        };
    }

    @Put(':id/wiki/curation/config')
    @ApiOkResponse({ summary: '更新知识库自动策展建议开关' })
    async updateWikiCurationConfig(
        @Param('id') id: string,
        @Body() body: { autoCuration?: boolean },
        @DesktopOwnerId() userId = 'system',
    ) {
        const asset = await this.requireAsset(id);
        const knowledge = { ...this.knowledgeMetadata(asset), autoCuration: body.autoCuration === true };
        await this.assets.updateAsset(id, { metadata: { knowledge } });
        await this.recordAudit(id, {
            action: 'config.update',
            target: 'curation.autoCuration',
            actorId: userId,
            metadata: { autoCuration: knowledge.autoCuration },
        });
        return { assetId: id, autoCuration: knowledge.autoCuration };
    }

    @Get(':id/wiki/curation/suggestions')
    @ApiOkResponse({ summary: '列出待审阅的知识库建链建议' })
    async listCurationSuggestions(@Param('id') id: string) {
        const asset = await this.requireAsset(id);
        return { assetId: id, suggestions: this.curationSuggestions(asset) };
    }

    @Post(':id/wiki/curation/suggestions/refresh')
    @ApiCreatedResponse({ summary: '根据本地语义相似度刷新建链建议' })
    async refreshCurationSuggestions(@Param('id') id: string) {
        return this.runCurationSerially(id, () => this.refreshCurationSuggestionsUnlocked(id));
    }

    private async refreshCurationSuggestionsUnlocked(id: string) {
        const asset = await this.requireAsset(id);
        const existing = new Map(this.curationSuggestions(asset).map(item => [item.id, item]));
        const graph = await this.wikiGraph(id);
        const linked = new Set(graph.edges.flatMap(edge => [`${edge.source}|${edge.target}`, `${edge.target}|${edge.source}`]));
        const suggestions: KnowledgeCurationSuggestion[] = [];
        const now = new Date().toISOString();
        const contents = await this.loadKnowledgeContents(asset, 'wiki/');
        const allPages = this.pageEntries(asset, contents).filter(
            page => !this.isReservedWikiPage(page.path),
        );
        const pages = allPages.filter(page => !this.isManagedCurationPage(page));
        const pagesByPath = new Map(pages.map(page => [page.path, page]));
        const pagePaths = new Set(pages.map(page => page.path));
        for (const page of pages) {
            const similar = await this.knowledge.findSimilarConcepts(id, page.path, 4).catch(() => ({ hits: [] }));
            for (const hit of similar.hits) {
                if (!pagePaths.has(hit.path) || hit.path === page.path || linked.has(`${page.path}|${hit.path}`) || hit.similarity < 0.16) continue;
                const [sourcePath, targetPath] = [page.path, hit.path].sort();
                const suggestionId = createHash('sha1').update(`${sourcePath}|${targetPath}`).digest('hex');
                if (suggestions.some(item => item.id === suggestionId)) continue;
                const previous = this.refreshableCurationSuggestion(existing.get(suggestionId));
                suggestions.push({
                    ...previous,
                    id: suggestionId,
                    kind: 'link',
                    status: previous?.status ?? 'pending',
                    sourcePath,
                    targetPath,
                    targetTitle: pagesByPath.get(targetPath)?.title ?? hit.title,
                    reason: `本地语义相似度 ${(hit.similarity * 100).toFixed(0)}%`,
                    similarity: hit.similarity,
                    createdAt: previous?.createdAt ?? now,
                    reviewedAt: previous?.reviewedAt,
                    reviewedBy: previous?.reviewedBy,
                });
                if (suggestions.length >= 30) break;
            }
            if (suggestions.length >= 30) break;
        }

        for (const page of pages.slice(0, 20)) {
            const content = contents[page.path] ?? '';
            const summary = this.extractiveSummary(content.replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, ''));
            if (!summary || /(^|\n)## Summary\s*(\n|$)/i.test(content)) continue;
            const suggestionId = createHash('sha1').update(`summary:${page.path}:${summary}`).digest('hex');
            const previous = this.refreshableCurationSuggestion(existing.get(suggestionId));
            suggestions.push({
                ...previous,
                id: suggestionId,
                kind: 'summary',
                status: previous?.status ?? 'pending',
                sourcePath: page.path,
                targetPath: page.path,
                targetTitle: page.title,
                reason: '根据页面正文生成可审阅摘要',
                similarity: 1,
                proposedContent: `\n\n## Summary\n\n${summary}\n`,
                citations: [page.path],
                createdAt: previous?.createdAt ?? now,
            });
        }

        const manifest = await this.ingestion.getManifest(id);
        const allPagePaths = new Set(allPages.map(page => page.path));
        for (const source of manifest.sources.filter(item => item.status === 'indexed').slice(0, 20)) {
            const chunks = await this.ingestion.readChunks(id, source);
            const excerpt = chunks[0]?.text.trim();
            if (!excerpt) continue;
            const targetPath = `wiki/generated/${this.slugFromSource(source.path)}.md`;
            if (allPagePaths.has(targetPath)) continue;
            const title = this.titleFromSourcePath(source.path);
            const summary = this.extractiveSummary(excerpt);
            const suggestionId = createHash('sha1').update(`page:${source.path}:${source.sha}`).digest('hex');
            const previous = this.refreshableCurationSuggestion(existing.get(suggestionId));
            suggestions.push({
                ...previous,
                id: suggestionId,
                kind: 'page',
                status: previous?.status ?? 'pending',
                sourcePath: source.path,
                targetPath,
                targetTitle: title,
                reason: '根据已索引来源生成 OKF 页面草稿',
                similarity: 1,
                citations: [`asset://${id}/${source.path}`],
                proposedContent: [
                    '---',
                    'type: Draft',
                    `title: ${JSON.stringify(title)}`,
                    `description: ${JSON.stringify(summary)}`,
                    `resource: ${JSON.stringify(`asset://${id}/${source.path}`)}`,
                    'tags: [generated, review-required]',
                    '---',
                    '',
                    '# Summary',
                    '',
                    summary,
                    '',
                    '# Source excerpt',
                    '',
                    excerpt.slice(0, 2_000),
                    '',
                ].join('\n'),
                createdAt: previous?.createdAt ?? now,
            });
        }

        for (const link of suggestions.filter(item => item.kind === 'link' && item.similarity >= 0.55).slice(0, 10)) {
            const targetPath = `wiki/drafts/merge-${link.id.slice(0, 10)}.md`;
            const suggestionId = createHash('sha1').update(`merge:${link.id}`).digest('hex');
            const previous = this.refreshableCurationSuggestion(existing.get(suggestionId));
            suggestions.push({
                ...previous,
                id: suggestionId,
                kind: 'merge',
                status: previous?.status ?? 'pending',
                sourcePath: link.sourcePath,
                targetPath,
                targetTitle: `Merge review: ${link.targetTitle}`,
                reason: `两个概念语义相似度 ${(link.similarity * 100).toFixed(0)}%，生成合并审阅草稿`,
                similarity: link.similarity,
                citations: [link.sourcePath, link.targetPath],
                proposedContent: [
                    '---',
                    'type: Draft',
                    `title: ${JSON.stringify(`Merge review: ${link.targetTitle}`)}`,
                    'tags: [merge-proposal, review-required]',
                    '---',
                    '',
                    '# Candidate concepts',
                    '',
                    `- [${this.titleFromPath(link.sourcePath)}](/${link.sourcePath.replace(/^wiki\//, '')})`,
                    `- [${link.targetTitle}](/${link.targetPath.replace(/^wiki\//, '')})`,
                    '',
                    '# Review',
                    '',
                    'Compare the cited concepts before consolidating them. Accepting this proposal creates only this draft and never deletes either source page.',
                    '',
                ].join('\n'),
                createdAt: previous?.createdAt ?? now,
            });
        }
        for (const previous of existing.values()) {
            if (
                previous.status !== 'pending' &&
                previous.status !== 'reverted' &&
                !suggestions.some(item => item.id === previous.id)
            ) {
                suggestions.push(previous);
            }
        }
        const knowledge = { ...this.knowledgeMetadata(asset), lastCurationAt: now };
        const retainedSuggestions = suggestions.slice(0, 100);
        await this.assets.updateAsset(id, { metadata: { knowledgeCurationSuggestions: retainedSuggestions, knowledge } });
        return {
            assetId: id,
            pendingCount: retainedSuggestions.filter(item => item.status === 'pending').length,
            suggestions: retainedSuggestions,
        };
    }

    @Post(':id/wiki/curation/suggestions/:suggestionId/review')
    @ApiCreatedResponse({ summary: '接受或拒绝一条知识库建链建议' })
    async reviewCurationSuggestion(
        @Param('id') id: string,
        @Param('suggestionId') suggestionId: string,
        @DesktopOwnerId() userId: string,
        @Body() body: { decision?: 'accept' | 'reject' | 'revert' },
    ) {
        return this.runCurationSerially(id, () => this.reviewCurationSuggestionUnlocked(id, suggestionId, userId, body));
    }

    private async reviewCurationSuggestionUnlocked(
        id: string,
        suggestionId: string,
        userId: string,
        body: { decision?: 'accept' | 'reject' | 'revert' },
    ) {
        if (body.decision !== 'accept' && body.decision !== 'reject' && body.decision !== 'revert') {
            throw new BadRequestException('审核操作必须是接受、拒绝或撤销');
        }
        const asset = await this.requireAsset(id);
        const suggestions = this.curationSuggestions(asset);
        const suggestion = suggestions.find(item => item.id === suggestionId);
        if (!suggestion) throw new NotFoundException('策展建议不存在');

        if (body.decision === 'revert') {
            if (suggestion.status !== 'accepted') throw new BadRequestException('只能撤销已接受的策展建议');
            if (suggestion.appliedMode === 'create') {
                const content = await this.assets.getBlobContent(id, suggestion.targetPath);
                const currentSha = createHash('sha1').update(content).digest('hex');
                if (suggestion.appliedContentSha !== currentSha) {
                    throw new ConflictException('页面在接受建议后已发生变化，请先撤销依赖该页面的后续建议或检查差异');
                }
                const reverted = await this.assets.deleteBlob(
                    id,
                    suggestion.targetPath,
                    `Revert knowledge suggestion ${suggestion.id}`,
                    'main',
                );
                suggestion.commitSha = reverted.commitSha;
            } else if (suggestion.appliedText) {
                const content = await this.assets.getBlobContent(id, suggestion.sourcePath);
                const currentSha = createHash('sha1').update(content).digest('hex');
                if (suggestion.appliedContentSha && suggestion.appliedContentSha !== currentSha) {
                    throw new ConflictException('页面在接受建议后已发生变化，撤销会覆盖后续编辑，请先检查页面差异');
                }
                const firstMatch = content.indexOf(suggestion.appliedText);
                const secondMatch = firstMatch < 0 ? -1 : content.indexOf(suggestion.appliedText, firstMatch + suggestion.appliedText.length);
                if (firstMatch < 0 || secondMatch >= 0) {
                    throw new ConflictException('无法唯一定位该建议添加的内容，请检查页面差异后再撤销');
                }
                const reverted = await this.assets.updateBlob(
                    id,
                    suggestion.sourcePath,
                    `${content.slice(0, firstMatch)}${content.slice(firstMatch + suggestion.appliedText.length)}`,
                    `Revert knowledge suggestion ${suggestion.id}`,
                    'main',
                );
                suggestion.commitSha = reverted.commitSha;
            }
            suggestion.status = 'reverted';
            suggestion.reviewedAt = new Date().toISOString();
            suggestion.reviewedBy = userId;
            await this.assets.updateAsset(id, { metadata: { knowledgeCurationSuggestions: suggestions } });
            await this.recordAudit(id, {
                action: 'curation.reverted',
                target: suggestion.targetPath,
                fromTarget: suggestion.sourcePath,
                actorId: userId,
                commitSha: suggestion.commitSha,
                metadata: { suggestionId: suggestion.id },
            });
            return suggestion;
        }

        if (suggestion.status !== 'pending') throw new BadRequestException('该策展建议已审核');

        if (body.decision === 'accept') {
            if (suggestion.kind === 'link' || suggestion.kind === 'summary') {
                const content = await this.assets.getBlobContent(id, suggestion.sourcePath);
                const target = `/${suggestion.targetPath.replace(/^wiki\//, '')}`;
                const appliedText =
                    suggestion.kind === 'link'
                        ? content.includes(`](${target})`)
                            ? ''
                            : `\n\n## Related\n\n- [${suggestion.targetTitle}](${target})\n`
                        : suggestion.proposedContent || '';
                if (appliedText) {
                const nextContent = `${content}${appliedText}`;
                const result = await this.assets.updateBlob(
                    id,
                    suggestion.sourcePath,
                    nextContent,
                    `Accept knowledge link suggestion ${suggestion.id}`,
                    'main',
                );
                suggestion.appliedText = appliedText;
                suggestion.appliedMode = 'append';
                suggestion.appliedContentSha = createHash('sha1').update(nextContent).digest('hex');
                suggestion.commitSha = result.commitSha;
                }
            } else {
                if (!suggestion.proposedContent) throw new BadRequestException('策展建议没有可应用的内容');
                const existingContent = await this.assets.getBlobContent(id, suggestion.targetPath).catch(() => null);
                if (existingContent !== null) throw new ConflictException('策展建议的目标页面已存在');
                const result = await this.assets.updateBlob(
                    id,
                    suggestion.targetPath,
                    suggestion.proposedContent,
                    `Accept knowledge ${suggestion.kind} proposal ${suggestion.id}`,
                    'main',
                );
                suggestion.appliedMode = 'create';
                suggestion.appliedContentSha = createHash('sha1').update(suggestion.proposedContent).digest('hex');
                suggestion.commitSha = result.commitSha;
            }
        }
        suggestion.status = body.decision === 'accept' ? 'accepted' : 'rejected';
        suggestion.reviewedAt = new Date().toISOString();
        suggestion.reviewedBy = userId;
        const audit = [
            {
                id: createHash('sha1').update(`${suggestion.id}:${suggestion.reviewedAt}`).digest('hex'),
                action: `curation.${suggestion.status}`,
                target: suggestion.targetPath,
                fromTarget: suggestion.sourcePath,
                actorId: userId,
                at: suggestion.reviewedAt,
            },
            ...this.curationAudit(asset),
        ].slice(0, 200);
        await this.assets.updateAsset(id, { metadata: { knowledgeCurationSuggestions: suggestions, knowledgeCurationAudit: audit } });
        await this.recordAudit(id, {
            action: `curation.${suggestion.status}`,
            target: suggestion.targetPath,
            fromTarget: suggestion.sourcePath,
            actorId: userId,
            commitSha: suggestion.commitSha,
            metadata: { suggestionId: suggestion.id },
        });
        return suggestion;
    }

    @Get(':id/wiki/audit-log')
    @ApiOkResponse({ summary: '获取统一知识库审计流' })
    async wikiAuditLog(@Param('id') id: string, @Query('limit') limit?: string) {
        if (this.audit) return this.audit.list(id, this.searchLimit(limit));
        const asset = await this.requireAsset(id);
        return this.curationAudit(asset).slice(0, this.searchLimit(limit));
    }

    @Get(':id/wiki/okf/validate')
    @ApiOkResponse({ summary: '校验知识库的 OKF v0.1 兼容性' })
    async validateOkf(@Param('id') id: string) {
        const asset = await this.requireAsset(id);
        return validateOkfBundle(this.okfFiles(asset, await this.loadKnowledgeContents(asset, 'wiki/')));
    }

    @Post(':id/wiki/okf/import')
    @ApiCreatedResponse({ summary: '导入 OKF v0.1 bundle' })
    async importOkf(
        @Param('id') id: string,
        @Body() body: ImportOkfBody,
        @DesktopOwnerId() userId = 'system',
    ) {
        const asset = await this.requireAsset(id);
        const files = body.archiveBase64
            ? await this.readOkfZip(body.archiveBase64)
            : this.readOkfFileInput(body.files ?? []);
        const validation = validateOkfBundle(files);
        if (!validation.valid) {
            const firstError = validation.diagnostics.find(item => item.severity === 'error');
            throw new BadRequestException(firstError?.message || 'OKF bundle 校验失败');
        }

        const existing = this.okfFiles(asset, await this.loadKnowledgeContents(asset, 'wiki/'));
        if (body.overwrite !== true) {
            const conflicts = Object.keys(files).filter(path => existing[path] !== undefined);
            if (conflicts.length > 0) {
                throw new BadRequestException(`OKF 文档已存在：${conflicts.slice(0, 3).join('、')}`);
            }
        }

        for (const [path, content] of Object.entries(files)) {
            await this.assets.updateBlob(id, `wiki/${path}`, content, `Import OKF ${path}`, 'main');
        }
        await this.recordAudit(id, {
            action: 'okf.import',
            target: 'wiki/',
            actorId: userId,
            metadata: { documentCount: Object.keys(files).length, overwrite: body.overwrite === true },
        });
        return {
            imported: Object.keys(files).length,
            paths: Object.keys(files).map(path => `wiki/${path}`),
            validation,
        };
    }

    @Get(':id/wiki/okf/export')
    @ApiOkResponse({ summary: '导出 OKF v0.1 ZIP bundle' })
    async exportOkf(@Param('id') id: string) {
        const asset = await this.requireAsset(id);
        const files = this.okfFiles(asset, await this.loadKnowledgeContents(asset, 'wiki/'));
        const validation = validateOkfBundle(files);
        if (Object.keys(files).length === 0) {
            throw new BadRequestException('知识库中没有可导出的 OKF 文档');
        }
        const archive = new JSZip();
        for (const [path, content] of Object.entries(files)) archive.file(path, content);
        return {
            filename: `${asset.name || 'knowledge'}.okf.zip`,
            contentBase64: await archive.generateAsync({ type: 'base64', compression: 'DEFLATE' }),
            validation,
        };
    }

    private async requireAsset(id: string): Promise<Asset> {
        const asset = await this.assets.getAsset(id);
        if (!asset) {
            throw new NotFoundException('Asset not found');
        }
        return asset;
    }

    private requireIngestJobs(): KnowledgeIngestJobService {
        if (!this.ingestJobs) throw new BadRequestException('Knowledge ingest jobs are unavailable');
        return this.ingestJobs;
    }

    private async recordAudit(
        assetId: string,
        entry: Parameters<KnowledgeAuditService['append']>[1],
    ): Promise<void> {
        await this.audit?.append(assetId, entry);
    }

    private assetDto(asset: Asset) {
        return asset.toProps();
    }

    private repositoryRefs(asset: Asset) {
        const branch = asset.defaultBranch || 'main';
        const head = asset.branches.find(item => item.name === branch)?.commitSha || asset.commits[0]?.sha || 'HEAD';
        return [{ name: branch, type: 'branch' as const, sha: head }];
    }

    private treeItems(asset: Asset, dirPath: string): RepositoryTreeItem[] {
        const normalizedDir = this.normalizeBlobPath(dirPath);
        const prefix = normalizedDir ? `${normalizedDir}/` : '';
        const directories = new Map<string, RepositoryTreeItem>();
        const files = new Map<string, RepositoryTreeItem>();

        for (const blob of this.contentBlobs(asset)) {
            if (prefix && !blob.path.startsWith(prefix)) continue;
            const rest = prefix ? blob.path.slice(prefix.length) : blob.path;
            if (!rest || rest.startsWith('/')) continue;
            const [head] = rest.split('/');
            if (!head) continue;
            const childPath = prefix ? `${prefix}${head}` : head;
            if (rest.includes('/')) {
                directories.set(childPath, {
                    path: childPath,
                    name: head,
                    type: 'tree',
                    mode: '040000',
                    sha: this.shaForText(`tree:${childPath}`),
                    size: null,
                });
            } else {
                files.set(childPath, {
                    path: childPath,
                    name: head,
                    type: 'blob',
                    mode: '100644',
                    sha: blob.contentSha || blob.id || this.shaForText(blob.path),
                    size: typeof blob.size === 'number' ? blob.size : null,
                    isBinary: blob.isBinary,
                });
            }
        }

        return [...directories.values(), ...files.values()].sort((left, right) => {
            if (left.type !== right.type) return left.type === 'tree' ? -1 : 1;
            return left.name.localeCompare(right.name, 'zh-CN');
        });
    }

    private contentBlobs(asset: Asset): Array<Pick<Blob, 'id' | 'path' | 'size' | 'contentSha' | 'isBinary'>> {
        const contents = this.blobContents(asset);
        const byPath = new Map<string, Pick<Blob, 'id' | 'path' | 'size' | 'contentSha' | 'isBinary'>>();
        for (const blob of asset.blobs ?? []) {
            byPath.set(blob.path, blob);
        }
        for (const [path, content] of Object.entries(contents)) {
            const previous = byPath.get(path);
            byPath.set(path, {
                id: previous?.id || this.shaForText(content),
                path,
                size: previous?.size ?? Buffer.byteLength(content, 'utf8'),
                contentSha: previous?.contentSha || this.shaForText(content),
                isBinary: previous?.isBinary ?? false,
            });
        }
        return Array.from(byPath.values());
    }

    private blobContents(asset: Asset): Record<string, string> {
        const contents = asset.metadata?.blobContents;
        return contents && typeof contents === 'object' && !Array.isArray(contents)
            ? (contents as Record<string, string>)
            : {};
    }

    private async loadKnowledgeContents(asset: Asset, prefix: string): Promise<Record<string, string>> {
        const cached = this.blobContents(asset);
        const paths = new Set([
            ...Object.keys(cached).filter(path => path.startsWith(prefix)),
            ...(asset.blobs ?? [])
                .filter(blob => !blob.isBinary && blob.path.startsWith(prefix))
                .map(blob => blob.path),
        ]);
        const pairs = await Promise.all(
            Array.from(paths).map(async path => {
                const content = cached[path] ?? (await this.assets.getBlobContent(asset.id, path).catch(() => null));
                return content === null ? null : ([path, content] as const);
            }),
        );
        return Object.fromEntries(pairs.filter((pair): pair is readonly [string, string] => pair !== null));
    }

    private pageEntries(asset: Asset, contents = this.blobContents(asset)) {
        return Object.entries(contents)
            .filter(([path]) => path.startsWith('wiki/') && path.toLowerCase().endsWith('.md'))
            .map(([path, content]) => {
                const frontmatter = this.readFrontmatter(content);
                return {
                    path,
                    title: frontmatter.title || this.titleFromPath(path),
                    type: this.wikiPageType(frontmatter.type),
                    sources: frontmatter.sources ?? [],
                    tags: frontmatter.tags ?? [],
                };
            })
            .sort((left, right) => left.title.localeCompare(right.title, 'zh-CN'));
    }

    private sourceEntries(asset: Asset) {
        const contents = this.blobContents(asset);
        const blobsByPath = new Map((asset.blobs ?? []).map(blob => [blob.path, blob]));
        const paths = new Set([
            ...Object.keys(contents).filter(path => path.startsWith('raw/sources/')),
            ...(asset.blobs ?? []).map(blob => blob.path).filter(path => path.startsWith('raw/sources/')),
        ]);
        return Array.from(paths)
            .map(path => ({
                path,
                name: path.split('/').pop() || path,
                size: blobsByPath.get(path)?.size ?? Buffer.byteLength(contents[path] ?? '', 'utf8'),
            }))
            .sort((left, right) => left.name.localeCompare(right.name, 'zh-CN'));
    }

    private knowledgeMetadata(asset: Asset): Record<string, unknown> {
        const knowledge = asset.metadata?.knowledge;
        return knowledge && typeof knowledge === 'object' && !Array.isArray(knowledge)
            ? (knowledge as Record<string, unknown>)
            : {};
    }

    private curationSuggestions(asset: Asset): KnowledgeCurationSuggestion[] {
        const suggestions = asset.metadata?.knowledgeCurationSuggestions;
        return Array.isArray(suggestions)
            ? suggestions.filter(
                  (item): item is KnowledgeCurationSuggestion =>
                      Boolean(item) && typeof item === 'object' && typeof (item as { id?: unknown }).id === 'string',
              )
            : [];
    }

    private refreshableCurationSuggestion(
        previous: KnowledgeCurationSuggestion | undefined,
    ): KnowledgeCurationSuggestion | undefined {
        if (!previous || previous.status !== 'reverted') return previous;
        const {
            appliedText: _appliedText,
            appliedContentSha: _appliedContentSha,
            appliedMode: _appliedMode,
            commitSha: _commitSha,
            reviewedAt: _reviewedAt,
            reviewedBy: _reviewedBy,
            ...rest
        } = previous;
        return { ...rest, status: 'pending' };
    }

    private curationAudit(asset: Asset): Array<Record<string, unknown>> {
        const audit = asset.metadata?.knowledgeCurationAudit;
        return Array.isArray(audit) ? (audit as Array<Record<string, unknown>>) : [];
    }

    private stringMetadataValue(value: unknown): string {
        return typeof value === 'string' ? value : '';
    }

    private numberMetadataValue(value: unknown): number | undefined {
        return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
    }

    private objectMetadataValue(value: unknown): Record<string, unknown> {
        return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
    }

    private wikiLinkAnalysis(
        pages: ReturnType<DesktopAssetsController['pageEntries']>,
        contents: Record<string, string>,
    ) {
        const byAlias = new Map<string, string>();
        for (const page of pages) {
            byAlias.set(page.title.toLowerCase(), page.path);
            byAlias.set(this.titleFromPath(page.path).toLowerCase(), page.path);
            byAlias.set(page.path.toLowerCase(), page.path);
        }

        const incomingPaths = new Set<string>();
        const brokenLinks: Array<{ srcPath: string; srcTitle: string; target: string }> = [];
        let linkCount = 0;
        for (const page of pages) {
            for (const targetAlias of this.knowledgeLinkTargets(page.path, contents[page.path] ?? '')) {
                const targetPath = byAlias.get(targetAlias.toLowerCase());
                if (targetPath) {
                    if (targetPath !== page.path) incomingPaths.add(targetPath);
                    linkCount += 1;
                } else {
                    brokenLinks.push({
                        srcPath: page.path,
                        srcTitle: page.title,
                        target: targetAlias,
                    });
                }
            }
        }
        return { incomingPaths, brokenLinks, linkCount };
    }

    private isReservedWikiPage(path: string): boolean {
        const normalized = path.toLowerCase();
        return (
            normalized === 'wiki/index.md' ||
            normalized === 'wiki/log.md' ||
            normalized === 'wiki/overview.md' ||
            normalized === 'wiki/purpose.md' ||
            normalized === 'wiki/schema.md'
        );
    }

    private isManagedCurationPage(page: ReturnType<DesktopAssetsController['pageEntries']>[number]): boolean {
        const normalizedPath = page.path.toLowerCase();
        if (normalizedPath.startsWith('wiki/generated/') || normalizedPath.startsWith('wiki/drafts/')) return true;
        const tags = new Set(page.tags.map(tag => tag.toLowerCase()));
        return tags.has('generated') || tags.has('review-required') || tags.has('merge-proposal');
    }

    private runCurationSerially<T>(assetId: string, operation: () => Promise<T>): Promise<T> {
        const previous = this.curationQueues.get(assetId) ?? Promise.resolve();
        const result = previous.catch(() => undefined).then(operation);
        const settled = result.then(
            () => undefined,
            () => undefined,
        );
        this.curationQueues.set(assetId, settled);
        return result.finally(() => {
            if (this.curationQueues.get(assetId) === settled) this.curationQueues.delete(assetId);
        });
    }

    private readFrontmatter(content: string): { title?: string; type?: string; tags?: string[]; sources?: string[] } {
        const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(content);
        if (!match) return {};
        const result: { title?: string; type?: string; tags?: string[]; sources?: string[] } = {};
        for (const line of match[1].split(/\r?\n/)) {
            const separator = line.indexOf(':');
            if (separator <= 0) continue;
            const key = line.slice(0, separator).trim();
            const value = line.slice(separator + 1).trim();
            if (key === 'title') result.title = value.replace(/^['"]|['"]$/g, '');
            if (key === 'type') result.type = value.replace(/^['"]|['"]$/g, '');
            if (key === 'tags') {
                result.tags = value
                    .replace(/^\[|\]$/g, '')
                    .split(',')
                    .map(item => item.trim().replace(/^['"]|['"]$/g, ''))
                    .filter(Boolean);
            }
            if (key === 'sources') {
                result.sources = value
                    .replace(/^\[|\]$/g, '')
                    .split(',')
                    .map(item => item.trim().replace(/^['"]|['"]$/g, ''))
                    .filter(Boolean);
            }
        }
        return result;
    }

    private wikilinks(content: string): string[] {
        const links: string[] = [];
        const pattern = /\[\[([^\]\n|#]+)(?:[|#][^\]\n]+)?\]\]/g;
        let match: RegExpExecArray | null;
        while ((match = pattern.exec(content)) !== null) {
            const target = match[1]?.trim();
            if (target) links.push(target);
        }
        return links;
    }

    private knowledgeLinkTargets(sourcePath: string, content: string): string[] {
        const targets = this.wikilinks(content);
        const bundlePath = sourcePath.replace(/^wiki\//i, '');
        for (const link of extractOkfLinks(bundlePath, content)) {
            if (link.resolvedPath) targets.push(`wiki/${link.resolvedPath}`);
        }
        return targets;
    }

    private okfFiles(asset: Asset, contents = this.blobContents(asset)): Record<string, string> {
        return Object.fromEntries(
            Object.entries(contents)
                .filter(([path]) => path.startsWith('wiki/') && path.toLowerCase().endsWith('.md'))
                .map(([path, content]) => [path.slice('wiki/'.length), content]),
        );
    }

    private readOkfFileInput(files: Array<{ path?: string; content?: string }>): Record<string, string> {
        return this.assertOkfImportLimits(
            Object.fromEntries(
                files.map(file => {
                    const path = normalizeOkfPath(file.path ?? '');
                    if (!path || !path.toLowerCase().endsWith('.md')) {
                        throw new BadRequestException(`非法 OKF 文档路径：${file.path || '(empty)'}`);
                    }
                    return [path, file.content ?? ''];
                }),
            ),
        );
    }

    private async readOkfZip(archiveBase64: string): Promise<Record<string, string>> {
        let archive: JSZip;
        try {
            archive = await JSZip.loadAsync(Buffer.from(archiveBase64, 'base64'));
        } catch {
            throw new BadRequestException('OKF ZIP 无法解析');
        }
        const entries = Object.values(archive.files).filter(entry => !entry.dir);
        const markdownEntries = entries.filter(entry => entry.name.toLowerCase().endsWith('.md'));
        const commonRoot = this.singleArchiveRoot(markdownEntries.map(entry => entry.name));
        const pairs = await Promise.all(
            markdownEntries.map(async entry => {
                const rawPath = commonRoot ? entry.name.slice(commonRoot.length + 1) : entry.name;
                const path = normalizeOkfPath(rawPath);
                if (!path || !path.toLowerCase().endsWith('.md')) {
                    throw new BadRequestException(`非法 OKF ZIP 路径：${entry.name}`);
                }
                return [path, await entry.async('string')] as const;
            }),
        );
        return this.assertOkfImportLimits(Object.fromEntries(pairs));
    }

    private assertOkfImportLimits(files: Record<string, string>): Record<string, string> {
        const entries = Object.entries(files);
        if (entries.length > MAX_OKF_IMPORT_FILES) {
            throw new BadRequestException(`OKF 文档数量不能超过 ${MAX_OKF_IMPORT_FILES}`);
        }
        const bytes = entries.reduce((sum, [, content]) => sum + Buffer.byteLength(content, 'utf8'), 0);
        if (bytes > MAX_OKF_IMPORT_BYTES) {
            throw new BadRequestException(`OKF 解压后不能超过 ${MAX_OKF_IMPORT_BYTES / 1024 / 1024} MB`);
        }
        return files;
    }

    private singleArchiveRoot(paths: string[]): string | null {
        if (paths.length === 0) return null;
        const roots = new Set(paths.map(path => path.replace(/\\/g, '/').split('/')[0]).filter(Boolean));
        if (roots.size !== 1 || paths.some(path => !path.replace(/\\/g, '/').includes('/'))) return null;
        return Array.from(roots)[0];
    }

    private wikiPageType(value?: string): WikiPageType | null {
        return value?.trim() || null;
    }

    private titleFromPath(path: string): string {
        const name = path.split('/').pop() || path;
        return name.replace(/\.[^.]+$/, '') || name;
    }

    private titleFromSourcePath(path: string): string {
        return decodeURIComponent(path.split('/').pop() || path).replace(/[-_]+/g, ' ');
    }

    private slugFromSource(path: string): string {
        const stem = (path.split('/').pop() || path).replace(/\.[^.]+$/, '');
        const slug = stem
            .normalize('NFKD')
            .replace(/[^a-z0-9\u4e00-\u9fff]+/gi, '-')
            .replace(/^-+|-+$/g, '')
            .toLowerCase();
        return slug || createHash('sha1').update(path).digest('hex').slice(0, 12);
    }

    private extractiveSummary(value: string): string {
        const compact = value.replace(/```[\s\S]*?```/g, ' ').replace(/\s+/g, ' ').trim();
        if (compact.length < 40) return '';
        const sentences = compact.split(/(?<=[。！？.!?])\s+/).filter(Boolean);
        return (sentences.slice(0, 3).join(' ') || compact).slice(0, 420);
    }

    private graphCommunities(paths: string[], edges: Array<{ source: string; target: string }>): Map<string, number> {
        const adjacency = new Map(paths.map(path => [path, new Set<string>()]));
        for (const edge of edges) {
            adjacency.get(edge.source)?.add(edge.target);
            adjacency.get(edge.target)?.add(edge.source);
        }
        const communities = new Map<string, number>();
        let community = 0;
        for (const path of paths) {
            if (communities.has(path)) continue;
            const queue = [path];
            communities.set(path, community);
            while (queue.length > 0) {
                const current = queue.shift();
                if (!current) continue;
                for (const neighbor of adjacency.get(current) ?? []) {
                    if (communities.has(neighbor)) continue;
                    communities.set(neighbor, community);
                    queue.push(neighbor);
                }
            }
            community += 1;
        }
        return communities;
    }

    private requireBlobPath(value: string | undefined): string {
        const normalized = this.normalizeBlobPath(value);
        if (!normalized) {
            throw new BadRequestException('path is required');
        }
        return normalized;
    }

    private searchLimit(value?: string): number {
        return Math.max(1, Math.min(50, Number(value) || 8));
    }

    private normalizeBlobPath(value: string | undefined): string {
        return (value ?? '')
            .replace(/\\/g, '/')
            .split('/')
            .map(segment => segment.trim())
            .filter(segment => segment && segment !== '.' && segment !== '..')
            .join('/');
    }

    private safeSourceName(value: string | undefined): string {
        const name = (value ?? '').replace(/\\/g, '/').split('/').pop()?.trim();
        if (!name || name === '.' || name === '..') {
            throw new BadRequestException('source name is required');
        }
        return name.replace(/[<>:"|?*\x00-\x1F]/g, '-');
    }

    private shaForText(value: string): string {
        return createHash('sha1').update(value).digest('hex');
    }
}
