import { Entity } from '@/shared/domain/entity';
import { Permission } from '../value-objects/permission.vo';

export type CollaboratorAccessEventAction =
    | 'invitation_created'
    | 'invitation_resent'
    | 'invitation_accepted'
    | 'invitation_declined'
    | 'invitation_revoked'
    | 'collaborator_permission_updated'
    | 'collaborator_removed';

export interface CollaboratorAccessEvent extends Entity<string> {
    readonly assetId: string;
    readonly action: CollaboratorAccessEventAction;
    readonly actorId?: string;
    readonly invitationId?: string;
    readonly targetUserId?: string;
    readonly targetEmail?: string;
    readonly targetUsername?: string;
    readonly permission?: Permission;
    readonly previousPermission?: Permission;
    readonly createdAt: Date;
}
