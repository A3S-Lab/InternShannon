import { Entity } from '@/shared/domain/entity';

/**
 * Fork Entity
 * Represents a fork relationship between assets
 */
export interface Fork extends Entity<string> {
    readonly sourceAssetId: string;
    readonly forkedAssetId: string;
    readonly createdAt: Date;
}
