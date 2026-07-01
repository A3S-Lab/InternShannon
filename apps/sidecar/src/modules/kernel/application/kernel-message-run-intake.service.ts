import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import type { Session } from '../domain/entities/session.entity';
import type { IKernelMessageRunService, KernelMessageRunInput } from '../domain/services/kernel-message-run.service.interface';
import { type IKernelService, KERNEL_SERVICE } from '../domain/services/kernel-service.interface';
import { describeLockedRunViolation, isLockedAgent, LOCKED_AGENT_POLICY } from './agents/locked-agent.policy';
import { KernelConversationLogService } from './kernel-conversation-log.service';
import { KernelMessageFileContextService } from './kernel-message-file-context.service';
import { KernelMessageRunnerService } from './kernel-message-runner.service';
import { KernelSessionRuntimeAccessService } from './kernel-session-runtime-access.service';
import { KernelSessionRuntimeStateService } from './kernel-session-runtime-state.service';
import type { ActiveSession } from './session-runtime.types';
import type { ToolConfirmationGate } from './tool-confirmation-gate';

export interface KernelMessageRunIntakeInput extends KernelMessageRunInput {
    confirmation?: ToolConfirmationGate | null;
}

@Injectable()
export class KernelMessageRunIntakeService implements IKernelMessageRunService {
    private readonly logger = new Logger(KernelMessageRunIntakeService.name);

    constructor(
        private readonly conversationLog: KernelConversationLogService,
        private readonly runtimeState: KernelSessionRuntimeStateService,
        private readonly runtimeAccess: KernelSessionRuntimeAccessService,
        private readonly messageRunner: KernelMessageRunnerService,
        private readonly fileContext: KernelMessageFileContextService,
        @Inject(KERNEL_SERVICE)
        private readonly kernelService: IKernelService,
    ) {}

    async run(input: KernelMessageRunIntakeInput): Promise<void> {
        const startedAt = Date.now();
        const { input: effectiveInput, session } = await this.enforceLockedAgentRunPolicy(input);
        this.logger.log(`User message for session ${input.sessionId}: ${input.content.substring(0, 100)}`);
        this.runtimeState.clearCancelled(input.sessionId);

        const userMessage = await this.conversationLog.recordUserMessage({
            sessionId: input.sessionId,
            content: input.content,
            images: input.images,
        });
        await this.maybeUpdateFirstUserMessageTitle(session, userMessage.id, input.content, input.emit);

        this.emitMainAgentActivity(input.emit, {
            id: `main:${userMessage.id}:intake`,
            runId: userMessage.id,
            status: 'queued',
            phase: 'intake',
            label: '接收用户请求',
            detail: '消息已写入会话日志，正在进入主智能体执行链路',
            elapsedMs: Date.now() - startedAt,
            source: 'Kernel Gateway',
        });

        this.emitMainAgentActivity(input.emit, {
            id: `main:${userMessage.id}:runtime_prepare`,
            runId: userMessage.id,
            status: 'running',
            phase: 'runtime_prepare',
            label: '准备运行时',
            detail: '加载会话、模型、权限、工具与 MCP 状态',
            elapsedMs: Date.now() - startedAt,
            source: 'Kernel Runtime',
        });

        const activeSession = await this.getActiveSession(effectiveInput);
        if (!activeSession) {
            this.emitMainAgentActivity(input.emit, {
                id: `main:${userMessage.id}:runtime_failed`,
                runId: userMessage.id,
                status: 'failed',
                phase: 'runtime_prepare',
                label: '运行时准备失败',
                detail: '主智能体无法访问当前会话运行时',
                elapsedMs: Date.now() - startedAt,
                source: 'Kernel Runtime',
            });
            return;
        }

        this.emitMainAgentActivity(input.emit, {
            id: `main:${userMessage.id}:dispatch`,
            runId: userMessage.id,
            status: 'running',
            phase: 'dispatch',
            label: '交给主智能体',
            detail: `使用 ${activeSession.runtimeKey || 'default'} runtime 执行本轮任务`,
            elapsedMs: Date.now() - startedAt,
            source: 'Kernel Runtime',
        });

        const includeVisionAttachments = this.runtimeState
            .runtimeConfigBuilder()
            .modelSupportsAttachments(activeSession.resolvedModel);
        const fileContextResult = await this.fileContext.appendMentionedFileContext({
            content: input.content,
            workspaceRoot: activeSession.storageWorkspace || activeSession.workspace,
            includeVisionAttachments,
        });
        if (fileContextResult.fileCount > 0) {
            this.logger.log(
                `Appended readable context for ${fileContextResult.fileCount} mentioned file(s) in session ${input.sessionId}`,
            );
        }
        if (fileContextResult.ocrFailure) {
            await this.replyWithOcrBackendUnavailable({
                sessionId: input.sessionId,
                model: effectiveInput.model || activeSession.resolvedModel,
                emit: input.emit,
                startedAt,
                filePath: fileContextResult.ocrFailure.filePath,
                reason: fileContextResult.ocrFailure.message,
            });
            return;
        }
        const images = [
            ...(input.images ?? []),
            ...fileContextResult.images,
        ];

        await this.messageRunner.runUserMessage({
            sessionId: input.sessionId,
            content: fileContextResult.content,
            images: images.length > 0 ? images : undefined,
            model: effectiveInput.model,
            activeSession,
            messageId: userMessage.id,
            confirmation: input.confirmation,
            emit: input.emit,
            onCleanup: () => input.confirmation?.clearTaskApprovals?.(input.sessionId),
        });
    }

    private async replyWithOcrBackendUnavailable(input: {
        sessionId: string;
        model?: string;
        emit: (message: unknown) => void;
        startedAt: number;
        filePath: string;
        reason: string;
    }): Promise<void> {
        const content = [
            `配置的 OCR 后端当前不可用，未继续让模型自行调用本地 OCR 命令。`,
            '',
            `文件：${input.filePath}`,
            `失败原因：${input.reason}`,
            '',
            '请先确认「设置 > OCR 服务」中的后端服务可访问，或明确回复允许我使用本机命令行方案（例如安装/调用 Tesseract、pdftoppm）后再继续。',
        ].join('\n');
        const timestamp = Date.now();
        const messageId = `msg-${timestamp}-${Math.random().toString(36).slice(2, 8)}`;
        const contentBlocks = [{ type: 'text' as const, text: content }];

        input.emit({
            type: 'assistant',
            parentToolUseId: null,
            message: {
                id: messageId,
                role: 'assistant',
                model: input.model || '',
                content: contentBlocks,
                stopReason: 'ocr_backend_unavailable',
                durationMs: Date.now() - input.startedAt,
                meta: {
                    source: 'kernel:ocr_backend_unavailable',
                    filePath: input.filePath,
                    reason: input.reason,
                },
                usage: null,
            },
            timestamp,
        });
        await this.conversationLog.recordAssistantMessage({
            id: messageId,
            sessionId: input.sessionId,
            content,
            contentBlocks,
            source: 'kernel:ocr_backend_unavailable',
        });
        input.emit({
            type: 'result',
            data: {
                is_error: true,
                status: 'failed',
                stopReason: 'ocr_backend_unavailable',
                retryable: true,
                message: 'OCR 后端不可用',
                durationMs: Date.now() - input.startedAt,
                totalTokens: undefined,
                toolCalls: 0,
                activeToolCount: 0,
                openPlanTasks: 0,
            },
        });
        input.emit({ type: 'status_change', status: null });
        input.emit({ type: 'cli_connected' });
    }

    private async getActiveSession(input: KernelMessageRunIntakeInput): Promise<ActiveSession | null> {
        try {
            this.logger.log(`Getting active session for ${input.sessionId}`);
            const activeSession = await this.runtimeAccess.getOrCreate({
                sessionId: input.sessionId,
                overrides: {
                    model: input.model,
                },
                emit: input.emit,
            });

            if (!activeSession) {
                this.logger.warn(`Active session is null for ${input.sessionId}`);
                if (this.runtimeState.isCancelled(input.sessionId)) {
                    this.finishCancelledSession(input.sessionId, input.emit, false);
                    return null;
                }
                input.emit({
                    type: 'error',
                    message: 'Failed to create or access session',
                });
                return null;
            }

            this.logger.log(`Active session ready for ${input.sessionId}, agentId=${activeSession.agentId}`);
            return activeSession;
        } catch (error) {
            this.logger.error(`Failed to create or access session ${input.sessionId}: ${error}`);
            input.emit({
                type: 'error',
                message: error instanceof Error ? error.message : String(error),
            });
            input.emit({
                type: 'status_change',
                status: null,
            });
            return null;
        }
    }

    private async enforceLockedAgentRunPolicy(
        input: KernelMessageRunIntakeInput,
    ): Promise<{ input: KernelMessageRunIntakeInput; session: Session | null }> {
        const session = await this.kernelService.getSession(input.sessionId);
        if (!isLockedAgent(session?.agentId)) return { input, session };

        const violation = describeLockedRunViolation({ model: input.model });
        if (violation) {
            throw new BadRequestException(violation);
        }

        this.runtimeState.patchRuntimeOverrides(input.sessionId, {
            model: '',
            permissionMode: LOCKED_AGENT_POLICY.permissionMode,
            planningMode: LOCKED_AGENT_POLICY.planningMode,
            goalTracking: LOCKED_AGENT_POLICY.goalTracking,
        });

        return {
            session,
            input: {
                ...input,
                model: undefined,
            },
        };
    }

    private async maybeUpdateFirstUserMessageTitle(
        session: Session | null,
        userMessageId: string,
        content: string,
        emit: (message: unknown) => void,
    ): Promise<void> {
        if (!session || !isLockedAgent(session.agentId) || !this.canAutoTitleSession(session)) return;

        const title = this.titleFromFirstUserMessage(content);
        if (!title) return;

        try {
            const updated = await this.kernelService.updateSession(session.id, {
                title,
                titleSource: 'first_user_message',
                titleSeedMessageId: userMessageId,
            });
            if (!updated) return;
            emit({ type: 'session_name_update', name: updated.title || title });
        } catch (error) {
            this.logger.warn(
                `Failed to update first-message title for session ${session.id}: ${
                    error instanceof Error ? error.message : String(error)
                }`,
            );
        }
    }

    private canAutoTitleSession(session: Session): boolean {
        const titleSource = session.metadata?.titleSource;
        if (titleSource === 'first_user_message' || titleSource === 'manual') return false;
        if (typeof titleSource === 'string' && titleSource.trim() && titleSource !== 'temporary') return false;
        return titleSource === 'temporary' || this.isFallbackSessionTitle(session.id, session.title);
    }

    private titleFromFirstUserMessage(content: string): string | null {
        const normalized = content
            .replace(/```[\s\S]*?```/g, ' ')
            .replace(/\s+/g, ' ')
            .trim()
            .replace(/^#+\s*/, '')
            .replace(/^[-*]\s+/, '')
            .trim();
        if (!normalized || normalized.startsWith('/')) return null;

        const lowSignalMessages = new Set([
            '你好',
            '您好',
            'hi',
            'hello',
            'hey',
            'ok',
            '好的',
            '继续',
            '继续优化',
            '在吗',
        ]);
        if (lowSignalMessages.has(normalized.toLowerCase())) return null;
        if (!/[A-Za-z0-9\u4e00-\u9fff]/.test(normalized)) return null;

        const maxTitleLength = 40;
        const chars = Array.from(normalized);
        if (chars.length <= maxTitleLength) return normalized;
        return `${chars
            .slice(0, maxTitleLength - 3)
            .join('')
            .trimEnd()}...`;
    }

    private isFallbackSessionTitle(sessionId: string, title: string): boolean {
        return title.trim() === `会话 ${this.sessionShortId(sessionId)}`;
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

    private finishCancelledSession(sessionId: string, emit: (message: unknown) => void, cancelled: boolean): void {
        this.runtimeState.clearCancelled(sessionId);
        emit({ type: 'status_change', status: null });
        emit({ type: 'cancelled', cancelled });
        emit({ type: 'cli_connected' });
    }

    private emitMainAgentActivity(
        emit: (message: unknown) => void,
        activity: {
            id: string;
            runId: string;
            status: 'queued' | 'running' | 'failed';
            phase: string;
            label: string;
            detail?: string;
            elapsedMs?: number;
            source?: string;
        },
    ): void {
        emit({
            type: 'stream_event',
            event: {
                type: 'main_agent_activity',
                timestamp: Date.now(),
                activeToolCount: 0,
                ...activity,
            },
        });
    }
}
