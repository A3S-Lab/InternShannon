import { randomUUID } from 'node:crypto';
import { NotFoundException } from '@/shared/common/errors';
import type { Asset } from '../domain/entities/asset.entity';
import type {
    Commit,
    PipelineRun,
    PullRequest,
    PullRequestReview,
} from '../domain/entities';
import type { AssetComparison, PullRequestChecks } from '../domain/services/asset.service.interface';
import {
    AssetLifecycleHistoryEntry,
    AssetLifecycleMetadata,
    AssetLifecycleState,
    assetLifecycleRule,
    isAssetLifecycleState,
} from '../domain/value-objects/asset-lifecycle.vo';

// ==================== generic helpers ====================

export function recordValue(value: unknown): Record<string, unknown> | undefined {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : undefined;
}

export function uuidLike(): string {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

// ==================== commit mappers / utilities ====================

export function toDomainCommit(
    assetId: string,
    source: {
        sha: string;
        message: string;
        authorName: string;
        authorEmail: string;
        parentShas: string[];
        treeSha: string;
        createdAt: string;
    },
): Commit {
    return {
        id: source.sha,
        assetId,
        sha: source.sha,
        message: source.message,
        authorName: source.authorName,
        authorEmail: source.authorEmail,
        parentShas: source.parentShas,
        treeSha: source.treeSha,
        createdAt: new Date(source.createdAt),
    } as Commit;
}

export function resolveRefSha(asset: Asset, ref: string): string {
    const normalized = ref.trim();
    const branch = asset.branches.find(item => item.name === normalized);
    if (branch) {
        return branch.commitSha;
    }
    const tag = asset.tags.find(item => item.name === normalized);
    if (tag) {
        return tag.commitSha;
    }
    const commit = asset.commits.find(item => item.sha === normalized || item.sha.startsWith(normalized));
    if (commit) {
        return commit.sha;
    }
    return normalized;
}

export function filterMetadataCommits(asset: Asset, options?: { ref?: string; path?: string }): Commit[] {
    const ref = options?.ref?.trim();
    const path = options?.path?.trim();
    let commits = asset.commits ?? [];
    if (ref) {
        const resolved = resolveRefSha(asset, ref);
        commits = commits.filter(commit => commit.sha === resolved || commit.sha.startsWith(resolved));
        if (commits.length === 0) {
            commits = (asset.commits ?? []).filter(commit => commit.sha === ref || commit.sha.startsWith(ref));
        }
    }
    if (path) {
        commits = commits.filter(commit => (asset.getCommitDiff(commit.sha) ?? '').includes(path));
    }
    return commits;
}

export function latestCommitShaForBranch(asset: Asset, branch: string): string | undefined {
    const branchCommit = (asset.branches ?? []).find(item => item.name === branch)?.commitSha;
    return branchCommit || (asset.commits ?? [])[0]?.sha;
}

export function upsertBranchCommit(
    asset: Asset,
    branch: string,
    commitSha: string,
): Array<Record<string, unknown>> {
    const branches = asset.branches ?? [];
    const now = new Date();
    if (branches.some(item => item.name === branch)) {
        return branches.map(item => ({
            id: item.id,
            assetId: item.assetId,
            name: item.name,
            isProtected: item.isProtected,
            requiredApprovals: item.requiredApprovals,
            requireStatusChecks: item.requireStatusChecks,
            commitSha: item.name === branch ? commitSha : item.commitSha,
            createdAt: item.createdAt,
        }));
    }
    return [
        ...branches.map(item => ({
            id: item.id,
            assetId: item.assetId,
            name: item.name,
            isProtected: item.isProtected,
            requiredApprovals: item.requiredApprovals,
            requireStatusChecks: item.requireStatusChecks,
            commitSha: item.commitSha,
            createdAt: item.createdAt,
        })),
        {
            id: randomUUID(),
            assetId: asset.id,
            name: branch,
            isProtected: false,
            requiredApprovals: 0,
            requireStatusChecks: false,
            commitSha,
            createdAt: now,
        },
    ];
}

// ==================== diff utilities ====================

export function singleFileDiff(path: string, previous: string | undefined, next: string): string {
    const oldLines = (previous ?? '').split('\n');
    const newLines = next.split('\n');
    return [
        `diff --git a/${path} b/${path}`,
        previous === undefined ? 'new file mode 100644' : `--- a/${path}`,
        `+++ b/${path}`,
        '@@',
        ...oldLines.filter(line => line.length > 0).map(line => `-${line}`),
        ...newLines.filter(line => line.length > 0).map(line => `+${line}`),
        '',
    ].join('\n');
}

export function summarizeDiff(diff: string): { filesChanged: number; additions: number; deletions: number } {
    const files = new Set<string>();
    let additions = 0;
    let deletions = 0;
    diff.split('\n').forEach(line => {
        if (line.startsWith('diff --git ')) {
            const match = line.match(/^diff --git a\/(.+?) b\/(.+)$/);
            files.add(match?.[2] ?? line);
        } else if (line.startsWith('+') && !line.startsWith('+++')) {
            additions += 1;
        } else if (line.startsWith('-') && !line.startsWith('---')) {
            deletions += 1;
        }
    });
    return { filesChanged: files.size, additions, deletions };
}

// ==================== commit graph traversal ====================

export function collectAncestorShas(commitBySha: Map<string, Commit>, startSha: string): Set<string> {
    const visited = new Set<string>();
    const stack = [startSha];
    while (stack.length > 0) {
        const sha = stack.pop();
        if (!sha || visited.has(sha)) {
            continue;
        }
        visited.add(sha);
        const commit = commitBySha.get(sha);
        commit?.parentShas.forEach(parentSha => {
            stack.push(parentSha);
        });
    }
    return visited;
}

export function collectCommitsUntil(
    commitBySha: Map<string, Commit>,
    startSha: string,
    stopSha: string,
): Commit[] {
    const visited = new Set<string>();
    const result: Commit[] = [];
    const stack = [startSha];
    while (stack.length > 0 && result.length < 250) {
        const sha = stack.pop();
        if (!sha || sha === stopSha || visited.has(sha)) {
            continue;
        }
        visited.add(sha);
        const commit = commitBySha.get(sha);
        if (!commit) {
            continue;
        }
        result.push(commit);
        commit.parentShas.forEach(parentSha => {
            stack.push(parentSha);
        });
    }
    return result.sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime());
}

export function compareRefsFromMetadata(
    assetId: string,
    asset: Asset,
    base: string,
    head: string,
): AssetComparison {
    const baseCommitSha = resolveRefSha(asset, base || asset.defaultBranch);
    const headCommitSha = resolveRefSha(asset, head || asset.defaultBranch);
    const commitBySha = new Map(asset.commits.map(commit => [commit.sha, commit]));
    const headCommit = commitBySha.get(headCommitSha);
    if (!headCommit) {
        throw new NotFoundException('Head commit not found');
    }

    const baseAncestors = collectAncestorShas(commitBySha, baseCommitSha);
    const headAncestors = collectAncestorShas(commitBySha, headCommitSha);
    const commits =
        headCommitSha === baseCommitSha
            ? []
            : collectCommitsUntil(commitBySha, headCommitSha, baseCommitSha);
    const diff = commits
        .map(commit => asset.getCommitDiff(commit.sha))
        .filter((value): value is string => Boolean(value?.trim()))
        .join('\n');
    const summary = summarizeDiff(diff);

    return {
        assetId,
        base,
        head,
        baseCommitSha,
        headCommitSha,
        aheadBy: commits.length,
        behindBy: [...baseAncestors].filter(sha => !headAncestors.has(sha)).length,
        filesChanged: summary.filesChanged,
        additions: summary.additions,
        deletions: summary.deletions,
        commits,
        diff,
    };
}

// ==================== pull-request check helpers ====================

export function triggerPullRequestChecks(asset: Asset, pullRequest: PullRequest, triggeredBy: string): void {
    asset.pipelines
        .filter(pipeline => pipeline.isEnabled && pipeline.triggerEvents.includes('pull_request'))
        .forEach(pipeline => {
            asset.dispatchPipelineRun(pipeline.id, {
                event: 'pull_request',
                branch: pullRequest.headRef,
                commitSha: pullRequest.headCommitSha,
                triggeredBy,
                status: 'success',
            });
        });
}

export function pipelineRunCheckStatus(run?: PipelineRun): 'success' | 'pending' | 'failure' {
    if (!run) {
        return 'pending';
    }
    if (run.conclusion === 'success' || run.status === 'success') {
        return 'success';
    }
    if (
        ['failure', 'cancelled', 'timed_out', 'action_required'].includes(String(run.conclusion)) ||
        ['failure', 'cancelled'].includes(run.status)
    ) {
        return 'failure';
    }
    return 'pending';
}

export function buildPullRequestReviewSummary(
    asset: Asset,
    pullRequest: PullRequest,
    requiredApprovals: number,
): {
    reviewStatus: 'approved' | 'changes_requested' | 'pending';
    approvals: number;
    changesRequested: number;
    requiredApprovals: number;
} {
    const latestByReviewer = new Map<string, PullRequestReview>();
    asset.pullRequestReviews
        .filter(review => review.pullRequestId === pullRequest.id)
        .sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime())
        .forEach(review => {
            latestByReviewer.set(review.reviewerId, review);
        });
    const latestReviews = [...latestByReviewer.values()];
    const approvals = latestReviews.filter(review => review.decision === 'approved').length;
    const changesRequested = latestReviews.filter(review => review.decision === 'changes_requested').length;
    const reviewStatus =
        changesRequested > 0 ? 'changes_requested' : approvals >= requiredApprovals ? 'approved' : 'pending';
    return { reviewStatus, approvals, changesRequested, requiredApprovals };
}

export function buildPullRequestChecks(asset: Asset, pullRequest: PullRequest): PullRequestChecks {
    const targetBranch = asset.branches.find(branch => branch.name === pullRequest.baseRef);
    const pipelines = asset.pipelines.filter(
        pipeline => pipeline.isEnabled && pipeline.triggerEvents.includes('pull_request'),
    );
    const items = pipelines.map(pipeline => {
        const run = asset.pipelineRuns
            .filter(
                item =>
                    item.pipelineId === pipeline.id &&
                    item.event === 'pull_request' &&
                    item.commitSha === pullRequest.headCommitSha,
            )
            .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())[0];
        const status = pipelineRunCheckStatus(run);
        return {
            workflowId: pipeline.id,
            workflowName: pipeline.name,
            status,
            run: run
                ? {
                      id: run.id,
                      workflowId: run.pipelineId,
                      assetId: run.assetId,
                      runNumber: run.runNumber,
                      status: run.status,
                      conclusion: run.conclusion,
                      event: run.event,
                      branch: run.branch,
                      commitSha: run.commitSha,
                      triggeredBy: run.triggeredBy,
                      inputs: run.inputs,
                      startedAt: run.startedAt,
                      completedAt: run.completedAt,
                      createdAt: run.createdAt,
                  }
                : undefined,
        };
    });
    const status =
        items.length === 0
            ? 'success'
            : items.some(item => item.status === 'failure')
              ? 'failure'
              : items.some(item => item.status === 'pending')
                ? 'pending'
                : 'success';
    const required = Boolean(targetBranch?.isProtected);
    const requireStatusChecks = required ? (targetBranch?.requireStatusChecks ?? true) : false;
    const requiredApprovals = required ? (targetBranch?.requiredApprovals ?? 1) : 0;
    const reviewSummary = buildPullRequestReviewSummary(asset, pullRequest, requiredApprovals);
    const effectivePipelineStatus = required && !requireStatusChecks ? 'success' : status;
    const overallStatus =
        reviewSummary.reviewStatus === 'changes_requested'
            ? 'failure'
            : effectivePipelineStatus === 'failure'
              ? 'failure'
              : effectivePipelineStatus === 'pending' || reviewSummary.reviewStatus === 'pending'
                ? 'pending'
                : 'success';

    return {
        assetId: asset.id,
        pullRequestId: pullRequest.id,
        required,
        requireStatusChecks,
        status: overallStatus,
        reviewStatus: reviewSummary.reviewStatus,
        approvals: reviewSummary.approvals,
        changesRequested: reviewSummary.changesRequested,
        requiredApprovals: reviewSummary.requiredApprovals,
        items,
    };
}

// ==================== lifecycle metadata ====================

/**
 * 读取 asset.metadata.assetLifecycle，回退到 catalogProfile.status / status / 默认 draft / 已禁用 archived。
 * 实现镜像 `AssetLifecycleStateService.readLifecycleMetadata`，但不依赖任何注入服务，
 * 给 `AssetServiceImpl` 等不能 inject lifecycle 服务的位置使用。
 */
export function readAssetLifecycleMetadata(asset: Asset): AssetLifecycleMetadata {
    const metadata = asset.metadata ?? {};
    const stored = recordValue(metadata.assetLifecycle);
    const storedState = stored?.state;
    const fallbackStatus = recordValue(metadata.catalogProfile)?.status ?? metadata.status;
    const state = isAssetLifecycleState(storedState)
        ? storedState
        : isAssetLifecycleState(fallbackStatus)
            ? fallbackStatus
            : asset.enabled
                ? 'draft'
                : 'archived';
    const history = Array.isArray(stored?.history)
        ? (stored.history as unknown[])
            .map(item => normalizeLifecycleHistoryEntry(item))
            .filter((item): item is AssetLifecycleHistoryEntry => Boolean(item))
        : [];
    return {
        state,
        previousState: isAssetLifecycleState(stored?.previousState) ? stored.previousState : undefined,
        updatedAt: typeof stored?.updatedAt === 'string' ? stored.updatedAt : asset.createdAt.toISOString(),
        updatedBy: typeof stored?.updatedBy === 'string' ? stored.updatedBy : undefined,
        history: history.length > 0
            ? history
            : [
                {
                    id: `${asset.id}:initial`,
                    event: 'initialize',
                    to: state,
                    at: asset.createdAt.toISOString(),
                },
            ],
    };
}

function normalizeLifecycleHistoryEntry(value: unknown): AssetLifecycleHistoryEntry | null {
    const record = recordValue(value);
    if (!record || !isAssetLifecycleState(record.to) || typeof record.event !== 'string' || typeof record.at !== 'string') {
        return null;
    }
    return {
        id: typeof record.id === 'string' ? record.id : randomUUID(),
        event: record.event as AssetLifecycleHistoryEntry['event'],
        from: isAssetLifecycleState(record.from) ? record.from : undefined,
        to: record.to,
        actorId: typeof record.actorId === 'string' ? record.actorId : undefined,
        reason: typeof record.reason === 'string' ? record.reason : undefined,
        source: typeof record.source === 'string' ? record.source : undefined,
        metadata: recordValue(record.metadata),
        at: record.at,
    };
}

/**
 * 写文件类操作（updateBlob / uploadFiles / scaffold-with-agent 等）调用此 helper：
 * - 当资产状态 ∈ {published, packaged} → 隐式触发 start_development，回到 developing；
 * - 否则不动状态。
 * 仅在内存上修改 asset 实体；持久化由调用方自己的 `assetRepository.save(asset)` 完成。
 *
 * 返回值用于让调用方知道是否触发了隐式转换，便于上层在响应里加 toast 提示。
 */
export function applyImplicitEditLifecycleTransition(
    asset: Asset,
    actorId?: string,
): { transitioned: boolean; from?: AssetLifecycleState; to?: AssetLifecycleState } {
    const current = readAssetLifecycleMetadata(asset);
    if (current.state !== 'published' && current.state !== 'packaged') {
        return { transitioned: false };
    }
    const rule = assetLifecycleRule(current.state, 'start_development', asset.category);
    if (!rule) {
        return { transitioned: false };
    }
    const now = new Date().toISOString();
    const entry: AssetLifecycleHistoryEntry = {
        id: randomUUID(),
        event: 'start_development',
        from: current.state,
        to: rule.to,
        actorId,
        source: 'asset.lifecycle.implicit_edit',
        metadata: { implicit: true },
        at: now,
    };
    const next: AssetLifecycleMetadata = {
        state: rule.to,
        previousState: current.state,
        updatedAt: now,
        updatedBy: actorId,
        history: [...current.history, entry].slice(-50),
    };

    const currentMetadata = asset.metadata ?? {};
    const currentCatalog = recordValue(currentMetadata.catalogProfile) ?? {};
    asset.updateMetadata({
        assetLifecycle: next,
        catalogProfile: {
            ...currentCatalog,
            status: next.state,
            updatedAt: now,
        },
        status: next.state,
    });
    return { transitioned: true, from: current.state, to: next.state };
}

export function withInitialLifecycleMetadata(
    metadata: Record<string, unknown> | undefined,
    actorId: string,
): Record<string, unknown> {
    if (metadata?.assetLifecycle) {
        return metadata;
    }
    const catalogProfile = recordValue(metadata?.catalogProfile) ?? {};
    const state: AssetLifecycleState = isAssetLifecycleState(catalogProfile.status)
        ? catalogProfile.status
        : isAssetLifecycleState(metadata?.status)
          ? metadata.status
          : 'draft';
    const now = new Date().toISOString();
    return {
        ...(metadata ?? {}),
        status: state,
        catalogProfile: {
            ...catalogProfile,
            status: state,
            updatedAt: now,
        },
        assetLifecycle: {
            state,
            updatedAt: now,
            updatedBy: actorId,
            history: [
                {
                    id: uuidLike(),
                    event: 'initialize',
                    to: state,
                    actorId,
                    source: 'assets.create',
                    at: now,
                },
            ],
        },
    };
}
