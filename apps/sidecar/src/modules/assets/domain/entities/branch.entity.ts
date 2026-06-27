import { Entity } from '@/shared/domain/entity';

/**
 * Branch Entity
 * Represents a branch in an asset
 */
export interface Branch extends Entity<string> {
    readonly assetId: string;
    readonly name: string;
    readonly isProtected: boolean;
    readonly requiredApprovals: number;
    readonly requireStatusChecks: boolean;
    readonly commitSha: string;
    readonly createdAt: Date;
}
