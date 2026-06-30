import type { AgentEvent, PendingConfirmation, Session } from '@a3s-lab/code';
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

        let toolId =
            pickNonEmptyString(data, 'toolId', 'tool_id', 'toolUseId', 'tool_use_id', 'id') ||
            nonEmptyString(event.toolId) ||
            nonEmptyString(input.fallbackToolId) ||
            '';
        let toolName =
            pickNonEmptyString(data, 'toolName', 'tool_name', 'name', 'tool') ||
            nonEmptyString(event.toolName) ||
            nonEmptyString(input.fallbackToolName) ||
            '';
        const extractedToolInput = extractToolInputForConfirmation(data, data);
        let toolInput =
            Object.keys(extractedToolInput).length > 0 ? extractedToolInput : (input.fallbackToolInput ?? {});

        const pendingConfirmation = await this.resolvePendingConfirmation(session, {
            sessionId,
            toolId,
            toolName,
            toolInput,
        });
        if (pendingConfirmation) {
            if (pendingConfirmation.toolId !== toolId) {
                this.logger.log(
                    `[kernel.tool.confirmation_resolved] sessionId=${sessionId} providedToolId=${toolId || 'n/a'} pendingToolId=${pendingConfirmation.toolId} toolName=${pendingConfirmation.toolName || toolName || 'n/a'}`,
                );
            }
            toolId = pendingConfirmation.toolId;
            toolName = toolName || pendingConfirmation.toolName;
            const pendingInput = recordValue(pendingConfirmation.args);
            if (Object.keys(toolInput).length === 0 && pendingInput) {
                toolInput = pendingInput;
            }
        }

        if (!toolId) {
            this.logger.warn(`confirmation_required event missing toolId for session ${sessionId}`);
            return false;
        }

        if (this.runtimeState.isCancelled(sessionId)) {
            await this.confirmToolUse(session, {
                sessionId,
                toolId,
                toolName,
                toolInput,
                approved: false,
                reason: 'user_cancelled',
            });
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
            return this.confirmToolUse(session, {
                sessionId,
                toolId,
                toolName,
                toolInput,
                approved: true,
            });
        }

        if (!confirmation) {
            this.logger.warn(
                `[kernel.tool.confirmation_missing] sessionId=${sessionId} toolName=${toolName || 'n/a'} toolId=${toolId} agentId=${agentId ?? 'n/a'} reason=no_confirmation_manager`,
            );
            this.metrics?.incCounter('kernel_tool_confirmation_missing_total', {
                tool: toolName || 'unknown',
                agent: agentId ?? 'unknown',
            });
            await this.confirmToolUse(session, {
                sessionId,
                toolId,
                toolName,
                toolInput,
                approved: false,
                reason: 'no_confirmation_manager',
            });
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
                await this.confirmToolUse(session, {
                    sessionId,
                    toolId,
                    toolName,
                    toolInput,
                    approved: false,
                    reason: 'user_cancelled',
                });
                return false;
            }

            const confirmed = await this.confirmToolUse(session, {
                sessionId,
                toolId,
                toolName,
                toolInput,
                approved,
            });
            return approved && confirmed;
        } catch (error) {
            this.logger.warn(`HITL confirmation failed for ${toolName} in ${sessionId}: ${error}`);
            await this.confirmToolUse(session, {
                sessionId,
                toolId,
                toolName,
                toolInput,
                approved: false,
                reason: 'confirmation_timeout',
            });
            return false;
        }
    }

    private async confirmToolUse(
        session: Session,
        input: {
            sessionId: string;
            toolId: string;
            toolName: string;
            toolInput: Record<string, unknown>;
            approved: boolean;
            reason?: string;
        },
    ): Promise<boolean> {
        const result = await session.confirmToolUse(input.toolId, input.approved, input.reason);
        if (result !== false) return true;

        const pendingConfirmation = await this.resolvePendingConfirmation(session, input);
        if (pendingConfirmation && pendingConfirmation.toolId !== input.toolId) {
            this.logger.warn(
                `[kernel.tool.confirmation_retry] sessionId=${input.sessionId} toolName=${input.toolName || pendingConfirmation.toolName || 'n/a'} staleToolId=${input.toolId} pendingToolId=${pendingConfirmation.toolId}`,
            );
            const retryResult = await session.confirmToolUse(
                pendingConfirmation.toolId,
                input.approved,
                input.reason,
            );
            if (retryResult !== false) return true;
        }

        this.logger.warn(
            `[kernel.tool.confirmation_not_found] sessionId=${input.sessionId} toolName=${input.toolName || 'n/a'} toolId=${input.toolId} approved=${input.approved}`,
        );
        return false;
    }

    private async resolvePendingConfirmation(
        session: Session,
        input: {
            sessionId: string;
            toolId: string;
            toolName: string;
            toolInput: Record<string, unknown>;
        },
    ): Promise<PendingConfirmation | null> {
        const pendingConfirmations = await this.pendingConfirmations(session, input.sessionId);
        if (pendingConfirmations.length === 0) return null;

        if (input.toolId) {
            const exact = pendingConfirmations.find(item => item.toolId === input.toolId);
            if (exact) return exact;
        }

        const hasToolInput = Object.keys(input.toolInput).length > 0;
        const sameArgs = (item: PendingConfirmation) => hasToolInput && sameJson(item.args, input.toolInput);
        const sameName = (item: PendingConfirmation) =>
            Boolean(input.toolName) && item.toolName.trim() === input.toolName.trim();

        const byNameAndArgs = pendingConfirmations.find(item => sameName(item) && sameArgs(item));
        if (byNameAndArgs) return byNameAndArgs;

        const byArgs = pendingConfirmations.find(sameArgs);
        if (byArgs) return byArgs;

        const byName = pendingConfirmations.filter(sameName);
        if (byName.length === 1) return byName[0];

        if (pendingConfirmations.length === 1) return pendingConfirmations[0];
        return null;
    }

    private async pendingConfirmations(session: Session, sessionId: string): Promise<PendingConfirmation[]> {
        const pendingConfirmations = (session as unknown as {
            pendingConfirmations?: () => Promise<unknown>;
        }).pendingConfirmations;
        if (typeof pendingConfirmations !== 'function') return [];
        try {
            const result = await pendingConfirmations.call(session);
            if (!Array.isArray(result)) return [];
            return result.filter(isPendingConfirmation);
        } catch (error) {
            this.logger.warn(
                `Failed to read pending confirmations for session ${sessionId}: ${
                    error instanceof Error ? error.message : String(error)
                }`,
            );
            return [];
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

function recordValue(value: unknown): Record<string, unknown> | undefined {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : undefined;
}

function isPendingConfirmation(value: unknown): value is PendingConfirmation {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const record = value as Record<string, unknown>;
    return typeof record.toolId === 'string' && record.toolId.trim() !== '';
}

function sameJson(left: unknown, right: unknown): boolean {
    return stableJson(left) === stableJson(right);
}

function stableJson(value: unknown): string {
    try {
        return JSON.stringify(sortJsonValue(value));
    } catch {
        return '';
    }
}

function sortJsonValue(value: unknown, depth = 0): unknown {
    if (depth > 8 || value === null || typeof value !== 'object') return value;
    if (Array.isArray(value)) return value.map(item => sortJsonValue(item, depth + 1));
    const record = value as Record<string, unknown>;
    return Object.keys(record)
        .sort()
        .reduce<Record<string, unknown>>((result, key) => {
            result[key] = sortJsonValue(record[key], depth + 1);
            return result;
        }, {});
}
