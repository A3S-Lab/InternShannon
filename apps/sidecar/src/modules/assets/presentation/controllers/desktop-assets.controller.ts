import { Body, Controller, Delete, Get, Inject, Param, Patch, Post, Put, Query } from "@nestjs/common";
import { createHash } from "node:crypto";
import { isAbsolute } from "node:path";
import { DesktopOwnerId } from "@/shared/security/decorators/desktop-owner.decorator";
import { DesktopApi } from "@/shared/security/desktop-access";
import { BadRequestException, NotFoundException } from "@/shared/common/errors";
import { ApiCreatedResponse, ApiOkResponse } from "@/shared/api/openapi";
import { ASSET_SERVICE, type IAssetService } from "@/modules/assets/domain/services/asset.service.interface";
import type { Asset } from "@/modules/assets/domain/entities/asset.entity";
import type { Blob } from "@/modules/assets/domain/entities/blob.entity";
import { KnowledgeQueryService } from "@/modules/assets/application/knowledge-query.service";
import { KnowledgeIngestionService } from "@/modules/assets/application/knowledge-ingestion.service";
import { KnowledgeAuditService } from "@/modules/assets/application/knowledge-audit.service";
import { KnowledgeIngestJobService } from "@/modules/assets/application/knowledge-ingest-job.service";
import { KnowledgeContentService } from "@/modules/assets/application/knowledge-content.service";
import { KnowledgeGraphService } from "@/modules/assets/application/knowledge-graph.service";
import { KnowledgeCurationService } from "@/modules/assets/application/knowledge-curation.service";
import { KnowledgeOkfService } from "@/modules/assets/application/knowledge-okf.service";
import { ImportOkfRequestDto } from "@/modules/assets/presentation/dto/request/import-okf.request.dto";
import {
    ReviewKnowledgeCurationSuggestionRequestDto,
    UpdateKnowledgeCurationConfigRequestDto,
} from "@/modules/assets/presentation/dto/request/knowledge-curation.request.dto";

type RepositoryTreeItem = {
    path: string;
    name: string;
    type: "tree" | "blob" | "commit";
    mode: string;
    sha: string;
    size: number | null;
    isBinary?: boolean;
};

interface UpdateBlobBody {
    content?: string;
    encoding?: "utf8" | "base64";
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
    sources?: Array<{ name?: string; contentBase64?: string; originalPath?: string }>;
    ingest?: boolean;
}

const TEXT_SOURCE_EXTENSIONS = new Set([
    "txt",
    "csv",
    "tsv",
    "md",
    "json",
    "jsonl",
    "yaml",
    "yml",
    "xml",
    "html",
    "htm",
    "log",
]);
const INTERNAL_REPOSITORY_SEGMENTS = new Set([".internshannon", ".shuan-os-snapshots", ".shuan-os-trash"]);

@DesktopApi()
@Controller("assets")
export class DesktopAssetsController {
    constructor(
        @Inject(ASSET_SERVICE) private readonly assets: IAssetService,
        private readonly ingestion: KnowledgeIngestionService,
        private readonly knowledge: KnowledgeQueryService,
        private readonly ingestJobs: KnowledgeIngestJobService,
        private readonly audit: KnowledgeAuditService,
        private readonly content: KnowledgeContentService,
        private readonly graph: KnowledgeGraphService,
        private readonly curation: KnowledgeCurationService,
        private readonly okf: KnowledgeOkfService,
    ) {}

    @Get("me/knowledge")
    @ApiOkResponse({ summary: "获取我的个人知识库资产" })
    async getMyKnowledge(@DesktopOwnerId() userId: string) {
        return this.assetDto(await this.assets.getOrCreatePersonalKnowledge(userId));
    }

    @Get("me/knowledge/search")
    @ApiOkResponse({ summary: "搜索当前用户的 OKF 个人知识库" })
    async searchMyKnowledge(
        @DesktopOwnerId() userId: string,
        @Query("q") query: string,
        @Query("limit") limit?: string,
    ) {
        return this.knowledge.searchScope("personal", userId, query, this.searchLimit(limit));
    }

    @Get("docs/knowledge/search")
    @ApiOkResponse({ summary: "搜索书小安文档 OKF 知识库" })
    async searchDocsKnowledge(
        @DesktopOwnerId() userId: string,
        @Query("q") query: string,
        @Query("limit") limit?: string,
    ) {
        return this.knowledge.searchScope("docs", userId, query, this.searchLimit(limit));
    }

    @Get("docs/knowledge/search-all")
    @ApiOkResponse({ summary: "跨域搜索全部公开 OKF 知识库" })
    async searchAllKnowledge(
        @DesktopOwnerId() userId: string,
        @Query("q") query: string,
        @Query("limit") limit?: string,
    ) {
        return this.knowledge.searchScope("global", userId, query, this.searchLimit(limit));
    }

    @Get(":id/repository")
    @ApiOkResponse({ summary: "获取资产仓库信息" })
    async repository(@Param("id") id: string) {
        const asset = await this.requireAsset(id);
        return {
            assetId: asset.id,
            cloneUrl: asset.cloneUrl,
            defaultBranch: asset.defaultBranch || "main",
            refs: this.repositoryRefs(asset),
        };
    }

    @Get(":id/repository/tree")
    @ApiOkResponse({ summary: "列出资产仓库目录树" })
    async repositoryTree(
        @Param("id") id: string,
        @Query("ref") ref?: string,
        @Query("path") treePath?: string,
        @Query("page") pageValue?: string,
        @Query("limit") limitValue?: string,
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
            ref: ref?.trim() || asset.defaultBranch || "main",
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

    @Get(":id/repository/blob")
    @ApiOkResponse({ summary: "读取资产仓库文件内容" })
    async repositoryBlob(@Param("id") id: string, @Query("path") path: string, @Query("ref") ref?: string) {
        const asset = await this.requireAsset(id);
        const normalizedPath = this.requireBlobPath(path);
        const blob = await this.assets.getBlobData(asset.id, normalizedPath);
        return {
            assetId: asset.id,
            ref: ref?.trim() || asset.defaultBranch || "main",
            ...blob,
        };
    }

    @Post(":id/blobs/update")
    @ApiCreatedResponse({ summary: "更新资产仓库文件" })
    async updateBlob(@Param("id") id: string, @Query("path") path: string, @Body() body: UpdateBlobBody) {
        const normalizedPath = this.requireBlobPath(path);
        if (body.encoding === "base64") {
            return this.assets.updateBlobBinary(
                id,
                normalizedPath,
                Buffer.from(body.content || "", "base64"),
                body.message || `Update ${normalizedPath}`,
                body.branch || "main",
                body.authorName,
                body.authorEmail,
            );
        }
        return this.assets.updateBlob(
            id,
            normalizedPath,
            typeof body.content === "string" ? body.content : "",
            body.message || `Update ${normalizedPath}`,
            body.branch || "main",
            body.authorName,
            body.authorEmail,
        );
    }

    @Post(":id/blobs/delete")
    @ApiCreatedResponse({ summary: "删除资产仓库文件" })
    async deleteBlob(@Param("id") id: string, @Query("path") path: string, @Body() body: DeleteBlobBody) {
        const normalizedPath = this.requireBlobPath(path);
        return this.assets.deleteBlob(
            id,
            normalizedPath,
            body.message || `Delete ${normalizedPath}`,
            body.branch || "main",
            body.authorName,
            body.authorEmail,
        );
    }

    @Post(":id/blobs/rename")
    @ApiCreatedResponse({ summary: "重命名资产仓库文件" })
    async renameBlob(@Param("id") id: string, @Query("path") path: string, @Body() body: RenameBlobBody) {
        const normalizedPath = this.requireBlobPath(path);
        const toPath = this.requireBlobPath(body.toPath);
        return this.assets.renameBlob(
            id,
            normalizedPath,
            toPath,
            body.message || `Rename ${normalizedPath} to ${toPath}`,
            body.branch || "main",
            body.authorName,
            body.authorEmail,
        );
    }

    @Get(":id/wiki/sources")
    @ApiOkResponse({ summary: "列出资产 Wiki 来源" })
    async listWikiSources(@Param("id") id: string) {
        const asset = await this.requireAsset(id);
        const manifest = await this.ingestion.getManifest(id);
        const byPath = new Map(manifest.sources.map((source) => [source.path, source]));
        const sourceLocations = this.knowledgeSourceLocations(asset);
        return this.content.sourceEntries(asset).map((source) => {
            const indexed = byPath.get(source.path);
            return {
                ...source,
                status: indexed?.status ?? "pending",
                error: indexed?.error,
                retryable: indexed?.retryable,
                chunkCount: indexed?.chunkCount ?? 0,
                extractionMethod: indexed?.extractionMethod,
                originalPath: sourceLocations[source.path],
            };
        });
    }

    @Post(":id/wiki/sources")
    @ApiCreatedResponse({ summary: "上传资产 Wiki 来源" })
    async uploadWikiSources(
        @Param("id") id: string,
        @Body() body: UploadSourcesBody,
        @DesktopOwnerId() userId = "system",
    ) {
        const sources = Array.isArray(body.sources) ? body.sources : [];
        if (sources.length === 0) {
            throw new BadRequestException("sources is required");
        }
        const paths: string[] = [];
        const asset = await this.requireAsset(id);
        const sourceLocations = { ...this.knowledgeSourceLocations(asset) };
        for (const source of sources) {
            const name = this.safeSourceName(source.name);
            const contentBase64 = source.contentBase64 || "";
            const buffer = Buffer.from(contentBase64, "base64");
            const path = `raw/sources/${name}`;
            const originalPath = source.originalPath?.trim();
            if (originalPath && !isAbsolute(originalPath)) {
                throw new BadRequestException("originalPath must be absolute");
            }
            const extension = name.split(".").pop()?.toLowerCase() ?? "";
            const update = TEXT_SOURCE_EXTENSIONS.has(extension)
                ? await this.assets.updateBlob(id, path, buffer.toString("utf8"), `Import ${name}`, "main")
                : await this.assets.updateBlobBinary(id, path, buffer, `Import ${name}`, "main");
            await this.recordAudit(id, {
                action: "source.upload",
                target: path,
                actorId: userId,
                commitSha: update.commitSha,
                metadata: { size: buffer.byteLength },
            });
            paths.push(path);
            if (originalPath) sourceLocations[path] = originalPath;
            else delete sourceLocations[path];
        }
        await this.saveKnowledgeSourceLocations(asset, sourceLocations);
        const job = body.ingest === true ? await this.ingestJobs.start(id, paths, userId) : undefined;
        return { paths, job };
    }

    @Delete(":id/wiki/sources")
    @ApiOkResponse({ summary: "删除资产 Wiki 来源" })
    async deleteWikiSource(@Param("id") id: string, @Query("path") path: string, @DesktopOwnerId() userId = "system") {
        const normalizedPath = this.requireBlobPath(path);
        const asset = await this.requireAsset(id);
        const result = await this.assets.deleteBlob(id, normalizedPath, `Delete ${normalizedPath}`, "main");
        const sourceLocations = { ...this.knowledgeSourceLocations(asset) };
        delete sourceLocations[normalizedPath];
        await this.saveKnowledgeSourceLocations(asset, sourceLocations);
        await this.recordAudit(id, {
            action: "source.delete",
            target: normalizedPath,
            actorId: userId,
            commitSha: result.commitSha,
        });
        return { deleted: result.deleted, path: normalizedPath };
    }

    @Post(":id/wiki/ingest-jobs")
    @ApiCreatedResponse({ summary: "启动异步知识库摄取任务" })
    async startWikiIngestJob(
        @Param("id") id: string,
        @Body() body: { sourcePaths?: string[] },
        @DesktopOwnerId() userId = "system",
    ) {
        return this.ingestJobs.start(id, Array.isArray(body.sourcePaths) ? body.sourcePaths : [], userId);
    }

    @Get(":id/wiki/ingest-jobs")
    @ApiOkResponse({ summary: "列出知识库摄取任务" })
    async listWikiIngestJobs(@Param("id") id: string, @Query("limit") limit?: string) {
        return this.ingestJobs.list(id, this.searchLimit(limit));
    }

    @Get(":id/wiki/ingest-jobs/:jobId")
    @ApiOkResponse({ summary: "获取知识库摄取任务状态" })
    async wikiIngestJobStatus(@Param("id") id: string, @Param("jobId") jobId: string) {
        return this.ingestJobs.get(id, jobId);
    }

    @Post(":id/wiki/ingest-jobs/:jobId/cancel")
    @ApiCreatedResponse({ summary: "取消知识库摄取任务" })
    async cancelWikiIngestJob(@Param("id") id: string, @Param("jobId") jobId: string) {
        return this.ingestJobs.cancel(id, jobId);
    }

    @Post(":id/wiki/ingest-jobs/:jobId/retry")
    @ApiCreatedResponse({ summary: "重试失败的知识库摄取任务" })
    async retryWikiIngestJob(
        @Param("id") id: string,
        @Param("jobId") jobId: string,
        @DesktopOwnerId() userId = "system",
    ) {
        return this.ingestJobs.retry(id, jobId, userId);
    }

    @Get(":id/wiki/pages")
    @ApiOkResponse({ summary: "列出资产 Wiki 页面" })
    async listWikiPages(@Param("id") id: string) {
        const asset = await this.content.requireAsset(id);
        return this.content.pageEntries(asset, await this.content.loadContents(asset, "wiki/"));
    }

    @Get(":id/wiki/graph")
    @ApiOkResponse({ summary: "获取资产 Wiki 图谱" })
    async wikiGraph(
        @Param("id") id: string,
        @Query("q") query?: string,
        @Query("type") requestedType?: string,
        @Query("tag") requestedTag?: string,
    ) {
        return this.graph.graph(id, { query, type: requestedType, tag: requestedTag });
    }

    @Get(":id/wiki/backlinks")
    @ApiOkResponse({ summary: "获取指向指定 Wiki 页面的反向链接" })
    async wikiBacklinks(@Param("id") id: string, @Query("path") path: string) {
        const normalizedPath = this.requireBlobPath(path);
        return this.graph.backlinks(id, normalizedPath);
    }

    @Get(":id/wiki/similar")
    @ApiOkResponse({ summary: "使用本地 embedding 查找语义相关 Wiki 页面" })
    async wikiSimilar(@Param("id") id: string, @Query("path") path: string, @Query("limit") limit?: string) {
        return this.knowledge.findSimilarConcepts(id, path, this.searchLimit(limit));
    }

    @Get(":id/wiki/search")
    @ApiOkResponse({ summary: "搜索指定资产中的 OKF concept" })
    async wikiSearch(@Param("id") id: string, @Query("q") query: string, @Query("limit") limit?: string) {
        return this.knowledge.searchAsset(id, query, this.searchLimit(limit));
    }

    @Post(":id/wiki/evaluate")
    @ApiCreatedResponse({ summary: "运行知识库检索评测集" })
    async evaluateWikiSearch(
        @Param("id") id: string,
        @Body() body: { cases?: Array<{ query?: string; expectedPaths?: string[] }>; k?: number },
    ) {
        const cases = (Array.isArray(body.cases) ? body.cases : []).flatMap((item) => {
            const query = item.query?.trim();
            const expectedPaths = Array.isArray(item.expectedPaths) ? item.expectedPaths.filter(Boolean) : [];
            return query && expectedPaths.length > 0 ? [{ query, expectedPaths }] : [];
        });
        if (cases.length === 0) throw new BadRequestException("evaluation cases are required");
        return this.knowledge.evaluateAsset(id, cases, body.k);
    }

    @Get(":id/wiki/concept")
    @ApiOkResponse({ summary: "读取指定 OKF concept" })
    async readWikiConcept(@Param("id") id: string, @Query("path") path: string) {
        return this.knowledge.readConcept(id, path);
    }

    @Get(":id/wiki/directory")
    @ApiOkResponse({ summary: "渐进式列出 OKF bundle 目录" })
    async listWikiDirectory(@Param("id") id: string, @Query("path") path?: string) {
        return this.knowledge.listDirectory(id, path);
    }

    @Get(":id/wiki/tags")
    @ApiOkResponse({ summary: "聚合 OKF concept 标签" })
    async wikiTags(@Param("id") id: string) {
        return this.knowledge.listTags(id);
    }

    @Patch(":id/wiki/pages")
    @ApiOkResponse({ summary: "保存资产 Wiki 页面" })
    async saveWikiPage(
        @Param("id") id: string,
        @Body() body: { path?: string; content?: string },
        @DesktopOwnerId() userId = "system",
    ) {
        const path = this.requireBlobPath(body.path);
        const result = await this.assets.updateBlob(id, path, body.content ?? "", `Update ${path}`, "main");
        await this.recordAudit(id, {
            action: "page.save",
            target: path,
            actorId: userId,
            commitSha: result.commitSha,
        });
        return { saved: true, path };
    }

    @Delete(":id/wiki/pages")
    @ApiOkResponse({ summary: "删除资产 Wiki 页面" })
    async deleteWikiPage(@Param("id") id: string, @Query("path") path: string, @DesktopOwnerId() userId = "system") {
        const normalizedPath = this.requireBlobPath(path);
        const result = await this.assets.deleteBlob(id, normalizedPath, `Delete ${normalizedPath}`, "main");
        await this.recordAudit(id, {
            action: "page.delete",
            target: normalizedPath,
            actorId: userId,
            commitSha: result.commitSha,
        });
        return { deleted: result.deleted, path: normalizedPath };
    }

    @Post(":id/wiki/pages/rename")
    @ApiCreatedResponse({ summary: "重命名资产 Wiki 页面" })
    async renameWikiPage(
        @Param("id") id: string,
        @Body() body: { fromPath?: string; toPath?: string },
        @DesktopOwnerId() userId = "system",
    ) {
        const fromPath = this.requireBlobPath(body.fromPath);
        const toPath = this.requireBlobPath(body.toPath);
        const result = await this.assets.renameBlob(id, fromPath, toPath, `Rename ${fromPath} to ${toPath}`, "main");
        await this.recordAudit(id, {
            action: "page.rename",
            target: toPath,
            fromTarget: fromPath,
            actorId: userId,
            commitSha: result.commitSha,
        });
        return { renamed: true, fromPath, toPath };
    }

    @Get(":id/wiki/health")
    @ApiOkResponse({ summary: "获取资产 Wiki 健康状态" })
    async wikiHealth(@Param("id") id: string) {
        return this.graph.health(id);
    }

    @Get(":id/wiki/config")
    @ApiOkResponse({ summary: "获取知识库配置" })
    async wikiConfig(@Param("id") id: string) {
        const asset = await this.requireAsset(id);
        const knowledge = this.content.knowledgeMetadata(asset);
        const embedding = this.objectMetadataValue(knowledge.embedding);
        return {
            purpose: await this.assets.getBlobContent(id, "purpose.md").catch(() => ""),
            schema: await this.assets.getBlobContent(id, "schema.md").catch(() => ""),
            knowledgeType: this.stringMetadataValue(knowledge.knowledgeType) || null,
            embedding: {
                provider: this.stringMetadataValue(embedding.provider) || "local",
                model: this.stringMetadataValue(embedding.model) || "local-hash-v1",
                dimensions: this.numberMetadataValue(embedding.dimensions) || 192,
                keywordWeight: this.numberMetadataValue(embedding.keywordWeight) ?? 1,
                vectorWeight: this.numberMetadataValue(embedding.vectorWeight) ?? 6,
                mmrLambda: this.numberMetadataValue(embedding.mmrLambda) ?? 0.78,
            },
        };
    }

    @Put(":id/wiki/config")
    @ApiOkResponse({ summary: "更新知识库配置" })
    async updateWikiConfig(
        @Param("id") id: string,
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
        @DesktopOwnerId() userId = "system",
    ) {
        if (typeof body.purpose === "string") {
            await this.assets.updateBlob(id, "purpose.md", body.purpose, "Update knowledge purpose", "main");
        }
        if (typeof body.schema === "string") {
            await this.assets.updateBlob(id, "schema.md", body.schema, "Update knowledge schema", "main");
        }
        const asset = await this.requireAsset(id);
        const current = this.content.knowledgeMetadata(asset);
        const currentEmbedding = this.objectMetadataValue(current.embedding);
        const embedding = body.embedding
            ? {
                  ...currentEmbedding,
                  ...Object.fromEntries(
                      Object.entries(body.embedding).filter(([, value]) => value !== undefined && value !== ""),
                  ),
              }
            : currentEmbedding;
        const knowledge = {
            ...current,
            ...(typeof body.knowledgeType === "string" ? { knowledgeType: body.knowledgeType.trim() } : {}),
            embedding,
        };
        await this.assets.updateAsset(id, { metadata: { knowledge } });
        await this.recordAudit(id, {
            action: "config.update",
            target: "knowledge",
            actorId: userId,
            metadata: {
                embeddingProvider: this.stringMetadataValue(embedding.provider) || "local",
                embeddingModel: this.stringMetadataValue(embedding.model) || "local-hash-v1",
            },
        });
        return this.wikiConfig(id);
    }

    @Post(":id/wiki/reindex")
    @ApiCreatedResponse({ summary: "重建资产 Wiki 索引" })
    async wikiReindex(@Param("id") id: string, @DesktopOwnerId() userId = "system") {
        const asset = await this.requireAsset(id);
        const ingestion = await this.ingestion.reindex(asset.id);
        const summary = await this.graph.summary(id);
        const curation = await this.curation.refreshAfterReindex(id).catch(() => null);
        const result = {
            ...summary,
            ...ingestion,
            curationPendingCount: curation?.pendingCount ?? 0,
        };
        await this.recordAudit(id, {
            action: "ingest.complete",
            actorId: userId,
            metadata: { sourceCount: ingestion.sourceCount, chunkCount: ingestion.chunkCount, synchronous: true },
        });
        return result;
    }

    @Post(":id/wiki/storage/migrate")
    @ApiCreatedResponse({ summary: "迁移旧知识库 metadata 正文到资产存储" })
    async migrateWikiStorage(@Param("id") id: string, @DesktopOwnerId() userId = "system") {
        const result = await this.assets.migrateKnowledgeStorage(id);
        await this.recordAudit(id, {
            action: "storage.migrate",
            target: "knowledge",
            actorId: userId,
            metadata: result,
        });
        return result;
    }

    @Get(":id/wiki/curation")
    @ApiOkResponse({ summary: "获取知识库策展审阅状态" })
    async wikiCurationStatus(@Param("id") id: string) {
        return this.curation.status(id);
    }

    @Put(":id/wiki/curation/config")
    @ApiOkResponse({ summary: "更新知识库自动策展建议开关" })
    async updateWikiCurationConfig(
        @Param("id") id: string,
        @Body() body: UpdateKnowledgeCurationConfigRequestDto,
        @DesktopOwnerId() userId = "system",
    ) {
        return this.curation.updateConfig(id, body.autoCuration === true, userId);
    }

    @Get(":id/wiki/curation/suggestions")
    @ApiOkResponse({ summary: "列出待审阅的知识库建链建议" })
    async listCurationSuggestions(@Param("id") id: string) {
        return this.curation.list(id);
    }

    @Post(":id/wiki/curation/suggestions/refresh")
    @ApiCreatedResponse({ summary: "根据本地语义相似度刷新建链建议" })
    async refreshCurationSuggestions(@Param("id") id: string) {
        return this.curation.refresh(id);
    }

    @Post(":id/wiki/curation/suggestions/:suggestionId/review")
    @ApiCreatedResponse({ summary: "接受或拒绝一条知识库建链建议" })
    async reviewCurationSuggestion(
        @Param("id") id: string,
        @Param("suggestionId") suggestionId: string,
        @DesktopOwnerId() userId: string,
        @Body() body: ReviewKnowledgeCurationSuggestionRequestDto,
    ) {
        return this.curation.review(id, suggestionId, userId, body.decision);
    }

    @Get(":id/wiki/audit-log")
    @ApiOkResponse({ summary: "获取统一知识库审计流" })
    async wikiAuditLog(@Param("id") id: string, @Query("limit") limit?: string) {
        return this.curation.auditLog(id, this.searchLimit(limit));
    }

    @Get(":id/wiki/okf/validate")
    @ApiOkResponse({ summary: "校验知识库的 OKF v0.1 兼容性" })
    async validateOkf(@Param("id") id: string) {
        return this.okf.validate(id);
    }

    @Post(":id/wiki/okf/import")
    @ApiCreatedResponse({ summary: "导入 OKF v0.1 bundle" })
    async importOkf(@Param("id") id: string, @Body() body: ImportOkfRequestDto, @DesktopOwnerId() userId = "system") {
        return this.okf.import(id, body, userId);
    }

    @Get(":id/wiki/okf/export")
    @ApiOkResponse({ summary: "导出 OKF v0.1 ZIP bundle" })
    async exportOkf(@Param("id") id: string) {
        return this.okf.export(id);
    }

    private async requireAsset(id: string): Promise<Asset> {
        const asset = await this.assets.getAsset(id);
        if (!asset) {
            throw new NotFoundException("Asset not found");
        }
        return asset;
    }

    private knowledgeSourceLocations(asset: Asset): Record<string, string> {
        const knowledge = asset.metadata?.knowledge;
        if (!knowledge || typeof knowledge !== "object" || Array.isArray(knowledge)) return {};
        const sourceLocations = (knowledge as Record<string, unknown>).sourceLocations;
        if (!sourceLocations || typeof sourceLocations !== "object" || Array.isArray(sourceLocations)) return {};
        return Object.fromEntries(
            Object.entries(sourceLocations).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
        );
    }

    private async saveKnowledgeSourceLocations(asset: Asset, sourceLocations: Record<string, string>): Promise<void> {
        const current =
            asset.metadata?.knowledge &&
            typeof asset.metadata.knowledge === "object" &&
            !Array.isArray(asset.metadata.knowledge)
                ? (asset.metadata.knowledge as Record<string, unknown>)
                : {};
        await this.assets.updateAsset(asset.id, {
            metadata: { knowledge: { ...current, sourceLocations } },
        });
    }

    private async recordAudit(assetId: string, entry: Parameters<KnowledgeAuditService["append"]>[1]): Promise<void> {
        await this.audit.append(assetId, entry);
    }

    private assetDto(asset: Asset) {
        return asset.toProps();
    }

    private repositoryRefs(asset: Asset) {
        const branch = asset.defaultBranch || "main";
        const head = asset.branches.find((item) => item.name === branch)?.commitSha || asset.commits[0]?.sha || "HEAD";
        return [{ name: branch, type: "branch" as const, sha: head }];
    }

    private treeItems(asset: Asset, dirPath: string): RepositoryTreeItem[] {
        const normalizedDir = this.normalizeBlobPath(dirPath);
        const prefix = normalizedDir ? `${normalizedDir}/` : "";
        const directories = new Map<string, RepositoryTreeItem>();
        const files = new Map<string, RepositoryTreeItem>();

        for (const blob of this.contentBlobs(asset)) {
            if (blob.path.split("/").some((segment) => INTERNAL_REPOSITORY_SEGMENTS.has(segment))) continue;
            if (prefix && !blob.path.startsWith(prefix)) continue;
            const rest = prefix ? blob.path.slice(prefix.length) : blob.path;
            if (!rest || rest.startsWith("/")) continue;
            const [head] = rest.split("/");
            if (!head) continue;
            const childPath = prefix ? `${prefix}${head}` : head;
            if (rest.includes("/")) {
                directories.set(childPath, {
                    path: childPath,
                    name: head,
                    type: "tree",
                    mode: "040000",
                    sha: this.shaForText(`tree:${childPath}`),
                    size: null,
                });
            } else {
                files.set(childPath, {
                    path: childPath,
                    name: head,
                    type: "blob",
                    mode: "100644",
                    sha: blob.contentSha || blob.id || this.shaForText(blob.path),
                    size: typeof blob.size === "number" ? blob.size : null,
                    isBinary: blob.isBinary,
                });
            }
        }

        return [...directories.values(), ...files.values()].sort((left, right) => {
            if (left.type !== right.type) return left.type === "tree" ? -1 : 1;
            return left.name.localeCompare(right.name, "zh-CN");
        });
    }

    private contentBlobs(asset: Asset): Array<Pick<Blob, "id" | "path" | "size" | "contentSha" | "isBinary">> {
        const contents = this.blobContents(asset);
        const byPath = new Map<string, Pick<Blob, "id" | "path" | "size" | "contentSha" | "isBinary">>();
        for (const blob of asset.blobs ?? []) {
            byPath.set(blob.path, blob);
        }
        for (const [path, content] of Object.entries(contents)) {
            const previous = byPath.get(path);
            byPath.set(path, {
                id: previous?.id || this.shaForText(content),
                path,
                size: previous?.size ?? Buffer.byteLength(content, "utf8"),
                contentSha: previous?.contentSha || this.shaForText(content),
                isBinary: previous?.isBinary ?? false,
            });
        }
        return Array.from(byPath.values());
    }

    private blobContents(asset: Asset): Record<string, string> {
        const contents = asset.metadata?.blobContents;
        return contents && typeof contents === "object" && !Array.isArray(contents)
            ? (contents as Record<string, string>)
            : {};
    }

    private stringMetadataValue(value: unknown): string {
        return typeof value === "string" ? value : "";
    }

    private numberMetadataValue(value: unknown): number | undefined {
        return typeof value === "number" && Number.isFinite(value) ? value : undefined;
    }

    private objectMetadataValue(value: unknown): Record<string, unknown> {
        return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
    }

    private requireBlobPath(value: string | undefined): string {
        const normalized = this.normalizeBlobPath(value);
        if (!normalized) {
            throw new BadRequestException("path is required");
        }
        return normalized;
    }

    private searchLimit(value?: string): number {
        return Math.max(1, Math.min(50, Number(value) || 8));
    }

    private normalizeBlobPath(value: string | undefined): string {
        return (value ?? "")
            .replace(/\\/g, "/")
            .split("/")
            .map((segment) => segment.trim())
            .filter((segment) => segment && segment !== "." && segment !== "..")
            .join("/");
    }

    private safeSourceName(value: string | undefined): string {
        const name = (value ?? "").replace(/\\/g, "/").split("/").pop()?.trim();
        if (!name || name === "." || name === "..") {
            throw new BadRequestException("source name is required");
        }
        return name.replace(/[<>:"|?*\x00-\x1F]/g, "-");
    }

    private shaForText(value: string): string {
        return createHash("sha1").update(value).digest("hex");
    }
}
