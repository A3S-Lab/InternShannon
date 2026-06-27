import { Entity } from '@/shared/domain/entity';

/**
 * Commit Entity
 * Represents a git commit in an asset
 */
export interface Commit extends Entity<string> {
    readonly assetId: string;
    readonly sha: string;
    readonly message: string;
    readonly authorName: string;
    readonly authorEmail: string;
    readonly authorAvatarUrl?: string;
    readonly parentShas: string[];
    readonly treeSha: string;
    readonly createdAt: Date;
}
