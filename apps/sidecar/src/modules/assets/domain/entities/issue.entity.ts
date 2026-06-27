import { Entity } from '@/shared/domain/entity';

export type IssueStatus = 'open' | 'closed';
export type ExternalProvider = 'github';

export interface IssueComment extends Entity<string> {
    readonly assetId: string;
    readonly issueId: string;
    readonly userId: string;
    readonly body: string;
    readonly externalId?: string;
    readonly externalProvider?: ExternalProvider;
    readonly createdAt: Date;
    readonly updatedAt: Date;
}

export interface Issue extends Entity<string> {
    readonly assetId: string;
    readonly number: number;
    readonly title: string;
    readonly body?: string;
    readonly authorId: string;
    readonly status: IssueStatus;
    readonly labels: string[];
    readonly assignees: string[];
    readonly closedBy?: string;
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
