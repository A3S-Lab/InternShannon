import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { BadRequestException, ForbiddenException, NotFoundException } from '@/shared/common/errors';
import { createHash, randomUUID } from 'node:crypto';
import { PageQueryOptions, PageResult } from '@/shared/domain/pagination';
interface NotificationService {
    create(input: {
        userId: string;
        title: string;
        content?: string;
        description?: string;
        type?: string;
        level?: string;
        category?: string;
        link?: string;
        metadata?: Record<string, unknown>;
    }): Promise<unknown>;
}
import { Asset, AssetActionVariable, PipelineSourceDefinition, PipelineSourceJob } from '../domain/entities/asset.entity';
import {
    AssetCatalogFilters,
    ASSET_REPOSITORY,
    IAssetRepository,
} from '../domain/repositories/asset.repository.interface';
import {
    AssetComparison,
    CollaboratorInvitationWithAsset,
    CreateCollaboratorInvitationInput,
    ExternalSyncLinkage,
    IAssetService,
    PullRequestChecks,
} from '../domain/services/asset.service.interface';
import { AgentKind } from '../domain/value-objects/agent-kind.vo';
import { AssetCategory } from '../domain/value-objects/asset-category.vo';
import { AssetLifecycleState, isAssetLifecycleState } from '../domain/value-objects/asset-lifecycle.vo';
import { Visibility } from '../domain/value-objects/visibility.vo';
import {
    Blob,
    Branch,
    Collaborator,
    CollaboratorAccessEvent,
    CollaboratorInvitation,
    Commit,
    CommitComment,
    Issue,
    IssueComment,
    IssueStatus,
    Pipeline,
    PipelineArtifact,
    PipelineJob,
    PipelineRun,
    PipelineStep,
    PullRequest,
    PullRequestComment,
    PullRequestCommentSide,
    PullRequestMergeStrategy,
    PullRequestReview,
    PullRequestReviewDecision,
    PullRequestStatus,
    Release,
    Tag,
} from '../domain/entities';
import { Permission } from '../domain/value-objects';
import {
    PLATFORM_DOCS_GLOBAL_DOMAIN,
    resolveGlobalKnowledgeMaintainers,
} from '../domain/value-objects/global-knowledge.vo';
import {
    ASSET_GIT_REPOSITORY_SERVICE,
    IAssetGitRepositoryService,
    RepositorySeedFile,
} from '../domain/services/asset-git-repository.service.interface';
import { AssetUrlResolverService, buildAssetGitCloneUrl } from './asset-url-resolver.service';
import {
    applyImplicitEditLifecycleTransition,
    buildPullRequestChecks,
    compareRefsFromMetadata,
    filterMetadataCommits,
    latestCommitShaForBranch,
    resolveRefSha,
    singleFileDiff,
    toDomainCommit,
    triggerPullRequestChecks,
    upsertBranchCommit,
    uuidLike,
    withInitialLifecycleMetadata,
} from './asset.utils';
export {
    AssetUrlResolverService,
    buildAssetGitCloneUrlWithBase,
    buildAssetGitCloneUrl,
    buildAssetGitSshUrl,
    isGeneratedLocalAssetGitCloneUrl,
    resolveAssetGitCloneUrl,
    resolveAssetGitHttpBaseUrl,
} from './asset-url-resolver.service';

/** 专属知识库资产名(每用户唯一,真正的单例约束由迁移 093 的部分唯一索引保证)。 */
const PERSONAL_KNOWLEDGE_ASSET_NAME = 'personal-knowledge';
const PERSONAL_KNOWLEDGE_DESCRIPTION =
    '系统为每位用户自动创建的专属知识库,作为内核循环工程的默认上下文载体。';
const PERSONAL_KNOWLEDGE_PURPOSE_MD = `# Purpose

这是本用户的专属知识库,由系统自动创建并随内核循环工程持续维护。

把日常沉淀的资料、笔记、来源文档放进 \`raw/sources/\`,经两步 LLM 摄取后会在 \`wiki/\`
下生成相互链接的知识页面;内核循环的新鲜度扫描器会保持派生索引(图谱/检索)与 git 同步。
`;
const PERSONAL_KNOWLEDGE_SCHEMA_MD = `# Schema

- entities: 人物、组织、项目等实体页面
- concepts: 概念与术语
- sources: 来源文档的归档与摘要

无需严格遵循;摄取时 LLM 会参考此文件组织页面结构。
`;
const PERSONAL_KNOWLEDGE_INDEX_MD = `---
type: synthesis
title: 知识库总览
---

# 知识库总览

这是你的专属知识库入口。上传来源文档后,这里会逐步汇总成可检索、可关联的知识网络。
`;

// 全局知识库(多域):面向 Desktop 本地工作区公开共享的 category='knowledge' 资产,按 DOMAIN 区分。
// owner 沿用内置资产约定 'builtin-docs'/organization;visibility=public + metadata.builtin
// → 本地用户只读可达(见 asset-access enforceRead),internShannon经渐进式 API 检索。每个域是一个单例,由迁移 100 的部分唯一索引
// (owner_type='organization' AND category='knowledge' AND metadata#>>'{knowledge,globalDomain}'=<域>)保证。
const GLOBAL_KNOWLEDGE_OWNER_ID = 'builtin-docs';

/** 平台文档中心(os-docs)所属的规范域键。getOrCreateGlobalDocsKnowledge 解析/创建此域。 */
const PLATFORM_DOCS_DOMAIN = PLATFORM_DOCS_GLOBAL_DOMAIN;
const PLATFORM_DOCS_KNOWLEDGE_NAME = 'os-docs-global-knowledge';
const PLATFORM_DOCS_KNOWLEDGE_DESCRIPTION = 'internShannon 文档中心的全局共享知识库:面向所有用户公开,供internShannon结合文档作答。';
const PLATFORM_DOCS_KNOWLEDGE_PURPOSE_MD = `# Purpose

这是internShannon 文档中心的【全局共享知识库】,由系统从内置 os-docs 文档自动摄取并维护,面向所有用户公开只读。
internShannon在回答问题时可经渐进式 API 检索此处,以internShannon 官方文档为依据并标注来源。
`;
const PLATFORM_DOCS_KNOWLEDGE_SCHEMA_MD = `# Schema

- 平台中间件:a3s-* 系列(box / code / gateway / lane / memory / power / search …)
- 开放平台:open-platform-* 系列(资产 / 工作流 / 注册表 / 市场 / 发布 / 集成 …)

摄取时 LLM 会参考此文件组织页面结构。
`;
const PLATFORM_DOCS_KNOWLEDGE_INDEX_MD = `---
type: synthesis
title: internShannon 文档中心
---

# internShannon 文档中心

全局共享的internShannon 官方文档知识库入口;此处汇总了平台中间件与开放平台的文档,可检索、可关联。
`;

/** 把域键规范化为合法资产名片段(全局知识库资产名 = global-knowledge-<域>)。 */
function globalKnowledgeAssetName(domain: string): string {
    if (domain === PLATFORM_DOCS_DOMAIN) {
        return PLATFORM_DOCS_KNOWLEDGE_NAME;
    }
    const slug = domain
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
    return `global-knowledge-${slug || 'domain'}`;
}

@Injectable()
export class AssetServiceImpl implements IAssetService {
    private readonly logger = new Logger(AssetServiceImpl.name);

    constructor(
        @Inject(ASSET_REPOSITORY) private readonly assetRepository: IAssetRepository,
        // gitHosting 历史上注入具体类(写操作:删库/删分支/快进合并);现统一经接口 token,
        // 与下方 gitRepo 同源(useExisting),保留两字段以最小化对既有调用点与定位测试的改动。
        @Optional() @Inject(ASSET_GIT_REPOSITORY_SERVICE) private readonly gitHosting?: IAssetGitRepositoryService,
        @Optional() private readonly assetUrls?: AssetUrlResolverService,
        @Optional() @Inject(ASSET_GIT_REPOSITORY_SERVICE) private readonly gitRepo?: IAssetGitRepositoryService,
        @Optional() private readonly notifications?: NotificationService,
    ) {}

    async createAsset(
        name: string,
        ownerId: string,
        ownerType: 'user' | 'organization',
        category: AssetCategory,
        visibility: Visibility,
        description?: string,
        homepage?: string,
        metadata?: Record<string, unknown>,
        agentKind?: AgentKind,
    ): Promise<Asset> {
        const asset = Asset.create({
            name,
            ownerId,
            ownerType,
            category,
            visibility,
            description,
            homepage,
            cloneUrl: await this.buildCloneUrl(ownerType, ownerId, name),
            metadata: withInitialLifecycleMetadata(metadata, ownerId),
            agentKind: category === 'agent' ? (agentKind ?? 'application') : undefined,
        });
        let repositoryInitialized = false;
        try {
            if (this.gitRepo) {
                await this.gitRepo.ensureAssetRepository(asset);
                repositoryInitialized = true;
                await this.gitRepo.syncAssetMetadata(asset, {
                    gitRepository: {
                        managed: true,
                        backend: 'local',
                        initializedAt: new Date().toISOString(),
                    },
                });
            }
            await this.assetRepository.save(asset);
        } catch (error) {
            if (repositoryInitialized) {
                await this.gitHosting?.deleteAssetRepository(asset).catch(() => undefined);
            }
            throw error;
        }
        return asset;
    }

    async getAsset(id: string): Promise<Asset | null> {
        return this.assetRepository.findById(id);
    }

    async getOrCreatePersonalKnowledge(userId: string): Promise<Asset> {
        if (!userId) {
            throw new BadRequestException('缺少用户标识,无法解析专属知识库');
        }
        const existing = await this.assetRepository.findPersonalKnowledge(userId);
        if (existing) return existing;
        try {
            const asset = await this.createAsset(
                PERSONAL_KNOWLEDGE_ASSET_NAME,
                userId,
                'user',
                'knowledge',
                'private',
                PERSONAL_KNOWLEDGE_DESCRIPTION,
                undefined,
                { knowledge: { personal: true } },
            );
            // 脚手架 best-effort:写失败不阻断,空知识库对内核循环的 reindex 也是合法 no-op。
            await this.seedPersonalKnowledgeScaffold(asset).catch((error) => {
                this.logger.warn(`专属知识库脚手架写入失败 asset=${asset.id}: ${String(error)}`);
            });
            return asset;
        } catch (error) {
            // 并发首访:败者 INSERT 撞迁移 093 唯一索引(其 git 仓库已被 createAsset 回滚)。
            // 回查赢家返回,保证「有且仅有一个」。回查不到才说明是真实错误,向上抛出。
            const winner = await this.assetRepository.findPersonalKnowledge(userId);
            if (winner) return winner;
            throw error;
        }
    }

    private async seedPersonalKnowledgeScaffold(asset: Asset): Promise<void> {
        if (!this.gitRepo) return;
        await this.gitRepo.seedRepositoryFiles(
            asset,
            [
                { path: 'purpose.md', content: PERSONAL_KNOWLEDGE_PURPOSE_MD },
                { path: 'schema.md', content: PERSONAL_KNOWLEDGE_SCHEMA_MD },
                { path: 'wiki/index.md', content: PERSONAL_KNOWLEDGE_INDEX_MD },
            ],
            { message: 'chore: scaffold personal knowledge base', overwrite: false },
        );
    }

    async getOrCreateGlobalDocsKnowledge(): Promise<Asset> {
        return this.getOrCreateGlobalKnowledge(PLATFORM_DOCS_DOMAIN);
    }

    async getOrCreateGlobalKnowledge(
        domain: string,
        opts?: { name?: string; description?: string },
    ): Promise<Asset> {
        const normalizedDomain = domain?.trim();
        if (!normalizedDomain) {
            throw new BadRequestException('缺少全局知识库域键(globalDomain)');
        }
        const existing = await this.assetRepository.findGlobalKnowledgeByDomain(normalizedDomain);
        if (existing) return existing;

        const isPlatformDocs = normalizedDomain === PLATFORM_DOCS_DOMAIN;
        const name = opts?.name?.trim() || globalKnowledgeAssetName(normalizedDomain);
        const description =
            opts?.description?.trim() ||
            (isPlatformDocs
                ? PLATFORM_DOCS_KNOWLEDGE_DESCRIPTION
                : `全局共享知识库(${normalizedDomain}):面向所有用户公开,供internShannon结合知识作答。`);
        try {
            const asset = await this.createAsset(
                name,
                GLOBAL_KNOWLEDGE_OWNER_ID,
                'organization',
                'knowledge',
                'public',
                description,
                undefined,
                // globalDomain=<域> 标记单例(迁移 100 唯一索引);builtin 让它对所有用户只读可达。
                // 不再设 readOnly:true —— 本地维护路径可在线编辑,其他写入由
                // owner/collaborator/member 且 public 回落只读,仍写不进。globalDocs 仅平台文档域
                // 保留以兼容历史标记/索引。
                {
                    knowledge: {
                        globalDomain: normalizedDomain,
                        knowledgeType: 'documentation',
                        ...(isPlatformDocs ? { globalDocs: true } : {}),
                    },
                    builtin: true,
                },
            );
            await this.seedGlobalKnowledgeScaffold(asset, normalizedDomain).catch((error) => {
                this.logger.warn(`全局知识库脚手架写入失败 asset=${asset.id} domain=${normalizedDomain}: ${String(error)}`);
            });
            return asset;
        } catch (error) {
            // 并发首访:败者 INSERT 撞迁移 100 唯一索引;回查赢家返回,保证「每域有且仅有一个」。
            const winner = await this.assetRepository.findGlobalKnowledgeByDomain(normalizedDomain);
            if (winner) return winner;
            throw error;
        }
    }

    async listGlobalKnowledge(): Promise<Asset[]> {
        return this.assetRepository.listGlobalKnowledge();
    }

    async updateGlobalKnowledge(
        domain: string,
        props: { name?: string; description?: string },
    ): Promise<Asset> {
        const asset = await this.requireGlobalKnowledge(domain);
        // name 不在 updateAsset 的 props 里,走实体 rename;description 经 updateDetails。
        // 两者都已 touch() 实体,最后单次落库。
        const name = props.name?.trim();
        if (name) {
            asset.rename(name);
        }
        if (props.description !== undefined) {
            asset.updateDetails({ description: props.description });
        }
        await this.assetRepository.save(asset);
        return asset;
    }

    async setGlobalKnowledgeArchived(domain: string, archived: boolean): Promise<Asset> {
        const asset = await this.requireGlobalKnowledge(domain);
        // 软归档:仅写 metadata.knowledge.archived(无迁移)。updateMetadata 是浅合并,
        // 顶层 knowledge 会被整体替换,故先读出现有 knowledge 子对象再合并写回,保住 globalDomain 等键。
        const knowledge = {
            ...((asset.metadata?.knowledge as Record<string, unknown> | undefined) ?? {}),
            archived,
        };
        asset.updateMetadata({ knowledge });
        await this.assetRepository.save(asset);
        return asset;
    }

    async setGlobalKnowledgeMaintainers(domain: string, identifiers: string[]): Promise<Asset> {
        const asset = await this.requireGlobalKnowledge(domain);
        const userIds = await this.resolveMaintainerUserIds(identifiers);
        // 仅写 metadata.knowledge.maintainers(无迁移)。updateMetadata 是顶层浅合并,顶层 knowledge
        // 会被整体替换,故先读出现有 knowledge 子对象再合并写回,保住 globalDomain / builtin / archived 等键
        // (与 setGlobalKnowledgeArchived 的 merge-preserve 完全一致)。
        const knowledge = {
            ...((asset.metadata?.knowledge as Record<string, unknown> | undefined) ?? {}),
            maintainers: userIds,
        };
        asset.updateMetadata({ knowledge });
        await this.assetRepository.save(asset);
        return asset;
    }

    private async resolveMaintainerUserIds(identifiers: string[]): Promise<string[]> {
        const cleaned = (identifiers ?? []).map(item => item?.trim()).filter((item): item is string => Boolean(item));
        return [...new Set(cleaned)];
    }

    async getGlobalKnowledgeMaintainers(
        domain: string,
    ): Promise<{ asset: Asset; maintainers: Array<{ userId: string; username: string | null; email: string | null }> }> {
        const asset = await this.requireGlobalKnowledge(domain);
        const userIds = resolveGlobalKnowledgeMaintainers(asset);
        return {
            asset,
            maintainers: userIds.map(userId => ({ userId, username: null, email: null })),
        };
    }

    /** 按域解析全局知识库,缺失抛 NotFound(域级管理端点共用)。 */
    private async requireGlobalKnowledge(domain: string): Promise<Asset> {
        const normalizedDomain = domain?.trim();
        if (!normalizedDomain) {
            throw new BadRequestException('缺少全局知识库域键(globalDomain)');
        }
        const asset = await this.assetRepository.findGlobalKnowledgeByDomain(normalizedDomain);
        if (!asset) {
            throw new NotFoundException(`全局知识库域 "${normalizedDomain}" 不存在`);
        }
        return asset;
    }

    private async seedGlobalKnowledgeScaffold(asset: Asset, domain: string): Promise<void> {
        if (!this.gitRepo) return;
        const isPlatformDocs = domain === PLATFORM_DOCS_DOMAIN;
        const purpose = isPlatformDocs
            ? PLATFORM_DOCS_KNOWLEDGE_PURPOSE_MD
            : `# Purpose\n\n这是【全局共享知识库】域 \`${domain}\`,面向所有用户公开只读。把来源文档放进 \`raw/sources/\`,经两步 LLM 摄取后会在 \`wiki/\` 下生成相互链接的知识页面。\n`;
        const schema = isPlatformDocs
            ? PLATFORM_DOCS_KNOWLEDGE_SCHEMA_MD
            : `# Schema\n\n无需严格遵循;摄取时 LLM 会参考此文件组织页面结构。\n`;
        const index = isPlatformDocs
            ? PLATFORM_DOCS_KNOWLEDGE_INDEX_MD
            : `---\ntype: synthesis\ntitle: 全局知识库(${domain})\n---\n\n# 全局知识库(${domain})\n\n全局共享知识库入口;上传来源文档后,这里会逐步汇总成可检索、可关联的知识网络。\n`;
        await this.gitRepo.seedRepositoryFiles(
            asset,
            [
                { path: 'purpose.md', content: purpose },
                { path: 'schema.md', content: schema },
                { path: 'wiki/index.md', content: index },
            ],
            { message: 'chore: scaffold global knowledge base', overwrite: false },
        );
    }

    async getAssetCore(id: string): Promise<Asset | null> {
        return this.assetRepository.findCoreById(id);
    }

    async getAssets(ids: string[]): Promise<Asset[]> {
        return this.assetRepository.findByIds(ids);
    }

    async findByOwnerAndName(owner: string, name: string): Promise<Asset | null> {
        return this.assetRepository.findByOwnerAndName(owner, name);
    }

    async findByName(ownerId: string, name: string): Promise<Asset | null> {
        return this.assetRepository.findByName(ownerId, name);
    }

    async saveAsset(asset: Asset): Promise<void> {
        await this.assetRepository.save(asset);
    }

    async updateAsset(
        id: string,
        props: Partial<{
            description: string;
            homepage: string;
            defaultBranch: string;
            metadata: Record<string, unknown>;
            agentKind: AgentKind;
        }>,
    ): Promise<Asset> {
        const asset = await this.requireAsset(id);
        this.assertMutableAsset(asset);
        asset.updateDetails(props);
        if (props.metadata) {
            asset.updateMetadata(props.metadata);
        }
        if (props.agentKind !== undefined) {
            if (asset.category !== 'agent') {
                throw new BadRequestException('agentKind 仅适用于 category=agent 的资产');
            }
            asset.setAgentKind(props.agentKind);
        }
        await this.assetRepository.save(asset);
        return asset;
    }

    async deleteAsset(id: string): Promise<void> {
        const asset = await this.requireAsset(id);
        if (this.isDeletionProtectedAsset(asset)) {
            throw new ForbiddenException('系统内置数字资产不可删除');
        }
        await this.gitHosting?.deleteAssetRepository(asset);
        await this.assetRepository.delete(id);
    }

    async listAssetsPage(
        options: PageQueryOptions & {
            ownerId?: string;
            ownerType?: 'user' | 'organization';
            category?: AssetCategory;
            visibility?: Visibility;
        } & AssetCatalogFilters,
    ): Promise<PageResult<Asset>> {
        return this.assetRepository.findPaginated(options);
    }

    async listAccessibleAssetsPage(
        options: PageQueryOptions & {
            userId: string;
            organizationIds?: string[];
            ownerId?: string;
            ownerType?: 'user' | 'organization';
            category?: AssetCategory;
            visibility?: Visibility;
            /** 角色级知识库授权:额外放行的 category='knowledge' 资产 id。 */
            authorizedKnowledgeBaseIds?: string[];
        } & AssetCatalogFilters,
    ): Promise<PageResult<Asset>> {
        return this.assetRepository.findAccessiblePaginated(options);
    }

    async listUserAssets(userId: string): Promise<Asset[]> {
        return this.assetRepository.findByOwnerId(userId, 'user');
    }

    async listUserAssetsPage(
        userId: string,
        options: PageQueryOptions & { category?: AssetCategory; visibility?: Visibility } & AssetCatalogFilters,
    ): Promise<PageResult<Asset>> {
        return this.assetRepository.findPaginated({
            ...options,
            ownerId: userId,
            ownerType: 'user',
        });
    }

    async listPublicAssetsPage(
        options: PageQueryOptions & { category?: AssetCategory } & AssetCatalogFilters,
    ): Promise<PageResult<Asset>> {
        return this.assetRepository.findPaginated({
            ...options,
            visibility: 'public',
        });
    }

    async listPublicAssets(limit: number, offset: number): Promise<Asset[]> {
        return this.assetRepository.findPublic(limit, offset);
    }

    async starAsset(assetId: string, userId: string): Promise<void> {
        const asset = await this.requireAsset(assetId);
        asset.starBy(userId);
        await this.assetRepository.save(asset);
    }

    async unstarAsset(assetId: string, userId: string): Promise<void> {
        const asset = await this.requireAsset(assetId);
        asset.unstarBy(userId);
        await this.assetRepository.save(asset);
    }

    async listStargazers(assetId: string): Promise<string[]> {
        const asset = await this.requireAsset(assetId);
        return asset.stargazerIds;
    }

    async watchAsset(assetId: string, userId: string): Promise<void> {
        const asset = await this.requireAsset(assetId);
        asset.watchBy(userId);
        await this.assetRepository.save(asset);
    }

    async unwatchAsset(assetId: string, userId: string): Promise<void> {
        const asset = await this.requireAsset(assetId);
        asset.unwatchBy(userId);
        await this.assetRepository.save(asset);
    }

    async listSubscribers(assetId: string): Promise<string[]> {
        const asset = await this.requireAsset(assetId);
        return asset.subscriberIds;
    }

    async forkAsset(sourceAssetId: string, ownerId: string, ownerType: 'user' | 'organization'): Promise<Asset> {
        const source = await this.requireAsset(sourceAssetId);
        const fork = source.forkTo({
            ownerId,
            ownerType,
            name: `${source.name}-fork`,
            cloneUrl: await this.buildCloneUrl(ownerType, ownerId, `${source.name}-fork`),
        });
        await this.assetRepository.save(source);
        await this.assetRepository.save(fork);
        return fork;
    }

    async listForks(sourceAssetId: string): Promise<Asset[]> {
        return this.assetRepository.findForkedFrom(sourceAssetId);
    }

    async listForksPage(sourceAssetId: string, options: PageQueryOptions): Promise<PageResult<Asset>> {
        return this.assetRepository.findPaginated({
            ...options,
            sourceAssetId,
        });
    }

    async listBranches(assetId: string): Promise<Branch[]> {
        const asset = await this.requireAsset(assetId);
        return asset.branches;
    }

    async createBranch(
        assetId: string,
        name: string,
        commitSha: string,
        isProtected?: boolean,
        protection?: { requiredApprovals?: number; requireStatusChecks?: boolean },
    ): Promise<Branch> {
        const asset = await this.requireAsset(assetId);
        // 云端先在真实裸库建分支引用(返回所指真实 sha),元数据再按该 sha 记录,保持两者一致;
        // desktop 无 gitHosting → 退回纯元数据(沿用旧行为)。
        let resolvedSha = commitSha;
        if (this.gitHosting) {
            const result = await this.gitHosting.createBranch(asset, name, commitSha || undefined);
            resolvedSha = result.commitSha;
        }
        const branch = asset.createBranch(name, resolvedSha, isProtected, protection);
        await this.assetRepository.save(asset);
        return branch;
    }

    async updateBranchProtection(
        assetId: string,
        name: string,
        isProtected: boolean,
        protection?: { requiredApprovals?: number; requireStatusChecks?: boolean },
    ): Promise<Branch> {
        const asset = await this.requireAsset(assetId);
        const branch = asset.updateBranchProtection(name, isProtected, protection);
        if (!branch) {
            throw new NotFoundException('Branch not found');
        }
        await this.assetRepository.save(asset);
        return branch;
    }

    async deleteBranch(assetId: string, name: string): Promise<void> {
        const asset = await this.requireAsset(assetId);
        if (this.gitHosting) {
            await this.gitHosting.deleteBranch(asset, name);
        }
        asset.deleteBranch(name);
        await this.assetRepository.save(asset);
    }

    async listTags(assetId: string): Promise<Tag[]> {
        const asset = await this.requireAsset(assetId);
        return asset.tags;
    }

    async createTag(assetId: string, name: string, commitSha: string): Promise<Tag> {
        const asset = await this.requireAsset(assetId);
        let resolvedSha = commitSha;
        if (this.gitHosting) {
            const result = await this.gitHosting.createTag(asset, name, commitSha || undefined);
            resolvedSha = result.commitSha;
        }
        const tag = asset.createTag(name, resolvedSha);
        await this.assetRepository.save(asset);
        return tag;
    }

    async deleteTag(assetId: string, name: string): Promise<void> {
        const asset = await this.requireAsset(assetId);
        if (this.gitHosting) {
            await this.gitHosting.deleteTag(asset, name);
        }
        asset.deleteTag(name);
        await this.assetRepository.save(asset);
    }

    async listReleases(assetId: string): Promise<Release[]> {
        const asset = await this.requireAsset(assetId);
        return asset.releases;
    }

    async getLatestRelease(assetId: string): Promise<Release | null> {
        const asset = await this.requireAsset(assetId);
        const publishedReleases = asset.releases.filter(release => !release.isDraft);
        if (publishedReleases.length === 0) {
            return null;
        }
        return publishedReleases.sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())[0] ?? null;
    }

    async createRelease(
        assetId: string,
        tagName: string,
        name: string,
        body?: string,
        targetCommitish?: string,
        isDraft?: boolean,
        isPrerelease?: boolean,
    ): Promise<Release> {
        const asset = await this.requireAsset(assetId);
        const release = asset.createRelease(tagName, name, body, targetCommitish, isDraft, isPrerelease);
        await this.assetRepository.save(asset);
        return release;
    }

    async updateRelease(
        id: string,
        props: Partial<{ name: string; body: string; isDraft: boolean; isPrerelease: boolean }>,
    ): Promise<Release> {
        const asset = await this.findAssetByReleaseId(id);
        const release = asset.updateRelease(id, props);
        if (!release) {
            throw new NotFoundException('Release not found');
        }
        await this.assetRepository.save(asset);
        return release;
    }

    async deleteRelease(id: string): Promise<void> {
        const asset = await this.findAssetByReleaseId(id);
        asset.deleteRelease(id);
        await this.assetRepository.save(asset);
    }

    async listCollaborators(assetId: string): Promise<Collaborator[]> {
        const asset = await this.requireAsset(assetId);
        return asset.collaborators;
    }

    async addCollaborator(assetId: string, userId: string, permission: Permission): Promise<void> {
        const asset = await this.requireAsset(assetId);
        asset.addCollaborator(userId, permission);
        await this.assetRepository.save(asset);
    }

    async removeCollaborator(assetId: string, userId: string, actorId?: string): Promise<void> {
        const asset = await this.requireAsset(assetId);
        asset.removeCollaborator(userId, actorId);
        await this.assetRepository.save(asset);
    }

    async updateCollaboratorPermission(
        assetId: string,
        userId: string,
        permission: Permission,
        actorId?: string,
    ): Promise<Collaborator> {
        const asset = await this.requireAsset(assetId);
        const collaborator = asset.updateCollaboratorPermission(userId, permission, actorId);
        if (!collaborator) {
            throw new NotFoundException('Collaborator not found');
        }
        await this.assetRepository.save(asset);
        await this.notifyCollaboratorPermissionChanged(asset, collaborator, actorId).catch(error => {
            this.logger.warn(`Failed to create collaborator permission notification: ${this.errorMessage(error)}`);
        });
        return collaborator;
    }

    async listCollaboratorAccessEvents(assetId: string): Promise<CollaboratorAccessEvent[]> {
        const asset = await this.requireAsset(assetId);
        return asset.collaboratorAccessEvents;
    }

    async listCollaboratorInvitations(assetId: string, status?: CollaboratorInvitation['status']): Promise<CollaboratorInvitation[]> {
        const asset = await this.requireAsset(assetId);
        const invitations = asset.collaboratorInvitations;
        if (!status) {
            return invitations;
        }
        return invitations.filter(invitation => this.effectiveCollaboratorInvitationStatus(invitation) === status);
    }

    async inviteCollaborator(
        assetId: string,
        input: CreateCollaboratorInvitationInput,
    ): Promise<CollaboratorInvitation> {
        const asset = await this.requireAsset(assetId);
        const inviteeUserId = this.normalizeOptionalText(input.inviteeUserId);
        const inviteeEmail = this.normalizeOptionalEmail(input.inviteeEmail);
        const inviteeUsername = this.normalizeOptionalUsername(input.inviteeUsername);

        if (!inviteeUserId && !inviteeEmail && !inviteeUsername) {
            throw new BadRequestException('请指定要邀请的用户 ID、邮箱或用户名');
        }
        if (inviteeUserId && inviteeUserId === asset.ownerId) {
            throw new BadRequestException('资产拥有者已拥有完整访问权限，无需邀请');
        }
        if (inviteeUserId && asset.collaborators.some(collaborator => collaborator.userId === inviteeUserId)) {
            throw new BadRequestException('该用户已经是仓库合作者');
        }

        const hasDuplicatePendingInvitation = asset.collaboratorInvitations.some(invitation => (
            this.effectiveCollaboratorInvitationStatus(invitation) === 'pending'
            && this.collaboratorInvitationTargetsOverlap(invitation, { inviteeUserId, inviteeEmail, inviteeUsername })
        ));
        if (hasDuplicatePendingInvitation) {
            throw new BadRequestException('该用户已有待处理的协作邀请');
        }

        const invitation = asset.inviteCollaborator({
            inviteeUserId,
            inviteeEmail,
            inviteeUsername,
            permission: input.permission,
            invitedBy: input.invitedBy,
            expiresAt: input.expiresAt,
        });
        await this.assetRepository.save(asset);
        await this.notifyCollaboratorInvitation(asset, invitation, 'created').catch(error => {
            this.logger.warn(`Failed to create collaborator invitation notification: ${this.errorMessage(error)}`);
        });
        return invitation;
    }

    async resendCollaboratorInvitation(
        assetId: string,
        invitationId: string,
        actorId: string,
        expiresAt?: Date,
    ): Promise<CollaboratorInvitation> {
        const asset = await this.requireAsset(assetId);
        const invitation = asset.resendCollaboratorInvitation(invitationId, actorId, expiresAt);
        if (!invitation) {
            throw new NotFoundException('Collaborator invitation not found');
        }
        await this.assetRepository.save(asset);
        await this.notifyCollaboratorInvitation(asset, invitation, 'resent').catch(error => {
            this.logger.warn(`Failed to create collaborator invitation resend notification: ${this.errorMessage(error)}`);
        });
        return invitation;
    }

    async revokeCollaboratorInvitation(assetId: string, invitationId: string, actorId?: string): Promise<CollaboratorInvitation> {
        const asset = await this.requireAsset(assetId);
        const invitation = asset.revokeCollaboratorInvitation(invitationId, actorId);
        if (!invitation) {
            throw new NotFoundException('Collaborator invitation not found');
        }
        await this.assetRepository.save(asset);
        await this.notifyCollaboratorInvitationOwner(asset, invitation, 'revoked').catch(error => {
            this.logger.warn(`Failed to create collaborator invitation revoke notification: ${this.errorMessage(error)}`);
        });
        return invitation;
    }

    async acceptCollaboratorInvitation(
        assetId: string,
        invitationId: string,
        user: { id: string; email?: string },
    ): Promise<CollaboratorInvitation> {
        const asset = await this.requireAsset(assetId);
        const invitation = asset.collaboratorInvitations.find(item => item.id === invitationId);
        this.assertCollaboratorInvitationActionAllowed(invitation, user);
        if (this.effectiveCollaboratorInvitationStatus(invitation) === 'expired') {
            throw new BadRequestException('该协作邀请已过期');
        }
        const accepted = asset.acceptCollaboratorInvitation(invitationId, user.id);
        if (!accepted) {
            throw new BadRequestException('该协作邀请已被处理');
        }
        await this.assetRepository.save(asset);
        await this.notifyCollaboratorInvitationOwner(asset, accepted, 'accepted').catch(error => {
            this.logger.warn(`Failed to create collaborator invitation accepted notification: ${this.errorMessage(error)}`);
        });
        return accepted;
    }

    async declineCollaboratorInvitation(
        assetId: string,
        invitationId: string,
        user: { id: string; email?: string },
    ): Promise<CollaboratorInvitation> {
        const asset = await this.requireAsset(assetId);
        const invitation = asset.collaboratorInvitations.find(item => item.id === invitationId);
        this.assertCollaboratorInvitationActionAllowed(invitation, user);
        if (this.effectiveCollaboratorInvitationStatus(invitation) === 'expired') {
            throw new BadRequestException('该协作邀请已过期');
        }
        const declined = asset.declineCollaboratorInvitation(invitationId, user.id);
        if (!declined) {
            throw new BadRequestException('该协作邀请已被处理');
        }
        await this.assetRepository.save(asset);
        await this.notifyCollaboratorInvitationOwner(asset, declined, 'declined').catch(error => {
            this.logger.warn(`Failed to create collaborator invitation declined notification: ${this.errorMessage(error)}`);
        });
        return declined;
    }

    async listCollaboratorInvitationsForUser(
        user: { id: string; email?: string },
    ): Promise<CollaboratorInvitationWithAsset[]> {
        const assets = await this.assetRepository.findAll();
        return assets.flatMap(asset => (
            asset.collaboratorInvitations
                .filter(invitation => (
                    this.effectiveCollaboratorInvitationStatus(invitation) === 'pending'
                    && this.collaboratorInvitationMatchesUser(invitation, user)
                ))
                .map(invitation => ({ invitation, asset }))
        ));
    }

    async listCommits(
        assetId: string,
        options?: { limit?: number; offset?: number; ref?: string; path?: string },
    ): Promise<Commit[]> {
        return (await this.listCommitsPage(assetId, options)).items;
    }

    async listCommitsPage(
        assetId: string,
        options?: { limit?: number; offset?: number; ref?: string; path?: string },
    ): Promise<PageResult<Commit>> {
        const asset = await this.requireAsset(assetId);
        const result = await this.gitRepo?.listCommits(asset, options).catch(() => null);
        if (result) {
            const limit = Math.max(1, options?.limit ?? 100);
            const offset = Math.max(0, options?.offset ?? 0);
            return {
                items: result.commits.map(toDomainCommit.bind(null, assetId)),
                total: result.total,
                page: Math.floor(offset / limit) + 1,
                limit,
            };
        }
        const limit = options?.limit;
        const offset = options?.offset || 0;
        const commits = filterMetadataCommits(asset, options);
        const effectiveLimit = Math.max(1, limit ?? (commits.length || 1));
        return {
            items: commits.slice(offset, limit ? offset + limit : undefined),
            total: commits.length,
            page: Math.floor(offset / effectiveLimit) + 1,
            limit: effectiveLimit,
        };
    }

    /**
     * 取资产 git 仓库在指定 ref 处的 tar.gz 归档,用于 serving-isolation 容器
     * 冷启动时拉取源码。若仓库 backend 不可用(desktop fallback / 占位实现),
     * 返回 null,调用方决定是否回退到其他源(目前无回退,直接报 404)。
     */
    async getSourceArchive(assetId: string, ref: string): Promise<Buffer | null> {
        if (!this.gitRepo) return null;
        const asset = await this.requireAsset(assetId);
        return this.gitRepo.archiveSource(asset, ref);
    }

    async getCommit(assetId: string, sha: string): Promise<Commit | null> {
        const asset = await this.requireAsset(assetId);
        const cached = asset.commits.find(
            commit => commit.sha === sha || commit.id === sha || commit.sha.startsWith(sha),
        );
        if (cached) {
            return cached;
        }
        const live = await this.gitRepo?.listCommits(asset, { ref: sha, limit: 1, offset: 0 }).catch(() => null);
        const commit = live?.commits.find(item => item.sha === sha || item.sha.startsWith(sha)) ?? live?.commits[0];
        return commit ? toDomainCommit(assetId, commit) : null;
    }

    async getCommitDiff(assetId: string, sha: string): Promise<string> {
        const asset = await this.requireAsset(assetId);
        const cached = asset.getCommitDiff(sha);
        if (typeof cached === 'string' && cached.length > 0) {
            return cached;
        }
        const live = await this.gitRepo?.getCommitDiff(asset, sha).catch(() => null);
        if (typeof live === 'string') {
            return live;
        }
        if (typeof cached === 'string') {
            return cached;
        }
        throw new NotFoundException('Commit diff not found');
    }

    async compareRefs(assetId: string, base: string, head: string): Promise<AssetComparison> {
        const asset = await this.requireAsset(assetId);
        const live = await this.gitRepo?.compareRefs(asset, base, head).catch(() => null);
        if (live) {
            return {
                assetId,
                base,
                head,
                baseCommitSha: live.baseCommitSha,
                headCommitSha: live.headCommitSha,
                aheadBy: live.aheadBy,
                behindBy: live.behindBy,
                filesChanged: live.filesChanged,
                additions: live.additions,
                deletions: live.deletions,
                commits: live.commits.map(toDomainCommit.bind(null, assetId)),
                diff: live.diff,
            };
        }
        return compareRefsFromMetadata(assetId, asset, base, head);
    }

    async listCommitComments(assetId: string, commitSha: string): Promise<CommitComment[]> {
        const asset = await this.requireAsset(assetId);
        return asset.commitComments.filter(comment => comment.commitSha === commitSha);
    }

    async createCommitComment(
        assetId: string,
        commitSha: string,
        userId: string,
        body: string,
        line?: number,
        filePath?: string,
    ): Promise<CommitComment> {
        const asset = await this.requireAsset(assetId);
        const comment = asset.createCommitComment(commitSha, userId, body, line, filePath);
        await this.assetRepository.save(asset);
        return comment;
    }

    async deleteCommitComment(id: string): Promise<void> {
        const asset = await this.findAssetByCommitCommentId(id);
        asset.deleteCommitComment(id);
        await this.assetRepository.save(asset);
    }

    async listIssues(assetId: string, status?: IssueStatus): Promise<Issue[]> {
        const asset = await this.requireAsset(assetId);
        const issues = status ? asset.issues.filter(item => item.status === status) : asset.issues;
        return [...issues].sort((left, right) => right.number - left.number);
    }

    async getIssue(assetId: string, id: string): Promise<Issue | null> {
        const asset = await this.requireAsset(assetId);
        return asset.issues.find(item => item.id === id || String(item.number) === id) || null;
    }

    async createIssue(input: {
        assetId: string;
        title: string;
        authorId: string;
        body?: string;
        labels?: string[];
        assignees?: string[];
        externalId?: string;
        externalProvider?: 'github';
        externalUrl?: string;
        metadata?: Record<string, unknown>;
    }): Promise<Issue>;
    async createIssue(
        assetId: string,
        title: string,
        authorId: string,
        body?: string,
        labels?: string[],
        assignees?: string[],
        externalId?: string,
        externalProvider?: 'github',
        externalUrl?: string,
    ): Promise<Issue>;
    async createIssue(
        assetIdOrInput:
            | string
            | {
                  assetId: string;
                  title: string;
                  authorId: string;
                  body?: string;
                  labels?: string[];
                  assignees?: string[];
                  externalId?: string;
                  externalProvider?: 'github';
                  externalUrl?: string;
                  metadata?: Record<string, unknown>;
              },
        title?: string,
        authorId?: string,
        body?: string,
        labels?: string[],
        assignees?: string[],
        externalId?: string,
        externalProvider?: 'github',
        externalUrl?: string,
    ): Promise<Issue> {
        const input =
            typeof assetIdOrInput === 'string'
                ? {
                      assetId: assetIdOrInput,
                      title: title!,
                      authorId: authorId!,
                      body,
                      labels,
                      assignees,
                      externalId,
                      externalProvider,
                      externalUrl,
                  }
                : assetIdOrInput;

        const asset = await this.requireAsset(input.assetId);
        const issue = asset.createIssue(input);
        await this.assetRepository.save(asset);
        return issue;
    }

    async updateIssue(
        id: string,
        props: Partial<{ title: string; body: string; labels: string[]; assignees: string[] }>,
    ): Promise<Issue> {
        const asset = await this.findAssetByIssueId(id);
        const issue = asset.updateIssue(id, props);
        if (!issue) {
            throw new NotFoundException('Issue not found');
        }
        await this.assetRepository.save(asset);
        return issue;
    }

    async closeIssue(id: string, closedBy: string): Promise<Issue> {
        const asset = await this.findAssetByIssueId(id);
        const issue = asset.closeIssue(id, closedBy);
        if (!issue) {
            throw new NotFoundException('Issue not found');
        }
        await this.assetRepository.save(asset);
        return issue;
    }

    async reopenIssue(id: string): Promise<Issue> {
        const asset = await this.findAssetByIssueId(id);
        const issue = asset.reopenIssue(id);
        if (!issue) {
            throw new NotFoundException('Issue not found');
        }
        await this.assetRepository.save(asset);
        return issue;
    }

    async listIssueComments(assetId: string, issueId: string): Promise<IssueComment[]> {
        const asset = await this.requireAsset(assetId);
        const issue = asset.issues.find(item => item.id === issueId || String(item.number) === issueId);
        if (!issue) {
            throw new NotFoundException('Issue not found');
        }
        return asset.issueComments
            .filter(comment => comment.issueId === issue.id)
            .sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime());
    }

    async createIssueComment(
        assetId: string,
        issueId: string,
        userId: string,
        body: string,
        options?: ExternalSyncLinkage,
    ): Promise<IssueComment> {
        const asset = await this.requireAsset(assetId);
        const issue = asset.issues.find(item => item.id === issueId || String(item.number) === issueId);
        if (!issue) {
            throw new NotFoundException('Issue not found');
        }
        const comment = asset.createIssueComment(issue.id, userId, body, options);
        await this.assetRepository.save(asset);
        return comment;
    }

    async deleteIssueComment(id: string): Promise<void> {
        const asset = await this.findAssetByIssueCommentId(id);
        asset.deleteIssueComment(id);
        await this.assetRepository.save(asset);
    }

    async listPullRequests(assetId: string, status?: PullRequestStatus): Promise<PullRequest[]> {
        const asset = await this.requireAsset(assetId);
        const pullRequests = status ? asset.pullRequests.filter(item => item.status === status) : asset.pullRequests;
        return [...pullRequests].sort((left, right) => right.number - left.number);
    }

    async getPullRequest(assetId: string, id: string): Promise<PullRequest | null> {
        const asset = await this.requireAsset(assetId);
        return asset.pullRequests.find(item => item.id === id || String(item.number) === id) || null;
    }

    async createPullRequest(input: {
        assetId: string;
        title: string;
        baseRef: string;
        headRef: string;
        authorId: string;
        body?: string;
        assignees?: string[];
        requestedReviewers?: string[];
        externalId?: string;
        externalProvider?: 'github';
        externalUrl?: string;
        metadata?: Record<string, unknown>;
    }): Promise<PullRequest>;
    async createPullRequest(
        assetId: string,
        title: string,
        baseRef: string,
        headRef: string,
        authorId: string,
        body?: string,
        externalId?: string,
        externalProvider?: 'github',
        externalUrl?: string,
    ): Promise<PullRequest>;
    async createPullRequest(
        assetIdOrInput:
            | string
            | {
                  assetId: string;
                  title: string;
                  baseRef: string;
                  headRef: string;
                  authorId: string;
                  body?: string;
                  assignees?: string[];
                  requestedReviewers?: string[];
                  externalId?: string;
                  externalProvider?: 'github';
                  externalUrl?: string;
                  metadata?: Record<string, unknown>;
              },
        title?: string,
        baseRef?: string,
        headRef?: string,
        authorId?: string,
        body?: string,
        externalId?: string,
        externalProvider?: 'github',
        externalUrl?: string,
    ): Promise<PullRequest> {
        const input =
            typeof assetIdOrInput === 'string'
                ? {
                      assetId: assetIdOrInput,
                      title: title!,
                      baseRef: baseRef!,
                      headRef: headRef!,
                      authorId: authorId!,
                      body,
                      externalId,
                      externalProvider,
                      externalUrl,
                  }
                : assetIdOrInput;

        const comparison = await this.compareRefs(input.assetId, input.baseRef, input.headRef);
        const asset = await this.requireAsset(input.assetId);
        const existing = asset.pullRequests.find(
            item => item.status === 'open' && item.baseRef === input.baseRef && item.headRef === input.headRef,
        );
        if (existing) {
            throw new BadRequestException('Pull request already exists');
        }
        const pullRequest = asset.createPullRequest({
            ...input,
            baseCommitSha: comparison.baseCommitSha,
            headCommitSha: comparison.headCommitSha,
            filesChanged: comparison.filesChanged,
            additions: comparison.additions,
            deletions: comparison.deletions,
            commitsCount: comparison.commits.length,
        });
        triggerPullRequestChecks(asset, pullRequest, input.authorId);
        await this.assetRepository.save(asset);
        await this.notifyPullRequestReviewers(asset, pullRequest, input.requestedReviewers ?? [], input.authorId)
            .catch(error => this.logger.warn(`Failed to notify pull request reviewers: ${this.errorMessage(error)}`));
        return pullRequest;
    }

    async updatePullRequest(
        id: string,
        props: Partial<{ title: string; body: string; assignees: string[]; requestedReviewers: string[] }>,
        actorId?: string,
    ): Promise<PullRequest> {
        const asset = await this.findAssetByPullRequestId(id);
        const previous = asset.pullRequests.find(item => item.id === id);
        const pullRequest = asset.updatePullRequest(id, props);
        if (!pullRequest) {
            throw new NotFoundException('Pull request not found');
        }
        await this.assetRepository.save(asset);
        if (props.requestedReviewers !== undefined) {
            const previousReviewers = new Set(previous?.requestedReviewers ?? []);
            const newlyRequested = pullRequest.requestedReviewers.filter(reviewer => !previousReviewers.has(reviewer));
            await this.notifyPullRequestReviewers(asset, pullRequest, newlyRequested, actorId)
                .catch(error => this.logger.warn(`Failed to notify pull request reviewers: ${this.errorMessage(error)}`));
        }
        return pullRequest;
    }

    async closePullRequest(id: string): Promise<PullRequest> {
        const asset = await this.findAssetByPullRequestId(id);
        const pullRequest = asset.closePullRequest(id);
        if (!pullRequest) {
            throw new NotFoundException('Pull request not found');
        }
        await this.assetRepository.save(asset);
        return pullRequest;
    }

    async reopenPullRequest(id: string): Promise<PullRequest> {
        const asset = await this.findAssetByPullRequestId(id);
        const pullRequest = asset.reopenPullRequest(id);
        if (!pullRequest) {
            throw new NotFoundException('Pull request not found');
        }
        await this.assetRepository.save(asset);
        return pullRequest;
    }

    async mergePullRequest(
        id: string,
        mergedBy: string,
        strategy: PullRequestMergeStrategy = 'merge',
    ): Promise<PullRequest> {
        const asset = await this.findAssetByPullRequestId(id);
        const current = asset.pullRequests.find(item => item.id === id);
        if (current?.status !== 'open') {
            throw new BadRequestException('Only open pull requests can be merged');
        }
        const checks = buildPullRequestChecks(asset, current);
        if (checks.required && checks.status !== 'success') {
            throw new BadRequestException('Pull request checks have not passed');
        }
        const autoDeleteHeadBranch = this.shouldAutoDeletePullRequestBranch(asset, current);
        if (this.gitHosting) {
            try {
                // 真合并:把 head 分支按所选策略合并进 base 分支(可快进则快进,否则建合并/压缩/变基提交)。
                // 冲突抛 BadRequest(不写元数据,阻断合并);分支在裸库不存在(纯元数据 PR)抛 NotFound → 回落。
                await this.gitHosting.mergeBranches(asset, current.baseRef, current.headRef, {
                    strategy,
                    message: `Merge pull request #${current.number} (${current.headRef} → ${current.baseRef})`,
                    authorName: mergedBy,
                });
                if (autoDeleteHeadBranch) {
                    await this.gitHosting.deleteBranch(asset, current.headRef);
                }
                await this.gitHosting.syncAssetMetadata(asset, {
                    lastPullRequestMerge: {
                        pullRequestId: current.id,
                        pullRequestNumber: current.number,
                        baseRef: current.baseRef,
                        headRef: current.headRef,
                        strategy,
                        mergedBy,
                        mergedAt: new Date().toISOString(),
                    },
                });
            } catch (error) {
                if (error instanceof NotFoundException) {
                    // 纯元数据 PR(裸库里没有对应分支)→ 退回仅元数据合并,不阻断历史流程。
                    this.logger.warn(`PR ${current.id} 分支在 git 裸库中不存在,按元数据合并:${error.message}`);
                } else {
                    throw error; // 真冲突 / 自合并 → 阻断
                }
            }
        } else {
            this.logger.warn(`PR ${current.id} merged without git hosting; metadata only`);
        }
        const pullRequest = asset.mergePullRequest(id, mergedBy, strategy);
        if (!pullRequest) {
            throw new NotFoundException('Pull request not found');
        }
        if (autoDeleteHeadBranch) {
            asset.deleteBranch(current.headRef);
        }
        await this.assetRepository.save(asset);
        return pullRequest;
    }

    private shouldAutoDeletePullRequestBranch(asset: Asset, pullRequest: PullRequest): boolean {
        if (pullRequest.headRef === pullRequest.baseRef || pullRequest.headRef === asset.defaultBranch) {
            return false;
        }
        const metadata = pullRequest.metadata ?? {};
        const source = typeof metadata.source === 'string' ? metadata.source : undefined;
        const autoDelete = metadata.autoDeleteBranch === true;
        const generatedBranch =
            (source === 'asset-diagnose' &&
                (pullRequest.headRef.startsWith('diagnose/') || pullRequest.headRef.startsWith('optimize/'))) ||
            (source === 'asset-development-board' && pullRequest.headRef.startsWith('dev/'));
        return autoDelete && generatedBranch;
    }

    async getPullRequestChecks(assetId: string, pullRequestId: string): Promise<PullRequestChecks> {
        const asset = await this.requireAsset(assetId);
        const pullRequest = asset.pullRequests.find(
            item => item.id === pullRequestId || String(item.number) === pullRequestId,
        );
        if (!pullRequest) {
            throw new NotFoundException('Pull request not found');
        }
        return buildPullRequestChecks(asset, pullRequest);
    }

    async listPullRequestComments(assetId: string, pullRequestId: string): Promise<PullRequestComment[]> {
        const asset = await this.requireAsset(assetId);
        const pullRequest = asset.pullRequests.find(
            item => item.id === pullRequestId || String(item.number) === pullRequestId,
        );
        if (!pullRequest) {
            throw new NotFoundException('Pull request not found');
        }
        return asset.pullRequestComments
            .filter(comment => comment.pullRequestId === pullRequest.id)
            .sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime());
    }

    async createPullRequestComment(
        assetId: string,
        pullRequestId: string,
        userId: string,
        body: string,
        filePath?: string,
        line?: number,
        side?: PullRequestCommentSide,
        options?: ExternalSyncLinkage,
    ): Promise<PullRequestComment> {
        const asset = await this.requireAsset(assetId);
        const pullRequest = asset.pullRequests.find(
            item => item.id === pullRequestId || String(item.number) === pullRequestId,
        );
        if (!pullRequest) {
            throw new NotFoundException('Pull request not found');
        }
        const comment = asset.createPullRequestComment(pullRequest.id, userId, body, filePath, line, side, options);
        await this.assetRepository.save(asset);
        return comment;
    }

    async deletePullRequestComment(id: string): Promise<void> {
        const asset = await this.findAssetByPullRequestCommentId(id);
        asset.deletePullRequestComment(id);
        await this.assetRepository.save(asset);
    }

    async listPullRequestReviews(assetId: string, pullRequestId: string): Promise<PullRequestReview[]> {
        const asset = await this.requireAsset(assetId);
        const pullRequest = asset.pullRequests.find(
            item => item.id === pullRequestId || String(item.number) === pullRequestId,
        );
        if (!pullRequest) {
            throw new NotFoundException('Pull request not found');
        }
        return asset.pullRequestReviews
            .filter(review => review.pullRequestId === pullRequest.id)
            .sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime());
    }

    async createPullRequestReview(
        assetId: string,
        pullRequestId: string,
        reviewerId: string,
        decision: PullRequestReviewDecision,
        body?: string,
        options?: ExternalSyncLinkage,
    ): Promise<PullRequestReview> {
        const asset = await this.requireAsset(assetId);
        const pullRequest = asset.pullRequests.find(
            item => item.id === pullRequestId || String(item.number) === pullRequestId,
        );
        if (!pullRequest) {
            throw new NotFoundException('Pull request not found');
        }
        // The open-only guard protects interactive review submission; externally synced
        // reviews (which carry an externalId) may belong to already closed/merged PRs.
        if (pullRequest.status !== 'open' && !options?.externalId) {
            throw new BadRequestException('Only open pull requests can be reviewed');
        }
        const review = asset.createPullRequestReview(pullRequest.id, reviewerId, decision, body, options);
        await this.assetRepository.save(asset);
        return review;
    }

    async listBlobs(assetId: string, _treeSha: string): Promise<Blob[]> {
        const asset = await this.requireAsset(assetId);
        return asset.blobs;
    }

    async getBlob(assetId: string, path: string): Promise<Blob | null> {
        const asset = await this.requireAsset(assetId);
        return asset.blobs.find(blob => blob.path === path) || null;
    }

    async getBlobContent(assetId: string, path: string): Promise<string> {
        const asset = await this.requireAsset(assetId);
        const contents = asset.metadata?.blobContents;
        if (contents && typeof contents === 'object' && !Array.isArray(contents)) {
            const content = (contents as Record<string, unknown>)[path];
            if (typeof content === 'string') {
                return content;
            }
        }
        if (this.gitRepo) {
            const blob = await this.gitRepo.readBlob(asset, path, asset.defaultBranch);
            if (blob?.content !== undefined) {
                return blob.encoding === 'base64' ? Buffer.from(blob.content, 'base64').toString('utf8') : blob.content;
            }
        }
        if (asset.content && ['content', 'README.md', 'readme.md'].includes(path)) {
            return asset.content;
        }
        throw new NotFoundException('Blob content not found');
    }

    async updateBlob(
        assetId: string,
        path: string,
        content: string,
        message: string,
        branch: string,
        authorName?: string,
        authorEmail?: string,
    ): Promise<{
        commitSha: string;
        blobSha: string;
        implicitLifecycleTransition?: { from: string; to: string };
    }> {
        const asset = await this.requireAsset(assetId);

        // 隐式 lifecycle 转换：published / packaged 状态收到写入，自动回到 developing。
        // 仅在内存上改 metadata；两条分支下面都会跑 assetRepository.save(asset) 把它落盘。
        const implicit = applyImplicitEditLifecycleTransition(asset, authorName);
        const implicitTransition =
            implicit.transitioned && implicit.from && implicit.to
                ? { from: implicit.from as string, to: implicit.to as string }
                : undefined;

        // cloud 模式（gitRepo provider 已注册）：commitFile 失败必须抛，不再悄悄
        // 落到 metadata 模拟，否则"git 是否生效"变成不可见的运行时状态。
        // desktop 模式（gitRepo 未注册）：走下方 metadata 模拟分支。
        if (this.gitRepo) {
            const result = await this.gitRepo.commitFile(asset, path, content, {
                message: message || `Update ${path}`,
                branch: branch || asset.defaultBranch,
                authorName,
                authorEmail,
            });
            await this.assetRepository.save(asset);
            return {
                commitSha: result.commitSha,
                blobSha: result.blobSha,
                implicitLifecycleTransition: implicitTransition,
            };
        }

        const blobSha = createHash('sha1').update(content).digest('hex');
        const existingContents = (asset.metadata?.blobContents ?? {}) as Record<string, string>;
        const previousContent = existingContents[path];
        existingContents[path] = content;
        const createdAt = new Date();
        const currentBranch = branch || asset.defaultBranch || 'main';
        const parentCommitSha = latestCommitShaForBranch(asset, currentBranch);
        const commitSha = createHash('sha1')
            .update(`${assetId}:${path}:${createdAt.toISOString()}:${content}`)
            .digest('hex');
        const blobs = [
            ...(asset.blobs ?? []).filter(blob => blob.path !== path),
            {
                id: blobSha,
                assetId,
                path,
                size: Buffer.byteLength(content, 'utf8'),
                contentSha: blobSha,
                isBinary: false,
            },
        ];
        const commit = {
            id: commitSha,
            assetId,
            sha: commitSha,
            message: message || `Update ${path}`,
            authorName: authorName || 'internShannon',
            authorEmail: authorEmail || 'system@internshannon.local',
            parentShas: parentCommitSha ? [parentCommitSha] : [],
            treeSha: blobSha,
            createdAt,
        };
        const branches = upsertBranchCommit(asset, currentBranch, commitSha);
        const commitDiffs = {
            ...((asset.metadata?.commitDiffs ?? {}) as Record<string, string>),
            [commitSha]: singleFileDiff(path, previousContent, content),
        };
        asset.updateMetadata({
            blobContents: existingContents,
            blobs,
            commits: [commit, ...(asset.commits ?? [])],
            commitDiffs,
            branches,
        });

        if (['README.md', 'readme.md', 'content'].includes(path)) {
            asset.updateContent(content);
        }

        await this.assetRepository.save(asset);

        return { commitSha, blobSha, implicitLifecycleTransition: implicitTransition };
    }

    async deleteBlob(
        assetId: string,
        path: string,
        message: string,
        branch: string,
        authorName?: string,
        authorEmail?: string,
    ): Promise<{ commitSha: string; deleted: boolean }> {
        const asset = await this.requireAsset(assetId);
        const normalizedPath = this.normalizeBlobPath(path);
        if (!normalizedPath) {
            throw new BadRequestException('文件路径不能为空');
        }
        const currentBranch = branch || asset.defaultBranch || 'main';
        const implicit = applyImplicitEditLifecycleTransition(asset, authorName);

        if (this.gitRepo) {
            if (!this.gitRepo.deleteRepositoryFiles) {
                throw new BadRequestException('当前仓库后端暂不支持删除文件');
            }
            const result = await this.gitRepo.deleteRepositoryFiles(asset, [normalizedPath], {
                message: message || `Delete ${normalizedPath}`,
                branch: currentBranch,
                authorName,
                authorEmail,
            });
            if (implicit.transitioned) {
                await this.assetRepository.save(asset);
            }
            return {
                commitSha: result?.commitSha ?? latestCommitShaForBranch(asset, currentBranch) ?? 'HEAD',
                deleted: Boolean(result),
            };
        }

        const existingContents = { ...((asset.metadata?.blobContents ?? {}) as Record<string, string>) };
        const existingBlobs = asset.blobs ?? [];
        const removedPaths = new Set<string>();
        const isTarget = (candidate: string) =>
            candidate === normalizedPath || candidate.startsWith(`${normalizedPath}/`);

        for (const candidate of Object.keys(existingContents)) {
            if (!isTarget(candidate)) continue;
            removedPaths.add(candidate);
            delete existingContents[candidate];
        }
        for (const blob of existingBlobs) {
            if (isTarget(blob.path)) {
                removedPaths.add(blob.path);
            }
        }
        if (removedPaths.size === 0) {
            throw new NotFoundException('文件不存在');
        }

        const createdAt = new Date();
        const parentCommitSha = latestCommitShaForBranch(asset, currentBranch);
        const commitSha = createHash('sha1')
            .update(`${assetId}:delete:${normalizedPath}:${createdAt.toISOString()}`)
            .digest('hex');
        const commit = this.buildMetadataCommit(
            assetId,
            commitSha,
            message || `Delete ${normalizedPath}`,
            parentCommitSha,
            createdAt,
            authorName,
            authorEmail,
        );
        const branches = upsertBranchCommit(asset, currentBranch, commitSha);
        const commitDiffs = {
            ...((asset.metadata?.commitDiffs ?? {}) as Record<string, string>),
            [commitSha]: this.deletedPathsDiff(Array.from(removedPaths).sort()),
        };
        const blobs = existingBlobs.filter(blob => !removedPaths.has(blob.path)).map(blob => this.serializeBlob(blob));

        asset.updateMetadata({
            blobContents: existingContents,
            blobs,
            commits: [commit, ...(asset.commits ?? [])],
            commitDiffs,
            branches,
        });
        this.refreshAssetContentFromBlobContents(
            asset,
            existingContents,
            ['README.md', 'readme.md', 'content'].some(path => removedPaths.has(path)),
        );

        await this.assetRepository.save(asset);
        return { commitSha, deleted: true };
    }

    async renameBlob(
        assetId: string,
        fromPath: string,
        toPath: string,
        message: string,
        branch: string,
        authorName?: string,
        authorEmail?: string,
    ): Promise<{ commitSha: string; blobSha: string; fromPath: string; toPath: string }> {
        const asset = await this.requireAsset(assetId);
        const normalizedFrom = this.normalizeBlobPath(fromPath);
        const normalizedTo = this.normalizeBlobPath(toPath);
        if (!normalizedFrom || !normalizedTo) {
            throw new BadRequestException('文件路径不能为空');
        }
        if (normalizedFrom === normalizedTo) {
            throw new BadRequestException('新旧路径不能相同');
        }
        if (normalizedTo.startsWith(`${normalizedFrom}/`)) {
            throw new BadRequestException('不能把目录移动到自身内部');
        }
        const currentBranch = branch || asset.defaultBranch || 'main';
        const implicit = applyImplicitEditLifecycleTransition(asset, authorName);

        if (this.gitRepo) {
            const files = await this.collectGitRepositoryFiles(asset, currentBranch, normalizedFrom);
            if (files.length === 0) {
                throw new NotFoundException('文件不存在');
            }
            const isDirectory = files.length > 1 || files[0].path !== normalizedFrom;
            const renamedFiles = files.map(file => ({
                path: isDirectory
                    ? `${normalizedTo}/${file.path.slice(normalizedFrom.length).replace(/^\/+/, '')}`
                    : normalizedTo,
                content: file.content,
            }));
            const result = await this.gitRepo.seedRepositoryFiles(asset, renamedFiles, {
                overwrite: true,
                deletions: [normalizedFrom],
                message: message || `Rename ${normalizedFrom} to ${normalizedTo}`,
                branch: currentBranch,
                authorName,
                authorEmail,
            });
            if (implicit.transitioned) {
                await this.assetRepository.save(asset);
            }
            const commitSha = result?.commitSha ?? latestCommitShaForBranch(asset, currentBranch) ?? 'HEAD';
            return { commitSha, blobSha: commitSha, fromPath: normalizedFrom, toPath: normalizedTo };
        }

        const existingContents = { ...((asset.metadata?.blobContents ?? {}) as Record<string, string>) };
        const existingBlobs = asset.blobs ?? [];
        const movedPaths = new Map<string, string>();
        const isTarget = (candidate: string) =>
            candidate === normalizedFrom || candidate.startsWith(`${normalizedFrom}/`);

        for (const candidate of new Set([...Object.keys(existingContents), ...existingBlobs.map(blob => blob.path)])) {
            if (!isTarget(candidate)) continue;
            const suffix =
                candidate === normalizedFrom ? '' : candidate.slice(normalizedFrom.length).replace(/^\/+/, '');
            movedPaths.set(candidate, suffix ? `${normalizedTo}/${suffix}` : normalizedTo);
        }
        if (movedPaths.size === 0) {
            throw new NotFoundException('文件不存在');
        }
        for (const target of movedPaths.values()) {
            if (
                !movedPaths.has(target) &&
                (existingContents[target] !== undefined || existingBlobs.some(blob => blob.path === target))
            ) {
                throw new BadRequestException(`目标路径已存在：${target}`);
            }
        }

        for (const [source, target] of movedPaths) {
            if (existingContents[source] === undefined) continue;
            existingContents[target] = existingContents[source];
            delete existingContents[source];
        }

        const blobs = existingBlobs.map(blob =>
            this.serializeBlob({
                id: blob.id,
                assetId: blob.assetId,
                path: movedPaths.get(blob.path) ?? blob.path,
                size: blob.size,
                contentSha: blob.contentSha,
                isBinary: blob.isBinary,
            }),
        );
        const createdAt = new Date();
        const parentCommitSha = latestCommitShaForBranch(asset, currentBranch);
        const commitSha = createHash('sha1')
            .update(`${assetId}:rename:${normalizedFrom}:${normalizedTo}:${createdAt.toISOString()}`)
            .digest('hex');
        const blobSha = this.shaForMetadataPaths(existingContents, Array.from(movedPaths.values()));
        const commit = this.buildMetadataCommit(
            assetId,
            commitSha,
            message || `Rename ${normalizedFrom} to ${normalizedTo}`,
            parentCommitSha,
            createdAt,
            authorName,
            authorEmail,
            blobSha,
        );
        const branches = upsertBranchCommit(asset, currentBranch, commitSha);
        const commitDiffs = {
            ...((asset.metadata?.commitDiffs ?? {}) as Record<string, string>),
            [commitSha]: this.renamedPathsDiff(movedPaths),
        };

        asset.updateMetadata({
            blobContents: existingContents,
            blobs,
            commits: [commit, ...(asset.commits ?? [])],
            commitDiffs,
            branches,
        });
        this.refreshAssetContentFromBlobContents(
            asset,
            existingContents,
            ['README.md', 'readme.md', 'content'].some(path => movedPaths.has(path)),
        );

        await this.assetRepository.save(asset);
        return { commitSha, blobSha, fromPath: normalizedFrom, toPath: normalizedTo };
    }

    async searchBlobs(
        assetId: string,
        query: string,
        options?: {
            caseSensitive?: boolean;
            useRegex?: boolean;
            filePattern?: string;
            maxResults?: number;
        },
    ): Promise<
        Array<{
            path: string;
            matches: Array<{
                line: number;
                content: string;
                startColumn: number;
                endColumn: number;
            }>;
        }>
    > {
        const asset = await this.requireAsset(assetId);
        const caseSensitive = options?.caseSensitive ?? false;
        const useRegex = options?.useRegex ?? false;
        const maxResults = options?.maxResults ?? 100;
        const filePattern = options?.filePattern;

        const results: Array<{
            path: string;
            matches: Array<{
                line: number;
                content: string;
                startColumn: number;
                endColumn: number;
            }>;
        }> = [];

        // Merge the metadata-cached contents with the live git tree (cloud mode),
        // so files that only exist in the repository — not in metadata.blobContents — are searchable too.
        const { contents: blobContents, truncated } = await this.gatherSearchableBlobContents(asset);
        if (truncated) {
            this.logger.warn(
                `searchBlobs(${assetId}): repository tree exceeded the scan limit; some files were not searched`,
            );
        }

        // Create search pattern
        let searchPattern: RegExp;
        try {
            if (useRegex) {
                searchPattern = new RegExp(query, caseSensitive ? 'g' : 'gi');
            } else {
                const escapedQuery = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                searchPattern = new RegExp(escapedQuery, caseSensitive ? 'g' : 'gi');
            }
        } catch {
            throw new BadRequestException('Invalid search pattern');
        }

        // Create file pattern if provided
        let filePatternRegex: RegExp | undefined;
        if (filePattern) {
            try {
                filePatternRegex = new RegExp(filePattern);
            } catch {
                throw new BadRequestException('Invalid file pattern');
            }
        }

        // Search through all blobs
        for (const [path, content] of Object.entries(blobContents)) {
            // Skip if file pattern doesn't match
            if (filePatternRegex && !filePatternRegex.test(path)) {
                continue;
            }

            const lines = content.split('\n');
            const matches: Array<{
                line: number;
                content: string;
                startColumn: number;
                endColumn: number;
            }> = [];

            for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
                const lineContent = lines[lineIndex];
                const lineMatches = Array.from(lineContent.matchAll(searchPattern));

                for (const match of lineMatches) {
                    if (match.index !== undefined) {
                        matches.push({
                            line: lineIndex + 1,
                            content: lineContent,
                            startColumn: match.index,
                            endColumn: match.index + match[0].length,
                        });
                    }
                }
            }

            if (matches.length > 0) {
                results.push({ path, matches });

                if (results.length >= maxResults) {
                    break;
                }
            }
        }

        return results;
    }

    /**
     * Collect searchable (text) blob contents for an asset, merging the
     * metadata-cached `blobContents` with the live git tree when a git hosting
     * provider is available (cloud mode). Git contents take precedence over the
     * metadata cache; binary and oversized files are skipped. The walk is bounded
     * to avoid unbounded git invocations on very large repositories.
     */
    private async gatherSearchableBlobContents(
        asset: Asset,
    ): Promise<{ contents: Record<string, string>; truncated: boolean }> {
        const contents: Record<string, string> = {
            ...((asset.metadata?.blobContents ?? {}) as Record<string, string>),
        };

        if (!this.gitRepo) {
            return { contents, truncated: false };
        }

        const SCAN_LIMIT = 2000;
        const MAX_FILE_BYTES = 512 * 1024;
        const ref = asset.defaultBranch;
        const directories: string[] = [''];
        let scanned = 0;
        let truncated = false;

        try {
            while (directories.length > 0) {
                const dir = directories.shift() as string;
                const entries = await this.gitRepo.listTree(asset, ref, dir || undefined).catch(() => []);

                for (const entry of entries) {
                    if (entry.type === 'tree') {
                        directories.push(entry.path);
                        continue;
                    }
                    if (entry.type !== 'blob') {
                        continue;
                    }
                    if (scanned >= SCAN_LIMIT) {
                        truncated = true;
                        break;
                    }
                    if (entry.size !== null && entry.size > MAX_FILE_BYTES) {
                        continue;
                    }
                    scanned++;
                    const blob = await this.gitRepo.readBlob(asset, entry.path, ref).catch(() => null);
                    if (blob && blob.encoding === 'utf8') {
                        contents[entry.path] = blob.content;
                    }
                }

                if (truncated) {
                    break;
                }
            }
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.logger.warn(`searchBlobs git walk failed for ${asset.id}; using metadata cache only: ${message}`);
        }

        return { contents, truncated };
    }

    async syncPipelinesFromDefinitions(assetId: string, definitions: PipelineSourceDefinition[]): Promise<Pipeline[]> {
        const asset = await this.requireAsset(assetId);
        const pipelines = asset.syncPipelinesFromDefinitions(definitions);
        await this.assetRepository.save(asset);
        return pipelines;
    }

    async listActionVariables(assetId: string): Promise<AssetActionVariable[]> {
        const asset = await this.requireAsset(assetId);
        return asset.actionVariables.sort((left, right) => left.name.localeCompare(right.name));
    }

    async upsertActionVariable(assetId: string, name: string, value: string): Promise<AssetActionVariable> {
        const asset = await this.requireAsset(assetId);
        const variable = asset.upsertActionVariable(name, value);
        await this.assetRepository.save(asset);
        return variable;
    }

    async deleteActionVariable(assetId: string, name: string): Promise<void> {
        const asset = await this.requireAsset(assetId);
        asset.deleteActionVariable(name);
        await this.assetRepository.save(asset);
    }

    async listPipelines(assetId: string, limit?: number, offset?: number): Promise<Pipeline[]> {
        const asset = await this.requireAsset(assetId);
        return asset.pipelines.slice(offset || 0, limit ? (offset || 0) + limit : undefined);
    }

    async createPipeline(
        assetId: string,
        name: string,
        filePath: string,
        triggerEvents: string[],
        description?: string,
        isEnabled?: boolean,
    ): Promise<Pipeline> {
        const asset = await this.requireAsset(assetId);
        const pipeline = asset.createPipeline(name, filePath, triggerEvents, description, isEnabled);
        await this.assetRepository.save(asset);
        return pipeline;
    }

    async getPipeline(assetId: string, pipelineId: string): Promise<Pipeline | null> {
        const asset = await this.requireAsset(assetId);
        return asset.pipelines.find(pipeline => pipeline.id === pipelineId) || null;
    }

    async updatePipeline(
        assetId: string,
        pipelineId: string,
        props: Partial<{ name: string; description: string; isEnabled: boolean; triggerEvents: string[] }>,
    ): Promise<Pipeline> {
        const asset = await this.requireAsset(assetId);
        const pipeline = asset.updatePipeline(pipelineId, props);
        if (!pipeline) {
            throw new NotFoundException('Pipeline not found');
        }
        await this.assetRepository.save(asset);
        return pipeline;
    }

    async deletePipeline(assetId: string, pipelineId: string): Promise<void> {
        const asset = await this.requireAsset(assetId);
        asset.deletePipeline(pipelineId);
        await this.assetRepository.save(asset);
    }

    async listAssetPipelineRuns(assetId: string, limit?: number, offset?: number): Promise<PipelineRun[]> {
        const asset = await this.requireAsset(assetId);
        return [...asset.pipelineRuns]
            .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())
            .slice(offset || 0, limit ? (offset || 0) + limit : undefined);
    }

    async getAssetPipelineRun(assetId: string, runId: string): Promise<PipelineRun | null> {
        const asset = await this.requireAsset(assetId);
        return asset.pipelineRuns.find(run => run.id === runId) || null;
    }

    async listPipelineRuns(
        assetId: string,
        pipelineId: string,
        limit?: number,
        offset?: number,
    ): Promise<PipelineRun[]> {
        const asset = await this.requireAsset(assetId);
        return asset.pipelineRuns
            .filter(run => run.pipelineId === pipelineId)
            .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())
            .slice(offset || 0, limit ? (offset || 0) + limit : undefined);
    }

    async dispatchPipelineRun(
        assetId: string,
        pipelineId: string,
        options?: {
            event?: string;
            branch?: string;
            commitSha?: string;
            triggeredBy?: string;
            jobs?: PipelineSourceJob[];
            status?: PipelineRun['status'];
            inputs?: Record<string, string>;
        },
    ): Promise<PipelineRun> {
        const asset = await this.requireAsset(assetId);
        const run = asset.dispatchPipelineRun(pipelineId, options);
        if (!run) {
            throw new NotFoundException('Pipeline not found');
        }
        await this.assetRepository.save(asset);
        return run;
    }

    async getPipelineRun(assetId: string, pipelineId: string, runId: string): Promise<PipelineRun | null> {
        const asset = await this.requireAsset(assetId);
        return asset.pipelineRuns.find(run => run.pipelineId === pipelineId && run.id === runId) || null;
    }

    async cancelPipelineRun(assetId: string, pipelineId: string, runId: string): Promise<PipelineRun> {
        const asset = await this.requireAsset(assetId);
        const run = asset.cancelPipelineRun(pipelineId, runId);
        if (!run) {
            throw new NotFoundException('Pipeline run not found');
        }
        await this.assetRepository.save(asset);
        return run;
    }

    async listPipelineJobs(assetId: string, runId: string, limit?: number, offset?: number): Promise<PipelineJob[]> {
        const asset = await this.requireAsset(assetId);
        return asset.pipelineJobs
            .filter(job => job.runId === runId)
            .slice(offset || 0, limit ? (offset || 0) + limit : undefined);
    }

    async getPipelineJob(assetId: string, runId: string, jobId: string): Promise<PipelineJob | null> {
        const asset = await this.requireAsset(assetId);
        return asset.pipelineJobs.find(job => job.runId === runId && job.id === jobId) || null;
    }

    async getPipelineJobLogs(assetId: string, runId: string, jobId: string): Promise<string> {
        const job = await this.getPipelineJob(assetId, runId, jobId);
        if (!job) {
            throw new NotFoundException('Pipeline job not found');
        }
        return job.logs || '';
    }

    async listPipelineSteps(assetId: string, jobId: string, limit?: number, offset?: number): Promise<PipelineStep[]> {
        const asset = await this.requireAsset(assetId);
        return asset.pipelineSteps
            .filter(step => step.jobId === jobId)
            .slice(offset || 0, limit ? (offset || 0) + limit : undefined);
    }

    async getPipelineRunBundle(
        assetId: string,
        runId: string,
    ): Promise<{ run: PipelineRun; jobs: PipelineJob[]; steps: PipelineStep[] } | null> {
        const asset = await this.requireAsset(assetId);
        const run = asset.pipelineRuns.find(item => item.id === runId);
        if (!run) return null;
        const jobs = asset.pipelineJobs.filter(job => job.runId === runId);
        const jobIds = new Set(jobs.map(job => job.id));
        const steps = asset.pipelineSteps.filter(step => jobIds.has(step.jobId));
        return { run, jobs, steps };
    }

    async createPipelineStep(
        assetId: string,
        jobId: string,
        input: {
            name: string;
            command?: string;
            workingDirectory?: string;
            envVars?: Record<string, string>;
            dependsOn?: string[];
            condition?: string;
        },
    ): Promise<PipelineStep> {
        const asset = await this.requireAsset(assetId);
        const job = asset.pipelineJobs.find(item => item.id === jobId);
        if (!job) {
            throw new NotFoundException('Pipeline job not found');
        }
        const now = new Date();
        const step = {
            id: uuidLike(),
            jobId,
            name: input.name,
            status: 'queued' as const,
            stepNumber: asset.pipelineSteps.filter(item => item.jobId === jobId).length + 1,
            command: input.command,
            workingDirectory: input.workingDirectory,
            envVars: input.envVars,
            dependsOn: input.dependsOn,
            condition: input.condition,
            createdAt: now,
        } as PipelineStep;
        asset.updateMetadata({ pipelineSteps: [step, ...asset.pipelineSteps] });
        await this.assetRepository.save(asset);
        return step;
    }

    async getPipelineStep(assetId: string, jobId: string, stepId: string): Promise<PipelineStep | null> {
        const asset = await this.requireAsset(assetId);
        return asset.pipelineSteps.find(step => step.jobId === jobId && step.id === stepId) || null;
    }

    async getPipelineStepLogs(assetId: string, jobId: string, stepId: string): Promise<string> {
        const step = await this.getPipelineStep(assetId, jobId, stepId);
        if (!step) {
            throw new NotFoundException('Pipeline step not found');
        }
        return step.logs || '';
    }

    async listPipelineArtifacts(
        assetId: string,
        runId: string,
        limit?: number,
        offset?: number,
    ): Promise<PipelineArtifact[]> {
        const asset = await this.requireAsset(assetId);
        return asset.pipelineArtifacts
            .filter(artifact => artifact.runId === runId)
            .slice(offset || 0, limit ? (offset || 0) + limit : undefined);
    }

    async getPipelineArtifact(assetId: string, runId: string, artifactId: string): Promise<PipelineArtifact | null> {
        const asset = await this.requireAsset(assetId);
        return asset.pipelineArtifacts.find(artifact => artifact.runId === runId && artifact.id === artifactId) || null;
    }

    async recordPipelineArtifact(
        assetId: string,
        input: {
            runId: string;
            name: string;
            sizeBytes: number;
            objectKey?: string;
            downloadUrl?: string;
            expiredAt?: Date;
        },
    ): Promise<PipelineArtifact> {
        const asset = await this.requireAsset(assetId);
        const artifact = asset.recordPipelineArtifact(input);
        await this.assetRepository.save(asset);
        return artifact;
    }

    private async notifyCollaboratorInvitation(
        asset: Asset,
        invitation: CollaboratorInvitation,
        action: 'created' | 'resent',
    ): Promise<void> {
        if (!this.notifications || !invitation.inviteeUserId) return;
        const verb = action === 'resent' ? '重新发送了' : '邀请你加入';
        await this.notifications.create({
            userId: invitation.inviteeUserId,
            title: `${asset.name} 的协作邀请`,
            description: `${invitation.invitedBy} ${verb}仓库 ${asset.ownerId}/${asset.name}，权限为 ${invitation.permission}。`,
            level: 'info',
            category: 'asset',
            link: '/admin/assets/collaborators',
            metadata: {
                kind: 'asset_collaborator_invitation',
                action,
                assetId: asset.id,
                assetName: asset.name,
                invitationId: invitation.id,
                permission: invitation.permission,
                expiresAt: invitation.expiresAt.toISOString(),
            },
        });
    }

    private async notifyCollaboratorInvitationOwner(
        asset: Asset,
        invitation: CollaboratorInvitation,
        action: 'accepted' | 'declined' | 'revoked',
    ): Promise<void> {
        if (!this.notifications || !invitation.invitedBy) return;
        const target = invitation.inviteeUsername
            ? `@${invitation.inviteeUsername}`
            : invitation.acceptedBy || invitation.inviteeUserId || invitation.inviteeEmail || '协作者';
        const actionText = action === 'accepted'
            ? '已接受'
            : action === 'declined'
                ? '已拒绝'
                : '已撤销';
        await this.notifications.create({
            userId: invitation.invitedBy,
            title: `${asset.name} 协作邀请${actionText}`,
            description: `${target} ${actionText}仓库 ${asset.ownerId}/${asset.name} 的协作邀请。`,
            level: action === 'accepted' ? 'success' : 'info',
            category: 'asset',
            link: `/admin/assets/${encodeURIComponent(asset.id)}/repository`,
            metadata: {
                kind: 'asset_collaborator_invitation',
                action,
                assetId: asset.id,
                assetName: asset.name,
                invitationId: invitation.id,
                permission: invitation.permission,
            },
        });
    }

    private async notifyCollaboratorPermissionChanged(
        asset: Asset,
        collaborator: Collaborator,
        actorId?: string,
    ): Promise<void> {
        if (!this.notifications) return;
        await this.notifications.create({
            userId: collaborator.userId,
            title: `${asset.name} 的仓库权限已更新`,
            description: `${actorId || asset.ownerId} 将你在 ${asset.ownerId}/${asset.name} 的权限更新为 ${collaborator.permission}。`,
            level: 'info',
            category: 'asset',
            link: `/admin/assets/${encodeURIComponent(asset.id)}/repository`,
            metadata: {
                kind: 'asset_collaborator_permission_updated',
                assetId: asset.id,
                assetName: asset.name,
                permission: collaborator.permission,
                actorId,
            },
        });
    }

    private async notifyPullRequestReviewers(
        asset: Asset,
        pullRequest: PullRequest,
        reviewerIds: string[],
        actorId?: string,
    ): Promise<void> {
        if (!this.notifications) return;
        const uniqueReviewerIds = Array.from(new Set(reviewerIds.map(id => id.trim()).filter(Boolean)))
            .filter(id => id !== actorId);
        await Promise.all(uniqueReviewerIds.map(reviewerId => this.notifications!.create({
            userId: reviewerId,
            title: `${asset.name} 请求你评审 PR #${pullRequest.number}`,
            description: `${actorId || pullRequest.authorId} 请求你评审 ${asset.ownerId}/${asset.name} 的 ${pullRequest.title}。`,
            level: 'info',
            category: 'asset',
            link: `/admin/assets/${encodeURIComponent(asset.id)}/repository`,
            metadata: {
                kind: 'asset_pull_request_review_request',
                assetId: asset.id,
                assetName: asset.name,
                pullRequestId: pullRequest.id,
                pullRequestNumber: pullRequest.number,
                actorId,
            },
        })));
    }

    private errorMessage(error: unknown): string {
        return error instanceof Error ? error.message : String(error);
    }

    private normalizeBlobPath(value: string): string {
        return (value ?? '')
            .replace(/\\/g, '/')
            .split('/')
            .map(segment => segment.trim())
            .filter(segment => segment && segment !== '.' && segment !== '..')
            .join('/');
    }

    private serializeBlob(blob: Pick<Blob, 'id' | 'assetId' | 'path' | 'size' | 'contentSha' | 'isBinary'>) {
        return {
            id: blob.id,
            assetId: blob.assetId,
            path: blob.path,
            size: blob.size,
            contentSha: blob.contentSha,
            isBinary: blob.isBinary,
        };
    }

    private buildMetadataCommit(
        assetId: string,
        commitSha: string,
        message: string,
        parentCommitSha: string | undefined,
        createdAt: Date,
        authorName?: string,
        authorEmail?: string,
        treeSha = commitSha,
    ) {
        return {
            id: commitSha,
            assetId,
            sha: commitSha,
            message,
            authorName: authorName || 'internShannon',
            authorEmail: authorEmail || 'system@internshannon.local',
            parentShas: parentCommitSha ? [parentCommitSha] : [],
            treeSha,
            createdAt,
        };
    }

    private deletedPathsDiff(paths: string[]): string {
        return paths
            .map(path => [`diff --git a/${path} b/${path}`, `--- a/${path}`, '+++ /dev/null', '@@', ''].join('\n'))
            .join('\n');
    }

    private renamedPathsDiff(paths: Map<string, string>): string {
        return Array.from(paths.entries())
            .map(([source, target]) =>
                [
                    `diff --git a/${source} b/${target}`,
                    'similarity index 100%',
                    `rename from ${source}`,
                    `rename to ${target}`,
                    '',
                ].join('\n'),
            )
            .join('\n');
    }

    private shaForMetadataPaths(contents: Record<string, string>, paths: string[]): string {
        const hash = createHash('sha1');
        for (const path of paths.sort()) {
            hash.update(path);
            hash.update('\0');
            hash.update(contents[path] ?? '');
            hash.update('\0');
        }
        return hash.digest('hex');
    }

    private refreshAssetContentFromBlobContents(
        asset: Asset,
        contents: Record<string, string>,
        clearWhenMissing = false,
    ): void {
        const content = contents['README.md'] ?? contents['readme.md'] ?? contents.content;
        if (content !== undefined) {
            asset.updateContent(content);
        } else if (clearWhenMissing) {
            asset.updateContent('');
        }
    }

    private async collectGitRepositoryFiles(asset: Asset, ref: string, path: string): Promise<RepositorySeedFile[]> {
        if (!this.gitRepo) return [];
        const items = await this.gitRepo.listTree(asset, ref, path);
        if (items.length > 0) {
            const nested = await Promise.all(
                items.map(async item => {
                    if (item.type === 'blob') {
                        const childBlob = await this.gitRepo?.readBlob(asset, item.path, ref);
                        return childBlob
                            ? [{ path: childBlob.path, content: this.repositoryBlobContentBuffer(childBlob) }]
                            : [];
                    }
                    if (item.type === 'tree') {
                        return this.collectGitRepositoryFiles(asset, ref, item.path);
                    }
                    return [];
                }),
            );
            return nested.flat();
        }

        const blob = await this.gitRepo.readBlob(asset, path, ref);
        return blob ? [{ path: blob.path, content: this.repositoryBlobContentBuffer(blob) }] : [];
    }

    private repositoryBlobContentBuffer(blob: { encoding: 'utf8' | 'base64'; content: string }): Buffer {
        return blob.encoding === 'base64' ? Buffer.from(blob.content, 'base64') : Buffer.from(blob.content, 'utf8');
    }

    private normalizeOptionalText(value: string | undefined): string | undefined {
        const normalized = value?.trim();
        return normalized ? normalized : undefined;
    }

    private normalizeOptionalEmail(value: string | undefined): string | undefined {
        return this.normalizeOptionalText(value)?.toLowerCase();
    }

    private normalizeOptionalUsername(value: string | undefined): string | undefined {
        return this.normalizeOptionalText(value)?.toLowerCase();
    }

    private effectiveCollaboratorInvitationStatus(
        invitation: CollaboratorInvitation,
    ): CollaboratorInvitation['status'] {
        if (invitation.status === 'pending' && invitation.expiresAt.getTime() < Date.now()) {
            return 'expired';
        }
        return invitation.status;
    }

    private collaboratorInvitationTargetsOverlap(
        invitation: CollaboratorInvitation,
        target: { inviteeUserId?: string; inviteeEmail?: string; inviteeUsername?: string },
    ): boolean {
        return Boolean(
            (target.inviteeUserId && invitation.inviteeUserId === target.inviteeUserId)
            || (target.inviteeEmail && invitation.inviteeEmail === target.inviteeEmail)
            || (target.inviteeUsername && invitation.inviteeUsername === target.inviteeUsername),
        );
    }

    private collaboratorInvitationMatchesUser(
        invitation: CollaboratorInvitation,
        user: { id: string; email?: string },
    ): boolean {
        const email = this.normalizeOptionalEmail(user.email);
        return Boolean(
            invitation.inviteeUserId === user.id
            || (email && invitation.inviteeEmail === email),
        );
    }

    private assertCollaboratorInvitationActionAllowed(
        invitation: CollaboratorInvitation | undefined,
        user: { id: string; email?: string },
    ): asserts invitation is CollaboratorInvitation {
        if (!invitation || !this.collaboratorInvitationMatchesUser(invitation, user)) {
            throw new NotFoundException('Collaborator invitation not found');
        }
    }

    private async requireAsset(id: string): Promise<Asset> {
        const asset = await this.assetRepository.findById(id);
        if (!asset) {
            throw new NotFoundException('Asset not found');
        }
        return asset;
    }

    private assertMutableAsset(asset: Asset): void {
        if (this.isReadOnlyAsset(asset)) {
            throw new ForbiddenException('系统内置只读数字资产不可修改');
        }
    }

    private isReadOnlyAsset(asset: Asset): boolean {
        return asset.metadata?.readOnly === true || asset.metadata?.immutable === true;
    }

    private isDeletionProtectedAsset(asset: Asset): boolean {
        return asset.metadata?.builtin === true || asset.metadata?.deletable === false || this.isReadOnlyAsset(asset);
    }

    private async findAssetByReleaseId(releaseId: string): Promise<Asset> {
        const asset = await this.assetRepository.findByMetadataChildId('releases', releaseId);
        if (!asset) {
            throw new NotFoundException('Release not found');
        }
        return asset;
    }

    private async findAssetByCommitCommentId(commentId: string): Promise<Asset> {
        const asset = await this.assetRepository.findByMetadataChildId('commitComments', commentId);
        if (!asset) {
            throw new NotFoundException('Commit comment not found');
        }
        return asset;
    }

    private async findAssetByPullRequestId(pullRequestId: string): Promise<Asset> {
        const asset = await this.assetRepository.findByMetadataChildId('pullRequests', pullRequestId);
        if (!asset) {
            throw new NotFoundException('Pull request not found');
        }
        return asset;
    }

    private async findAssetByIssueId(issueId: string): Promise<Asset> {
        const asset = await this.assetRepository.findByMetadataChildId('issues', issueId);
        if (!asset) {
            throw new NotFoundException('Issue not found');
        }
        return asset;
    }

    private async findAssetByIssueCommentId(commentId: string): Promise<Asset> {
        const asset = await this.assetRepository.findByMetadataChildId('issueComments', commentId);
        if (!asset) {
            throw new NotFoundException('Issue comment not found');
        }
        return asset;
    }

    private async findAssetByPullRequestCommentId(commentId: string): Promise<Asset> {
        const asset = await this.assetRepository.findByMetadataChildId('pullRequestComments', commentId);
        if (!asset) {
            throw new NotFoundException('Pull request comment not found');
        }
        return asset;
    }

    private async buildCloneUrl(ownerType: 'user' | 'organization', ownerId: string, name: string): Promise<string> {
        return (
            this.assetUrls?.buildGitCloneUrl(ownerType, ownerId, name) ??
            buildAssetGitCloneUrl(ownerType, ownerId, name)
        );
    }
}
