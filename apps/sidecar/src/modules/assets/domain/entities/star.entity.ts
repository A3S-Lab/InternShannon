import { Entity } from '@/shared/domain/entity';

/**
 * Star Entity
 * Represents a user starring an asset
 */
export interface Star extends Entity<string> {
    readonly assetId: string;
    readonly userId: string;
    readonly createdAt: Date;
}
