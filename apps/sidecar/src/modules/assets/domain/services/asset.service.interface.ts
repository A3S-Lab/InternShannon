import { PageQueryOptions, PageResult } from '@/shared/domain/pagination';
import { Asset } from '../entities/asset.entity';
import { Blob } from '../entities/blob.entity';
import { Branch } from '../entities/branch.entity';
import { Collaborator } from '../entities/collaborator.entity';
import { CollaboratorAccessEvent } from '../entities/collaborator-access-event.entity';
import { CollaboratorInvitation, CollaboratorInvitationStatus } from '../entities/collaborator-invitation.entity';
import { Commit } from '../entities/commit.entity';
import { CommitComment } from '../entities/commit-comment.entity';
import { Issue, IssueComment, IssueStatus } from '../entities/issue.entity';
import { Pipeline } from '../entities/pipeline.entity';
import { PipelineArtifact } from '../entities/pipeline-artifact.entity';
import { PipelineJob } from '../entities/pipeline-job.entity';
import { PipelineRun } from '../entities/pipeline-run.entity';
import { PipelineStep } from '../entities/pipeline-step.entity';
import {
    PullRequest,
    PullRequestComment,
    PullRequestCommentSide,
    PullRequestMergeStrategy,
    PullRequestReview,
    PullRequestReviewDecision,
    PullRequestStatus,
} from '../entities/pull-request.entity';
import { Release } from '../entities/release.entity';
import { Tag } from '../entities/tag.entity';
import { AssetActionVariable, PipelineSourceDefinition, PipelineSourceJob } from '../entities/asset.entity';
import { AgentKind } from '../value-objects/agent-kind.vo';
import { AssetCategory } from '../value-objects/asset-category.vo';
import { Permission } from '../value-objects/permission.vo';
import { Visibility } from '../value-objects/visibility.vo';
import { AssetCatalogFilters } from '../repositories/asset.repository.interface';

export const ASSET_SERVICE = Symbol('ASSET_SERVICE');

/**
 * Optional external-provider linkage used when persisting issue/PR comments and
 * reviews that originate from an external repository sync or inbound webhook.
 * When `externalId` is set, callers can dedupe re-syncs and webhook re-deliveries.
 */
export interface ExternalSyncLinkage {
    externalId?: string;
    externalProvider?: 'github';
    createdAt?: Date;
    updatedAt?: Date;
}

export interface AssetComparison {
    assetId: string;
    base: string;
    head: string;
    baseCommitSha: string;
    headCommitSha: string;
    aheadBy: number;
    behindBy: number;
    filesChanged: number;
    additions: number;
    deletions: number;
    commits: Commit[];
    diff: string;
}

export interface PullRequestCheckItem {
    pipelineId: string;
    pipelineName: string;
    status: 'success' | 'pending' | 'failure';
    run?: {
        id: string;
        pipelineId: string;
        assetId: string;
        runNumber: number;
        status: PipelineRun['status'];
        conclusion?: PipelineRun['conclusion'];
        event: string;
        branch: string;
        commitSha: string;
        triggeredBy: string;
        inputs?: Record<string, string>;
        startedAt?: Date;
        completedAt?: Date;
        createdAt: Date;
    };
}

export interface PullRequestChecks {
    assetId: string;
    pullRequestId: string;
    required: boolean;
    requireStatusChecks: boolean;
    status: 'success' | 'pending' | 'failure';
    reviewStatus: 'approved' | 'changes_requested' | 'pending';
    approvals: number;
    changesRequested: number;
    requiredApprovals: number;
    items: PullRequestCheckItem[];
}

export interface CreateCollaboratorInvitationInput {
    inviteeUserId?: string;
    inviteeEmail?: string;
    inviteeUsername?: string;
    permission: Permission;
    invitedBy: string;
    expiresAt?: Date;
}

export interface CollaboratorInvitationWithAsset {
    invitation: CollaboratorInvitation;
    asset: Asset;
}

export interface IAssetService {
    // Asset CRUD
    createAsset(
        name: string,
        ownerId: string,
        ownerType: 'user' | 'organization',
        category: AssetCategory,
        visibility: Visibility,
        description?: string,
        homepage?: string,
        metadata?: Record<string, unknown>,
        agentKind?: AgentKind,
    ): Promise<Asset>;
    getAsset(id: string): Promise<Asset | null>;
    /**
     * 解析当前用户的专属知识库,不存在则懒创建(单例由迁移 093 的唯一索引保证)。
     * 专属知识库是一条普通 category='knowledge' 资产,因此内核循环工程的新鲜度
     * 扫描器与 software→knowledge 路由会自动把它纳入维护,无需额外接线。
     */
    getOrCreatePersonalKnowledge(userId: string): Promise<Asset>;
    /**
     * 解析/懒创建【平台文档全局知识库】(internShannon 文档中心,域='platform-docs')。
     * 等价于 getOrCreateGlobalKnowledge('platform-docs'),保留以兼容既有文档同步/检索调用。
     */
    getOrCreateGlobalDocsKnowledge(): Promise<Asset>;
    /**
     * 解析/懒创建某域的【全局知识库】(owner='builtin-docs'/organization, visibility=public,
     * metadata.knowledge.globalDomain=<domain>)。Desktop 本地用户只读可达(public);
     * 维护路径可在线编辑。每个域是一个单例(迁移 100 的部分唯一索引保证)。
     */
    getOrCreateGlobalKnowledge(domain: string, opts?: { name?: string; description?: string }): Promise<Asset>;
    /** 列出所有【全局知识库】(各域),供本地列表与在线管理。 */
    listGlobalKnowledge(): Promise<Asset[]>;
    /**
     * 按域改名 / 改描述(本地在线管理)。经 findGlobalKnowledgeByDomain 解析,域不存在抛
     * NotFound。复用 updateAsset 落库;name 走实体 rename。返回更新后的资产。
     */
    updateGlobalKnowledge(domain: string, props: { name?: string; description?: string }): Promise<Asset>;
    /**
     * 软归档 / 取消归档某域的全局知识库(写 metadata.knowledge.archived,无迁移)。
     * 域不存在抛 NotFound。返回更新后的资产。
     */
    setGlobalKnowledgeArchived(domain: string, archived: boolean): Promise<Asset>;
    /**
     * 设置某域全局知识库的【域管理员 / steward】名单(写 metadata.knowledge.maintainers,
     * 无迁移)。名单内的本地用户被授权【在线编辑该特定域】。入参按 userId 原样接收,
     * 去重、去空后整列覆盖写回;域不存在抛 NotFound。返回更新后的资产。
     */
    setGlobalKnowledgeMaintainers(domain: string, identifiers: string[]): Promise<Asset>;
    /**
     * 列出某域全局知识库当前的域管理员(已存 userId)。桌面版没有用户资料库,
     * username / email 固定为 null。域不存在抛 NotFound。供管理端点列表展示。
     */
    getGlobalKnowledgeMaintainers(domain: string): Promise<{
        asset: Asset;
        maintainers: Array<{ userId: string; username: string | null; email: string | null }>;
    }>;
    /**
     * Like {@link getAsset} but omits the heavy `metadata.blobContents` file
     * tree. Use on read paths that never touch file contents (asset detail /
     * permission checks) to avoid the >1 MB detoast/transfer/parse that
     * dominates `GET /assets/:id`. See IAssetRepository.findCoreById.
     */
    getAssetCore(id: string): Promise<Asset | null>;
    /**
     * Batch lookup — single SQL WHERE id IN (...). Use whenever you'd otherwise
     * loop getAsset (enriching marketplace listings / graph nodes / etc.).
     */
    getAssets(ids: string[]): Promise<Asset[]>;
    findByOwnerAndName(owner: string, name: string): Promise<Asset | null>;
    /**
     * Exact lookup by `owner_id` + `name` (no username/org-slug resolution, unlike
     * {@link findByOwnerAndName}). Returns the single owned asset with that name, or
     * null. Used to detect name collisions before auto-naming a draft agent.
     */
    findByName(ownerId: string, name: string): Promise<Asset | null>;
    saveAsset(asset: Asset): Promise<void>;
    updateAsset(
        id: string,
        props: Partial<{
            description: string;
            homepage: string;
            defaultBranch: string;
            metadata: Record<string, unknown>;
            agentKind: AgentKind;
        }>,
    ): Promise<Asset>;
    deleteAsset(id: string): Promise<void>;
    listAssetsPage(
        options: PageQueryOptions & {
            ownerId?: string;
            ownerType?: 'user' | 'organization';
            category?: AssetCategory;
            visibility?: Visibility;
        } & AssetCatalogFilters,
    ): Promise<PageResult<Asset>>;
    listAccessibleAssetsPage(
        options: PageQueryOptions & {
            userId: string;
            organizationIds?: string[];
            ownerId?: string;
            ownerType?: 'user' | 'organization';
            category?: AssetCategory;
            visibility?: Visibility;
            /** Desktop 兼容字段：跳过 accessFilter，可见全部资产。 */
            platformBypass?: boolean;
        } & AssetCatalogFilters,
    ): Promise<PageResult<Asset>>;
    listUserAssets(userId: string): Promise<Asset[]>;
    listUserAssetsPage(
        userId: string,
        options: PageQueryOptions & { category?: AssetCategory; visibility?: Visibility } & AssetCatalogFilters,
    ): Promise<PageResult<Asset>>;
    listPublicAssetsPage(
        options: PageQueryOptions & { category?: AssetCategory } & AssetCatalogFilters,
    ): Promise<PageResult<Asset>>;
    listForksPage(sourceAssetId: string, options: PageQueryOptions): Promise<PageResult<Asset>>;
    listPublicAssets(limit: number, offset: number): Promise<Asset[]>;

    // Star
    starAsset(assetId: string, userId: string): Promise<void>;
    unstarAsset(assetId: string, userId: string): Promise<void>;
    listStargazers(assetId: string): Promise<string[]>;

    // Watch
    watchAsset(assetId: string, userId: string): Promise<void>;
    unwatchAsset(assetId: string, userId: string): Promise<void>;
    listSubscribers(assetId: string): Promise<string[]>;

    // Fork
    forkAsset(sourceAssetId: string, ownerId: string, ownerType: 'user' | 'organization'): Promise<Asset>;
    listForks(sourceAssetId: string): Promise<Asset[]>;

    // Branch
    listBranches(assetId: string): Promise<Branch[]>;
    createBranch(
        assetId: string,
        name: string,
        commitSha: string,
        isProtected?: boolean,
        protection?: { requiredApprovals?: number; requireStatusChecks?: boolean },
    ): Promise<Branch>;
    updateBranchProtection(
        assetId: string,
        name: string,
        isProtected: boolean,
        protection?: { requiredApprovals?: number; requireStatusChecks?: boolean },
    ): Promise<Branch>;
    deleteBranch(assetId: string, name: string): Promise<void>;

    // Tag
    listTags(assetId: string): Promise<Tag[]>;
    createTag(assetId: string, name: string, commitSha: string): Promise<Tag>;
    deleteTag(assetId: string, name: string): Promise<void>;

    // Release
    listReleases(assetId: string): Promise<Release[]>;
    getLatestRelease(assetId: string): Promise<Release | null>;
    createRelease(
        assetId: string,
        tagName: string,
        name: string,
        body?: string,
        targetCommitish?: string,
        isDraft?: boolean,
        isPrerelease?: boolean,
    ): Promise<Release>;
    updateRelease(
        id: string,
        props: Partial<{ name: string; body: string; isDraft: boolean; isPrerelease: boolean }>,
    ): Promise<Release>;
    deleteRelease(id: string): Promise<void>;

    // Collaborator
    listCollaborators(assetId: string): Promise<Collaborator[]>;
    addCollaborator(assetId: string, userId: string, permission: Permission): Promise<void>;
    removeCollaborator(assetId: string, userId: string, actorId?: string): Promise<void>;
    updateCollaboratorPermission(assetId: string, userId: string, permission: Permission, actorId?: string): Promise<Collaborator>;
    listCollaboratorAccessEvents(assetId: string): Promise<CollaboratorAccessEvent[]>;
    listCollaboratorInvitations(assetId: string, status?: CollaboratorInvitationStatus): Promise<CollaboratorInvitation[]>;
    inviteCollaborator(assetId: string, input: CreateCollaboratorInvitationInput): Promise<CollaboratorInvitation>;
    resendCollaboratorInvitation(
        assetId: string,
        invitationId: string,
        actorId: string,
        expiresAt?: Date,
    ): Promise<CollaboratorInvitation>;
    revokeCollaboratorInvitation(assetId: string, invitationId: string, actorId?: string): Promise<CollaboratorInvitation>;
    acceptCollaboratorInvitation(
        assetId: string,
        invitationId: string,
        user: { id: string; email?: string },
    ): Promise<CollaboratorInvitation>;
    declineCollaboratorInvitation(
        assetId: string,
        invitationId: string,
        user: { id: string; email?: string },
    ): Promise<CollaboratorInvitation>;
    listCollaboratorInvitationsForUser(
        user: { id: string; email?: string },
    ): Promise<CollaboratorInvitationWithAsset[]>;

    // Commit
    listCommits(
        assetId: string,
        options?: { limit?: number; offset?: number; ref?: string; path?: string },
    ): Promise<Commit[]>;
    listCommitsPage(
        assetId: string,
        options?: { limit?: number; offset?: number; ref?: string; path?: string },
    ): Promise<PageResult<Commit>>;
    getCommit(assetId: string, sha: string): Promise<Commit | null>;
    getCommitDiff(assetId: string, sha: string): Promise<string>;
    compareRefs(assetId: string, base: string, head: string): Promise<AssetComparison>;
    listCommitComments(assetId: string, commitSha: string): Promise<CommitComment[]>;
    createCommitComment(
        assetId: string,
        commitSha: string,
        userId: string,
        body: string,
        line?: number,
        filePath?: string,
    ): Promise<CommitComment>;
    deleteCommitComment(id: string): Promise<void>;

    // Issue
    listIssues(assetId: string, status?: IssueStatus): Promise<Issue[]>;
    getIssue(assetId: string, id: string): Promise<Issue | null>;
    createIssue(input: {
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
    createIssue(
        assetId: string,
        title: string,
        authorId: string,
        body?: string,
        labels?: string[],
        assignees?: string[],
    ): Promise<Issue>;
    updateIssue(
        id: string,
        props: Partial<{ title: string; body: string; labels: string[]; assignees: string[] }>,
    ): Promise<Issue>;
    closeIssue(id: string, closedBy: string): Promise<Issue>;
    reopenIssue(id: string): Promise<Issue>;
    listIssueComments(assetId: string, issueId: string): Promise<IssueComment[]>;
    createIssueComment(
        assetId: string,
        issueId: string,
        userId: string,
        body: string,
        options?: ExternalSyncLinkage,
    ): Promise<IssueComment>;
    deleteIssueComment(id: string): Promise<void>;

    // Pull Request
    listPullRequests(assetId: string, status?: PullRequestStatus): Promise<PullRequest[]>;
    getPullRequest(assetId: string, id: string): Promise<PullRequest | null>;
    createPullRequest(input: {
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
    createPullRequest(
        assetId: string,
        title: string,
        baseRef: string,
        headRef: string,
        authorId: string,
        body?: string,
    ): Promise<PullRequest>;
    updatePullRequest(
        id: string,
        props: Partial<{ title: string; body: string; assignees: string[]; requestedReviewers: string[] }>,
        actorId?: string,
    ): Promise<PullRequest>;
    closePullRequest(id: string): Promise<PullRequest>;
    reopenPullRequest(id: string): Promise<PullRequest>;
    mergePullRequest(id: string, mergedBy: string, strategy?: PullRequestMergeStrategy): Promise<PullRequest>;
    getPullRequestChecks(assetId: string, pullRequestId: string): Promise<PullRequestChecks>;
    listPullRequestComments(assetId: string, pullRequestId: string): Promise<PullRequestComment[]>;
    createPullRequestComment(
        assetId: string,
        pullRequestId: string,
        userId: string,
        body: string,
        filePath?: string,
        line?: number,
        side?: PullRequestCommentSide,
        options?: ExternalSyncLinkage,
    ): Promise<PullRequestComment>;
    deletePullRequestComment(id: string): Promise<void>;
    listPullRequestReviews(assetId: string, pullRequestId: string): Promise<PullRequestReview[]>;
    createPullRequestReview(
        assetId: string,
        pullRequestId: string,
        reviewerId: string,
        decision: PullRequestReviewDecision,
        body?: string,
        options?: ExternalSyncLinkage,
    ): Promise<PullRequestReview>;

    // Blob
    listBlobs(assetId: string, treeSha: string): Promise<Blob[]>;
    getBlob(assetId: string, path: string): Promise<Blob | null>;
    getBlobContent(assetId: string, path: string): Promise<string>;
    /**
     * 拉资产 git 仓库在指定 ref(branch/tag/commit)处的 tar.gz 归档,
     * 仅服务于 serving-isolation 容器冷启动拉源码。null 表示后端不支持归档。
     */
    getSourceArchive(assetId: string, ref: string): Promise<Buffer | null>;
    updateBlob(
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
    }>;
    deleteBlob(
        assetId: string,
        path: string,
        message: string,
        branch: string,
        authorName?: string,
        authorEmail?: string,
    ): Promise<{ commitSha: string; deleted: boolean }>;
    renameBlob(
        assetId: string,
        fromPath: string,
        toPath: string,
        message: string,
        branch: string,
        authorName?: string,
        authorEmail?: string,
    ): Promise<{ commitSha: string; blobSha: string; fromPath: string; toPath: string }>;
    searchBlobs(
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
    >;

    // Pipeline / A3S Actions
    syncPipelinesFromDefinitions(assetId: string, definitions: PipelineSourceDefinition[]): Promise<Pipeline[]>;
    listActionVariables(assetId: string): Promise<AssetActionVariable[]>;
    upsertActionVariable(assetId: string, name: string, value: string): Promise<AssetActionVariable>;
    deleteActionVariable(assetId: string, name: string): Promise<void>;
    listPipelines(assetId: string, limit?: number, offset?: number): Promise<Pipeline[]>;
    createPipeline(
        assetId: string,
        name: string,
        filePath: string,
        triggerEvents: string[],
        description?: string,
        isEnabled?: boolean,
    ): Promise<Pipeline>;
    getPipeline(assetId: string, pipelineId: string): Promise<Pipeline | null>;
    updatePipeline(
        assetId: string,
        pipelineId: string,
        props: Partial<{ name: string; description: string; isEnabled: boolean; triggerEvents: string[] }>,
    ): Promise<Pipeline>;
    deletePipeline(assetId: string, pipelineId: string): Promise<void>;
    listAssetPipelineRuns(assetId: string, limit?: number, offset?: number): Promise<PipelineRun[]>;
    getAssetPipelineRun(assetId: string, runId: string): Promise<PipelineRun | null>;
    /**
     * Single-load bundle for a run's logs view: the run plus all its jobs and
     * their steps, derived from ONE asset read. Replaces the facade's prior
     * listPipelineJobs + per-job listPipelineSteps fan-out (each of which
     * reloaded the whole asset row, including blob-laden metadata).
     */
    getPipelineRunBundle(
        assetId: string,
        runId: string,
    ): Promise<{ run: PipelineRun; jobs: PipelineJob[]; steps: PipelineStep[] } | null>;
    listPipelineRuns(assetId: string, pipelineId: string, limit?: number, offset?: number): Promise<PipelineRun[]>;
    dispatchPipelineRun(
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
    ): Promise<PipelineRun>;
    getPipelineRun(assetId: string, pipelineId: string, runId: string): Promise<PipelineRun | null>;
    cancelPipelineRun(assetId: string, pipelineId: string, runId: string): Promise<PipelineRun>;
    listPipelineJobs(assetId: string, runId: string, limit?: number, offset?: number): Promise<PipelineJob[]>;
    getPipelineJob(assetId: string, runId: string, jobId: string): Promise<PipelineJob | null>;
    getPipelineJobLogs(assetId: string, runId: string, jobId: string): Promise<string>;
    listPipelineSteps(assetId: string, jobId: string, limit?: number, offset?: number): Promise<PipelineStep[]>;
    createPipelineStep(
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
    ): Promise<PipelineStep>;
    getPipelineStep(assetId: string, jobId: string, stepId: string): Promise<PipelineStep | null>;
    getPipelineStepLogs(assetId: string, jobId: string, stepId: string): Promise<string>;
    listPipelineArtifacts(assetId: string, runId: string, limit?: number, offset?: number): Promise<PipelineArtifact[]>;
    getPipelineArtifact(assetId: string, runId: string, artifactId: string): Promise<PipelineArtifact | null>;
    recordPipelineArtifact(
        assetId: string,
        input: {
            runId: string;
            name: string;
            sizeBytes: number;
            objectKey?: string;
            downloadUrl?: string;
            expiredAt?: Date;
        },
    ): Promise<PipelineArtifact>;
}
