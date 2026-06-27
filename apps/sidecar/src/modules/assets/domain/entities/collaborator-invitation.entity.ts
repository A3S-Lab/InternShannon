import { Entity } from '@/shared/domain/entity';
import { Permission } from '../value-objects/permission.vo';

export type CollaboratorInvitationStatus = 'pending' | 'accepted' | 'declined' | 'revoked' | 'expired';

export interface CollaboratorInvitation extends Entity<string> {
    readonly assetId: string;
    readonly inviteeUserId?: string;
    readonly inviteeEmail?: string;
    readonly inviteeUsername?: string;
    readonly permission: Permission;
    readonly status: CollaboratorInvitationStatus;
    readonly invitedBy: string;
    readonly acceptedBy?: string;
    readonly acceptedAt?: Date;
    readonly declinedAt?: Date;
    readonly revokedAt?: Date;
    readonly expiresAt: Date;
    readonly createdAt: Date;
    readonly updatedAt: Date;
}
