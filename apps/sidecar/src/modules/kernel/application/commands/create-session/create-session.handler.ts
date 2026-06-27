import { BadRequestException, Inject, Logger } from '@nestjs/common';
import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { Session } from '../../../domain/entities/session.entity';
import { IKernelService, KERNEL_SERVICE } from '../../../domain/services/kernel-service.interface';
import { AgentRegistry } from '../../agents';
import {
    applyLockedAgentMetadata,
    describeLockedSessionViolation,
    isLockedAgent,
} from '../../agents/locked-agent.policy';
import { CreateSessionCommand } from './create-session.command';

@CommandHandler(CreateSessionCommand)
export class CreateSessionHandler implements ICommandHandler<CreateSessionCommand> {
    private readonly logger = new Logger(CreateSessionHandler.name);
    private readonly pendingIdempotentCreations = new Map<string, Promise<Session>>();

    constructor(
        @Inject(KERNEL_SERVICE) private readonly kernelService: IKernelService,
        private readonly agentRegistry: AgentRegistry,
    ) {}

    async execute(command: CreateSessionCommand) {
        const agentId = command.agentId?.trim() || 'default';
        const locked = isLockedAgent(agentId);
        const baseOptions = command.options ?? {};
        if (locked) {
            const violation = describeLockedSessionViolation(baseOptions);
            if (violation) throw new BadRequestException(violation);
        }
        const options = locked ? applyLockedAgentMetadata(baseOptions) : command.options;
        const idempotencyKey = this.creationIdempotencyKey(command.userId, agentId, options);
        if (idempotencyKey) {
            const pending = this.pendingIdempotentCreations.get(idempotencyKey);
            if (pending) return pending;

            const create = this.findExistingSessionForCreationRequest(command.userId, agentId, options).then(
                existing => existing ?? this.createSession(command, agentId, options),
            );
            this.pendingIdempotentCreations.set(idempotencyKey, create);
            try {
                return await create;
            } finally {
                this.pendingIdempotentCreations.delete(idempotencyKey);
            }
        }

        return this.createSession(command, agentId, options);
    }

    private async createSession(
        command: CreateSessionCommand,
        agentId: string,
        options?: Record<string, unknown>,
    ): Promise<Session> {
        const result = await this.kernelService.createSessionWithStatus(
            agentId,
            command.userId,
            command.title,
            command.cwd,
            options,
        );
        const session = result.session;

        const agentSpec = this.agentRegistry.resolve(session.agentId ?? 'default');
        if (result.created && agentSpec?.onSessionCreate) {
            const extraMetadata = await agentSpec.onSessionCreate({
                sessionId: session.id,
                userId: command.userId,
                agentId: session.agentId ?? 'default',
                metadata: session.metadata,
            });
            if (extraMetadata) {
                Object.assign(session.metadata, extraMetadata);
                // Persist asynchronously — session object already has the merged metadata
                void this.kernelService.updateSession(session.id, extraMetadata).catch((error) => {
                    this.logger.warn(
                        `Failed to persist extra metadata for session ${session.id}: ${error instanceof Error ? error.message : error}`,
                    );
                });
            }
        }

        return session;
    }

    private creationIdempotencyKey(
        userId: string,
        agentId: string,
        options?: Record<string, unknown>,
    ): string | undefined {
        const creationRequestId = this.creationRequestId(options);
        return creationRequestId ? [userId, agentId, creationRequestId].join('::') : undefined;
    }

    private creationRequestId(options?: Record<string, unknown>): string | undefined {
        const value = options?.creationRequestId;
        return typeof value === 'string' && value.trim() ? value.trim() : undefined;
    }

    private async findExistingSessionForCreationRequest(
        userId: string,
        agentId: string,
        options?: Record<string, unknown>,
    ): Promise<Session | null> {
        const creationRequestId = this.creationRequestId(options);
        if (!creationRequestId) return null;

        return this.kernelService.findSessionByCreationRequest(userId, agentId, creationRequestId);
    }
}
