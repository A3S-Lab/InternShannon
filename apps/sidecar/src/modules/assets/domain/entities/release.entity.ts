import { Entity } from '@/shared/domain/entity';

/**
 * Release Entity
 * Represents a release in an asset
 */
export interface Release extends Entity<string> {
    readonly assetId: string;
    readonly tagName: string;
    readonly name: string;
    readonly body?: string;
    readonly targetCommitish: string;
    readonly isDraft: boolean;
    readonly isPrerelease: boolean;
    readonly createdAt: Date;
    readonly updatedAt: Date;
}
