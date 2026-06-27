import { Injectable, Logger } from '@nestjs/common';
import { AgentRegistry } from './agents/agent-registry';
import type { WorkspaceUploadMetadata } from '../domain/services/agent-spec.interface';

@Injectable()
export class AgentLifecycleMediator {
    private readonly logger = new Logger(AgentLifecycleMediator.name);

    constructor(private readonly agentRegistry: AgentRegistry) {}

    async dispatchFileAttached(input: {
        sessionId: string;
        agentId: string;
        userId: string;
        upload: WorkspaceUploadMetadata;
    }): Promise<void> {
        const spec = this.agentRegistry.resolve(input.agentId);
        if (!spec?.onFileAttached) return;

        try {
            await spec.onFileAttached({
                sessionId: input.sessionId,
                userId: input.userId,
                agentId: input.agentId,
                upload: input.upload,
            });
        } catch (err) {
            this.logger.warn(
                `Agent ${input.agentId} onFileAttached failed for session ${input.sessionId}: ${err}`,
            );
        }
    }

    dispatchSessionEnd(sessionId: string, agentId: string): void {
        const spec = this.agentRegistry.resolve(agentId);
        spec?.onSessionEnd?.({ sessionId });
    }
}
