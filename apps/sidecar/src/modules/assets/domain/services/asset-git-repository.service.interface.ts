import type { Asset } from '../entities/asset.entity';

export const ASSET_GIT_REPOSITORY_SERVICE = Symbol('ASSET_GIT_REPOSITORY_SERVICE');

export type GitRepositoryRef = {
    assetId?: string;
    ownerType: 'user' | 'organization';
    owner: string;
    repo: string;
};

export type RepositoryRefDto = {
    name: string;
    type: 'branch' | 'tag';
    sha: string;
};

export type RepositoryTreeItemDto = {
    path: string;
    name: string;
    type: 'tree' | 'blob' | 'commit';
    mode: string;
    sha: string;
    size: number | null;
};

export type RepositoryBlobDto = {
    path: string;
    encoding: 'utf8' | 'base64';
    content: string;
    size: number;
};

export type RepositorySeedFile = {
    path: string;
    content: string | Buffer;
};

export type RepositorySeedResult = {
    commitSha: string;
    treeSha: string;
    defaultBranch?: string;
    remoteSynced?: boolean;
    remoteSyncError?: string;
};

export type RepositoryCommitFileOptions = {
    message: string;
    branch?: string;
    authorName?: string;
    authorEmail?: string;
};

export type RepositoryCommitFileResult = {
    commitSha: string;
    blobSha: string;
    branch: string;
};

export type GitPushRefUpdate = {
    oldSha: string;
    newSha: string;
    refName: string;
    branch?: string;
    tag?: string;
    created: boolean;
    deleted: boolean;
};

export type RepositoryCommitDto = {
    sha: string;
    message: string;
    authorName: string;
    authorEmail: string;
    parentShas: string[];
    treeSha: string;
    createdAt: string;
};

export type RepositoryMetadataSnapshot = {
    defaultBranch: string;
    refs: RepositoryRefDto[];
    commits: RepositoryCommitDto[];
    commitCount: number;
    commitDiffs: Record<string, string>;
};

export type RepositoryCompareResult = {
    base: string;
    head: string;
    baseCommitSha: string;
    headCommitSha: string;
    aheadBy: number;
    behindBy: number;
    filesChanged: number;
    additions: number;
    deletions: number;
    commits: RepositoryCommitDto[];
    diff: string;
};

export type RepositoryCommitListOptions = {
    ref?: string;
    path?: string;
    limit?: number;
    offset?: number;
};

export type RepositoryCommitListResult = {
    commits: RepositoryCommitDto[];
    total: number;
};

export type MirrorRemoteRepositoryOptions = {
    overwrite?: boolean;
    username?: string;
    password?: string;
};

export type RepositoryCommitDiffResult = {
    branch: string;
    commitSha: string;
};

export type MaterializedAssetWorktree = {
    workdir: string;
    sourceRevision: string;
};

export type MaterializeAssetWorktreeOptions = {
    workdirPrefix?: string;
    preferredBranch?: string;
};

export interface IAssetGitRepositoryService {
    toRepositoryRef(asset: Asset): GitRepositoryRef;
    ensureAssetRepository(asset: Asset): Promise<string>;
    listRefs(asset: Asset): Promise<RepositoryRefDto[]>;
    listTree(asset: Asset, ref?: string, treePath?: string): Promise<RepositoryTreeItemDto[]>;
    readBlob(asset: Asset, filePath: string, ref?: string): Promise<RepositoryBlobDto | null>;
    seedRepositoryFiles(
        asset: Asset,
        files: RepositorySeedFile[],
        options?: {
            message?: string;
            authorName?: string;
            authorEmail?: string;
            overwrite?: boolean;
            deletions?: string[];
            branch?: string;
        },
    ): Promise<RepositorySeedResult | null>;
    deleteRepositoryFiles(
        asset: Asset,
        paths: string[],
        options?: { message?: string; authorName?: string; authorEmail?: string; branch?: string },
    ): Promise<RepositorySeedResult | null>;
    syncAssetMetadata(asset: Asset, patch?: Record<string, unknown>): Promise<RepositoryMetadataSnapshot>;
    getCommitDiff(asset: Asset, sha: string): Promise<string | null>;
    compareRefs(asset: Asset, base: string, head: string): Promise<RepositoryCompareResult | null>;
    listCommits(asset: Asset, options?: RepositoryCommitListOptions): Promise<RepositoryCommitListResult>;
    commitFile(
        asset: Asset,
        filePath: string,
        content: string,
        options: RepositoryCommitFileOptions,
    ): Promise<RepositoryCommitFileResult>;
    /**
     * Produce a gzipped tar archive of the repo at `ref` —— used by serving-isolation
     * SharedRuntime containers to fetch source on cold start. Implementation MUST
     * stream output as `tar.gz` (Content-Type: application/gzip).
     *
     * Returns the full archive buffer rather than a stream: tool source is small
     * (typically < 1 MB), and a buffer keeps the controller layer free of stream
     * lifecycle concerns. Switch to a stream variant if/when large monorepos
     * become a real use case.
     */
    archiveSource(asset: Asset, ref: string): Promise<Buffer>;
    /** 镜像一个外部远端仓库到资产仓库(import 流程用)。 */
    mirrorRemoteRepository(
        asset: Asset,
        remoteUrl: string,
        options?: MirrorRemoteRepositoryOptions,
    ): Promise<RepositorySeedResult | null>;
    /** 把一段 unified diff 作为一次提交落到指定分支(开发看板/任务产物回写用)。 */
    commitDiffToBranch(
        asset: Asset,
        diff: string,
        options: {
            branch: string;
            baseBranch?: string;
            message: string;
            authorName?: string;
            authorEmail?: string;
        },
    ): Promise<RepositoryCommitDiffResult>;
    /**
     * 把一组按文件维度的补丁作为一次提交落到指定分支。
     *
     * 与 {@link commitDiffToBranch} 不同,本方法不使用 `git apply`:诊断/优化 agent
     * 产出的 diff 是“伪 diff”(hunk 头是函数签名提示而非 `@@ -N,M +N,M @@`,且常缺
     * `--- a/ +++ b/` 文件头),git apply 会拒绝。这里改为按 hunk 上下文内容匹配
     * (忽略行号)逐个文件应用后写回。每个补丁须自带目标 `path` 作为定位事实源。
     */
    commitPatchesToBranch(
        asset: Asset,
        patches: Array<{ path: string; diff: string }>,
        options: {
            branch: string;
            baseBranch?: string;
            message: string;
            authorName?: string;
            authorEmail?: string;
        },
    ): Promise<RepositoryCommitDiffResult>;
    /** 把资产仓库某可用分支检出到临时工作区(任务模型 cold-start 取源用)。 */
    materializeAssetWorktree(
        asset: Asset,
        options?: MaterializeAssetWorktreeOptions,
    ): Promise<MaterializedAssetWorktree>;
    /** 删除资产对应的整个 git 仓库(资产删除级联用)。 */
    deleteAssetRepository(asset: Asset): Promise<void>;
    /** 删除资产仓库的某个分支(自动合并 PR 后清理 head 分支用)。 */
    deleteBranch(asset: Asset, branch: string): Promise<void>;
    /** 把 head 分支快进合并到 base 分支,返回合并后提交 sha(自动合并 PR 用)。 */
    fastForwardBranch(asset: Asset, baseBranch: string, headBranch: string): Promise<{ commitSha: string }>;
    /** 在裸库里创建分支(指向 fromRef / 缺省默认分支 HEAD),返回所指 commit sha;已存在则报错。 */
    createBranch(asset: Asset, name: string, fromRef?: string): Promise<{ commitSha: string }>;
    /** 在裸库里创建轻量标签(指向 fromRef / 缺省默认分支 HEAD);已存在则报错。 */
    createTag(asset: Asset, name: string, fromRef?: string): Promise<{ commitSha: string }>;
    /** 删除裸库里的标签(不存在则幂等)。 */
    deleteTag(asset: Asset, name: string): Promise<void>;
    /**
     * 把 head 分支按策略真实合并进 base 分支:可快进则快进,否则在临时工作区建合并/压缩/变基提交后推回。
     * 冲突或分支自合并抛 BadRequest;分支在裸库不存在抛 NotFound(供调用方回落元数据合并)。
     */
    mergeBranches(
        asset: Asset,
        baseBranch: string,
        headBranch: string,
        options?: {
            strategy?: 'merge' | 'squash' | 'rebase';
            message?: string;
            authorName?: string;
            authorEmail?: string;
        },
    ): Promise<{ commitSha: string; fastForward: boolean }>;
}
