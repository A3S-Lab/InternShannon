import { v4 as uuidv4 } from 'uuid';
import { AggregateRoot } from '@/shared/domain/aggregate-root';
import { AssetWebhook } from './asset-webhook.entity';
import { Blob } from './blob.entity';
import { Branch } from './branch.entity';
import { CollaboratorAccessEvent, CollaboratorAccessEventAction } from './collaborator-access-event.entity';
import { Collaborator } from './collaborator.entity';
import { CollaboratorInvitation, CollaboratorInvitationStatus } from './collaborator-invitation.entity';
import { Commit } from './commit.entity';
import { CommitComment } from './commit-comment.entity';
import { ExternalProvider, Issue, IssueComment } from './issue.entity';
import { Pipeline } from './pipeline.entity';
import { PipelineArtifact } from './pipeline-artifact.entity';
import { PipelineJob } from './pipeline-job.entity';
import { PipelineRun } from './pipeline-run.entity';
import { PipelineStep } from './pipeline-step.entity';
import { PullRequest, PullRequestComment, PullRequestMergeStrategy, PullRequestReview } from './pull-request.entity';
import { Release } from './release.entity';
import { Tag } from './tag.entity';
import { AgentKind, isAgentKind } from '../value-objects/agent-kind.vo';
import { AssetCategory } from '../value-objects/asset-category.vo';
import { Permission } from '../value-objects/permission.vo';
import { Visibility } from '../value-objects/visibility.vo';

export interface AssetProps {
    id: string;
    name: string;
    ownerId: string;
    ownerType: 'user' | 'organization';
    category: AssetCategory;
    visibility: Visibility;
    description?: string;
    homepage?: string;
    defaultBranch: string;
    cloneUrl: string;
    starCount: number;
    forkCount: number;
    watchCount: number;
    isForked: boolean;
    sourceAssetId?: string;
    content?: string;
    metadata?: Record<string, unknown>;
    enabled: boolean;
    /**
     * 仅当 category=agent 时有意义：'tool' 可被工作流编排，'application' 只能独立部署。
     * 非 agent 资产恒为 undefined。
     */
    agentKind?: AgentKind;
    createdAt: Date;
    updatedAt: Date;
}

export interface CreateAssetProps {
    name: string;
    ownerId: string;
    ownerType: 'user' | 'organization';
    category: AssetCategory;
    visibility: Visibility;
    description?: string;
    homepage?: string;
    defaultBranch?: string;
    cloneUrl?: string;
    content?: string;
    metadata?: Record<string, unknown>;
    enabled?: boolean;
    /** 仅 category=agent 生效；非 agent 入参会被静默忽略 */
    agentKind?: AgentKind;
}

type PersistedAssetProps = Omit<AssetProps, 'createdAt' | 'updatedAt'> & {
    createdAt: Date | string;
    updatedAt: Date | string;
};

type MetadataChild = Record<string, unknown>;

export interface WorkflowStepDefinition {
    name: string;
    command?: string;
    workingDirectory?: string;
    shell?: string;
    envVars?: Record<string, string>;
    with?: Record<string, string>;
    condition?: string;
    continueOnError?: boolean;
    timeoutMinutes?: number;
}

export interface WorkflowJobDefinition {
    id: string;
    sourceId?: string;
    name: string;
    runsOn?: string;
    container?: string;
    needs?: string[];
    envVars?: Record<string, string>;
    workingDirectory?: string;
    shell?: string;
    condition?: string;
    timeoutMinutes?: number;
    matrix?: Record<string, string[]>;
    matrixInclude?: Array<Record<string, string>>;
    matrixExclude?: Array<Record<string, string>>;
    matrixMaxParallel?: number;
    matrixFailFast?: boolean;
    matrixValues?: Record<string, string>;
    steps: WorkflowStepDefinition[];
}

export interface WorkflowDefinition {
    name: string;
    description?: string;
    filePath: string;
    triggerEvents: string[];
    inputs?: WorkflowInputDefinition[];
    jobs: WorkflowJobDefinition[];
}

export interface WorkflowInputDefinition {
    name: string;
    description?: string;
    required?: boolean;
    defaultValue?: string;
    type?: 'string' | 'boolean' | 'choice' | 'environment' | 'number';
    options?: string[];
}

export interface AssetActionVariable {
    name: string;
    value: string;
    updatedAt: Date;
}

/**
 * Asset Aggregate Root.
 *
 * Asset is the only consistency boundary for the digital asset module. Branches,
 * tags, commits, releases, pipeline state, collaboration, and reactions should
 * be changed through asset-scoped application commands.
 */
export class Asset extends AggregateRoot<string> {
    private constructor(
        id: string,
        private _name: string,
        private _ownerId: string,
        private _ownerType: 'user' | 'organization',
        private _category: AssetCategory,
        private _visibility: Visibility,
        private _description: string | undefined,
        private _homepage: string | undefined,
        private _defaultBranch: string,
        private _cloneUrl: string,
        private _starCount: number,
        private _forkCount: number,
        private _watchCount: number,
        private _isForked: boolean,
        private _sourceAssetId: string | undefined,
        private _content: string | undefined,
        private _metadata: Record<string, unknown> | undefined,
        private _enabled: boolean,
        private _agentKind: AgentKind | undefined,
        private _createdAt: Date,
        private _updatedAt: Date,
    ) {
        super(id);
    }

    public static create(props: CreateAssetProps): Asset {
        const now = new Date();
        return new Asset(
            uuidv4(),
            Asset.normalizeName(props.name),
            props.ownerId,
            props.ownerType,
            props.category,
            props.visibility,
            props.description,
            props.homepage,
            props.defaultBranch || 'main',
            props.cloneUrl || '',
            0,
            0,
            0,
            false,
            undefined,
            props.content,
            props.metadata,
            props.enabled ?? true,
            Asset.coerceAgentKind(props.category, props.agentKind),
            now,
            now,
        );
    }

    public static createFromRow(row: PersistedAssetProps): Asset {
        return new Asset(
            row.id,
            Asset.normalizeName(row.name),
            row.ownerId,
            row.ownerType,
            row.category,
            row.visibility,
            row.description,
            row.homepage,
            row.defaultBranch || 'main',
            row.cloneUrl || '',
            row.starCount ?? 0,
            row.forkCount ?? 0,
            row.watchCount ?? 0,
            row.isForked ?? false,
            row.sourceAssetId,
            row.content,
            row.metadata,
            row.enabled ?? true,
            Asset.coerceAgentKind(row.category, row.agentKind),
            new Date(row.createdAt),
            new Date(row.updatedAt),
        );
    }

    private static coerceAgentKind(category: AssetCategory, value: unknown): AgentKind | undefined {
        if (category !== 'agent') return undefined;
        return isAgentKind(value) ? value : undefined;
    }

    public get name(): string {
        return this._name;
    }

    public get ownerId(): string {
        return this._ownerId;
    }

    public get ownerType(): 'user' | 'organization' {
        return this._ownerType;
    }

    public get category(): AssetCategory {
        return this._category;
    }

    public get visibility(): Visibility {
        return this._visibility;
    }

    public get description(): string | undefined {
        return this._description;
    }

    public get homepage(): string | undefined {
        return this._homepage;
    }

    public get defaultBranch(): string {
        return this._defaultBranch;
    }

    public get cloneUrl(): string {
        return this._cloneUrl;
    }

    public get starCount(): number {
        return this._starCount;
    }

    public get forkCount(): number {
        return this._forkCount;
    }

    public get watchCount(): number {
        return this._watchCount;
    }

    public get isForked(): boolean {
        return this._isForked;
    }

    public get sourceAssetId(): string | undefined {
        return this._sourceAssetId;
    }

    public get content(): string | undefined {
        return this._content;
    }

    public get metadata(): Record<string, unknown> | undefined {
        return this._metadata;
    }

    public get enabled(): boolean {
        return this._enabled;
    }

    public get agentKind(): AgentKind | undefined {
        return this._agentKind;
    }

    /**
     * 设置 agentKind。仅 category=agent 时生效；非 agent 资产传入会被静默忽略以
     * 保持调用方层简洁（DTO 校验阶段已经拒绝过非 agent 的入参）。
     */
    public setAgentKind(value: AgentKind | undefined): void {
        const next = Asset.coerceAgentKind(this._category, value);
        if (next === this._agentKind) return;
        this._agentKind = next;
        this.touch();
    }

    public get createdAt(): Date {
        return this._createdAt;
    }

    public get updatedAt(): Date {
        return this._updatedAt;
    }

    public rename(name: string): void {
        this._name = Asset.normalizeName(name);
        this.touch();
    }

    public updateDetails(props: Partial<Pick<AssetProps, 'description' | 'homepage' | 'defaultBranch'>>): void {
        if (props.description !== undefined) {
            this._description = props.description;
        }
        if (props.homepage !== undefined) {
            this._homepage = props.homepage;
        }
        if (props.defaultBranch !== undefined) {
            this._defaultBranch = Asset.normalizeBranch(props.defaultBranch);
        }
        this.touch();
    }

    public changeVisibility(visibility: Visibility): void {
        this._visibility = visibility;
        this.touch();
    }

    public updateContent(content: string, metadata?: Record<string, unknown>): void {
        this._content = content;
        if (metadata !== undefined) {
            this._metadata = metadata;
        }
        this.touch();
    }

    public updateMetadata(metadata: Record<string, unknown>): void {
        this._metadata = { ...(this._metadata || {}), ...metadata };
        this.touch();
    }

    public enable(): void {
        this._enabled = true;
        this.touch();
    }

    public disable(): void {
        this._enabled = false;
        this.touch();
    }

    public recordStar(): void {
        this._starCount += 1;
        this.touch();
    }

    public recordUnstar(): void {
        this._starCount = Math.max(0, this._starCount - 1);
        this.touch();
    }

    public recordWatch(): void {
        this._watchCount += 1;
        this.touch();
    }

    public recordUnwatch(): void {
        this._watchCount = Math.max(0, this._watchCount - 1);
        this.touch();
    }

    public recordFork(): void {
        this._forkCount += 1;
        this.touch();
    }

    public starBy(userId: string): void {
        const stargazerIds = new Set(this.stargazerIds);
        if (stargazerIds.has(userId)) return;

        stargazerIds.add(userId);
        this.setMetadataList('stargazerIds', stargazerIds);
        this._starCount = stargazerIds.size;
        this.touch();
    }

    public unstarBy(userId: string): void {
        const stargazerIds = new Set(this.stargazerIds);
        if (!stargazerIds.delete(userId)) return;

        this.setMetadataList('stargazerIds', stargazerIds);
        this._starCount = stargazerIds.size;
        this.touch();
    }

    public watchBy(userId: string): void {
        const subscriberIds = new Set(this.subscriberIds);
        if (subscriberIds.has(userId)) return;

        subscriberIds.add(userId);
        this.setMetadataList('subscriberIds', subscriberIds);
        this._watchCount = subscriberIds.size;
        this.touch();
    }

    public unwatchBy(userId: string): void {
        const subscriberIds = new Set(this.subscriberIds);
        if (!subscriberIds.delete(userId)) return;

        this.setMetadataList('subscriberIds', subscriberIds);
        this._watchCount = subscriberIds.size;
        this.touch();
    }

    public get stargazerIds(): string[] {
        return this.getMetadataList('stargazerIds');
    }

    public get subscriberIds(): string[] {
        return this.getMetadataList('subscriberIds');
    }

    public forkTo(props: Pick<CreateAssetProps, 'ownerId' | 'ownerType'> & Partial<CreateAssetProps>): Asset {
        this.recordFork();
        return Asset.create({
            name: props.name || `${this._name}-fork`,
            ownerId: props.ownerId,
            ownerType: props.ownerType,
            category: props.category || this._category,
            visibility: props.visibility || this._visibility,
            description: props.description ?? this._description,
            homepage: props.homepage ?? this._homepage,
            defaultBranch: props.defaultBranch || this._defaultBranch,
            cloneUrl: props.cloneUrl,
            content: props.content ?? this._content,
            metadata: props.metadata ?? this._metadata,
            enabled: props.enabled ?? this._enabled,
            agentKind: props.agentKind ?? this._agentKind,
        }).markAsForkOf(this.id);
    }

    public get branches(): Branch[] {
        return this.getMetadataChildren<Branch>('branches', row => Asset.asBranch({
            id: Asset.stringValue(row.id),
            assetId: this.id,
            name: Asset.stringValue(row.name),
            isProtected: Boolean(row.isProtected),
            requiredApprovals: Asset.nonNegativeIntegerValue(row.requiredApprovals, Boolean(row.isProtected) ? 1 : 0),
            requireStatusChecks: row.requireStatusChecks === undefined ? Boolean(row.isProtected) : Boolean(row.requireStatusChecks),
            commitSha: Asset.stringValue(row.commitSha),
            createdAt: Asset.dateValue(row.createdAt),
        }));
    }

    public createBranch(
        name: string,
        commitSha: string,
        isProtected = false,
        protection?: { requiredApprovals?: number; requireStatusChecks?: boolean },
    ): Branch {
        const normalizedName = Asset.normalizeName(name);
        const branches = this.branches;
        if (branches.some(branch => branch.name === normalizedName)) {
            throw new Error('Branch already exists');
        }

        const branch = Asset.asBranch({
            id: uuidv4(),
            assetId: this.id,
            name: normalizedName,
            isProtected,
            requiredApprovals: Asset.normalizeRequiredApprovals(isProtected, protection?.requiredApprovals),
            requireStatusChecks: protection?.requireStatusChecks ?? isProtected,
            commitSha: Asset.normalizeName(commitSha),
            createdAt: new Date(),
        });
        this.setMetadataChildren('branches', [...branches, branch]);
        this.touch();
        return branch;
    }

    public deleteBranch(name: string): void {
        const branches = this.branches;
        const nextBranches = branches.filter(branch => branch.name !== name);
        if (nextBranches.length === branches.length) {
            return;
        }
        this.setMetadataChildren('branches', nextBranches);
        this.touch();
    }

    public updateBranchProtection(
        name: string,
        isProtected: boolean,
        protection?: { requiredApprovals?: number; requireStatusChecks?: boolean },
    ): Branch | null {
        let updatedBranch: Branch | null = null;
        const branches = this.branches.map(branch => {
            if (branch.name !== name) {
                return branch;
            }
            updatedBranch = Asset.asBranch({
                ...branch,
                id: branch.id,
                isProtected,
                requiredApprovals: Asset.normalizeRequiredApprovals(isProtected, protection?.requiredApprovals ?? branch.requiredApprovals),
                requireStatusChecks: protection?.requireStatusChecks ?? (isProtected ? (branch.isProtected ? branch.requireStatusChecks : true) : false),
            });
            return updatedBranch;
        });
        if (!updatedBranch) {
            return null;
        }
        this.setMetadataChildren('branches', branches);
        this.touch();
        return updatedBranch;
    }

    public get tags(): Tag[] {
        return this.getMetadataChildren<Tag>('tags', row => Asset.asTag({
            id: Asset.stringValue(row.id),
            assetId: this.id,
            name: Asset.stringValue(row.name),
            commitSha: Asset.stringValue(row.commitSha),
            createdAt: Asset.dateValue(row.createdAt),
        }));
    }

    public createTag(name: string, commitSha: string): Tag {
        const normalizedName = Asset.normalizeName(name);
        const tags = this.tags;
        if (tags.some(tag => tag.name === normalizedName)) {
            throw new Error('Tag already exists');
        }

        const tag = Asset.asTag({
            id: uuidv4(),
            assetId: this.id,
            name: normalizedName,
            commitSha: Asset.normalizeName(commitSha),
            createdAt: new Date(),
        });
        this.setMetadataChildren('tags', [...tags, tag]);
        this.touch();
        return tag;
    }

    public deleteTag(name: string): void {
        const tags = this.tags;
        const nextTags = tags.filter(tag => tag.name !== name);
        if (nextTags.length === tags.length) {
            return;
        }
        this.setMetadataChildren('tags', nextTags);
        this.touch();
    }

    public get releases(): Release[] {
        return this.getMetadataChildren<Release>('releases', row => Asset.asRelease({
            id: Asset.stringValue(row.id),
            assetId: this.id,
            tagName: Asset.stringValue(row.tagName),
            name: Asset.stringValue(row.name),
            body: Asset.optionalStringValue(row.body),
            targetCommitish: Asset.stringValue(row.targetCommitish),
            isDraft: Boolean(row.isDraft),
            isPrerelease: Boolean(row.isPrerelease),
            createdAt: Asset.dateValue(row.createdAt),
            updatedAt: Asset.dateValue(row.updatedAt),
        }));
    }

    public createRelease(
        tagName: string,
        name: string,
        body?: string,
        targetCommitish = this._defaultBranch,
        isDraft = false,
        isPrerelease = false,
    ): Release {
        const now = new Date();
        const release = Asset.asRelease({
            id: uuidv4(),
            assetId: this.id,
            tagName: Asset.normalizeName(tagName),
            name: Asset.normalizeName(name),
            body,
            targetCommitish: Asset.normalizeName(targetCommitish),
            isDraft,
            isPrerelease,
            createdAt: now,
            updatedAt: now,
        });
        this.setMetadataChildren('releases', [...this.releases, release]);
        this.touch();
        return release;
    }

    public updateRelease(
        id: string,
        props: Partial<Pick<Release, 'name' | 'body' | 'isDraft' | 'isPrerelease'>>,
    ): Release | null {
        let updatedRelease: Release | null = null;
        const releases: Release[] = this.releases.map(release => {
            if (release.id !== id) {
                return release;
            }
            const nextRelease = Asset.asRelease({
                ...release,
                id: release.id,
                name: props.name !== undefined ? Asset.normalizeName(props.name) : release.name,
                body: props.body !== undefined ? props.body : release.body,
                isDraft: props.isDraft !== undefined ? props.isDraft : release.isDraft,
                isPrerelease: props.isPrerelease !== undefined ? props.isPrerelease : release.isPrerelease,
                updatedAt: new Date(),
            });
            updatedRelease = nextRelease;
            return updatedRelease;
        });

        if (!updatedRelease) {
            return null;
        }
        this.setMetadataChildren('releases', releases);
        this.touch();
        return updatedRelease;
    }

    public deleteRelease(id: string): void {
        const releases = this.releases;
        const nextReleases = releases.filter(release => release.id !== id);
        if (nextReleases.length === releases.length) {
            return;
        }
        this.setMetadataChildren('releases', nextReleases);
        this.touch();
    }

    public get collaborators(): Collaborator[] {
        return this.getMetadataChildren<Collaborator>('collaborators', row => Asset.asCollaborator({
            id: Asset.stringValue(row.id),
            assetId: this.id,
            userId: Asset.stringValue(row.userId),
            permission: Asset.stringValue(row.permission) as Permission,
            createdAt: Asset.dateValue(row.createdAt),
            updatedAt: Asset.dateValue(row.updatedAt),
        }));
    }

    public addCollaborator(userId: string, permission: Permission): Collaborator {
        const collaborators = this.collaborators;
        const now = new Date();
        const existing = collaborators.find(collaborator => collaborator.userId === userId);
        const collaborator = existing
            ? Asset.asCollaborator({ ...existing, id: existing.id, permission, updatedAt: now })
            : Asset.asCollaborator({
                id: uuidv4(),
                assetId: this.id,
                userId,
                permission,
                createdAt: now,
                updatedAt: now,
            });

        const nextCollaborators = existing
            ? collaborators.map(item => item.userId === userId ? collaborator : item)
            : [...collaborators, collaborator];
        this.setMetadataChildren('collaborators', nextCollaborators);
        this.touch();
        return collaborator;
    }

    public updateCollaboratorPermission(userId: string, permission: Permission, actorId?: string): Collaborator | null {
        const existing = this.collaborators.find(collaborator => collaborator.userId === userId);
        if (!existing) {
            return null;
        }
        const collaborator = this.addCollaborator(userId, permission);
        if (existing.permission !== permission) {
            this.recordCollaboratorAccessEvent({
                action: 'collaborator_permission_updated',
                actorId,
                targetUserId: userId,
                permission,
                previousPermission: existing.permission,
            });
        }
        return collaborator;
    }

    public removeCollaborator(userId: string, actorId?: string): void {
        const collaborators = this.collaborators;
        const existing = collaborators.find(collaborator => collaborator.userId === userId);
        const nextCollaborators = collaborators.filter(collaborator => collaborator.userId !== userId);
        if (nextCollaborators.length === collaborators.length) {
            return;
        }
        this.setMetadataChildren('collaborators', nextCollaborators);
        this.recordCollaboratorAccessEvent({
            action: 'collaborator_removed',
            actorId,
            targetUserId: userId,
            previousPermission: existing?.permission,
        });
        this.touch();
    }

    public get collaboratorAccessEvents(): CollaboratorAccessEvent[] {
        return this.getMetadataChildren<CollaboratorAccessEvent>('collaboratorAccessEvents', row => Asset.asCollaboratorAccessEvent({
            id: Asset.stringValue(row.id),
            assetId: this.id,
            action: Asset.collaboratorAccessEventActionValue(row.action),
            actorId: Asset.optionalStringValue(row.actorId),
            invitationId: Asset.optionalStringValue(row.invitationId),
            targetUserId: Asset.optionalStringValue(row.targetUserId),
            targetEmail: Asset.optionalLowerStringValue(row.targetEmail),
            targetUsername: Asset.optionalLowerStringValue(row.targetUsername),
            permission: Asset.optionalPermissionValue(row.permission),
            previousPermission: Asset.optionalPermissionValue(row.previousPermission),
            createdAt: Asset.dateValue(row.createdAt),
        }));
    }

    public get collaboratorInvitations(): CollaboratorInvitation[] {
        return this.getMetadataChildren<CollaboratorInvitation>('collaboratorInvitations', row => Asset.asCollaboratorInvitation({
            id: Asset.stringValue(row.id),
            assetId: this.id,
            inviteeUserId: Asset.optionalStringValue(row.inviteeUserId),
            inviteeEmail: Asset.optionalLowerStringValue(row.inviteeEmail),
            inviteeUsername: Asset.optionalLowerStringValue(row.inviteeUsername),
            permission: Asset.stringValue(row.permission) as Permission,
            status: Asset.collaboratorInvitationStatusValue(row.status),
            invitedBy: Asset.stringValue(row.invitedBy),
            acceptedBy: Asset.optionalStringValue(row.acceptedBy),
            acceptedAt: Asset.optionalDateValue(row.acceptedAt),
            declinedAt: Asset.optionalDateValue(row.declinedAt),
            revokedAt: Asset.optionalDateValue(row.revokedAt),
            expiresAt: Asset.dateValue(row.expiresAt),
            createdAt: Asset.dateValue(row.createdAt),
            updatedAt: Asset.dateValue(row.updatedAt),
        }));
    }

    public inviteCollaborator(input: {
        inviteeUserId?: string;
        inviteeEmail?: string;
        inviteeUsername?: string;
        permission: Permission;
        invitedBy: string;
        expiresAt?: Date;
    }): CollaboratorInvitation {
        const now = new Date();
        const invitation = Asset.asCollaboratorInvitation({
            id: uuidv4(),
            assetId: this.id,
            inviteeUserId: Asset.normalizeOptionalText(input.inviteeUserId),
            inviteeEmail: Asset.normalizeOptionalLowerText(input.inviteeEmail),
            inviteeUsername: Asset.normalizeOptionalLowerText(input.inviteeUsername),
            permission: input.permission,
            status: 'pending',
            invitedBy: input.invitedBy,
            acceptedBy: undefined,
            acceptedAt: undefined,
            declinedAt: undefined,
            revokedAt: undefined,
            expiresAt: input.expiresAt ?? new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000),
            createdAt: now,
            updatedAt: now,
        });
        this.setMetadataChildren('collaboratorInvitations', [invitation, ...this.collaboratorInvitations]);
        this.recordCollaboratorAccessEvent({
            action: 'invitation_created',
            actorId: input.invitedBy,
            invitationId: invitation.id,
            targetUserId: invitation.inviteeUserId,
            targetEmail: invitation.inviteeEmail,
            targetUsername: invitation.inviteeUsername,
            permission: invitation.permission,
        });
        this.touch();
        return invitation;
    }

    public resendCollaboratorInvitation(invitationId: string, actorId: string, expiresAt?: Date): CollaboratorInvitation | null {
        const now = new Date();
        const invitations = this.collaboratorInvitations;
        const index = invitations.findIndex(invitation => invitation.id === invitationId && invitation.status === 'pending');
        if (index < 0) {
            return null;
        }
        const invitation = invitations[index];
        const resentInvitation = Asset.asCollaboratorInvitation({
            ...invitation,
            id: invitation.id,
            expiresAt: expiresAt ?? new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000),
            updatedAt: now,
        });
        const nextInvitations = [...invitations];
        nextInvitations[index] = resentInvitation;
        this.setMetadataChildren('collaboratorInvitations', nextInvitations);
        this.recordCollaboratorAccessEvent({
            action: 'invitation_resent',
            actorId,
            invitationId: resentInvitation.id,
            targetUserId: resentInvitation.inviteeUserId,
            targetEmail: resentInvitation.inviteeEmail,
            targetUsername: resentInvitation.inviteeUsername,
            permission: resentInvitation.permission,
        });
        this.touch();
        return resentInvitation;
    }

    public acceptCollaboratorInvitation(invitationId: string, userId: string): CollaboratorInvitation | null {
        const now = new Date();
        const invitations = this.collaboratorInvitations;
        const index = invitations.findIndex(invitation => invitation.id === invitationId && invitation.status === 'pending');
        if (index < 0) {
            return null;
        }
        const invitation = invitations[index];
        const acceptedInvitation = Asset.asCollaboratorInvitation({
            ...invitation,
            id: invitation.id,
            status: 'accepted',
            acceptedBy: userId,
            acceptedAt: now,
            updatedAt: now,
        });

        const nextInvitations = [...invitations];
        nextInvitations[index] = acceptedInvitation;
        this.setMetadataChildren('collaboratorInvitations', nextInvitations);
        this.addCollaborator(userId, acceptedInvitation.permission);
        this.recordCollaboratorAccessEvent({
            action: 'invitation_accepted',
            actorId: userId,
            invitationId: acceptedInvitation.id,
            targetUserId: userId,
            targetEmail: acceptedInvitation.inviteeEmail,
            targetUsername: acceptedInvitation.inviteeUsername,
            permission: acceptedInvitation.permission,
        });
        return acceptedInvitation;
    }

    public declineCollaboratorInvitation(invitationId: string, actorId?: string): CollaboratorInvitation | null {
        const now = new Date();
        const invitations = this.collaboratorInvitations;
        const index = invitations.findIndex(invitation => invitation.id === invitationId && invitation.status === 'pending');
        if (index < 0) {
            return null;
        }
        const invitation = invitations[index];
        const declinedInvitation = Asset.asCollaboratorInvitation({
            ...invitation,
            id: invitation.id,
            status: 'declined',
            declinedAt: now,
            updatedAt: now,
        });

        const nextInvitations = [...invitations];
        nextInvitations[index] = declinedInvitation;
        this.setMetadataChildren('collaboratorInvitations', nextInvitations);
        this.recordCollaboratorAccessEvent({
            action: 'invitation_declined',
            actorId,
            invitationId: declinedInvitation.id,
            targetUserId: declinedInvitation.inviteeUserId,
            targetEmail: declinedInvitation.inviteeEmail,
            targetUsername: declinedInvitation.inviteeUsername,
            permission: declinedInvitation.permission,
        });
        this.touch();
        return declinedInvitation;
    }

    public revokeCollaboratorInvitation(invitationId: string, actorId?: string): CollaboratorInvitation | null {
        const now = new Date();
        const invitations = this.collaboratorInvitations;
        const index = invitations.findIndex(invitation => invitation.id === invitationId && invitation.status === 'pending');
        if (index < 0) {
            return null;
        }
        const invitation = invitations[index];
        const revokedInvitation = Asset.asCollaboratorInvitation({
            ...invitation,
            id: invitation.id,
            status: 'revoked',
            revokedAt: now,
            updatedAt: now,
        });

        const nextInvitations = [...invitations];
        nextInvitations[index] = revokedInvitation;
        this.setMetadataChildren('collaboratorInvitations', nextInvitations);
        this.recordCollaboratorAccessEvent({
            action: 'invitation_revoked',
            actorId,
            invitationId: revokedInvitation.id,
            targetUserId: revokedInvitation.inviteeUserId,
            targetEmail: revokedInvitation.inviteeEmail,
            targetUsername: revokedInvitation.inviteeUsername,
            permission: revokedInvitation.permission,
        });
        this.touch();
        return revokedInvitation;
    }

    public get blobs(): Blob[] {
        return this.getMetadataChildren<Blob>('blobs', row => Asset.asBlob({
            id: Asset.stringValue(row.id),
            assetId: this.id,
            path: Asset.stringValue(row.path),
            size: Number(row.size ?? 0),
            contentSha: Asset.stringValue(row.contentSha),
            isBinary: Boolean(row.isBinary),
        }));
    }

    public get commits(): Commit[] {
        return this.getMetadataChildren<Commit>('commits', row => Asset.asCommit({
            id: Asset.stringValue(row.id) || Asset.stringValue(row.sha),
            assetId: this.id,
            sha: Asset.stringValue(row.sha) || Asset.stringValue(row.id),
            message: Asset.stringValue(row.message),
            authorName: Asset.stringValue(row.authorName),
            authorEmail: Asset.stringValue(row.authorEmail),
            authorAvatarUrl: Asset.optionalStringValue(row.authorAvatarUrl),
            parentShas: Array.isArray(row.parentShas)
                ? row.parentShas.filter((item): item is string => typeof item === 'string')
                : [],
            treeSha: Asset.stringValue(row.treeSha),
            createdAt: Asset.dateValue(row.createdAt),
        }));
    }

    public getCommitDiff(sha: string): string | undefined {
        const diffs = this._metadata?.commitDiffs;
        if (!diffs || typeof diffs !== 'object' || Array.isArray(diffs)) {
            return undefined;
        }
        const diff = (diffs as Record<string, unknown>)[sha];
        return typeof diff === 'string' ? diff : undefined;
    }

    public get commitComments(): CommitComment[] {
        return this.getMetadataChildren<CommitComment>('commitComments', row => Asset.asCommitComment({
            id: Asset.stringValue(row.id),
            assetId: this.id,
            commitSha: Asset.stringValue(row.commitSha),
            userId: Asset.stringValue(row.userId),
            body: Asset.stringValue(row.body),
            line: typeof row.line === 'number' ? row.line : undefined,
            filePath: Asset.optionalStringValue(row.filePath),
            createdAt: Asset.dateValue(row.createdAt),
            updatedAt: Asset.dateValue(row.updatedAt),
        }));
    }

    public createCommitComment(
        commitSha: string,
        userId: string,
        body: string,
        line?: number,
        filePath?: string,
    ): CommitComment {
        const now = new Date();
        const comment = Asset.asCommitComment({
            id: uuidv4(),
            assetId: this.id,
            commitSha: Asset.normalizeName(commitSha),
            userId,
            body: Asset.normalizeName(body),
            line,
            filePath,
            createdAt: now,
            updatedAt: now,
        });
        this.setMetadataChildren('commitComments', [...this.commitComments, comment]);
        this.touch();
        return comment;
    }

    public deleteCommitComment(id: string): void {
        const comments = this.commitComments;
        const nextComments = comments.filter(comment => comment.id !== id);
        if (nextComments.length === comments.length) {
            return;
        }
        this.setMetadataChildren('commitComments', nextComments);
        this.touch();
    }

    public get pullRequestComments(): PullRequestComment[] {
        return this.getMetadataChildren<PullRequestComment>('pullRequestComments', row => Asset.asPullRequestComment({
            id: Asset.stringValue(row.id),
            assetId: this.id,
            pullRequestId: Asset.stringValue(row.pullRequestId),
            userId: Asset.stringValue(row.userId),
            body: Asset.stringValue(row.body),
            filePath: Asset.optionalStringValue(row.filePath),
            line: typeof row.line === 'number' ? row.line : undefined,
            side: Asset.optionalStringValue(row.side) as PullRequestComment['side'],
            externalId: Asset.optionalStringValue(row.externalId),
            externalProvider: Asset.optionalStringValue(row.externalProvider) as PullRequestComment['externalProvider'],
            createdAt: Asset.dateValue(row.createdAt),
            updatedAt: Asset.dateValue(row.updatedAt),
        }));
    }

    public createPullRequestComment(
        pullRequestId: string,
        userId: string,
        body: string,
        filePath?: string,
        line?: number,
        side?: PullRequestComment['side'],
        options?: { externalId?: string; externalProvider?: ExternalProvider; createdAt?: Date; updatedAt?: Date },
    ): PullRequestComment {
        const now = new Date();
        const comment = Asset.asPullRequestComment({
            id: uuidv4(),
            assetId: this.id,
            pullRequestId: Asset.normalizeName(pullRequestId),
            userId: Asset.normalizeName(userId),
            body: Asset.normalizeName(body),
            filePath,
            line,
            side,
            externalId: options?.externalId,
            externalProvider: options?.externalProvider,
            createdAt: options?.createdAt ?? now,
            updatedAt: options?.updatedAt ?? now,
        });
        this.setMetadataChildren('pullRequestComments', [...this.pullRequestComments, comment]);
        this.touch();
        return comment;
    }

    public deletePullRequestComment(id: string): void {
        const comments = this.pullRequestComments;
        const nextComments = comments.filter(comment => comment.id !== id);
        if (nextComments.length === comments.length) {
            return;
        }
        this.setMetadataChildren('pullRequestComments', nextComments);
        this.touch();
    }

    public get issueComments(): IssueComment[] {
        return this.getMetadataChildren<IssueComment>('issueComments', row => Asset.asIssueComment({
            id: Asset.stringValue(row.id),
            assetId: this.id,
            issueId: Asset.stringValue(row.issueId),
            userId: Asset.stringValue(row.userId),
            body: Asset.stringValue(row.body),
            externalId: Asset.optionalStringValue(row.externalId),
            externalProvider: Asset.optionalStringValue(row.externalProvider) as IssueComment['externalProvider'],
            createdAt: Asset.dateValue(row.createdAt),
            updatedAt: Asset.dateValue(row.updatedAt),
        }));
    }

    public createIssueComment(
        issueId: string,
        userId: string,
        body: string,
        options?: { externalId?: string; externalProvider?: ExternalProvider; createdAt?: Date; updatedAt?: Date },
    ): IssueComment {
        const now = new Date();
        const comment = Asset.asIssueComment({
            id: uuidv4(),
            assetId: this.id,
            issueId: Asset.normalizeName(issueId),
            userId: Asset.normalizeName(userId),
            body,
            externalId: options?.externalId,
            externalProvider: options?.externalProvider,
            createdAt: options?.createdAt ?? now,
            updatedAt: options?.updatedAt ?? now,
        });
        this.setMetadataChildren('issueComments', [...this.issueComments, comment]);
        this.touch();
        return comment;
    }

    public deleteIssueComment(id: string): void {
        const comments = this.issueComments;
        const nextComments = comments.filter(comment => comment.id !== id);
        if (nextComments.length === comments.length) {
            return;
        }
        this.setMetadataChildren('issueComments', nextComments);
        this.touch();
    }

    public get issues(): Issue[] {
        return this.getMetadataChildren<Issue>('issues', row => Asset.asIssue({
            id: Asset.stringValue(row.id),
            assetId: this.id,
            number: typeof row.number === 'number' ? row.number : Number(row.number ?? 0),
            title: Asset.stringValue(row.title),
            body: Asset.optionalStringValue(row.body),
            authorId: Asset.stringValue(row.authorId),
            status: Asset.stringValue(row.status) as Issue['status'],
            labels: Array.isArray(row.labels) ? row.labels.map(item => Asset.stringValue(item)) : [],
            assignees: Array.isArray(row.assignees) ? row.assignees.map(item => Asset.stringValue(item)) : [],
            closedBy: Asset.optionalStringValue(row.closedBy),
            closedAt: row.closedAt ? Asset.dateValue(row.closedAt) : undefined,
            externalId: Asset.optionalStringValue(row.externalId),
            externalProvider: Asset.optionalStringValue(row.externalProvider) as Issue['externalProvider'],
            externalUrl: Asset.optionalStringValue(row.externalUrl),
            syncedAt: row.syncedAt ? Asset.dateValue(row.syncedAt) : undefined,
            metadata: row.metadata && typeof row.metadata === 'object' && !Array.isArray(row.metadata)
                ? row.metadata as Record<string, unknown>
                : undefined,
            createdAt: Asset.dateValue(row.createdAt),
            updatedAt: Asset.dateValue(row.updatedAt),
        }));
    }

    public createIssue(input: {
        title: string;
        body?: string;
        authorId: string;
        labels?: string[];
        assignees?: string[];
        externalId?: string;
        externalProvider?: 'github';
        externalUrl?: string;
        metadata?: Record<string, unknown>;
    }): Issue {
        const now = new Date();
        const nextNumber = this.issues.reduce((max, issue) => Math.max(max, issue.number), 0) + 1;
        const issue = Asset.asIssue({
            id: uuidv4(),
            assetId: this.id,
            number: nextNumber,
            title: Asset.normalizeName(input.title),
            body: input.body,
            authorId: Asset.normalizeName(input.authorId),
            status: 'open',
            labels: input.labels?.map(label => Asset.normalizeName(label)).filter(Boolean) ?? [],
            assignees: input.assignees?.map(assignee => Asset.normalizeName(assignee)).filter(Boolean) ?? [],
            externalId: input.externalId,
            externalProvider: input.externalProvider,
            externalUrl: input.externalUrl,
            syncedAt: input.externalId ? now : undefined,
            metadata: input.metadata,
            createdAt: now,
            updatedAt: now,
        });
        this.setMetadataChildren('issues', [...this.issues, issue]);
        this.touch();
        return issue;
    }

    public updateIssue(
        id: string,
        props: Partial<Pick<Issue, 'title' | 'body' | 'labels' | 'assignees'>>,
    ): Issue | null {
        let updatedIssue: Issue | null = null;
        const issues = this.issues.map(issue => {
            if (issue.id !== id) {
                return issue;
            }
            updatedIssue = Asset.asIssue({
                ...issue,
                id: issue.id,
                title: props.title !== undefined ? Asset.normalizeName(props.title) : issue.title,
                body: props.body !== undefined ? props.body : issue.body,
                labels: props.labels !== undefined ? props.labels.map(label => Asset.normalizeName(label)).filter(Boolean) : issue.labels,
                assignees: props.assignees !== undefined ? props.assignees.map(assignee => Asset.normalizeName(assignee)).filter(Boolean) : issue.assignees,
                updatedAt: new Date(),
            });
            return updatedIssue;
        });
        if (!updatedIssue) {
            return null;
        }
        this.setMetadataChildren('issues', issues);
        this.touch();
        return updatedIssue;
    }

    public closeIssue(id: string, closedBy: string): Issue | null {
        return this.updateIssueStatus(id, 'closed', { closedAt: new Date(), closedBy });
    }

    public reopenIssue(id: string): Issue | null {
        return this.updateIssueStatus(id, 'open', { closedAt: undefined, closedBy: undefined });
    }

    private updateIssueStatus(
        id: string,
        status: Issue['status'],
        props: Partial<Pick<Issue, 'closedAt' | 'closedBy'>>,
    ): Issue | null {
        let updatedIssue: Issue | null = null;
        const issues = this.issues.map(issue => {
            if (issue.id !== id) {
                return issue;
            }
            updatedIssue = Asset.asIssue({
                ...issue,
                id: issue.id,
                status,
                closedAt: props.closedAt,
                closedBy: props.closedBy,
                updatedAt: new Date(),
            });
            return updatedIssue;
        });
        if (!updatedIssue) {
            return null;
        }
        this.setMetadataChildren('issues', issues);
        this.touch();
        return updatedIssue;
    }

    public get pullRequestReviews(): PullRequestReview[] {
        return this.getMetadataChildren<PullRequestReview>('pullRequestReviews', row => Asset.asPullRequestReview({
            id: Asset.stringValue(row.id),
            assetId: this.id,
            pullRequestId: Asset.stringValue(row.pullRequestId),
            reviewerId: Asset.stringValue(row.reviewerId),
            decision: Asset.stringValue(row.decision) as PullRequestReview['decision'],
            body: Asset.optionalStringValue(row.body),
            externalId: Asset.optionalStringValue(row.externalId),
            externalProvider: Asset.optionalStringValue(row.externalProvider) as PullRequestReview['externalProvider'],
            createdAt: Asset.dateValue(row.createdAt),
            updatedAt: Asset.dateValue(row.updatedAt),
        }));
    }

    public createPullRequestReview(
        pullRequestId: string,
        reviewerId: string,
        decision: PullRequestReview['decision'],
        body?: string,
        options?: { externalId?: string; externalProvider?: ExternalProvider; createdAt?: Date; updatedAt?: Date },
    ): PullRequestReview {
        const now = new Date();
        const review = Asset.asPullRequestReview({
            id: uuidv4(),
            assetId: this.id,
            pullRequestId: Asset.normalizeName(pullRequestId),
            reviewerId: Asset.normalizeName(reviewerId),
            decision,
            body,
            externalId: options?.externalId,
            externalProvider: options?.externalProvider,
            createdAt: options?.createdAt ?? now,
            updatedAt: options?.updatedAt ?? now,
        });
        this.setMetadataChildren('pullRequestReviews', [...this.pullRequestReviews, review]);
        this.touch();
        return review;
    }

    public get pullRequests(): PullRequest[] {
        return this.getMetadataChildren<PullRequest>('pullRequests', row => Asset.asPullRequest({
            id: Asset.stringValue(row.id),
            assetId: this.id,
            number: typeof row.number === 'number' ? row.number : Number(row.number ?? 0),
            title: Asset.stringValue(row.title),
            body: Asset.optionalStringValue(row.body),
            baseRef: Asset.stringValue(row.baseRef),
            headRef: Asset.stringValue(row.headRef),
            baseCommitSha: Asset.stringValue(row.baseCommitSha),
            headCommitSha: Asset.stringValue(row.headCommitSha),
            authorId: Asset.stringValue(row.authorId),
            assignees: Asset.stringListValue(row.assignees),
            requestedReviewers: Asset.stringListValue(row.requestedReviewers),
            status: Asset.stringValue(row.status) as PullRequest['status'],
            filesChanged: Number(row.filesChanged ?? 0),
            additions: Number(row.additions ?? 0),
            deletions: Number(row.deletions ?? 0),
            commitsCount: Number(row.commitsCount ?? 0),
            mergedBy: Asset.optionalStringValue(row.mergedBy),
            mergeStrategy: Asset.optionalStringValue(row.mergeStrategy) as PullRequest['mergeStrategy'],
            mergedAt: row.mergedAt ? Asset.dateValue(row.mergedAt) : undefined,
            closedAt: row.closedAt ? Asset.dateValue(row.closedAt) : undefined,
            externalId: Asset.optionalStringValue(row.externalId),
            externalProvider: Asset.optionalStringValue(row.externalProvider) as PullRequest['externalProvider'],
            externalUrl: Asset.optionalStringValue(row.externalUrl),
            syncedAt: row.syncedAt ? Asset.dateValue(row.syncedAt) : undefined,
            metadata: row.metadata && typeof row.metadata === 'object' && !Array.isArray(row.metadata)
                ? row.metadata as Record<string, unknown>
                : undefined,
            createdAt: Asset.dateValue(row.createdAt),
            updatedAt: Asset.dateValue(row.updatedAt),
        }));
    }

    public createPullRequest(input: {
        title: string;
        body?: string;
        baseRef: string;
        headRef: string;
        baseCommitSha: string;
        headCommitSha: string;
        authorId: string;
        filesChanged?: number;
        additions?: number;
        deletions?: number;
        commitsCount?: number;
        assignees?: string[];
        requestedReviewers?: string[];
        externalId?: string;
        externalProvider?: 'github';
        externalUrl?: string;
        metadata?: Record<string, unknown>;
    }): PullRequest {
        const now = new Date();
        const nextNumber = this.pullRequests.reduce((max, pullRequest) => Math.max(max, pullRequest.number), 0) + 1;
        const pullRequest = Asset.asPullRequest({
            id: uuidv4(),
            assetId: this.id,
            number: nextNumber,
            title: Asset.normalizeName(input.title),
            body: input.body,
            baseRef: Asset.normalizeName(input.baseRef),
            headRef: Asset.normalizeName(input.headRef),
            baseCommitSha: Asset.normalizeName(input.baseCommitSha),
            headCommitSha: Asset.normalizeName(input.headCommitSha),
            authorId: Asset.normalizeName(input.authorId),
            assignees: Asset.normalizeStringList(input.assignees),
            requestedReviewers: Asset.normalizeStringList(input.requestedReviewers),
            status: 'open',
            filesChanged: input.filesChanged ?? 0,
            additions: input.additions ?? 0,
            deletions: input.deletions ?? 0,
            commitsCount: input.commitsCount ?? 0,
            externalId: input.externalId,
            externalProvider: input.externalProvider,
            externalUrl: input.externalUrl,
            syncedAt: input.externalId ? now : undefined,
            metadata: input.metadata,
            createdAt: now,
            updatedAt: now,
        });
        this.setMetadataChildren('pullRequests', [...this.pullRequests, pullRequest]);
        this.touch();
        return pullRequest;
    }

    public updatePullRequest(
        id: string,
        props: Partial<Pick<PullRequest, 'title' | 'body' | 'assignees' | 'requestedReviewers'>>,
    ): PullRequest | null {
        let updatedPullRequest: PullRequest | null = null;
        const pullRequests = this.pullRequests.map(pullRequest => {
            if (pullRequest.id !== id) {
                return pullRequest;
            }
            updatedPullRequest = Asset.asPullRequest({
                ...pullRequest,
                id: pullRequest.id,
                title: props.title !== undefined ? Asset.normalizeName(props.title) : pullRequest.title,
                body: props.body !== undefined ? props.body : pullRequest.body,
                assignees: props.assignees !== undefined
                    ? Asset.normalizeStringList(props.assignees)
                    : pullRequest.assignees,
                requestedReviewers: props.requestedReviewers !== undefined
                    ? Asset.normalizeStringList(props.requestedReviewers)
                    : pullRequest.requestedReviewers,
                updatedAt: new Date(),
            });
            return updatedPullRequest;
        });
        if (!updatedPullRequest) {
            return null;
        }
        this.setMetadataChildren('pullRequests', pullRequests);
        this.touch();
        return updatedPullRequest;
    }

    public closePullRequest(id: string): PullRequest | null {
        return this.updatePullRequestStatus(id, 'closed', { closedAt: new Date() });
    }

    public reopenPullRequest(id: string): PullRequest | null {
        return this.updatePullRequestStatus(id, 'open', { closedAt: undefined, mergedAt: undefined, mergedBy: undefined, mergeStrategy: undefined });
    }

    public mergePullRequest(id: string, mergedBy: string, strategy: PullRequestMergeStrategy = 'merge'): PullRequest | null {
        const merged = this.updatePullRequestStatus(id, 'merged', {
            mergedBy,
            mergeStrategy: strategy,
            mergedAt: new Date(),
            closedAt: new Date(),
        });
        if (!merged) {
            return null;
        }

        const branches = this.branches.map(branch => branch.name === merged.baseRef
            ? Asset.asBranch({ ...branch, id: branch.id, commitSha: merged.headCommitSha })
            : branch);
        this.setMetadataChildren('branches', branches);
        this.touch();
        return merged;
    }

    private updatePullRequestStatus(
        id: string,
        status: PullRequest['status'],
        props: Partial<Pick<PullRequest, 'closedAt' | 'mergedAt' | 'mergedBy' | 'mergeStrategy'>>,
    ): PullRequest | null {
        let updatedPullRequest: PullRequest | null = null;
        const pullRequests = this.pullRequests.map(pullRequest => {
            if (pullRequest.id !== id) {
                return pullRequest;
            }
            updatedPullRequest = Asset.asPullRequest({
                ...pullRequest,
                id: pullRequest.id,
                status,
                closedAt: props.closedAt,
                mergedAt: props.mergedAt,
                mergedBy: props.mergedBy,
                mergeStrategy: props.mergeStrategy,
                updatedAt: new Date(),
            });
            return updatedPullRequest;
        });
        if (!updatedPullRequest) {
            return null;
        }
        this.setMetadataChildren('pullRequests', pullRequests);
        this.touch();
        return updatedPullRequest;
    }

    public get pipelines(): Pipeline[] {
        return this.getMetadataChildren<Pipeline>('pipelines', row => Asset.asPipeline({
            id: Asset.stringValue(row.id),
            assetId: this.id,
            name: Asset.stringValue(row.name),
            description: Asset.optionalStringValue(row.description),
            filePath: Asset.stringValue(row.filePath),
            isEnabled: row.isEnabled !== false,
            triggerEvents: Asset.stringListValue(row.triggerEvents),
            inputs: Asset.pipelineInputsValue(row.inputs),
            createdAt: Asset.dateValue(row.createdAt),
            updatedAt: Asset.dateValue(row.updatedAt),
        }));
    }

    public get pipelineRuns(): PipelineRun[] {
        return this.getMetadataChildren<PipelineRun>('pipelineRuns', row => Asset.asPipelineRun({
            id: Asset.stringValue(row.id),
            pipelineId: Asset.stringValue(row.pipelineId),
            assetId: this.id,
            runNumber: Number(row.runNumber ?? 0),
            status: Asset.pipelineRunStatusValue(row.status),
            conclusion: Asset.optionalPipelineRunConclusionValue(row.conclusion),
            event: Asset.stringValue(row.event),
            branch: Asset.stringValue(row.branch),
            commitSha: Asset.stringValue(row.commitSha),
            triggeredBy: Asset.stringValue(row.triggeredBy),
            inputs: Asset.stringRecordValue(row.inputs),
            startedAt: Asset.optionalDateValue(row.startedAt),
            completedAt: Asset.optionalDateValue(row.completedAt),
            createdAt: Asset.dateValue(row.createdAt),
        }));
    }

    public get pipelineJobs(): PipelineJob[] {
        return this.getMetadataChildren<PipelineJob>('pipelineJobs', row => Asset.asPipelineJob({
            id: Asset.stringValue(row.id),
            runId: Asset.stringValue(row.runId),
            sourceId: Asset.optionalStringValue(row.sourceId),
            name: Asset.stringValue(row.name),
            needs: Asset.stringListValue(row.needs),
            status: Asset.pipelineJobStatusValue(row.status),
            conclusion: Asset.optionalPipelineJobConclusionValue(row.conclusion),
            stepNumber: Number(row.stepNumber ?? 0),
            stepName: Asset.stringValue(row.stepName),
            logs: Asset.optionalStringValue(row.logs),
            startedAt: Asset.optionalDateValue(row.startedAt),
            completedAt: Asset.optionalDateValue(row.completedAt),
            createdAt: Asset.dateValue(row.createdAt),
        }));
    }

    public get pipelineSteps(): PipelineStep[] {
        return this.getMetadataChildren<PipelineStep>('pipelineSteps', row => Asset.asPipelineStep({
            id: Asset.stringValue(row.id),
            jobId: Asset.stringValue(row.jobId),
            name: Asset.stringValue(row.name),
            status: Asset.pipelineJobStatusValue(row.status),
            conclusion: Asset.optionalPipelineJobConclusionValue(row.conclusion),
            stepNumber: Number(row.stepNumber ?? 0),
            command: Asset.optionalStringValue(row.command),
            workingDirectory: Asset.optionalStringValue(row.workingDirectory),
            envVars: Asset.stringRecordValue(row.envVars),
            dependsOn: Asset.stringListValue(row.dependsOn),
            condition: Asset.optionalStringValue(row.condition),
            logs: Asset.optionalStringValue(row.logs),
            startedAt: Asset.optionalDateValue(row.startedAt),
            completedAt: Asset.optionalDateValue(row.completedAt),
            createdAt: Asset.dateValue(row.createdAt),
        }));
    }

    public get pipelineArtifacts(): PipelineArtifact[] {
        return this.getMetadataChildren<PipelineArtifact>('pipelineArtifacts', row => Asset.asPipelineArtifact({
            id: Asset.stringValue(row.id),
            runId: Asset.stringValue(row.runId),
            name: Asset.stringValue(row.name),
            sizeBytes: Number(row.sizeBytes ?? 0),
            objectKey: Asset.optionalStringValue(row.objectKey),
            downloadUrl: Asset.optionalStringValue(row.downloadUrl),
            expiredAt: Asset.optionalDateValue(row.expiredAt),
            createdAt: Asset.dateValue(row.createdAt),
        }));
    }

    public get actionVariables(): AssetActionVariable[] {
        return this.getMetadataChildren<AssetActionVariable | null>('actionVariables', row => {
            const name = Asset.actionConfigNameValue(row.name);
            return name
                ? { name, value: Asset.stringValue(row.value), updatedAt: Asset.dateValue(row.updatedAt) }
                : null;
        }).filter((item): item is AssetActionVariable => Boolean(item));
    }

    public get webhooks(): AssetWebhook[] {
        return this.getMetadataChildren<AssetWebhook>('webhooks', row => Asset.asAssetWebhook({
            id: Asset.stringValue(row.id),
            assetId: this.id,
            url: Asset.stringValue(row.url),
            secret: Asset.optionalStringValue(row.secret),
            events: Asset.stringListValue(row.events),
            isActive: row.isActive !== false,
            lastStatus: Asset.optionalWebhookStatusValue(row.lastStatus),
            lastStatusCode: typeof row.lastStatusCode === 'number' ? row.lastStatusCode : undefined,
            lastError: Asset.optionalStringValue(row.lastError),
            lastDeliveredAt: Asset.optionalDateValue(row.lastDeliveredAt),
            createdAt: Asset.dateValue(row.createdAt),
            updatedAt: Asset.dateValue(row.updatedAt),
        }));
    }

    public createWebhook(input: { url: string; secret?: string; events?: string[]; isActive?: boolean }): AssetWebhook {
        const now = new Date();
        const webhook = Asset.asAssetWebhook({
            id: uuidv4(),
            assetId: this.id,
            url: Asset.normalizeWebhookUrl(input.url),
            secret: input.secret?.trim() || undefined,
            events: Asset.normalizeWebhookEvents(input.events),
            isActive: input.isActive ?? true,
            createdAt: now,
            updatedAt: now,
        });
        this.setMetadataChildren('webhooks', [webhook, ...this.webhooks]);
        this.touch();
        return webhook;
    }

    public updateWebhook(
        webhookId: string,
        input: Partial<{ url: string; secret: string | null; events: string[]; isActive: boolean }>,
    ): AssetWebhook | null {
        let updatedWebhook: AssetWebhook | null = null;
        const webhooks = this.webhooks.map(webhook => {
            if (webhook.id !== webhookId) {
                return webhook;
            }
            updatedWebhook = Asset.asAssetWebhook({
                ...webhook,
                id: webhook.id,
                url: input.url !== undefined ? Asset.normalizeWebhookUrl(input.url) : webhook.url,
                secret: input.secret !== undefined ? (input.secret?.trim() || undefined) : webhook.secret,
                events: input.events !== undefined ? Asset.normalizeWebhookEvents(input.events) : webhook.events,
                isActive: input.isActive !== undefined ? input.isActive : webhook.isActive,
                updatedAt: new Date(),
            });
            return updatedWebhook;
        });
        if (!updatedWebhook) {
            return null;
        }
        this.setMetadataChildren('webhooks', webhooks);
        this.touch();
        return updatedWebhook;
    }

    public deleteWebhook(webhookId: string): void {
        const webhooks = this.webhooks;
        const nextWebhooks = webhooks.filter(webhook => webhook.id !== webhookId);
        if (nextWebhooks.length === webhooks.length) {
            return;
        }
        this.setMetadataChildren('webhooks', nextWebhooks);
        this.touch();
    }

    public recordWebhookDelivery(
        webhookId: string,
        input: { status: 'success' | 'failure'; statusCode?: number; error?: string; deliveredAt?: Date },
    ): AssetWebhook | null {
        let updatedWebhook: AssetWebhook | null = null;
        const webhooks = this.webhooks.map(webhook => {
            if (webhook.id !== webhookId) {
                return webhook;
            }
            const now = new Date();
            updatedWebhook = Asset.asAssetWebhook({
                ...webhook,
                id: webhook.id,
                lastStatus: input.status,
                lastStatusCode: input.statusCode,
                lastError: input.error,
                lastDeliveredAt: input.deliveredAt || now,
                updatedAt: now,
            });
            return updatedWebhook;
        });
        if (!updatedWebhook) {
            return null;
        }
        this.setMetadataChildren('webhooks', webhooks);
        this.touch();
        return updatedWebhook;
    }

    public syncPipelinesFromWorkflows(workflows: WorkflowDefinition[]): Pipeline[] {
        const now = new Date();
        const existingByFilePath = new Map(this.pipelines.map(pipeline => [pipeline.filePath, pipeline]));
        const existingByName = new Map(this.pipelines.map(pipeline => [pipeline.name, pipeline]));
        const pipelineDefinitions = this.getPipelineDefinitions();
        const pipelines = workflows.map(workflow => {
            const existing = existingByFilePath.get(workflow.filePath) || existingByName.get(workflow.name);
            const pipeline = Asset.asPipeline({
                id: existing?.id || uuidv4(),
                assetId: this.id,
                name: Asset.normalizeName(workflow.name),
                description: workflow.description,
                filePath: workflow.filePath,
                isEnabled: existing?.isEnabled ?? true,
                triggerEvents: workflow.triggerEvents.length > 0 ? workflow.triggerEvents : ['workflow_dispatch'],
                inputs: workflow.inputs,
                createdAt: existing?.createdAt || now,
                updatedAt: now,
            });
            pipelineDefinitions[pipeline.id] = workflow;
            return pipeline;
        });

        if (workflows.length === 0) {
            return this.pipelines;
        }

        this._metadata = {
            ...(this._metadata || {}),
            pipelineDefinitions,
        };
        this.setMetadataChildren('pipelines', pipelines);
        this.touch();
        return pipelines;
    }

    public upsertActionVariable(name: string, value: string): AssetActionVariable {
        const variable = {
            name: Asset.normalizeActionConfigName(name),
            value,
            updatedAt: new Date(),
        };
        this.setMetadataChildren('actionVariables', [
            variable,
            ...this.actionVariables.filter(item => item.name !== variable.name),
        ]);
        this.touch();
        return variable;
    }

    public deleteActionVariable(name: string): void {
        const normalized = Asset.normalizeActionConfigName(name);
        const variables = this.actionVariables;
        const nextVariables = variables.filter(item => item.name !== normalized);
        if (nextVariables.length === variables.length) {
            return;
        }
        this.setMetadataChildren('actionVariables', nextVariables);
        this.touch();
    }

    public createPipeline(
        name: string,
        filePath: string,
        triggerEvents: string[],
        description?: string,
        isEnabled = true,
    ): Pipeline {
        const now = new Date();
        const pipeline = Asset.asPipeline({
            id: uuidv4(),
            assetId: this.id,
            name: Asset.normalizeName(name),
            description,
            filePath: Asset.normalizeName(filePath),
            isEnabled,
            triggerEvents,
            createdAt: now,
            updatedAt: now,
        });
        this.setMetadataChildren('pipelines', [...this.pipelines, pipeline]);
        this.touch();
        return pipeline;
    }

    public updatePipeline(
        pipelineId: string,
        props: Partial<Pick<Pipeline, 'name' | 'description' | 'isEnabled' | 'triggerEvents'>>,
    ): Pipeline | null {
        let updatedPipeline: Pipeline | null = null;
        const pipelines = this.pipelines.map(pipeline => {
            if (pipeline.id !== pipelineId) {
                return pipeline;
            }
            updatedPipeline = Asset.asPipeline({
                ...pipeline,
                id: pipeline.id,
                name: props.name !== undefined ? Asset.normalizeName(props.name) : pipeline.name,
                description: props.description !== undefined ? props.description : pipeline.description,
                isEnabled: props.isEnabled !== undefined ? props.isEnabled : pipeline.isEnabled,
                triggerEvents: props.triggerEvents !== undefined ? props.triggerEvents : pipeline.triggerEvents,
                updatedAt: new Date(),
            });
            return updatedPipeline;
        });
        if (!updatedPipeline) {
            return null;
        }
        this.setMetadataChildren('pipelines', pipelines);
        this.touch();
        return updatedPipeline;
    }

    public deletePipeline(pipelineId: string): void {
        const pipelines = this.pipelines;
        const nextPipelines = pipelines.filter(pipeline => pipeline.id !== pipelineId);
        if (nextPipelines.length === pipelines.length) {
            return;
        }
        const runIds = new Set(this.pipelineRuns.filter(run => run.pipelineId === pipelineId).map(run => run.id));
        const jobIds = new Set(this.pipelineJobs.filter(job => runIds.has(job.runId)).map(job => job.id));
        this.setMetadataChildren('pipelines', nextPipelines);
        this.setMetadataChildren('pipelineRuns', this.pipelineRuns.filter(run => run.pipelineId !== pipelineId));
        this.setMetadataChildren('pipelineJobs', this.pipelineJobs.filter(job => !runIds.has(job.runId)));
        this.setMetadataChildren('pipelineSteps', this.pipelineSteps.filter(step => !jobIds.has(step.jobId)));
        this.setMetadataChildren('pipelineArtifacts', this.pipelineArtifacts.filter(artifact => !runIds.has(artifact.runId)));
        this.touch();
    }

    public dispatchPipelineRun(
        pipelineId: string,
        options: {
            event?: string;
            branch?: string;
            commitSha?: string;
            triggeredBy?: string;
            jobs?: WorkflowJobDefinition[];
            status?: PipelineRun['status'];
            inputs?: Record<string, string>;
        } = {},
    ): PipelineRun | null {
        const pipeline = this.pipelines.find(item => item.id === pipelineId);
        if (!pipeline || !pipeline.isEnabled) {
            return null;
        }

        const now = new Date();
        const status = options.status || 'success';
        const isTerminal = ['success', 'failure', 'cancelled', 'skipped'].includes(status);
        const conclusion = status === 'success' ? 'success' : status === 'failure' ? 'failure' : undefined;
        const previousRunNumber = this.pipelineRuns.reduce((max, run) => Math.max(max, run.runNumber), 0);
        const run = Asset.asPipelineRun({
            id: uuidv4(),
            pipelineId,
            assetId: this.id,
            runNumber: previousRunNumber + 1,
            status,
            conclusion,
            event: options.event || 'workflow_dispatch',
            branch: options.branch || this._defaultBranch,
            commitSha: options.commitSha || this.latestCommitSha(),
            triggeredBy: options.triggeredBy || 'local-user',
            inputs: options.inputs,
            startedAt: status === 'queued' ? undefined : now,
            completedAt: isTerminal ? now : undefined,
            createdAt: now,
        });

        const childStatus: PipelineJob['status'] = status === 'skipped' ? 'cancelled' : status;
        const jobs = (options.jobs && options.jobs.length > 0 ? options.jobs : this.workflowJobsForPipeline(pipelineId))
            .map((job, jobIndex) => this.createPipelineJob(run.id, job, jobIndex + 1, childStatus, now));
        const steps = jobs.flatMap(({ job, source }) => source.steps.map((step, index) => this.createPipelineStep(job.id, step, index + 1, childStatus, now)));
        const artifacts = status === 'success' ? this.createPipelineArtifacts(run.id, pipeline.name, now) : [];

        this.setMetadataChildren('pipelineRuns', [run, ...this.pipelineRuns]);
        this.setMetadataChildren('pipelineJobs', [...jobs.map(item => item.job), ...this.pipelineJobs]);
        this.setMetadataChildren('pipelineSteps', [...steps, ...this.pipelineSteps]);
        this.setMetadataChildren('pipelineArtifacts', [...artifacts, ...this.pipelineArtifacts]);
        this.touch();
        return run;
    }

    public updatePipelineRunState(
        pipelineId: string,
        runId: string,
        props: Partial<Pick<PipelineRun, 'status' | 'conclusion' | 'startedAt' | 'completedAt'>>,
    ): PipelineRun | null {
        let updatedRun: PipelineRun | null = null;
        const runs = this.pipelineRuns.map(run => {
            if (run.pipelineId !== pipelineId || run.id !== runId) {
                return run;
            }
            updatedRun = Asset.asPipelineRun({
                ...run,
                id: run.id,
                status: props.status ?? run.status,
                conclusion: props.conclusion !== undefined ? props.conclusion : run.conclusion,
                startedAt: props.startedAt !== undefined ? props.startedAt : run.startedAt,
                completedAt: props.completedAt !== undefined ? props.completedAt : run.completedAt,
            });
            return updatedRun;
        });
        if (!updatedRun) {
            return null;
        }
        this.setMetadataChildren('pipelineRuns', runs);
        this.touch();
        return updatedRun;
    }

    public updatePipelineJobState(
        runId: string,
        jobId: string,
        props: Partial<Pick<PipelineJob, 'status' | 'conclusion' | 'logs' | 'startedAt' | 'completedAt'>>,
    ): PipelineJob | null {
        let updatedJob: PipelineJob | null = null;
        const jobs = this.pipelineJobs.map(job => {
            if (job.runId !== runId || job.id !== jobId) {
                return job;
            }
            updatedJob = Asset.asPipelineJob({
                ...job,
                id: job.id,
                status: props.status ?? job.status,
                conclusion: props.conclusion !== undefined ? props.conclusion : job.conclusion,
                logs: props.logs !== undefined ? props.logs : job.logs,
                startedAt: props.startedAt !== undefined ? props.startedAt : job.startedAt,
                completedAt: props.completedAt !== undefined ? props.completedAt : job.completedAt,
            });
            return updatedJob;
        });
        if (!updatedJob) {
            return null;
        }
        this.setMetadataChildren('pipelineJobs', jobs);
        this.touch();
        return updatedJob;
    }

    public updatePipelineStepState(
        jobId: string,
        stepId: string,
        props: Partial<Pick<PipelineStep, 'status' | 'conclusion' | 'logs' | 'startedAt' | 'completedAt'>>,
    ): PipelineStep | null {
        let updatedStep: PipelineStep | null = null;
        const steps = this.pipelineSteps.map(step => {
            if (step.jobId !== jobId || step.id !== stepId) {
                return step;
            }
            updatedStep = Asset.asPipelineStep({
                ...step,
                id: step.id,
                status: props.status ?? step.status,
                conclusion: props.conclusion !== undefined ? props.conclusion : step.conclusion,
                logs: props.logs !== undefined ? props.logs : step.logs,
                startedAt: props.startedAt !== undefined ? props.startedAt : step.startedAt,
                completedAt: props.completedAt !== undefined ? props.completedAt : step.completedAt,
            });
            return updatedStep;
        });
        if (!updatedStep) {
            return null;
        }
        this.setMetadataChildren('pipelineSteps', steps);
        this.touch();
        return updatedStep;
    }

    public recordPipelineArtifact(input: {
        runId: string;
        name: string;
        sizeBytes: number;
        objectKey?: string;
        downloadUrl?: string;
        expiredAt?: Date;
    }): PipelineArtifact {
        const now = new Date();
        const artifact = Asset.asPipelineArtifact({
            id: uuidv4(),
            runId: input.runId,
            name: Asset.normalizeName(input.name),
            sizeBytes: Math.max(0, input.sizeBytes),
            objectKey: input.objectKey,
            downloadUrl: input.downloadUrl,
            expiredAt: input.expiredAt,
            createdAt: now,
        });
        this.setMetadataChildren('pipelineArtifacts', [
            artifact,
            ...this.pipelineArtifacts.filter(item => !(item.runId === artifact.runId && item.name === artifact.name)),
        ]);
        this.touch();
        return artifact;
    }

    public cancelPipelineRun(pipelineId: string, runId: string): PipelineRun | null {
        let updatedRun: PipelineRun | null = null;
        const now = new Date();
        const runs = this.pipelineRuns.map(run => {
            if (run.pipelineId !== pipelineId || run.id !== runId) {
                return run;
            }
            updatedRun = Asset.asPipelineRun({
                ...run,
                id: run.id,
                status: 'cancelled',
                conclusion: 'cancelled',
                completedAt: now,
            });
            return updatedRun;
        });
        if (!updatedRun) {
            return null;
        }
        const jobIds = this.pipelineJobs.filter(job => job.runId === runId).map(job => job.id);
        this.setMetadataChildren('pipelineRuns', runs);
        this.setMetadataChildren('pipelineJobs', this.pipelineJobs.map(job => (
            job.runId === runId
                ? Asset.asPipelineJob({ ...job, id: job.id, status: 'cancelled', conclusion: 'cancelled', completedAt: now })
                : job
        )));
        this.setMetadataChildren('pipelineSteps', this.pipelineSteps.map(step => (
            jobIds.includes(step.jobId)
                ? Asset.asPipelineStep({ ...step, id: step.id, status: 'cancelled', conclusion: 'cancelled', completedAt: now })
                : step
        )));
        this.touch();
        return updatedRun;
    }

    public toProps(): AssetProps {
        return {
            id: this.id,
            name: this._name,
            ownerId: this._ownerId,
            ownerType: this._ownerType,
            category: this._category,
            visibility: this._visibility,
            description: this._description,
            homepage: this._homepage,
            defaultBranch: this._defaultBranch,
            cloneUrl: this._cloneUrl,
            starCount: this._starCount,
            forkCount: this._forkCount,
            watchCount: this._watchCount,
            isForked: this._isForked,
            sourceAssetId: this._sourceAssetId,
            content: this._content,
            metadata: this._metadata,
            enabled: this._enabled,
            agentKind: this._agentKind,
            createdAt: this._createdAt,
            updatedAt: this._updatedAt,
        };
    }

    public toJSON(): AssetProps {
        return this.toProps();
    }

    private markAsForkOf(sourceAssetId: string): Asset {
        this._isForked = true;
        this._sourceAssetId = sourceAssetId;
        this.touch();
        return this;
    }

    private touch(): void {
        this._updatedAt = new Date();
    }

    private getMetadataList(key: string): string[] {
        const value = this._metadata?.[key];
        return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
    }

    private setMetadataList(key: string, values: Set<string>): void {
        this._metadata = {
            ...(this._metadata || {}),
            [key]: Array.from(values),
        };
    }

    private getMetadataChildren<T>(key: string, mapper: (row: MetadataChild) => T): T[] {
        const value = this._metadata?.[key];
        if (!Array.isArray(value)) {
            return [];
        }
        return value
            .filter((row): row is MetadataChild => row !== null && typeof row === 'object' && !Array.isArray(row))
            .map(row => mapper(row));
    }

    private setMetadataChildren<T extends object>(key: string, values: T[]): void {
        this._metadata = {
            ...(this._metadata || {}),
            [key]: values,
        };
    }

    private recordCollaboratorAccessEvent(input: {
        action: CollaboratorAccessEventAction;
        actorId?: string;
        invitationId?: string;
        targetUserId?: string;
        targetEmail?: string;
        targetUsername?: string;
        permission?: Permission;
        previousPermission?: Permission;
    }): CollaboratorAccessEvent {
        const event = Asset.asCollaboratorAccessEvent({
            id: uuidv4(),
            assetId: this.id,
            action: input.action,
            actorId: Asset.normalizeOptionalText(input.actorId),
            invitationId: Asset.normalizeOptionalText(input.invitationId),
            targetUserId: Asset.normalizeOptionalText(input.targetUserId),
            targetEmail: Asset.normalizeOptionalLowerText(input.targetEmail),
            targetUsername: Asset.normalizeOptionalLowerText(input.targetUsername),
            permission: input.permission,
            previousPermission: input.previousPermission,
            createdAt: new Date(),
        });
        this.setMetadataChildren('collaboratorAccessEvents', [event, ...this.collaboratorAccessEvents].slice(0, 500));
        return event;
    }

    private static normalizeName(name: string): string {
        const normalized = name.trim();
        if (!normalized) {
            throw new Error('Asset name cannot be empty');
        }
        return normalized;
    }

    private static normalizeWebhookUrl(url: string): string {
        const normalized = url.trim();
        if (!normalized) {
            throw new Error('Webhook URL cannot be empty');
        }
        const parsed = new URL(normalized);
        if (!['http:', 'https:'].includes(parsed.protocol)) {
            throw new Error('Webhook URL must use http or https');
        }
        return parsed.toString();
    }

    private static normalizeWebhookEvents(events?: string[]): string[] {
        const normalized = Array.from(new Set((events?.length ? events : ['push'])
            .map(event => event.trim().toLowerCase())
            .filter(Boolean)));
        return normalized.length > 0 ? normalized : ['push'];
    }

    private static normalizeActionConfigName(name: string): string {
        const normalized = name.trim();
        if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(normalized)) {
            throw new Error('Actions config name must start with a letter or underscore and contain only letters, numbers, and underscores');
        }
        return normalized;
    }

    private static actionConfigNameValue(value: unknown): string | undefined {
        if (typeof value !== 'string') {
            return undefined;
        }
        const normalized = value.trim();
        return /^[A-Za-z_][A-Za-z0-9_]*$/.test(normalized) ? normalized : undefined;
    }

    private static normalizeBranch(branch: string): string {
        const normalized = branch.trim();
        if (!normalized) {
            throw new Error('Default branch cannot be empty');
        }
        return normalized;
    }

    private static stringValue(value: unknown): string {
        return typeof value === 'string' ? value : '';
    }

    private static optionalStringValue(value: unknown): string | undefined {
        return typeof value === 'string' ? value : undefined;
    }

    private static optionalPermissionValue(value: unknown): Permission | undefined {
        return ['read', 'triage', 'write', 'maintain', 'admin'].includes(String(value))
            ? value as Permission
            : undefined;
    }

    private static optionalLowerStringValue(value: unknown): string | undefined {
        return typeof value === 'string' ? value.trim().toLowerCase() || undefined : undefined;
    }

    private static normalizeOptionalText(value: string | undefined): string | undefined {
        const normalized = value?.trim();
        return normalized ? normalized : undefined;
    }

    private static normalizeOptionalLowerText(value: string | undefined): string | undefined {
        return Asset.normalizeOptionalText(value)?.toLowerCase();
    }

    private static stringListValue(value: unknown): string[] {
        return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
    }

    private static normalizeStringList(value: string[] | undefined): string[] {
        return Array.from(new Set(value?.map(item => item.trim()).filter(Boolean) ?? []));
    }

    private static stringRecordValue(value: unknown): Record<string, string> | undefined {
        if (!value || typeof value !== 'object' || Array.isArray(value)) {
            return undefined;
        }
        return Object.fromEntries(
            Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
        );
    }

    private static pipelineInputsValue(value: unknown): Pipeline['inputs'] {
        if (!Array.isArray(value)) {
            return undefined;
        }
        return value
            .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object' && !Array.isArray(item) && typeof item.name === 'string')
            .map((item) => ({
                name: Asset.stringValue(item.name),
                description: Asset.optionalStringValue(item.description),
                required: typeof item.required === 'boolean' ? item.required : undefined,
                defaultValue: Asset.optionalStringValue(item.defaultValue),
                type: ['string', 'boolean', 'choice', 'environment', 'number'].includes(String(item.type)) ? item.type as NonNullable<Pipeline['inputs']>[number]['type'] : undefined,
                options: Asset.stringListValue(item.options),
            }));
    }

    private static nonNegativeIntegerValue(value: unknown, fallback = 0): number {
        const numberValue = typeof value === 'number' ? value : Number(value);
        if (!Number.isFinite(numberValue)) {
            return fallback;
        }
        return Math.max(0, Math.floor(numberValue));
    }

    private static normalizeRequiredApprovals(isProtected: boolean, value?: number): number {
        const fallback = isProtected ? 1 : 0;
        return Asset.nonNegativeIntegerValue(value, fallback);
    }

    private static dateValue(value: unknown): Date {
        if (value instanceof Date) {
            return value;
        }
        if (typeof value === 'string' || typeof value === 'number') {
            return new Date(value);
        }
        return new Date();
    }

    private static optionalDateValue(value: unknown): Date | undefined {
        if (value === undefined || value === null || value === '') {
            return undefined;
        }
        return Asset.dateValue(value);
    }

    private static collaboratorInvitationStatusValue(value: unknown): CollaboratorInvitationStatus {
        return ['pending', 'accepted', 'declined', 'revoked', 'expired'].includes(String(value))
            ? value as CollaboratorInvitationStatus
            : 'pending';
    }

    private static collaboratorAccessEventActionValue(value: unknown): CollaboratorAccessEventAction {
        return [
            'invitation_created',
            'invitation_resent',
            'invitation_accepted',
            'invitation_declined',
            'invitation_revoked',
            'collaborator_permission_updated',
            'collaborator_removed',
        ].includes(String(value))
            ? value as CollaboratorAccessEventAction
            : 'invitation_created';
    }

    private static pipelineRunStatusValue(value: unknown): PipelineRun['status'] {
        return ['queued', 'in_progress', 'success', 'failure', 'cancelled', 'skipped'].includes(String(value))
            ? value as PipelineRun['status']
            : 'queued';
    }

    private static optionalPipelineRunConclusionValue(value: unknown): PipelineRun['conclusion'] | undefined {
        return ['success', 'failure', 'cancelled', 'skipped', 'timed_out', 'action_required'].includes(String(value))
            ? value as PipelineRun['conclusion']
            : undefined;
    }

    private static pipelineJobStatusValue(value: unknown): PipelineJob['status'] {
        return ['queued', 'in_progress', 'success', 'failure', 'cancelled'].includes(String(value))
            ? value as PipelineJob['status']
            : 'queued';
    }

    private static optionalPipelineJobConclusionValue(value: unknown): PipelineJob['conclusion'] | undefined {
        return ['success', 'failure', 'cancelled', 'timed_out', 'skipped'].includes(String(value))
            ? value as PipelineJob['conclusion']
            : undefined;
    }

    private static optionalWebhookStatusValue(value: unknown): AssetWebhook['lastStatus'] | undefined {
        return value === 'success' || value === 'failure' ? value : undefined;
    }

    private getPipelineDefinitions(): Record<string, WorkflowDefinition> {
        const definitions = this._metadata?.pipelineDefinitions;
        if (!definitions || typeof definitions !== 'object' || Array.isArray(definitions)) {
            return {};
        }
        return definitions as Record<string, WorkflowDefinition>;
    }

    private workflowJobsForPipeline(pipelineId: string): WorkflowJobDefinition[] {
        const definition = this.getPipelineDefinitions()[pipelineId];
        if (definition?.jobs?.length) {
            return definition.jobs;
        }
        return [{
            id: 'build',
            name: 'Build',
            steps: [
                { name: 'Checkout', command: 'a3s/checkout@v1' },
                { name: 'Detect asset', command: 'a3s assets detect' },
                { name: 'Build package', command: 'a3s packages build' },
            ],
        }];
    }

    private latestCommitSha(): string {
        return this.commits[0]?.sha || this.branches.find(branch => branch.name === this._defaultBranch)?.commitSha || 'HEAD';
    }

    private createPipelineJob(
        runId: string,
        source: WorkflowJobDefinition,
        stepNumber: number,
        status: PipelineJob['status'],
        now: Date,
    ): { job: PipelineJob; source: WorkflowJobDefinition } {
        const firstStepName = source.steps[0]?.name || 'Run job';
        const isSuccess = status === 'success';
        const job = Asset.asPipelineJob({
            id: uuidv4(),
            runId,
            sourceId: source.sourceId || source.id,
            name: source.name || source.id,
            needs: source.needs || [],
            status,
            conclusion: isSuccess ? 'success' : undefined,
            stepNumber,
            stepName: firstStepName,
            logs: isSuccess
                ? [
                    `##[group]${source.name || source.id}`,
                    `Started at ${now.toISOString()}`,
                    ...source.steps.map(step => `✓ ${step.name}${step.command ? ` (${step.command})` : ''}`),
                    `Completed at ${now.toISOString()}`,
                    '##[endgroup]',
                ].join('\n')
                : `Queued ${source.name || source.id} for pipeline runner.`,
            startedAt: status === 'queued' ? undefined : now,
            completedAt: isSuccess ? now : undefined,
            createdAt: now,
        });
        return { job, source };
    }

    private createPipelineStep(
        jobId: string,
        source: WorkflowStepDefinition,
        stepNumber: number,
        status: PipelineStep['status'],
        now: Date,
    ): PipelineStep {
        const isSuccess = status === 'success';
        return Asset.asPipelineStep({
            id: uuidv4(),
            jobId,
            name: source.name,
            status,
            conclusion: isSuccess ? 'success' : undefined,
            stepNumber,
            command: source.command,
            workingDirectory: source.workingDirectory,
            envVars: source.envVars,
            condition: source.condition,
            logs: isSuccess
                ? [
                    `Run ${source.command || source.name}`,
                    `Working directory: ${source.workingDirectory || '.'}`,
                    'This compatibility runner recorded the step metadata for Shuan OS.',
                    'Step completed successfully.',
                ].join('\n')
                : `Queued ${source.name} for pipeline runner.`,
            startedAt: status === 'queued' ? undefined : now,
            completedAt: isSuccess ? now : undefined,
            createdAt: now,
        });
    }

    private createPipelineArtifacts(runId: string, pipelineName: string, now: Date): PipelineArtifact[] {
        return [Asset.asPipelineArtifact({
            id: uuidv4(),
            runId,
            name: `${pipelineName.toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'workflow'}-metadata`,
            sizeBytes: 1024,
            downloadUrl: undefined,
            expiredAt: new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000),
            createdAt: now,
        })];
    }

    private static asBranch(value: Omit<Branch, '_id' | 'equals' | 'equalsById' | 'toObject'>): Branch {
        return value as unknown as Branch;
    }

    private static asAssetWebhook(value: Omit<AssetWebhook, '_id' | 'equals' | 'equalsById' | 'toObject'>): AssetWebhook {
        return value as unknown as AssetWebhook;
    }

    private static asTag(value: Omit<Tag, '_id' | 'equals' | 'equalsById' | 'toObject'>): Tag {
        return value as unknown as Tag;
    }

    private static asRelease(value: Omit<Release, '_id' | 'equals' | 'equalsById' | 'toObject'>): Release {
        return value as unknown as Release;
    }

    private static asCollaborator(value: Omit<Collaborator, '_id' | 'equals' | 'equalsById' | 'toObject'>): Collaborator {
        return value as unknown as Collaborator;
    }

    private static asCollaboratorAccessEvent(
        value: Omit<CollaboratorAccessEvent, '_id' | 'equals' | 'equalsById' | 'toObject'>,
    ): CollaboratorAccessEvent {
        return value as unknown as CollaboratorAccessEvent;
    }

    private static asCollaboratorInvitation(
        value: Omit<CollaboratorInvitation, '_id' | 'equals' | 'equalsById' | 'toObject'>,
    ): CollaboratorInvitation {
        return value as unknown as CollaboratorInvitation;
    }

    private static asBlob(value: Omit<Blob, '_id' | 'equals' | 'equalsById' | 'toObject'>): Blob {
        return value as unknown as Blob;
    }

    private static asCommit(value: Omit<Commit, '_id' | 'equals' | 'equalsById' | 'toObject'>): Commit {
        return value as unknown as Commit;
    }

    private static asCommitComment(value: Omit<CommitComment, '_id' | 'equals' | 'equalsById' | 'toObject'>): CommitComment {
        return value as unknown as CommitComment;
    }

    private static asPullRequest(value: Omit<PullRequest, '_id' | 'equals' | 'equalsById' | 'toObject'>): PullRequest {
        return value as unknown as PullRequest;
    }

    private static asPullRequestComment(value: Omit<PullRequestComment, '_id' | 'equals' | 'equalsById' | 'toObject'>): PullRequestComment {
        return value as unknown as PullRequestComment;
    }

    private static asPullRequestReview(value: Omit<PullRequestReview, '_id' | 'equals' | 'equalsById' | 'toObject'>): PullRequestReview {
        return value as unknown as PullRequestReview;
    }

    private static asIssue(value: Omit<Issue, '_id' | 'equals' | 'equalsById' | 'toObject'>): Issue {
        return value as unknown as Issue;
    }

    private static asIssueComment(value: Omit<IssueComment, '_id' | 'equals' | 'equalsById' | 'toObject'>): IssueComment {
        return value as unknown as IssueComment;
    }

    private static asPipeline(value: Omit<Pipeline, '_id' | 'equals' | 'equalsById' | 'toObject'>): Pipeline {
        return value as unknown as Pipeline;
    }

    private static asPipelineRun(value: Omit<PipelineRun, '_id' | 'equals' | 'equalsById' | 'toObject'>): PipelineRun {
        return value as unknown as PipelineRun;
    }

    private static asPipelineJob(value: Omit<PipelineJob, '_id' | 'equals' | 'equalsById' | 'toObject'>): PipelineJob {
        return value as unknown as PipelineJob;
    }

    private static asPipelineStep(value: Omit<PipelineStep, '_id' | 'equals' | 'equalsById' | 'toObject'>): PipelineStep {
        return value as unknown as PipelineStep;
    }

    private static asPipelineArtifact(value: Omit<PipelineArtifact, '_id' | 'equals' | 'equalsById' | 'toObject'>): PipelineArtifact {
        return value as unknown as PipelineArtifact;
    }
}
