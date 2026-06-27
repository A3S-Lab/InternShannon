import { Entity } from '@/shared/domain/entity';

/**
 * Watch Entity
 * Represents a user watching/subscribing to an asset
 */
export interface Watch extends Entity<string> {
    readonly assetId: string;
    readonly userId: string;
    readonly createdAt: Date;
}
