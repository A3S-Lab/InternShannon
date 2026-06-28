import { Injectable, Inject } from '@nestjs/common';
import { Message } from '@/modules/kernel/domain/entities/message.entity';
import { Session } from '@/modules/kernel/domain/entities/session.entity';
import {
    ISessionRepository,
    NON_CONVERSATIONAL_AGENT_IDS,
    SESSION_REPOSITORY,
} from '@/modules/kernel/domain/repositories/session.repository.interface';
import {
    MESSAGE_REPOSITORY,
    IMessageRepository,
} from '@/modules/kernel/domain/repositories/message.repository.interface';
import { IKernelService, KERNEL_SERVICE } from '@/modules/kernel/domain/services/kernel-service.interface';
import { ApiModule, ApiOperation } from '@/modules/kernel/domain/services/api-explorer.interface';

@Injectable()
export class DesktopKernelService implements IKernelService {
    constructor(
        @Inject(SESSION_REPOSITORY) private readonly sessionRepo: ISessionRepository,
        @Inject(MESSAGE_REPOSITORY) private readonly messageRepo: IMessageRepository,
    ) {}

    async createSession(
        agentId: string | undefined,
        userId: string,
        title?: string,
        cwd?: string,
        options: Record<string, unknown> = {},
    ): Promise<Session> {
        const result = await this.createSessionWithStatus(agentId, userId, title, cwd, options);
        return result.session;
    }

    async createSessionWithStatus(
        agentId: string | undefined,
        userId: string,
        title?: string,
        cwd?: string,
        options: Record<string, unknown> = {},
    ): Promise<{ session: Session; created: boolean }> {
        const resolvedUserId = userId || 'desktop-user';
        const creationRequestId = this.creationRequestId(options);
        if (creationRequestId) {
            const existing = await this.findSessionByCreationRequest(resolvedUserId, agentId, creationRequestId);
            if (existing) return { session: existing, created: false };
        }

        const id = `session-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
        const now = new Date();
        const session = new Session(
            id,
            agentId,
            resolvedUserId,
            this.resolveSessionTitle(id, title),
            cwd || '',
            'active',
            now,
            now,
            options,
        );
        await this.sessionRepo.save(session);
        return { session, created: true };
    }

    async endSession(sessionId: string): Promise<void> {
        await this.sessionRepo.delete(sessionId);
    }

    async updateSession(sessionId: string, patch: Record<string, unknown>): Promise<Session | null> {
        const session = await this.sessionRepo.findById(sessionId);
        if (!session) return null;
        const metadata = {
            ...session.metadata,
            ...this.pickSessionMetadata(patch),
        };
        const updated = new Session(
            session.id,
            session.agentId,
            session.userId,
            this.stringPatch(patch, 'title') || this.stringPatch(patch, 'name') || session.title,
            this.stringPatch(patch, 'cwd') || session.cwd,
            session.status,
            session.createdAt,
            new Date(),
            metadata,
        );
        await this.sessionRepo.save(updated);
        return updated;
    }

    async getSession(sessionId: string): Promise<Session | null> {
        return this.sessionRepo.findById(sessionId);
    }

    async findSessionByCreationRequest(
        userId: string,
        agentId: string | undefined,
        creationRequestId: string,
    ): Promise<Session | null> {
        const resolvedRequestId = this.creationRequestId({ creationRequestId });
        if (!resolvedRequestId) return null;
        return this.sessionRepo.findByCreationRequest(userId || 'desktop-user', agentId, resolvedRequestId);
    }

    async getUserSessions(
        userId: string,
        limit?: number,
        offset?: number,
        includeAllUsers?: boolean,
        conversationalOnly?: boolean,
    ): Promise<Session[]> {
        const resolvedUserId = userId || 'desktop-user';
        if (includeAllUsers) {
            if (limit !== undefined) {
                return this.sessionRepo.findAllPaginated(limit, offset ?? 0, conversationalOnly);
            }
            const sessions = await this.sessionRepo.findAll();
            const scoped = conversationalOnly
                ? sessions.filter(session => this.isConversationalSession(session))
                : sessions;
            return offset ? scoped.slice(offset) : scoped;
        }

        if (limit !== undefined && offset !== undefined) {
            return this.sessionRepo.findByUserIdPaginated(resolvedUserId, limit, offset, conversationalOnly);
        }

        const sessions = await this.sessionRepo.findByUserId(resolvedUserId);
        const scoped = conversationalOnly
            ? sessions.filter(session => this.isConversationalSession(session))
            : sessions;
        const offsetVal = offset ?? 0;
        const limitVal = limit ?? scoped.length;
        return scoped.slice(offsetVal, offsetVal + limitVal);
    }

    async countUserSessions(userId: string, includeAllUsers?: boolean, conversationalOnly?: boolean): Promise<number> {
        // Mirror the cloud KernelService: delegate to the same ISessionRepository
        // count methods (which apply the conversationalOnly filter). includeAllUsers
        // is honored for interface parity even though desktop is single-user.
        if (includeAllUsers) {
            return this.sessionRepo.countAll(conversationalOnly);
        }
        return this.sessionRepo.countByUserId(userId || 'desktop-user', conversationalOnly);
    }

    async getSessionMessages(sessionId: string, limit?: number, offset?: number): Promise<Message[]> {
        const messages = await this.messageRepo.findBySessionId(sessionId);
        return messages.slice(offset ?? 0, (offset ?? 0) + (limit ?? messages.length));
    }

    async getLatestSessionMessageByRole(sessionId: string, role: Message['role']): Promise<Message | null> {
        return this.messageRepo.findLatestBySessionIdAndRole(sessionId, role);
    }

    // API Discovery - not available in desktop mode
    async listModules(_userId: string): Promise<ApiModule[]> {
        return [];
    }

    async getModule(_moduleName: string, _userId: string): Promise<ApiModule | null> {
        return null;
    }

    async searchOperations(_query: string, _userId: string): Promise<ApiOperation[]> {
        return [];
    }

    async executeOperation(
        _moduleName: string,
        _operationName: string,
        _params: Record<string, unknown>,
        _userId: string,
    ): Promise<unknown> {
        throw new Error('API operation execution is not available in desktop mode');
    }

    private pickSessionMetadata(patch: Record<string, unknown>): Record<string, unknown> {
        const metadataPatch =
            patch.metadata && typeof patch.metadata === 'object' && !Array.isArray(patch.metadata)
                ? (patch.metadata as Record<string, unknown>)
                : {};
        const source = { ...metadataPatch, ...patch };
        const allowed = [
            'model',
            'followDefaultModel',
            'permissionMode',
            'systemPrompt',
            'skills',
            'skillDirs',
            'mcpServers',
            'builtinSkills',
            'planningMode',
            'goalTracking',
            'maxToolRounds',
            'continuationEnabled',
            'maxContinuationTurns',
            'autoCompact',
            'autoCompactThreshold',
            'temperature',
            'thinkingBudget',
            'toolTimeoutMs',
            'queueTimeoutMs',
            'maxExecutionTimeMs',
            'streamStallWarningMs',
            'streamStallHardMs',
            'streamStallActiveToolHardMs',
            'maxConsecutiveToolErrors',
            'maxStreamRetries',
            'autoDelegation',
            'autoParallel',
            'maxParallelTasks',
            'artifactStoreLimits',
            'searchConfig',
            'purpose',
            'visibility',
            'ownerType',
            'ownerId',
            'creationRequestId',
            'sourceCaseId',
            'assetId',
            'agentPhase',
            'assetName',
            'assetCategory',
            'assetVisibility',
            'developmentStage',
            'lockedAgentState',
            'singleAssetSession',
        ];
        return Object.fromEntries(allowed.filter(key => source[key] !== undefined).map(key => [key, source[key]]));
    }

    private stringPatch(patch: Record<string, unknown>, key: string): string | undefined {
        const value = patch[key];
        return typeof value === 'string' && value.trim() ? value.trim() : undefined;
    }

    private creationRequestId(options?: Record<string, unknown>): string | undefined {
        const value = options?.creationRequestId;
        return typeof value === 'string' && value.trim() ? value.trim() : undefined;
    }

    private resolveSessionTitle(sessionId: string, title?: string): string {
        return title?.trim() || `会话 ${this.sessionShortId(sessionId)}`;
    }

    private sessionShortId(sessionId: string): string {
        const uuidPrefix = sessionId.match(/^[0-9a-f]{8}/i)?.[0];
        if (uuidPrefix) return uuidPrefix;
        const parts = sessionId.split(/[^a-zA-Z0-9]+/).filter(Boolean);
        const lastPart = parts[parts.length - 1];
        if (lastPart && lastPart.toLowerCase() !== 'session') return lastPart.slice(0, 8);
        const normalized = sessionId.replace(/[^a-zA-Z0-9]/g, '');
        return (normalized || sessionId).slice(0, 8);
    }

    private isConversationalSession(session: Session): boolean {
        return !session.agentId || !(NON_CONVERSATIONAL_AGENT_IDS as readonly string[]).includes(session.agentId);
    }
}

export const DesktopKernelServiceProvider = {
    provide: KERNEL_SERVICE,
    useClass: DesktopKernelService,
};
