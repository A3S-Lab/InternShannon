import { Entity } from '@/shared/domain/entity';

/**
 * Commit Comment Entity
 * Represents a comment on a commit
 */
export interface CommitComment extends Entity<string> {
    readonly assetId: string;
    readonly commitSha: string;
    readonly userId: string;
    readonly body: string;
    readonly line?: number;
    readonly filePath?: string;
    readonly createdAt: Date;
    readonly updatedAt: Date;
}
