import { Entity } from '@/shared/domain/entity';
import { Permission } from '../value-objects/permission.vo';

/**
 * Collaborator Entity
 * Represents a collaborator on an asset
 */
export interface Collaborator extends Entity<string> {
    readonly assetId: string;
    readonly userId: string;
    readonly permission: Permission;
    readonly createdAt: Date;
    readonly updatedAt: Date;
}
