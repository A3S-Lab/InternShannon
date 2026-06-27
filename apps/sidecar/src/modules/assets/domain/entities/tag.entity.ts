import { Entity } from '@/shared/domain/entity';

/**
 * Tag Entity
 * Represents a tag in an asset
 */
export interface Tag extends Entity<string> {
    readonly assetId: string;
    readonly name: string;
    readonly commitSha: string;
    readonly createdAt: Date;
}
