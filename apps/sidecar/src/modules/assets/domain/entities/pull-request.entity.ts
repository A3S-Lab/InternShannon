import { Entity } from '@/shared/domain/entity';
import type { ExternalProvider } from './issue.entity';

export type PullRequestStatus = 'open' | 'closed' | 'merged';
export type PullRequestMergeStrategy = 'merge' | 'squash' | 'rebase';
export type PullRequestCommentSide = 'base' | 'head';
export type PullRequestReviewDecision = 'approved' | 'changes_requested' | 'commented';

export interface PullRequestComment extends Entity<string> {
    readonly assetId: string;
    readonly pullRequestId: string;
    readonly userId: string;
    readonly body: string;
    readonly filePath?: string;
    readonly line?: number;
    readonly side?: PullRequestCommentSide;
    readonly externalId?: string;
    readonly externalProvider?: ExternalProvider;
    readonly createdAt: Date;
    readonly updatedAt: Date;
}

export interface PullRequestReview extends Entity<string> {
    readonly assetId: string;
    readonly pullRequestId: string;
    readonly reviewerId: string;
    readonly decision: PullRequestReviewDecision;
    readonly body?: string;
    readonly externalId?: string;
    readonly externalProvider?: ExternalProvider;
    readonly createdAt: Date;
    readonly updatedAt: Date;
}

/**
 * Pull Request Entity
 * Represents a repository collaboration request in an asset.
 */
export interface PullRequest extends Entity<string> {
    readonly assetId: string;
    readonly number: number;
    readonly title: string;
    readonly body?: string;
    readonly baseRef: string;
    readonly headRef: string;
    readonly baseCommitSha: string;
    readonly headCommitSha: string;
    readonly authorId: string;
    readonly assignees: string[];
    readonly requestedReviewers: string[];
    readonly status: PullRequestStatus;
    readonly filesChanged: number;
    readonly additions: number;
    readonly deletions: number;
    readonly commitsCount: number;
    readonly mergedBy?: string;
    readonly mergeStrategy?: PullRequestMergeStrategy;
    readonly mergedAt?: Date;
    readonly closedAt?: Date;
    readonly createdAt: Date;
    readonly updatedAt: Date;
    // External sync fields
    readonly externalId?: string;
    readonly externalProvider?: ExternalProvider;
    readonly externalUrl?: string;
    readonly syncedAt?: Date;
    readonly metadata?: Record<string, unknown>;
}
