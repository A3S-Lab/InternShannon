import type { AgentEvent, Session } from '@a3s-lab/code';
import { Injectable, Logger, Optional } from '@nestjs/common';
import { MetricsService } from '@/shared/observability/metrics';
import { isLockedAgent } from './agents/locked-agent.policy';
import { KernelSessionRuntimeStateService } from './kernel-session-runtime-state.service';
import { extractToolInputForConfirmation } from './kernel-tool-confirmation.helpers';
import type { ToolConfirmationGate } from './tool-confirmation-gate';

export interface KernelConfirmationRequiredInput {
    sessionId: string;
    agentId?: string;
    session: Session;
    event: AgentEvent;
    confirmation?: ToolConfirmationGate | null;
    fallbackToolId?: string;
    fallbackToolName?: string;
    fallbackToolInput?: Record<string, unknown>;
    emit: (message: unknown) => void;
}

@Injectable()
export class KernelToolConfirmationService {
    private readonly logger = new Logger(KernelToolConfirmationService.name);

    constructor(
        private readonly runtimeState: KernelSessionRuntimeStateService,
        @Optional() private readonly metrics?: MetricsService,
    ) {}

    async handleConfirmationRequired(input: KernelConfirmationRequiredInput): Promise<boolean> {
        const { sessionId, agentId, session, event, confirmation, emit } = input;

        let data: Record<string, unknown> = {};
        try {
            data = event.data ? JSON.parse(event.data) : {};
        } catch {
            this.logger.warn(`Failed to parse confirmation event data for session ${sessionId}`);
        }

        const toolId =
            pickNonEmptyString(data, 'toolId', 'tool_id', 'toolUseId', 'tool_use_id', 'id') ||
            nonEmptyString(event.toolId) ||
            nonEmptyString(input.fallbackToolId) ||
            '';
        const toolName =
            pickNonEmptyString(data, 'toolName', 'tool_name', 'name', 'tool') ||
            nonEmptyString(event.toolName) ||
            nonEmptyString(input.fallbackToolName) ||
            '';
        const extractedToolInput = extractToolInputForConfirmation(data, data);
        const toolInput =
            Object.keys(extractedToolInput).length > 0 ? extractedToolInput : (input.fallbackToolInput ?? {});

        if (!toolId) {
            this.logger.warn(`confirmation_required event missing toolId for session ${sessionId}`);
            return false;
        }

        if (this.runtimeState.isCancelled(sessionId)) {
            await session.confirmToolUse(toolId, false, 'user_cancelled');
            return false;
        }

        if (isLockedAgent(agentId)) {
            this.logger.log(
                `Auto-approving tool ${toolName || toolId} for locked agent ${agentId} in session ${sessionId}`,
            );
            emit({
                type: 'stream_event',
                event: {
                    type: 'tool_confirmation_auto_approved',
                    agentId,
                    toolId,
                    toolName,
                    toolInput,
                    reason: 'locked_agent_auto_confirm',
                    timestamp: Date.now(),
                },
            });
            await session.confirmToolUse(toolId, true);
            return true;
        }

        if (!confirmation) {
            this.logger.warn(
                `[kernel.tool.confirmation_missing] sessionId=${sessionId} toolName=${toolName || 'n/a'} toolId=${toolId} agentId=${agentId ?? 'n/a'} reason=no_confirmation_manager`,
            );
            this.metrics?.incCounter('kernel_tool_confirmation_missing_total', {
                tool: toolName || 'unknown',
                agent: agentId ?? 'unknown',
            });
            await session.confirmToolUse(toolId, false, 'no_confirmation_manager');
            return false;
        }

        emit({
            type: 'stream_event',
            event: {
                type: 'tool_confirmation_pending',
                toolId,
                toolName,
                toolInput,
            },
        });

        try {
            const approved = await confirmation.requestConfirmation(sessionId, toolName, toolInput);

            if (this.runtimeState.isCancelled(sessionId)) {
                await session.confirmToolUse(toolId, false, 'user_cancelled');
                return false;
            }

            await session.confirmToolUse(toolId, approved);
            return approved;
        } catch (error) {
            this.logger.warn(`HITL confirmation failed for ${toolName} in ${sessionId}: ${error}`);
            await session.confirmToolUse(toolId, false, 'confirmation_timeout');
            return false;
        }
    }
}

function pickNonEmptyString(data: Record<string, unknown>, ...keys: string[]): string | undefined {
    for (const key of keys) {
        const value = nonEmptyString(data[key]);
        if (value) return value;
    }
    return undefined;
}

function nonEmptyString(value: unknown): string | undefined {
    return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}
