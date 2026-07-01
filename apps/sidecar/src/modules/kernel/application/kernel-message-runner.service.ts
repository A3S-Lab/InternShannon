import type { AgentEvent, AttachmentObject } from '@a3s-lab/code';
import { Injectable, Logger, Optional } from '@nestjs/common';
interface ObservabilityService {
    recordUsageCost(input: {
        provider?: string;
        model?: string;
        inputTokens?: number;
        outputTokens?: number;
        totalTokens?: number;
        durationMs?: number;
        cost?: number;
        currency?: string;
        assetId?: string;
        workspaceId?: string;
        metadata?: Record<string, unknown>;
    }): Promise<unknown>;
}
import { MetricsService } from '@/shared/observability/metrics';
import { AgentRegistry } from './agents/agent-registry';
import { isLockedAgent } from './agents/locked-agent.policy';
import { extractAssistantTextFromHistory, mapAgentEvent } from './kernel-agent-event.mapper';
import { KernelConversationLogService, type KernelRuntimeHistoryMessage } from './kernel-conversation-log.service';
import type { KernelMessageRunLifecycleInput } from './kernel-lifecycle-feedback.service';
import { KernelLifecycleFeedbackService } from './kernel-lifecycle-feedback.service';
import { isPlanningProgressEvent, KernelPlanningProgressTracker } from './kernel-planning-progress-tracker';
import { KernelSessionRuntimeStateService } from './kernel-session-runtime-state.service';
import { isKnownEventType, normalizeStreamEvent, parseAgentEventData } from './kernel-stream-event-normalizer';
import { KernelStreamTextDedupe } from './kernel-stream-text-dedupe';
import { KernelToolConfirmationService } from './kernel-tool-confirmation.service';
import { KernelToolInputDeltaCoalescer } from './kernel-tool-input-delta-coalescer';
import { toUserMemoryRecordInput } from './user-memory-event.mapper';
import { UserMemoryService } from './user-memory.service';
import {
    type ActiveSession,
    type AssistantContentBlock,
    DEFAULT_MAX_CONSECUTIVE_TOOL_ERRORS,
    DEFAULT_MAX_STREAM_RETRIES,
    DEFAULT_STREAM_STALL_ACTIVE_TOOL_HARD_MS,
    DEFAULT_STREAM_STALL_HARD_MS,
    DEFAULT_STREAM_STALL_WARNING_MS,
    DEFAULT_TOOL_TIMEOUT_MS,
    type SessionRuntimeOverrides,
} from './session-runtime.types';
import type { ToolConfirmationGate } from './tool-confirmation-gate';

export interface KernelUserMessageInput {
    sessionId: string;
    content: string;
    images?: { mediaType: string; data: string }[];
    model?: string;
}

export interface KernelMessageRunInput extends KernelUserMessageInput {
    activeSession: ActiveSession;
    messageId?: string;
    confirmation?: ToolConfirmationGate | null;
    emit: (message: unknown) => void;
    onCleanup?: () => void;
}

interface ToolOutputLimitState {
    bytes: number;
    truncated: boolean;
}

interface EventStreamOptions {
    content?: string;
    images?: { mediaType: string; data: string }[];
    usePersistedHistory?: boolean;
}

type RunFinalStatus = 'succeeded' | 'incomplete' | 'failed' | 'cancelled';

type RunStopReason =
    | 'end_turn'
    | 'max_tokens'
    | 'context_limit'
    | 'max_execution_time'
    | 'max_tool_rounds'
    | 'continuation_exhausted'
    | 'event_stream_stalled'
    | 'tool_circuit_open'
    | 'empty_response'
    | 'user_cancelled'
    | 'sdk_stream_ended_without_stop_reason'
    | 'unknown';

interface RunVerdict {
    status: RunFinalStatus;
    stopReason: RunStopReason;
    retryable: boolean;
}

const MAX_CLIENT_TOOL_OUTPUT_BYTES = 64 * 1024;
const DEFAULT_MAX_TOOL_ROUND_AUTO_CONTINUATIONS = 1;
const TOOL_OUTPUT_TRUNCATION_NOTICE =
    '\n\n[Tool output truncated for display after 64 KB. Use a narrower path, query, or filter to inspect more.]';

const RETRYABLE_STOP_REASONS: ReadonlySet<RunStopReason> = new Set([
    'max_tokens',
    'context_limit',
    'max_tool_rounds',
    'sdk_stream_ended_without_stop_reason',
]);

function resolvePositiveMs(value: number | undefined, fallback: number): number {
    return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

function resolvePositiveInt(value: number | undefined, fallback: number): number {
    return typeof value === 'number' && Number.isFinite(value) && value >= 1 ? Math.floor(value) : fallback;
}

@Injectable()
export class KernelMessageRunnerService {
    private readonly logger = new Logger(KernelMessageRunnerService.name);

    constructor(
        private readonly conversationLog: KernelConversationLogService,
        private readonly runtimeState: KernelSessionRuntimeStateService,
        private readonly toolConfirmation: KernelToolConfirmationService,
        private readonly agentRegistry: AgentRegistry,
        @Optional()
        private readonly lifecycleFeedback?: KernelLifecycleFeedbackService,
        // Optional so existing unit tests that wire the runner by hand keep
        // working. In a real cloud bootstrap MetricsModule is @Global, so
        // this is always provided in production.
        @Optional()
        private readonly metrics?: MetricsService,
        // @Optional 保证 desktop 模式不强制依赖 cloud observability。
        @Optional()
        private readonly observability?: ObservabilityService,
        // @Optional: only bound in cloud mode (desktop has its own kernel sidecar). When absent the
        // memory tap is simply skipped — the live stream is unaffected either way.
        @Optional()
        private readonly userMemory?: UserMemoryService,
    ) {}

    /**
     * Persist a memory stream event into the per-user memory base, fire-and-forget. Tapping the stream is
     * additive + non-blocking + fail-silent: {@link UserMemoryService.record} never throws and never
     * returns an awaitable, and this whole helper is wrapped, so a persistence failure can never disturb
     * the browser-facing stream. No-op for non-memory events and when the service isn't bound (desktop).
     */
    private tapMemoryEvent(
        normalizedEvent: Record<string, unknown> | null,
        context: { userId: string; sessionId: string },
    ): void {
        if (!this.userMemory || !normalizedEvent) return;
        try {
            const input = toUserMemoryRecordInput(normalizedEvent, context);
            if (input) this.userMemory.record(input);
        } catch (error) {
            this.logger.warn(
                `[stream:${context.sessionId}] memory tap failed (swallowed): ${
                    error instanceof Error ? error.message : String(error)
                }`,
            );
        }
    }

    async runUserMessage(input: KernelMessageRunInput): Promise<void> {
        const { sessionId, activeSession, emit } = input;
        const messageId = input.messageId || `msg-run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const startedAt = Date.now();
        const activeToolIds = new Set<string>();
        const announcedToolIds = new Set<string>();
        const toolStartedAt = new Map<string, number>();
        const toolNameById = new Map<string, string>();
        const toolInputStartedAt = new Map<string, number>();
        const toolLastInputAt = new Map<string, number>();
        const toolInputDeltaCount = new Map<string, number>();
        const toolExecStartedAt = new Map<string, number>();
        const latestToolIdByName = new Map<string, string>();
        const toolInputById = new Map<string, unknown>();
        const lastToolUpdateAt = new Map<string, number>();
        const lastToolInputActivityAt = new Map<string, number>();
        const toolOutputLimitById = new Map<string, ToolOutputLimitState>();
        let outputStarted = false;
        let lifecycleClosed = false;
        const eventTypeTally = new Map<string, number>();
        const lifecycleInput = (
            extra: Partial<KernelMessageRunLifecycleInput> = {},
        ): KernelMessageRunLifecycleInput => ({
            sessionId,
            messageId,
            agentId: activeSession.agentId,
            model: input.model,
            contentLength: input.content.length,
            durationMs: Date.now() - startedAt,
            ...extra,
        });
        const closeLifecycle = (
            status: 'completed' | 'cancelled' | 'failed',
            extra: Partial<KernelMessageRunLifecycleInput> = {},
        ) => {
            if (lifecycleClosed) return;
            lifecycleClosed = true;
            if (status === 'completed') {
                this.lifecycleFeedback?.recordMessageRunCompleted(lifecycleInput(extra));
            } else if (status === 'cancelled') {
                this.lifecycleFeedback?.recordMessageRunCancelled(lifecycleInput(extra));
            } else {
                this.lifecycleFeedback?.recordMessageRunFailed(lifecycleInput(extra));
            }
        };

        this.lifecycleFeedback?.recordMessageRunStarted(
            lifecycleInput({
                durationMs: 0,
            }),
        );
        const emitMainActivity = (activity: {
            status: 'running' | 'waiting' | 'completed' | 'failed' | 'cancelled';
            phase: string;
            label: string;
            detail?: string;
            source?: string;
        }) => {
            this.emitMainAgentActivity(emit, {
                id: `main:${messageId}:${activity.phase}:${activity.status}`,
                runId: messageId,
                elapsedMs: Date.now() - startedAt,
                activeToolCount: activeToolIds.size,
                ...activity,
            });
        };
        const emitToolActivity = (activity: {
            status: 'running' | 'waiting' | 'completed' | 'failed';
            phase: string;
            toolUseId?: string;
            toolName?: string;
            label: string;
            detail?: string;
            elapsedMs?: number;
        }) => {
            this.emitToolActivity(emit, {
                id: `tool:${messageId}:${
                    activity.toolUseId || activity.toolName || activity.phase
                }:${activity.phase}:${activity.status}`,
                runId: messageId,
                ...activity,
            });
        };
        const findCurrentToolId = (preferredToolId?: string, preferredToolName?: string): string | undefined => {
            if (preferredToolId && activeToolIds.has(preferredToolId)) return preferredToolId;
            if (preferredToolName) {
                const byName = latestToolIdByName.get(preferredToolName);
                if (byName && activeToolIds.has(byName)) return byName;
            }
            if (activeToolIds.size === 1) return Array.from(activeToolIds)[0];
            const activeIds = Array.from(activeToolIds);
            return activeIds[activeIds.length - 1];
        };
        const markToolInputStreaming = (toolId: string, toolName?: string) => {
            const now = Date.now();
            if (!toolInputStartedAt.has(toolId)) {
                toolInputStartedAt.set(toolId, now);
            }
            toolLastInputAt.set(toolId, now);
            toolInputDeltaCount.set(toolId, (toolInputDeltaCount.get(toolId) ?? 0) + 1);
            const last = lastToolInputActivityAt.get(toolId) ?? 0;
            if (now - last > 1000) {
                lastToolInputActivityAt.set(toolId, now);
                emitMainActivity({
                    status: 'running',
                    phase: 'tool_input_streaming',
                    label: toolName ? `生成工具参数：${toolName}` : '生成工具参数',
                    detail: '模型正在流式生成工具参数，工具尚未开始执行',
                    source: '模型输出',
                });
                emitToolActivity({
                    status: 'running',
                    phase: 'input_streaming',
                    toolUseId: toolId,
                    toolName,
                    label: toolName ? `生成参数：${toolName}` : '生成参数',
                    detail: `${toolInputDeltaCount.get(toolId) ?? 0} 段参数流`,
                    elapsedMs: now - (toolInputStartedAt.get(toolId) ?? now),
                });
            }
        };
        const markToolExecutionStarted = (toolId: string) => {
            if (!toolExecStartedAt.has(toolId)) {
                toolExecStartedAt.set(toolId, toolLastInputAt.get(toolId) ?? toolStartedAt.get(toolId) ?? Date.now());
            }
        };
        const estimateToolExecutionDurationMs = (
            toolId: string,
            reportedDurationMs?: number,
        ): number | undefined => {
            if (typeof reportedDurationMs === 'number' && Number.isFinite(reportedDurationMs)) {
                return Math.max(0, reportedDurationMs);
            }
            const startedAt = toolExecStartedAt.get(toolId) ?? toolLastInputAt.get(toolId) ?? toolStartedAt.get(toolId);
            return startedAt === undefined ? undefined : Math.max(0, Date.now() - startedAt);
        };
        emitMainActivity({
            status: 'running',
            phase: 'model_request',
            label: '请求模型',
            detail: '主智能体正在向 a3s-code runtime 发起本轮执行',
            source: 'a3s-code runtime',
        });
        emit({
            type: 'status_change',
            status: 'running',
        });

        // 提前到 try 外侧：catch 也要能调 planningTracker.finalize() 把卡在 running / pending 的任务收尾
        const planningTracker = new KernelPlanningProgressTracker();
        const emitPlanningProgressUpdate = (event: Record<string, unknown>) => {
            emit({
                type: 'stream_event',
                event,
            });
        };
        // State accumulated across the message run. Keep it outside `try` so
        // the failure path can persist whatever the user already saw before a
        // watchdog/tool/runtime error aborted the stream.
        const assistantText: string[] = [];
        const assistantBlocks: AssistantContentBlock[] = [];
        const seenToolUses = new Set<string>();
        let pendingText = '';
        let totalTokens: number | undefined;
        let contextUsedPercent: number | undefined;
        let streamStopReason: RunStopReason | null = null;

        const flushTextBlock = () => {
            if (!pendingText) return;
            const previous = assistantBlocks[assistantBlocks.length - 1];
            if (previous?.type === 'text') {
                previous.text += pendingText;
            } else {
                assistantBlocks.push({ type: 'text', text: pendingText });
            }
            pendingText = '';
        };

        const ensureToolUseBlock = (toolId: string, toolName: string, toolInput?: unknown) => {
            if (!toolId || seenToolUses.has(toolId)) {
                if (toolId && toolInput !== undefined) {
                    const existing = assistantBlocks.find(
                        (block): block is Extract<AssistantContentBlock, { type: 'tool_use' }> =>
                            block.type === 'tool_use' && block.id === toolId,
                    );
                    if (existing && Object.keys(existing.input).length === 0) {
                        existing.input = this.normalizeToolInput(toolInput);
                    }
                }
                return;
            }
            flushTextBlock();
            seenToolUses.add(toolId);
            assistantBlocks.push({
                type: 'tool_use',
                id: toolId,
                name: toolName || 'tool',
                input: this.normalizeToolInput(toolInput),
            });
        };

        const failedToolLabel = (toolId: string): string => {
            for (const [toolName, latestToolId] of latestToolIdByName.entries()) {
                if (latestToolId === toolId) return toolName;
            }
            return toolId;
        };
        const toolNameForId = (toolId: string): string | undefined => {
            for (const [toolName, latestToolId] of latestToolIdByName.entries()) {
                if (latestToolId === toolId) return toolName;
            }
            return undefined;
        };
        const mostRecentActiveToolId = (): string | undefined => {
            const active = Array.from(activeToolIds);
            return active.length > 0 ? active[active.length - 1] : undefined;
        };

        const safeFailureBlocks = (failureText: string): AssistantContentBlock[] => {
            flushTextBlock();
            const completedToolIds = new Set(
                assistantBlocks
                    .filter(
                        (block): block is Extract<AssistantContentBlock, { type: 'tool_result' }> =>
                            block.type === 'tool_result',
                    )
                    .map(block => block.toolUseId),
            );
            const blocks = assistantBlocks.filter(block => block.type !== 'tool_use' || completedToolIds.has(block.id));
            blocks.push({ type: 'text', text: failureText });
            return blocks;
        };

        const persistFailedAssistantTurn = async (error: unknown, verdict: RunVerdict): Promise<void> => {
            const errorMessage = error instanceof Error ? error.message : String(error);
            const activeToolLabels = Array.from(activeToolIds).map(failedToolLabel).filter(Boolean);
            const activeToolText =
                activeToolLabels.length > 0 ? `\n仍在等待的工具：${activeToolLabels.join(', ')}` : '';
            const failureText = `本轮执行失败：${errorMessage}${activeToolText}`;
            const partialText = assistantText.join('').trim();
            const content = [partialText, failureText].filter(Boolean).join('\n\n');
            const contentBlocks = safeFailureBlocks(failureText);
            const failedAssistantMessageId = `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
            emit({
                type: 'assistant',
                parentToolUseId: null,
                message: {
                    id: failedAssistantMessageId,
                    role: 'assistant',
                    model: input.model || '',
                    content: contentBlocks,
                    stopReason: verdict.stopReason,
                    durationMs: Date.now() - startedAt,
                    meta: { error: errorMessage, runStatus: verdict.status, stopReason: verdict.stopReason },
                    usage: totalTokens ? { totalTokens } : null,
                },
                timestamp: Date.now(),
            });
            await this.conversationLog.recordAssistantMessage({
                id: failedAssistantMessageId,
                sessionId,
                content,
                contentBlocks,
                totalTokens,
                source: 'kernel:run_failed',
            });
        };

        const runResultData = (verdict: RunVerdict, openPlanTasks: number) => ({
            is_error: verdict.status !== 'succeeded',
            status: verdict.status,
            stopReason: verdict.stopReason,
            retryable: verdict.retryable,
            message: this.runVerdictMessage(verdict),
            durationMs: Date.now() - startedAt,
            totalTokens,
            toolCalls: announcedToolIds.size,
            activeToolCount: activeToolIds.size,
            openPlanTasks,
            contextUsedPercent,
        });

        const emitRunResult = (verdict: RunVerdict, openPlanTasks: number) => {
            const data = runResultData(verdict, openPlanTasks);
            emit({ type: 'result', data });
            this.recordRunOutcomeMetrics(
                verdict,
                data.durationMs,
                totalTokens,
                announcedToolIds.size,
                contextUsedPercent,
            );
            this.logger.log(
                `[kernel.run.outcome] sessionId=${sessionId} status=${verdict.status} stopReason=${verdict.stopReason} retryable=${verdict.retryable} durationMs=${data.durationMs} totalTokens=${totalTokens ?? 'n/a'} toolCalls=${announcedToolIds.size} activeToolCount=${activeToolIds.size} openPlanTasks=${openPlanTasks} contextUsedPercent=${contextUsedPercent ?? 'n/a'}`,
            );
        };

        try {
            if (this.runtimeState.isCancelled(sessionId)) {
                activeSession.session.cancel();
                emitRunResult(
                    {
                        status: 'cancelled',
                        stopReason: 'user_cancelled',
                        retryable: false,
                    },
                    planningTracker.openTaskCount(),
                );
                closeLifecycle('cancelled', { reason: 'cancelled_before_stream' });
                emitMainActivity({
                    status: 'cancelled',
                    phase: 'cancelled',
                    label: '任务已取消',
                    detail: '用户在模型流开始前取消了本轮执行',
                    source: '用户操作',
                });
                this.finishCancelledSession(sessionId, emit, true);
                return;
            }

            const resolvedModel = input.model || input.activeSession.runtimeOverrides.model || 'default';

            const agentSpec = this.agentRegistry.resolve(activeSession.agentId);
            const streamCtx = agentSpec?.onStreamText
                ? {
                      sessionId,
                      agentId: activeSession.agentId,
                      userId: activeSession.userId,
                      emit,
                  }
                : undefined;
            const textDedupe = new KernelStreamTextDedupe();
            const toolInputDeltaCoalescer = new KernelToolInputDeltaCoalescer();
            let pendingToolInputEvent: Record<string, unknown> | null = null;
            const emitStreamEvent = (streamEvent: Record<string, unknown>) => {
                const browserMsg: Record<string, unknown> = {
                    type: 'stream_event',
                    event: streamEvent,
                };
                if (!textDedupe.shouldDrop(browserMsg)) {
                    emit(browserMsg);
                }
            };
            const emitCoalescedToolInputDelta = (partialJson: string) => {
                emitStreamEvent({
                    ...(pendingToolInputEvent ?? { type: 'input_json_delta' }),
                    type: 'input_json_delta',
                    partial_json: partialJson,
                    coalesced: true,
                });
                pendingToolInputEvent = null;
            };
            const flushCoalescedToolInputDelta = () => {
                const flushed = toolInputDeltaCoalescer.flush();
                if (flushed) {
                    emitCoalescedToolInputDelta(flushed);
                }
            };
            const queueCoalescedToolInputDelta = (streamEvent: Record<string, unknown>): boolean => {
                const partialJson = typeof streamEvent.partial_json === 'string' ? streamEvent.partial_json : '';
                if (!partialJson) return false;
                pendingToolInputEvent = streamEvent;
                const flushed = toolInputDeltaCoalescer.push(partialJson);
                if (flushed) {
                    emitCoalescedToolInputDelta(flushed);
                }
                return true;
            };
            // One-shot agent hook: only fires on the first attempt, never on
            // retry. The user's content didn't change; the agent already saw it.
            await agentSpec?.onUserMessage?.(
                { sessionId, agentId: activeSession.agentId, userId: activeSession.userId },
                input.content,
            );

            // Currently-active run id is captured per attempt so the watchdog
            // can target `cancelRun(runId)`. `let` because a stall retry
            // replaces the stream and gets a fresh run id from the SDK.
            let currentRunId: string | null = null;
            // Hoisted so the catch path on the final attempt can log the run
            // id of the run that failed.
            const cancelCurrentRun = (reason: string): void => {
                if (currentRunId) {
                    activeSession.session
                        .cancelRun(currentRunId)
                        .catch(err =>
                            this.logger.warn(
                                `cancelRun(${currentRunId}) failed (${reason}) for session ${sessionId}: ${
                                    err instanceof Error ? err.message : String(err)
                                }; falling back to session.cancel()`,
                            ),
                        )
                        .finally(() => {
                            // Belt-and-suspenders: if cancelRun lost the race
                            // and the run is still active, the session-level
                            // cancel ensures the SDK halts. No-op when already
                            // stopped.
                            try {
                                activeSession.session.cancel();
                            } catch {
                                // best-effort; nothing else to do
                            }
                        });
                } else {
                    try {
                        activeSession.session.cancel();
                    } catch {
                        // best-effort cancel; the caller drives the failure path
                    }
                }
            };

            // Watchdog state for the SDK event stream. Tracks when the last
            // event arrived so a stalled tool / wedged SDK pipeline surfaces
            // as a heartbeat (and eventually a hard cancel) instead of an
            // invisible frozen stream. Thresholds come from the merged
            // runtime overrides so an agent/session can tighten them for
            // latency-sensitive flows or relax them for genuinely slow tools.
            const watchdogOverrides = activeSession.runtimeOverrides ?? {};
            const stallWarningMs = resolvePositiveMs(
                watchdogOverrides.streamStallWarningMs,
                DEFAULT_STREAM_STALL_WARNING_MS,
            );
            // The hard threshold must be strictly greater than the warning
            // threshold so the heartbeat actually has time to fire before the
            // forced cancel — otherwise a misconfigured pair would silently
            // drop the heartbeat.
            const stallHardMs = Math.max(
                stallWarningMs + 1_000,
                resolvePositiveMs(watchdogOverrides.streamStallHardMs, DEFAULT_STREAM_STALL_HARD_MS),
            );
            // Active-tool hard threshold: while a tool is in flight, give it
            // generous breathing room because legitimate long tools (large
            // `Bash`, `web_search` retries, big `git clone`) emit no
            // intermediate SDK events. The SDK's own `toolTimeoutMs` is the
            // authoritative killer — we floor at `toolTimeoutMs + 60s` so the
            // tool timeout always fires first, leaving the watchdog only to
            // catch the rare case where the SDK drops `tool_end`.
            const toolTimeoutMs = resolvePositiveMs(watchdogOverrides.toolTimeoutMs, DEFAULT_TOOL_TIMEOUT_MS);
            const stallActiveToolHardMs = Math.max(
                stallHardMs,
                toolTimeoutMs + 60_000,
                resolvePositiveMs(
                    watchdogOverrides.streamStallActiveToolHardMs,
                    DEFAULT_STREAM_STALL_ACTIVE_TOOL_HARD_MS,
                ),
            );
            const maxConsecutiveToolErrors = resolvePositiveInt(
                watchdogOverrides.maxConsecutiveToolErrors,
                DEFAULT_MAX_CONSECUTIVE_TOOL_ERRORS,
            );
            // Retry budget for the "model never produced a token before the
            // stall fired" failure mode. Tool-active and partial-output stalls
            // never enter the retry path — the surface to the user would
            // diverge between attempts (duplicated text, ghost tool calls).
            // Inline `>= 0` resolution (not `resolvePositiveInt`) so explicit
            // `0` disables retry instead of falling back to the default.
            const maxStreamRetriesOverride = watchdogOverrides.maxStreamRetries;
            const maxStreamRetries =
                typeof maxStreamRetriesOverride === 'number' &&
                Number.isFinite(maxStreamRetriesOverride) &&
                maxStreamRetriesOverride >= 0
                    ? Math.floor(maxStreamRetriesOverride)
                    : DEFAULT_MAX_STREAM_RETRIES;
            const maxToolRoundAutoContinues = this.maxToolRoundAutoContinueLimit(watchdogOverrides);
            let maxToolRoundAutoContinuesUsed = 0;
            let streamOptions: EventStreamOptions | undefined;
            // Reassigned at the top of each retry attempt. `watchedNext`,
            // `cancelCurrentRun`, and the inner event loop all close over
            // these bindings, so updates here flow through automatically.
            let eventStream: AsyncIterator<AgentEvent>;
            let lastEventAt = Date.now();
            // Repeating heartbeat: once the first warning fires, we re-emit a
            // `stream_stalled` event every `stallWarningMs` so the UI gets a
            // steady "still stuck for Xs" pulse during long tool waits instead
            // of one heartbeat followed by minutes of dead silence.
            let lastHeartbeatAt: number | null = null;
            const watchedNext = async (): Promise<IteratorResult<AgentEvent>> => {
                const pending = eventStream.next();
                while (true) {
                    const sinceLastMs = Date.now() - lastEventAt;
                    // Pick the threshold based on whether a tool is currently
                    // in flight. We re-evaluate each loop iteration because a
                    // tool may start/end between waits.
                    const activeHardMs = activeToolIds.size > 0 ? stallActiveToolHardMs : stallHardMs;
                    if (sinceLastMs >= activeHardMs) {
                        const activeToolId = activeToolIds.values().next().value;
                        this.logger.error(
                            `[stream:${sessionId}] event stream stalled for ${sinceLastMs}ms (activeTools=${activeToolIds.size}, last=${activeToolId ?? 'n/a'}, threshold=${activeHardMs}ms, runId=${currentRunId ?? 'unknown'}); cancelling run`,
                        );
                        // Surgical: only cancel this stuck run. If the user
                        // already retried with a new message, the new run id
                        // differs and `cancelRun` no-ops on the stale id.
                        cancelCurrentRun('event_stream_stalled');
                        throw new Error(
                            `event_stream_stalled: no SDK events for ${sinceLastMs}ms` +
                                (activeToolId ? ` while tool '${activeToolId}' was active` : ''),
                        );
                    }
                    // After the first heartbeat we re-tick on every
                    // `stallWarningMs` (capped to remaining hard window) to
                    // produce a periodic pulse instead of one heartbeat + silence.
                    const remainingToHardMs = Math.max(0, activeHardMs - sinceLastMs);
                    const remainingToNextHeartbeatMs =
                        lastHeartbeatAt === null
                            ? stallWarningMs - sinceLastMs
                            : stallWarningMs - (Date.now() - lastHeartbeatAt);
                    const nextTimerMs = Math.max(0, Math.min(remainingToHardMs, remainingToNextHeartbeatMs));
                    let timer: ReturnType<typeof setTimeout> | undefined;
                    const winner = await Promise.race([
                        pending.then(value => ({ kind: 'event' as const, value })),
                        new Promise<{ kind: 'tick' }>(resolve => {
                            timer = setTimeout(() => resolve({ kind: 'tick' }), nextTimerMs);
                        }),
                    ]);
                    if (timer) clearTimeout(timer);
                    if (winner.kind === 'event') {
                        lastEventAt = Date.now();
                        lastHeartbeatAt = null;
                        return winner.value;
                    }
                    const dueForHeartbeat =
                        lastHeartbeatAt === null
                            ? sinceLastMs >= stallWarningMs
                            : Date.now() - lastHeartbeatAt >= stallWarningMs;
                    if (dueForHeartbeat) {
                        lastHeartbeatAt = Date.now();
                        const stalledMs = lastHeartbeatAt - lastEventAt;
                        const activeToolId = activeToolIds.values().next().value;
                        const activeToolIdStr = typeof activeToolId === 'string' ? activeToolId : undefined;
                        // Structured log so operators can aggregate "X% of
                        // sessions stall on tool Y" via log pipelines.
                        this.logger.warn(
                            `[kernel.stream.stalled] sessionId=${sessionId} stalledMs=${stalledMs} activeToolCount=${activeToolIds.size} activeToolId=${activeToolIdStr ?? 'n/a'} threshold=${activeHardMs}`,
                        );
                        this.metrics?.incCounter('kernel_stream_stalled_total', {
                            active_tool: activeToolIdStr ?? 'none',
                        });
                        emit({
                            type: 'stream_event',
                            event: {
                                type: 'stream_stalled',
                                sessionId,
                                stalledMs,
                                activeToolCount: activeToolIds.size,
                                activeToolId: activeToolIdStr,
                                timestamp: Date.now(),
                            },
                        });
                    }
                }
            };

            // Per-attempt consecutive-error counter keyed by tool name. Reset
            // on successful tool completion. Used to fail-fast when the agent
            // is stuck retrying the same broken tool. A stall retry rebinds
            // this so the previous attempt's tool history doesn't bleed in.
            let consecutiveErrorsByTool = new Map<string, number>();

            // Retry loop for the "model thinking" wedge: when the watchdog
            // trips the hard threshold with `activeTools=0` and no token has
            // streamed, we transparently re-issue the same user message up to
            // `maxStreamRetries` times before surfacing the failure. Any other
            // stall (tool-active, mid-output) bypasses retry — see the catch
            // gate below.
            while (true) {
                streamStopReason = null;
                currentRunId = null;

                for (let attempt = 0; attempt <= maxStreamRetries; attempt++) {
                    if (attempt > 0) {
                        // Wipe everything the first attempt accumulated. Safe only
                        // because we gate retry on `!outputStarted`: the user UI
                        // has nothing to lose because no assistant tokens or tool
                        // events were ever emitted.
                        assistantText.length = 0;
                        assistantBlocks.length = 0;
                        seenToolUses.clear();
                        pendingText = '';
                        totalTokens = undefined;
                        activeToolIds.clear();
                        announcedToolIds.clear();
                        toolStartedAt.clear();
                        toolNameById.clear();
                        toolInputStartedAt.clear();
                        toolLastInputAt.clear();
                        toolInputDeltaCount.clear();
                        toolExecStartedAt.clear();
                        latestToolIdByName.clear();
                        toolInputById.clear();
                        lastToolUpdateAt.clear();
                        lastToolInputActivityAt.clear();
                        toolOutputLimitById.clear();
                        eventTypeTally.clear();
                        outputStarted = false;
                        streamStopReason = null;
                        contextUsedPercent = undefined;
                        consecutiveErrorsByTool = new Map<string, number>();
                        currentRunId = null;
                        lastHeartbeatAt = null;

                        this.logger.warn(
                            `[kernel.stream.retry] sessionId=${sessionId} attempt=${attempt + 1} maxAttempts=${maxStreamRetries + 1} model=${resolvedModel} reason=event_stream_stalled`,
                        );
                        this.metrics?.incCounter('kernel_stream_retry_total', {
                            reason: 'event_stream_stalled',
                        });
                        emit({
                            type: 'stream_event',
                            event: {
                                type: 'stream_retry',
                                sessionId,
                                attempt: attempt + 1,
                                maxAttempts: maxStreamRetries + 1,
                                reason: 'event_stream_stalled',
                                timestamp: Date.now(),
                            },
                        });
                        emitMainActivity({
                            status: 'running',
                            phase: 'model_retry',
                            label: '自动重试请求模型',
                            detail: `上次请求模型长时间无响应，正在自动发起第 ${attempt + 1} 次尝试`,
                            source: 'a3s-code runtime',
                        });
                    }

                    this.logger.log(
                        `Creating event stream for session ${sessionId}, model=${resolvedModel}${attempt > 0 ? ` (retry ${attempt})` : ''}${maxToolRoundAutoContinuesUsed > 0 ? ` (tool-round continuation ${maxToolRoundAutoContinuesUsed})` : ''}`,
                    );
                    eventStream = await this.createEventStream(input, streamOptions);
                    this.logger.log(`Event stream created for session ${sessionId}, waiting for events...`);

                    // Capture the SDK's run id for this stream so the watchdog can
                    // do surgical per-run cancellation (`cancelRun(runId)`).
                    // Best-effort: 3.2.x exposes `currentRun()` but if the SDK
                    // can't resolve the id (resumed-session race etc.) we fall
                    // back to the session-level cancel inside `cancelCurrentRun`.
                    try {
                        const run = await activeSession.session.currentRun();
                        const id = (run as { id?: unknown } | null)?.id;
                        if (typeof id === 'string' && id) currentRunId = id;
                    } catch (error) {
                        this.logger.warn(
                            `currentRun() failed for session ${sessionId}: ${error instanceof Error ? error.message : String(error)} — falling back to session.cancel() on watchdog trips`,
                        );
                    }

                    emitMainActivity({
                        status: 'running',
                        phase: 'model_stream',
                        label: '等待模型输出',
                        detail: '运行时已开始流式返回事件，正在等待首个输出或工具调用',
                        source: 'a3s-code runtime',
                    });

                    // Reset the stall clock now that the stream is actually live
                    // — otherwise the seconds spent awaiting createEventStream
                    // would count against the watchdog threshold.
                    lastEventAt = Date.now();
                    lastHeartbeatAt = null;

                    try {
                        while (true) {
                            if (this.runtimeState.isCancelled(sessionId)) {
                                cancelCurrentRun('user_cancelled');
                                break;
                            }

                            const result = await watchedNext();
                            if (result.done) break;

                            if (this.runtimeState.isCancelled(sessionId)) {
                                cancelCurrentRun('user_cancelled');
                                break;
                            }

                            const event = result.value;
                            if (!event) continue;

                            if (typeof event.type === 'string') {
                                eventTypeTally.set(event.type, (eventTypeTally.get(event.type) ?? 0) + 1);
                            }

                            if (!outputStarted) {
                                this.logger.log(
                                    `[stream:${sessionId}] event type="${event.type}" text="${event.text?.substring(0, 50) || ''}" toolName="${event.toolName || ''}" data="${event.data?.substring(0, 100) || ''}"`,
                                );
                            }

                            if (event.type === 'confirmation_required') {
                                const confirmation = this.extractConfirmationDetails(event);
                                const fallbackToolId = confirmation.toolId || mostRecentActiveToolId();
                                const fallbackToolInput =
                                    confirmation.toolInput ??
                                    (fallbackToolId
                                        ? this.recordValue(toolInputById.get(fallbackToolId))
                                        : undefined);
                                const confirmationDetails = {
                                    ...confirmation,
                                    toolId: fallbackToolId,
                                    toolName:
                                        confirmation.toolName ||
                                        (fallbackToolId ? toolNameForId(fallbackToolId) : undefined),
                                    toolInput: fallbackToolInput,
                                };
                                const activeConfirmationKey =
                                    confirmationDetails.toolId ||
                                    confirmationDetails.toolName ||
                                    'pending-confirmation';
                                const lockedAuto = isLockedAgent(activeSession.agentId);
                                activeToolIds.add(activeConfirmationKey);
                                emitMainActivity({
                                    status: lockedAuto ? 'running' : 'waiting',
                                    phase: lockedAuto ? 'tool_auto_authorize' : 'tool_authorization',
                                    label: lockedAuto ? '自动授权工具' : '等待工具授权',
                                    detail: lockedAuto
                                        ? confirmationDetails.toolName
                                            ? `锁定智能体 ${activeSession.agentId} 自动放行工具 ${confirmationDetails.toolName}`
                                            : `锁定智能体 ${activeSession.agentId} 自动放行工具调用`
                                        : confirmationDetails.toolName
                                          ? `工具 ${confirmationDetails.toolName} 需要用户确认后才能继续`
                                          : '工具调用需要用户确认后才能继续',
                                    source: lockedAuto ? '锁定智能体自动确认' : '工具授权',
                                });
                                if (!lockedAuto) {
                                    emitToolActivity({
                                        status: 'waiting',
                                        phase: 'authorization',
                                        toolUseId: confirmationDetails.toolId,
                                        toolName: confirmationDetails.toolName,
                                        label: confirmationDetails.toolName
                                            ? `等待授权：${confirmationDetails.toolName}`
                                            : '等待工具授权',
                                        detail: this.previewValue(confirmationDetails.toolInput),
                                    });
                                }
                                const approved = await this.toolConfirmation.handleConfirmationRequired({
                                    sessionId,
                                    agentId: activeSession.agentId,
                                    session: activeSession.session,
                                    event,
                                    confirmation: input.confirmation ?? null,
                                    fallbackToolId: confirmationDetails.toolId,
                                    fallbackToolName: confirmationDetails.toolName,
                                    fallbackToolInput: confirmationDetails.toolInput,
                                    emit,
                                });
                                activeToolIds.delete(activeConfirmationKey);
                                emitToolActivity({
                                    status: approved ? 'completed' : 'failed',
                                    phase: lockedAuto
                                        ? approved
                                            ? 'auto_authorized'
                                            : 'auto_authorization_failed'
                                        : approved
                                          ? 'authorized'
                                          : 'authorization_denied',
                                    toolUseId: confirmationDetails.toolId,
                                    toolName: confirmationDetails.toolName,
                                    label: lockedAuto
                                        ? approved
                                            ? '工具自动授权通过'
                                            : '工具自动授权失败'
                                        : approved
                                          ? '工具授权通过'
                                          : '工具授权被拒绝',
                                    detail: confirmationDetails.toolName,
                                });
                                emitMainActivity({
                                    status: 'running',
                                    phase: lockedAuto
                                        ? approved
                                            ? 'tool_auto_authorized'
                                            : 'tool_auto_denied'
                                        : approved
                                          ? 'tool_authorized'
                                          : 'tool_denied',
                                    label: lockedAuto
                                        ? approved
                                            ? '工具自动授权通过'
                                            : '工具自动授权失败'
                                        : approved
                                          ? '工具授权通过'
                                          : '工具授权未通过',
                                    detail: confirmation.toolName,
                                    source: lockedAuto ? '锁定智能体自动确认' : '工具授权',
                                });
                                // Interactive confirmation can take minutes (Feishu card,
                                // pager, etc). Reset the stall watchdog so the next
                                // `watchedNext` doesn't immediately fail with
                                // `event_stream_stalled` based on the pre-confirmation
                                // timestamp — the wait was legitimate, not a stuck SDK.
                                lastEventAt = Date.now();
                                lastHeartbeatAt = null;
                                continue;
                            }

                            const eventData = parseAgentEventData(event);
                            let normalizedEvent = normalizeStreamEvent(event.type, event, eventData);
                            streamStopReason =
                                this.extractRunStopReason(event, eventData, normalizedEvent) ?? streamStopReason;
                            contextUsedPercent =
                                this.extractContextUsedPercent(event, eventData) ?? contextUsedPercent;
                            normalizedEvent = this.withBoundedToolOutput(
                                normalizedEvent,
                                toolOutputLimitById,
                                latestToolIdByName,
                            );
                            // Additive, fire-and-forget tap: persist memory_stored/recalled/cleared events
                            // into the per-user memory base. READ-ONLY w.r.t. `normalizedEvent` — it never
                            // mutates the object emitted to the browser, and never throws into this loop.
                            this.tapMemoryEvent(normalizedEvent, { userId: activeSession.userId, sessionId });
                            if (!normalizedEvent && !isKnownEventType(event.type)) {
                                this.logger.warn(
                                    `[stream:${sessionId}] unhandled event type="${event.type}" text="${event.text?.substring(0, 80) || ''}" data="${event.data?.substring(0, 200) || ''}"`,
                                );
                            }
                            if (isPlanningProgressEvent(normalizedEvent)) {
                                planningTracker.observe(normalizedEvent);
                            }
                            if (normalizedEvent?.type !== 'input_json_delta') {
                                flushCoalescedToolInputDelta();
                            }

                            if (normalizedEvent?.type === 'text_delta' && typeof normalizedEvent.text === 'string') {
                                if (!outputStarted) {
                                    outputStarted = true;
                                    emitMainActivity({
                                        status: 'running',
                                        phase: 'model_output',
                                        label: '接收模型输出',
                                        detail: '主智能体已收到首个模型文本增量',
                                        source: 'a3s-code runtime',
                                    });
                                }
                                assistantText.push(normalizedEvent.text);
                                pendingText += normalizedEvent.text;
                                if (streamCtx && agentSpec?.onStreamText) {
                                    agentSpec.onStreamText(streamCtx, assistantText.join(''), normalizedEvent.text);
                                }
                            }
                            if (
                                (normalizedEvent?.type === 'tool_use_start' || normalizedEvent?.type === 'tool_use') &&
                                typeof normalizedEvent.toolName === 'string'
                            ) {
                                const toolUseId =
                                    typeof normalizedEvent.toolId === 'string'
                                        ? normalizedEvent.toolId
                                        : `${normalizedEvent.toolName}-${assistantBlocks.length}`;
                                if (!announcedToolIds.has(toolUseId)) {
                                    announcedToolIds.add(toolUseId);
                                    latestToolIdByName.set(normalizedEvent.toolName, toolUseId);
                                    if (normalizedEvent.input !== undefined) {
                                        toolInputById.set(toolUseId, normalizedEvent.input);
                                    }
                                    toolStartedAt.set(toolUseId, Date.now());
                                    toolNameById.set(toolUseId, normalizedEvent.toolName);
                                    activeToolIds.add(toolUseId);
                                    emitMainActivity({
                                        status: 'running',
                                        phase: 'tool_input_streaming',
                                        label: `生成工具参数：${normalizedEvent.toolName}`,
                                        detail: '模型已选择工具，正在生成完整工具参数',
                                        source: '模型输出',
                                    });
                                    emitToolActivity({
                                        status: 'running',
                                        phase: 'input_streaming',
                                        toolUseId,
                                        toolName: normalizedEvent.toolName,
                                        label: `生成参数：${normalizedEvent.toolName}`,
                                        detail: this.previewValue(normalizedEvent.input),
                                        elapsedMs: 0,
                                    });
                                }
                                if (normalizedEvent.input !== undefined && !toolInputById.has(toolUseId)) {
                                    toolInputById.set(toolUseId, normalizedEvent.input);
                                }
                                ensureToolUseBlock(toolUseId, normalizedEvent.toolName, normalizedEvent.input);
                                const planningUpdate = planningTracker.toolStarted(normalizedEvent.toolName);
                                if (planningUpdate) {
                                    emitPlanningProgressUpdate(planningUpdate);
                                }
                            }
                            if (normalizedEvent?.type === 'input_json_delta') {
                                const toolUseId = findCurrentToolId();
                                if (toolUseId) {
                                    markToolInputStreaming(toolUseId, toolNameById.get(toolUseId));
                                }
                                if (queueCoalescedToolInputDelta(normalizedEvent)) {
                                    continue;
                                }
                            }
                            if (
                                normalizedEvent?.type === 'tool_output_delta' &&
                                typeof normalizedEvent.toolName === 'string'
                            ) {
                                const toolUseId =
                                    typeof normalizedEvent.toolUseId === 'string' && normalizedEvent.toolUseId
                                        ? normalizedEvent.toolUseId
                                        : latestToolIdByName.get(normalizedEvent.toolName) || normalizedEvent.toolName;
                                markToolExecutionStarted(toolUseId);
                                emitMainActivity({
                                    status: 'running',
                                    phase: 'tool_exec',
                                    label: `执行工具：${normalizedEvent.toolName}`,
                                    detail: '工具已开始执行，正在接收输出',
                                    source: '工具运行器',
                                });
                                const now = Date.now();
                                const last = lastToolUpdateAt.get(toolUseId) ?? 0;
                                if (now - last > 1000) {
                                    lastToolUpdateAt.set(toolUseId, now);
                                    emitToolActivity({
                                        status: 'running',
                                        phase: 'output',
                                        toolUseId,
                                        toolName: normalizedEvent.toolName,
                                        label: `接收输出：${normalizedEvent.toolName}`,
                                        detail: this.previewValue(normalizedEvent.delta),
                                        elapsedMs: toolStartedAt.has(toolUseId)
                                            ? now - toolStartedAt.get(toolUseId)!
                                            : undefined,
                                    });
                                }
                            }
                            if (normalizedEvent?.type === 'tool_end' && typeof normalizedEvent.toolName === 'string') {
                                const toolId =
                                    typeof normalizedEvent.toolId === 'string' && normalizedEvent.toolId
                                        ? normalizedEvent.toolId
                                        : latestToolIdByName.get(normalizedEvent.toolName) ||
                                          `${normalizedEvent.toolName}-${assistantBlocks.length}`;
                                markToolExecutionStarted(toolId);
                                ensureToolUseBlock(toolId, normalizedEvent.toolName);
                                flushTextBlock();
                                const isError =
                                    typeof normalizedEvent.exitCode === 'number' ? normalizedEvent.exitCode !== 0 : false;
                                assistantBlocks.push({
                                    type: 'tool_result',
                                    toolUseId: toolId,
                                    content: typeof normalizedEvent.output === 'string' ? normalizedEvent.output : '',
                                    isError: isError || undefined,
                                });
                                activeToolIds.delete(toolId);
                                const reportedDurationMs =
                                    typeof normalizedEvent.durationMs === 'number' && Number.isFinite(normalizedEvent.durationMs)
                                        ? normalizedEvent.durationMs
                                        : undefined;
                                const toolDurationMs = estimateToolExecutionDurationMs(toolId, reportedDurationMs);
                                if (toolDurationMs !== undefined) {
                                    normalizedEvent.durationMs = toolDurationMs;
                                }
                                // Track consecutive failures of the same tool so the agent
                                // can't burn maxToolRounds re-trying a broken tool in a
                                // tight loop while the user stares at a frozen UI.
                                if (isError) {
                                    const consecutive = (consecutiveErrorsByTool.get(normalizedEvent.toolName) ?? 0) + 1;
                                    consecutiveErrorsByTool.set(normalizedEvent.toolName, consecutive);
                                    const toolErrorReason =
                                        typeof normalizedEvent.error === 'string'
                                            ? normalizedEvent.error
                                            : typeof normalizedEvent.output === 'string'
                                              ? normalizedEvent.output.slice(0, 1_000)
                                              : 'Tool execution failed';
                                    // Structured log so operators can aggregate "tool X
                                    // fails most often" via log pipelines (Loki / ELK).
                                    // Format keeps key=value pairs stable for grep/parse.
                                    this.logger.warn(
                                        `[kernel.tool.error] sessionId=${sessionId} toolName=${normalizedEvent.toolName} toolId=${toolId} exitCode=${normalizedEvent.exitCode ?? 'n/a'} durationMs=${toolDurationMs ?? 'n/a'} consecutive=${consecutive} reason="${toolErrorReason.replace(/"/g, '\\"').slice(0, 200)}"`,
                                    );
                                    this.metrics?.incCounter('kernel_tool_errors_total', {
                                        tool: normalizedEvent.toolName,
                                    });
                                    if (toolDurationMs !== undefined) {
                                        this.metrics?.observeHistogram(
                                            'kernel_tool_duration_seconds',
                                            toolDurationMs / 1_000,
                                            {
                                                tool: normalizedEvent.toolName,
                                                status: 'error',
                                            },
                                        );
                                    }
                                    // Surface an explicit tool_error stream event alongside
                                    // the canonical tool_end so frontends can render "tool
                                    // X failed after 30s: <reason>" without re-deriving
                                    // failure from the exit code or scraping output.
                                    //
                                    // `errorKind` (when present) is v3's structured failure
                                    // discriminant — `{type: "timeout", op, duration_ms}` /
                                    // `{type: "remote_git_conflict", ...}` etc. — so the
                                    // UI can show "工具超时" vs "版本冲突" instead of just
                                    // dumping the captured stderr.
                                    const errorKind =
                                        normalizedEvent.errorKind &&
                                        typeof normalizedEvent.errorKind === 'object' &&
                                        !Array.isArray(normalizedEvent.errorKind)
                                            ? (normalizedEvent.errorKind as Record<string, unknown>)
                                            : undefined;
                                    emit({
                                        type: 'stream_event',
                                        event: {
                                            type: 'tool_error',
                                            toolName: normalizedEvent.toolName,
                                            toolId,
                                            reason: toolErrorReason,
                                            exitCode: normalizedEvent.exitCode,
                                            durationMs: toolDurationMs,
                                            consecutiveFailures: consecutive,
                                            errorKind,
                                            sessionId,
                                            timestamp: Date.now(),
                                        },
                                    });
                                    if (consecutive >= maxConsecutiveToolErrors) {
                                        // Existing warn was free-form; tag with the same
                                        // [kernel.*] structured prefix as the other lines
                                        // so all kernel-runtime events grep together.
                                        this.logger.warn(
                                            `[kernel.tool.circuit_open] sessionId=${sessionId} toolName=${normalizedEvent.toolName} consecutive=${consecutive} threshold=${maxConsecutiveToolErrors}`,
                                        );
                                        this.metrics?.incCounter('kernel_tool_circuit_open_total', {
                                            tool: normalizedEvent.toolName,
                                        });
                                        emit({
                                            type: 'stream_event',
                                            event: {
                                                type: 'tool_circuit_open',
                                                toolName: normalizedEvent.toolName,
                                                consecutiveFailures: consecutive,
                                                sessionId,
                                                timestamp: Date.now(),
                                            },
                                        });
                                        cancelCurrentRun(`tool_circuit_open:${normalizedEvent.toolName}`);
                                        throw new Error(
                                            `tool_circuit_open: '${normalizedEvent.toolName}' failed ${consecutive} times in this run`,
                                        );
                                    }
                                } else {
                                    consecutiveErrorsByTool.delete(normalizedEvent.toolName);
                                    if (toolDurationMs !== undefined) {
                                        this.metrics?.observeHistogram(
                                            'kernel_tool_duration_seconds',
                                            toolDurationMs / 1_000,
                                            {
                                                tool: normalizedEvent.toolName,
                                                status: 'success',
                                            },
                                        );
                                    }
                                }
                                emitToolActivity({
                                    status: isError ? 'failed' : 'completed',
                                    phase: 'completed',
                                    toolUseId: toolId,
                                    toolName: normalizedEvent.toolName,
                                    label: isError
                                        ? `工具失败：${normalizedEvent.toolName}`
                                        : `工具完成：${normalizedEvent.toolName}`,
                                    detail: this.previewValue(normalizedEvent.output),
                                    elapsedMs: toolDurationMs,
                                });
                                emitMainActivity({
                                    status: 'running',
                                    phase: activeToolIds.size > 0 ? 'tool_exec' : 'model_stream',
                                    label: activeToolIds.size > 0 ? '继续执行工具' : '回到模型生成',
                                    detail: isError
                                        ? '工具执行失败，主智能体将根据错误继续处理'
                                        : '工具结果已返回给主智能体',
                                    source: '工具运行器',
                                });
                                const planningUpdate = planningTracker.toolEnded(normalizedEvent.toolName, isError);
                                if (planningUpdate) {
                                    emitPlanningProgressUpdate(planningUpdate);
                                }
                                toolInputById.delete(toolId);
                                toolNameById.delete(toolId);
                                toolStartedAt.delete(toolId);
                                toolInputStartedAt.delete(toolId);
                                toolLastInputAt.delete(toolId);
                                toolInputDeltaCount.delete(toolId);
                                toolExecStartedAt.delete(toolId);
                                lastToolInputActivityAt.delete(toolId);
                            }
                            const nextTotalTokens = this.extractTotalTokens(event, eventData);
                            if (nextTotalTokens !== undefined) {
                                totalTokens = nextTotalTokens;
                                emit({
                                    type: 'stream_event',
                                    event: {
                                        type: 'usage_update',
                                        totalTokens,
                                        timestamp: Date.now(),
                                    },
                                });
                            }

                            if (event.type === 'tool_use' || (event.type === 'tool_start' && event.toolName)) {
                                const toolName = event.toolName as string;
                                const toolId = event.toolId as string | undefined;
                                emit({
                                    type: 'stream_event',
                                    event: normalizedEvent ?? {
                                        type: 'tool_use_start',
                                        toolName,
                                        toolId,
                                    },
                                });
                                continue;
                            }

                            const browserMsg = normalizedEvent
                                ? {
                                      type: 'stream_event',
                                      event: normalizedEvent,
                                  }
                                : event.type === 'error' || !isKnownEventType(event.type)
                                  ? mapAgentEvent(event.type, event)
                                  : null;
                            if (browserMsg && !textDedupe.shouldDrop(browserMsg)) {
                                emit(browserMsg);
                            }
                        }
                    } catch (innerErr) {
                        flushCoalescedToolInputDelta();
                        // Only the "model thinking" wedge is retryable, and only
                        // when nothing has been streamed yet. Tool-active stalls,
                        // partial-output stalls, tool circuit-breaker failures,
                        // and unrelated errors fall through to the outer catch.
                        const message = innerErr instanceof Error ? innerErr.message : String(innerErr);
                        const isStall = message.startsWith('event_stream_stalled');
                        if (
                            isStall &&
                            !outputStarted &&
                            attempt < maxStreamRetries &&
                            !this.runtimeState.isCancelled(sessionId)
                        ) {
                            continue;
                        }
                        throw innerErr;
                    }

                    break;
                }

                if (
                    this.shouldAutoContinueAfterMaxToolRounds({
                        stopReason: streamStopReason,
                        activeToolCount: activeToolIds.size,
                        used: maxToolRoundAutoContinuesUsed,
                        limit: maxToolRoundAutoContinues,
                        wasCancelled: this.runtimeState.isCancelled(sessionId),
                    })
                ) {
                    maxToolRoundAutoContinuesUsed += 1;
                    streamOptions = {
                        content: this.maxToolRoundContinuationPrompt(
                            maxToolRoundAutoContinuesUsed,
                            maxToolRoundAutoContinues,
                        ),
                        images: [],
                        usePersistedHistory: false,
                    };
                    flushCoalescedToolInputDelta();
                    this.logger.warn(
                        `[kernel.run.auto_continue] sessionId=${sessionId} reason=max_tool_rounds attempt=${maxToolRoundAutoContinuesUsed} maxAttempts=${maxToolRoundAutoContinues}`,
                    );
                    this.metrics?.incCounter('kernel_run_auto_continue_total', {
                        reason: 'max_tool_rounds',
                    });
                    emitStreamEvent({
                        type: 'run_auto_continue',
                        reason: 'max_tool_rounds',
                        attempt: maxToolRoundAutoContinuesUsed,
                        maxAttempts: maxToolRoundAutoContinues,
                        timestamp: Date.now(),
                    });
                    emitMainActivity({
                        status: 'running',
                        phase: 'auto_continue',
                        label: '自动续跑',
                        detail: '本轮达到工具轮次上限，正在继续剩余步骤',
                        source: 'Kernel Runtime',
                    });
                    continue;
                }

                break;
            }

            const finalAssistantText =
                assistantText.length > 0
                    ? assistantText.join('')
                    : extractAssistantTextFromHistory(activeSession.session.history());
            flushTextBlock();
            this.logger.log(
                `[stream:${sessionId}] stream completed: assistantTextParts=${assistantText.length}, finalText="${finalAssistantText.substring(0, 100)}", blocks=${assistantBlocks.length}, history=${activeSession.session.history().length}`,
            );
            emitMainActivity({
                status: 'running',
                phase: 'finalize',
                label: '整理执行结果',
                detail: '主智能体正在合并流式输出、工具结果和会话记录',
                source: 'Kernel Runtime',
            });
            const wasCancelled = this.runtimeState.isCancelled(sessionId);

            // Give the agent one last hook after the stream is fully closed.
            // Skip on cancel: a cancelled turn is best left at the last good
            // checkpoint.
            if (!wasCancelled && streamCtx && agentSpec?.onStreamEnd) {
                try {
                    await agentSpec.onStreamEnd(streamCtx, finalAssistantText);
                } catch (err) {
                    this.logger.warn(
                        `[stream:${sessionId}] onStreamEnd hook failed: ${err instanceof Error ? err.message : err}`,
                    );
                }
            }

            if (
                !wasCancelled &&
                assistantText.length === 0 &&
                !finalAssistantText.trim() &&
                assistantBlocks.length === 0
            ) {
                const verdict: RunVerdict = {
                    status: 'failed',
                    stopReason: 'empty_response',
                    retryable: false,
                };
                const modelForReport =
                    input.activeSession.resolvedModel ||
                    input.model ||
                    input.activeSession.runtimeOverrides.model ||
                    'default';
                const apiKeyMissing = input.activeSession.modelApiKeyMissing === true;
                const tallySummary = eventTypeTally.size
                    ? Array.from(eventTypeTally.entries())
                          .sort((a, b) => b[1] - a[1])
                          .map(([type, n]) => `${type}=${n}`)
                          .join(', ')
                    : '(none — SDK yielded zero events)';
                this.logger.warn(
                    `[stream:${sessionId}] Model returned empty response (model=${modelForReport}, apiKeyMissing=${apiKeyMissing}, agentId=${input.activeSession.agentId ?? 'unknown'}, runtimeKey=${input.activeSession.runtimeKey ?? 'default'}). SDK emitted no text events between turn_start and stream completion — likely an upstream LLM call failure with no error event. Stream event tally: [${tallySummary}]. If apiKeyMissing=true the provider for this model has no API key configured; otherwise (key present) the upstream provider likely rejected the request silently (bad model id at that endpoint, geo block, or quota). If you see error/unknown event types, grep earlier "unhandled event type" warns for the same session. Cross-reference earlier model config and "Provider ... resolved to EMPTY apiKey" log lines for the same session.`,
                );
                const diagnosticMessage = apiKeyMissing
                    ? `当前模型 ${modelForReport} 未配置可用的 API Key，请在「系统 > AI 配置」中为对应 provider 填写密钥后重试。`
                    : `模型未返回有效响应，请检查系统 AI 配置 (model=${modelForReport})`;
                const diagnosticSource = apiKeyMissing ? 'kernel:missing_model_api_key' : 'kernel:empty_model_response';
                const diagnosticBlocks: AssistantContentBlock[] = [{ type: 'text', text: diagnosticMessage }];
                const diagnosticTimestamp = Date.now();
                const diagnosticMessageId = `msg-${diagnosticTimestamp}-${Math.random().toString(36).slice(2, 8)}`;
                emit({
                    type: 'assistant',
                    parentToolUseId: null,
                    message: {
                        id: diagnosticMessageId,
                        role: 'assistant',
                        model: input.model || modelForReport,
                        content: diagnosticBlocks,
                        stopReason: verdict.stopReason,
                        durationMs: Date.now() - startedAt,
                        meta: null,
                        usage: totalTokens ? { totalTokens } : null,
                    },
                    timestamp: diagnosticTimestamp,
                });
                await this.conversationLog.recordAssistantMessage({
                    id: diagnosticMessageId,
                    sessionId,
                    content: diagnosticMessage,
                    contentBlocks: diagnosticBlocks,
                    totalTokens,
                    source: diagnosticSource,
                });
                emit({ type: 'status_change', status: null });
                emit({ type: 'cli_connected' });
                closeLifecycle('failed', {
                    errorMessage: apiKeyMissing ? 'missing_model_api_key' : 'empty_model_response',
                });
                emitRunResult(verdict, planningTracker.openTaskCount());
                emitMainActivity({
                    status: 'failed',
                    phase: 'empty_response',
                    label: apiKeyMissing ? '模型未配置 API Key' : '模型响应为空',
                    detail: apiKeyMissing
                        ? `模型 ${modelForReport} 对应的 provider 未配置 API Key`
                        : `模型 ${modelForReport} 未返回任何文本内容`,
                    source: 'Kernel Runtime',
                });
                return;
            }

            const openPlanTasksBeforeFinalize = planningTracker.openTaskCount();
            const verdict = this.deriveRunVerdict({
                wasCancelled,
                stopReason: streamStopReason,
                openPlanTasks: openPlanTasksBeforeFinalize,
                activeToolCount: activeToolIds.size,
                hasAssistantContent: Boolean(finalAssistantText.trim() || assistantBlocks.length > 0),
            });

            if (finalAssistantText.trim() || assistantBlocks.length > 0) {
                const finalAssistantMessageId = `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
                const finalAssistantBlocks =
                    assistantBlocks.length > 0
                        ? assistantBlocks
                        : [{ type: 'text' as const, text: finalAssistantText }];
                emit({
                    type: 'assistant',
                    parentToolUseId: null,
                    message: {
                        id: finalAssistantMessageId,
                        role: 'assistant',
                        model: input.model || '',
                        content: finalAssistantBlocks,
                        stopReason: verdict.stopReason,
                        durationMs: Date.now() - startedAt,
                        meta: null,
                        usage: totalTokens ? { totalTokens } : null,
                    },
                    timestamp: Date.now(),
                });

                await this.conversationLog.recordAssistantMessage({
                    id: finalAssistantMessageId,
                    sessionId,
                    content: finalAssistantText,
                    contentBlocks: finalAssistantBlocks,
                    totalTokens,
                });
            }

            if (wasCancelled) {
                const finalizeUpdate = planningTracker.finalize('cancelled');
                if (finalizeUpdate) emitPlanningProgressUpdate(finalizeUpdate);
                emitRunResult(verdict, openPlanTasksBeforeFinalize);
                closeLifecycle('cancelled', { reason: 'user_cancelled' });
                emitMainActivity({
                    status: 'cancelled',
                    phase: 'cancelled',
                    label: '任务已取消',
                    detail: '用户取消了本轮智能体执行',
                    source: '用户操作',
                });
                this.finishCancelledSession(sessionId, emit, true);
                return;
            }

            const finalizeOutcome =
                verdict.status === 'succeeded'
                    ? 'completed'
                    : verdict.status === 'incomplete'
                      ? 'incomplete'
                      : 'failed';
            const completeFinalize = planningTracker.finalize(finalizeOutcome);
            if (completeFinalize) emitPlanningProgressUpdate(completeFinalize);
            if (verdict.status === 'succeeded') {
                closeLifecycle('completed', {
                    assistantTextLength: finalAssistantText.length,
                    totalTokens,
                });
            } else {
                closeLifecycle('failed', {
                    errorMessage: `run_${verdict.status}:${verdict.stopReason}`,
                    assistantTextLength: finalAssistantText.length,
                    totalTokens,
                });
            }
            // 持久化 kernel session 的 token usage 到 agent_usage_costs，喂
            // super-factory dashboard (quality / cost) 跨重启的真实数据。
            // SDK 只回 totalTokens，没拆 input/output；按 90/10 估算（多数 chat
            // 场景输入远多于输出，作为占位足够支撑 dashboard 聚合）。失败仅 warn。
            if (this.observability && totalTokens && totalTokens > 0) {
                try {
                    const durationMs = Date.now() - startedAt;
                    const inputTokens = Math.round(totalTokens * 0.9);
                    const outputTokens = totalTokens - inputTokens;
                    await this.observability.recordUsageCost({
                        provider: 'kernel-sdk',
                        model: input.model || input.activeSession.runtimeOverrides.model || 'default',
                        inputTokens,
                        outputTokens,
                        cost: 0, // SDK 不回 cost，dashboard 按 token 维度仍有信号
                        currency: 'USD',
                        assetId: input.activeSession.agentId,
                        workspaceId: sessionId,
                        metadata: {
                            latencyMs: durationMs,
                            kernel: true,
                            messageId,
                        },
                    });
                } catch (error) {
                    this.logger.warn(
                        `[stream:${sessionId}] Failed to persist kernel usage cost: ${error instanceof Error ? error.message : String(error)}`,
                    );
                }
            }
            emitRunResult(verdict, openPlanTasksBeforeFinalize);
            emit({ type: 'status_change', status: null });
            emit({ type: 'cli_connected' });
            emitMainActivity({
                status: verdict.status === 'succeeded' ? 'completed' : 'failed',
                phase: verdict.status === 'succeeded' ? 'completed' : verdict.status,
                label: verdict.status === 'succeeded' ? '任务完成' : '本轮未完成',
                detail:
                    verdict.status === 'succeeded'
                        ? finalAssistantText.trim()
                            ? '主智能体已完成回复并更新会话状态'
                            : '主智能体本轮执行已结束'
                        : this.runVerdictMessage(verdict),
                source: 'Kernel Runtime',
            });
        } catch (error) {
            if (this.runtimeState.isCancelled(sessionId)) {
                const verdict: RunVerdict = {
                    status: 'cancelled',
                    stopReason: 'user_cancelled',
                    retryable: false,
                };
                const openPlanTasks = planningTracker.openTaskCount();
                const finalizeUpdate = planningTracker.finalize('cancelled');
                if (finalizeUpdate) emitPlanningProgressUpdate(finalizeUpdate);
                emitRunResult(verdict, openPlanTasks);
                closeLifecycle('cancelled', { reason: 'user_cancelled' });
                emitMainActivity({
                    status: 'cancelled',
                    phase: 'cancelled',
                    label: '任务已取消',
                    detail: '用户取消了本轮智能体执行',
                    source: '用户操作',
                });
                this.finishCancelledSession(sessionId, emit, true);
                return;
            }

            this.logger.error(`Error streaming response for session ${sessionId}: ${error}`);
            const verdict = this.failedVerdictFromError(error);
            const openPlanTasks = planningTracker.openTaskCount();
            const failFinalize = planningTracker.finalize('failed');
            if (failFinalize) emitPlanningProgressUpdate(failFinalize);
            closeLifecycle('failed', {
                errorMessage: error instanceof Error ? error.message : String(error),
            });
            await persistFailedAssistantTurn(error, verdict);
            emitRunResult(verdict, openPlanTasks);
            emitMainActivity({
                status: 'failed',
                phase: 'failed',
                label: '任务失败',
                detail: error instanceof Error ? error.message : String(error),
                source: 'Kernel Runtime',
            });
            emit({
                type: 'error',
                message: error instanceof Error ? error.message : String(error),
            });
            emit({ type: 'status_change', status: null });
        } finally {
            input.onCleanup?.();
            activeSession.nativeConfirmedToolKeys.clear();
        }
    }

    private deriveRunVerdict(input: {
        wasCancelled: boolean;
        stopReason: RunStopReason | null;
        openPlanTasks: number;
        activeToolCount: number;
        hasAssistantContent: boolean;
    }): RunVerdict {
        if (input.wasCancelled) {
            return { status: 'cancelled', stopReason: 'user_cancelled', retryable: false };
        }
        if (!input.hasAssistantContent) {
            return { status: 'failed', stopReason: 'empty_response', retryable: false };
        }

        const stopReason = input.stopReason ?? 'sdk_stream_ended_without_stop_reason';
        if (input.openPlanTasks > 0 || input.activeToolCount > 0) {
            return {
                status: 'incomplete',
                stopReason,
                retryable: RETRYABLE_STOP_REASONS.has(stopReason),
            };
        }
        if (!input.stopReason) {
            return {
                status: 'incomplete',
                stopReason,
                retryable: RETRYABLE_STOP_REASONS.has(stopReason),
            };
        }
        if (stopReason === 'end_turn') {
            return { status: 'succeeded', stopReason, retryable: false };
        }
        if (stopReason === 'user_cancelled') {
            return { status: 'cancelled', stopReason, retryable: false };
        }
        if (
            stopReason === 'empty_response' ||
            stopReason === 'event_stream_stalled' ||
            stopReason === 'tool_circuit_open'
        ) {
            return { status: 'failed', stopReason, retryable: false };
        }
        return {
            status: 'incomplete',
            stopReason,
            retryable: RETRYABLE_STOP_REASONS.has(stopReason),
        };
    }

    private maxToolRoundAutoContinueLimit(
        overrides: Pick<SessionRuntimeOverrides, 'continuationEnabled' | 'maxContinuationTurns'> | null | undefined,
    ): number {
        if (overrides?.continuationEnabled === false) return 0;
        const configured = overrides?.maxContinuationTurns;
        if (typeof configured === 'number' && Number.isFinite(configured) && configured > 0) {
            return Math.min(DEFAULT_MAX_TOOL_ROUND_AUTO_CONTINUATIONS, Math.floor(configured));
        }
        return DEFAULT_MAX_TOOL_ROUND_AUTO_CONTINUATIONS;
    }

    private shouldAutoContinueAfterMaxToolRounds(input: {
        stopReason: RunStopReason | null;
        activeToolCount: number;
        used: number;
        limit: number;
        wasCancelled: boolean;
    }): boolean {
        return (
            input.stopReason === 'max_tool_rounds' &&
            input.activeToolCount === 0 &&
            input.used < input.limit &&
            !input.wasCancelled
        );
    }

    private maxToolRoundContinuationPrompt(attempt: number, maxAttempts: number): string {
        return [
            'Continue the previous user task from the current workspace and session state.',
            `The prior SDK run stopped because it reached the tool-round limit; this is automatic continuation ${attempt}/${maxAttempts}.`,
            'First inspect what is already complete, then do only the remaining work. Do not repeat completed file writes or duplicate generated data.',
            'For large mechanical changes, prefer one script or a batch edit over many small read/write cycles.',
            'Use only the current workspace, or temporary paths explicitly allowed by the available tools. Do not write scratch files to arbitrary absolute paths.',
            'Keep all user-facing prose in the same language as the latest real user message, and finish with a concise status once the task is complete.',
        ].join('\n');
    }

    private failedVerdictFromError(error: unknown): RunVerdict {
        const message = error instanceof Error ? error.message : String(error);
        const stopReason = this.normalizeRunStopReason(message) ?? 'unknown';
        const failureReason =
            stopReason === 'event_stream_stalled' || stopReason === 'tool_circuit_open' ? stopReason : 'unknown';
        return {
            status: 'failed',
            stopReason: failureReason,
            retryable: false,
        };
    }

    private runVerdictMessage(verdict: RunVerdict): string {
        if (verdict.status === 'succeeded') return '任务已完成';
        if (verdict.stopReason === 'max_tokens' || verdict.stopReason === 'context_limit') {
            return '本轮输出或任务被截断，可继续完成未收尾的步骤';
        }
        if (verdict.stopReason === 'max_tool_rounds' || verdict.stopReason === 'continuation_exhausted') {
            return '本轮达到续跑或工具轮次上限，任务尚未确认完成';
        }
        if (verdict.stopReason === 'sdk_stream_ended_without_stop_reason') {
            return '运行提前结束，未收到明确完成信号';
        }
        if (verdict.stopReason === 'event_stream_stalled') return '运行事件流超时停滞';
        if (verdict.stopReason === 'tool_circuit_open') return '工具连续失败，本轮已中止';
        if (verdict.stopReason === 'empty_response') return '模型未返回有效响应';
        if (verdict.stopReason === 'user_cancelled') return '用户取消了本轮任务';
        return verdict.status === 'incomplete' ? '本轮未确认完成' : '本轮执行失败';
    }

    private extractRunStopReason(
        event: AgentEvent,
        data: Record<string, unknown>,
        normalizedEvent: Record<string, unknown> | null,
    ): RunStopReason | null {
        const eventRecord = event as unknown as Record<string, unknown>;
        const terminalEvent =
            event.type === 'message_end' ||
            event.type === 'turn_end' ||
            event.type === 'done' ||
            event.type === 'error' ||
            event.type === 'session_end';
        const candidates = [
            ...this.stopReasonCandidates(eventRecord, terminalEvent),
            ...this.stopReasonCandidates(data, terminalEvent),
            ...this.stopReasonCandidates(normalizedEvent, terminalEvent),
        ];
        for (const candidate of candidates) {
            const normalized = this.normalizeRunStopReason(candidate);
            if (normalized) return normalized;
        }
        if (event.type === 'error') {
            const errorCandidates = [
                eventRecord.message,
                eventRecord.error,
                data.message,
                data.error,
                normalizedEvent?.message,
                normalizedEvent?.error,
            ];
            for (const candidate of errorCandidates) {
                const normalized = this.normalizeRunStopReason(candidate);
                if (normalized) return normalized;
            }
        }
        return null;
    }

    private stopReasonCandidates(record: Record<string, unknown> | null | undefined, includeReason: boolean): unknown[] {
        if (!record) return [];
        const records = [
            record,
            this.recordValue(record.message),
            this.recordValue(record.response),
            this.recordValue(record.result),
            this.recordValue(record.output),
            this.recordValue(record.event),
            this.recordValue(record.delta),
        ].filter(Boolean) as Record<string, unknown>[];
        return records.flatMap(item => [
            item.stopReason,
            item.stop_reason,
            item.finishReason,
            item.finish_reason,
            ...(includeReason ? [item.reason] : []),
        ]);
    }

    private normalizeRunStopReason(value: unknown): RunStopReason | null {
        if (typeof value !== 'string') return null;
        const raw = value.trim().toLowerCase();
        if (!raw) return null;
        const compact = raw.replace(/[\s-]+/g, '_');
        if (
            compact === 'end_turn' ||
            compact === 'stop' ||
            compact === 'done' ||
            compact === 'complete' ||
            compact === 'completed' ||
            compact === 'success'
        ) {
            return 'end_turn';
        }
        if (compact === 'max_tokens' || compact === 'length' || compact === 'max_output_tokens') return 'max_tokens';
        if (compact === 'context_limit' || compact === 'context_length_exceeded') return 'context_limit';
        if (compact === 'max_execution_time' || compact === 'timeout' || compact === 'timed_out') {
            return 'max_execution_time';
        }
        if (
            compact === 'max_tool_rounds' ||
            compact === 'tool_round_limit' ||
            compact.includes('max_tool_rounds') ||
            compact.includes('tool_round_limit')
        ) {
            return 'max_tool_rounds';
        }
        if (compact === 'continuation_exhausted' || compact === 'max_continuation_turns') {
            return 'continuation_exhausted';
        }
        if (compact === 'event_stream_stalled' || compact.includes('event_stream_stalled')) {
            return 'event_stream_stalled';
        }
        if (compact === 'tool_circuit_open' || compact.includes('tool_circuit_open')) return 'tool_circuit_open';
        if (compact === 'empty_response' || compact === 'empty_model_response') return 'empty_response';
        if (compact === 'user_cancelled' || compact === 'cancelled' || compact === 'canceled') return 'user_cancelled';
        if (compact === 'sdk_stream_ended_without_stop_reason') return 'sdk_stream_ended_without_stop_reason';
        return 'unknown';
    }

    private extractContextUsedPercent(event: AgentEvent, data: Record<string, unknown>): number | undefined {
        const eventRecord = event as unknown as Record<string, unknown>;
        return (
            this.numberValue(eventRecord.contextUsedPercent) ??
            this.numberValue(eventRecord.context_used_percent) ??
            this.numberValue(data.contextUsedPercent) ??
            this.numberValue(data.context_used_percent)
        );
    }

    private recordRunOutcomeMetrics(
        verdict: RunVerdict,
        durationMs: number,
        totalTokens: number | undefined,
        toolCalls: number,
        contextUsedPercent: number | undefined,
    ): void {
        const labels = { status: verdict.status, stopReason: verdict.stopReason };
        this.metrics?.incCounter('kernel_run_outcome_total', labels);
        this.metrics?.observeHistogram('kernel_run_duration_seconds', durationMs / 1_000, labels);
        this.metrics?.observeHistogram('kernel_run_tool_calls', toolCalls, labels);
        if (totalTokens !== undefined) {
            this.metrics?.observeHistogram('kernel_run_total_tokens', totalTokens, labels);
        }
        if (contextUsedPercent !== undefined) {
            this.metrics?.setGauge('kernel_run_context_used_percent', contextUsedPercent, labels);
        }
    }

    private async createEventStream(
        input: KernelMessageRunInput,
        options?: EventStreamOptions,
    ): Promise<AsyncIterator<AgentEvent>> {
        const content = options?.content ?? input.content;
        const attachments = this.toAttachments(options?.images ?? input.images);
        const history = options?.usePersistedHistory === false ? [] : await this.resolveRuntimeHistory(input);
        const historySummary = this.summarizeRuntimeHistory(history);
        this.logger.log(
            `Calling session.stream for session ${input.sessionId}, hasAttachments=${attachments.length > 0}, historyMessages=${history.length}`,
        );
        this.logger.log(
            `[kernel.run.context] sessionId=${input.sessionId} historyMessages=${history.length} estimatedTokens=${historySummary.estimatedTokens} toolOutputBytes=${historySummary.toolOutputBytes}`,
        );
        const stream =
            attachments.length > 0
                ? history.length > 0
                    ? await input.activeSession.session.streamWithAttachments(content, attachments, history)
                    : await input.activeSession.session.streamWithAttachments(content, attachments)
                : history.length > 0
                  ? await input.activeSession.session.stream(content, history)
                  : await input.activeSession.session.stream(content);
        this.logger.log(`session.stream returned for session ${input.sessionId}`);
        return stream as AsyncIterator<AgentEvent>;
    }

    private summarizeRuntimeHistory(history: KernelRuntimeHistoryMessage[]): {
        estimatedTokens: number;
        toolOutputBytes: number;
    } {
        let chars = 0;
        let toolOutputBytes = 0;
        const visit = (value: unknown, inToolResult = false) => {
            if (typeof value === 'string') {
                chars += value.length;
                if (inToolResult) toolOutputBytes += Buffer.byteLength(value, 'utf8');
                return;
            }
            if (!value || typeof value !== 'object') return;
            if (Array.isArray(value)) {
                for (const item of value) visit(item, inToolResult);
                return;
            }
            const record = value as Record<string, unknown>;
            const isToolResult = inToolResult || record.type === 'tool_result';
            for (const item of Object.values(record)) visit(item, isToolResult);
        };
        visit(history);
        return {
            estimatedTokens: Math.ceil(chars / 4),
            toolOutputBytes,
        };
    }

    private async resolveRuntimeHistory(input: KernelMessageRunInput): Promise<KernelRuntimeHistoryMessage[]> {
        try {
            if (input.activeSession.session.history().length > 0) return [];
        } catch (error) {
            this.logger.warn(
                `Failed to read SDK session history for ${input.sessionId}; falling back to persisted history: ${
                    error instanceof Error ? error.message : String(error)
                }`,
            );
        }
        return this.conversationLog.listRuntimeHistory(input.sessionId, {
            excludeMessageId: input.messageId,
        });
    }

    private finishCancelledSession(sessionId: string, emit: (message: unknown) => void, clearFlag: boolean): void {
        if (clearFlag) {
            this.runtimeState.clearCancelled(sessionId);
        }
        emit({ type: 'status_change', status: null });
        emit({ type: 'cancelled', cancelled: true });
        emit({ type: 'cli_connected' });
    }

    private toAttachments(images?: { mediaType: string; data: string }[]): AttachmentObject[] {
        if (!images?.length) {
            return [];
        }
        return images.map(image => ({
            mediaType: image.mediaType,
            data: Buffer.from(image.data.replace(/^data:[^;]+;base64,/, ''), 'base64'),
        }));
    }

    private emitMainAgentActivity(
        emit: (message: unknown) => void,
        activity: {
            id: string;
            runId: string;
            status: 'running' | 'waiting' | 'completed' | 'failed' | 'cancelled';
            phase: string;
            label: string;
            detail?: string;
            source?: string;
            elapsedMs: number;
            activeToolCount: number;
        },
    ): void {
        emit({
            type: 'stream_event',
            event: {
                type: 'main_agent_activity',
                timestamp: Date.now(),
                ...activity,
            },
        });
    }

    private emitToolActivity(
        emit: (message: unknown) => void,
        activity: {
            id: string;
            runId: string;
            status: 'running' | 'waiting' | 'completed' | 'failed';
            phase: string;
            toolUseId?: string;
            toolName?: string;
            label: string;
            detail?: string;
            elapsedMs?: number;
        },
    ): void {
        emit({
            type: 'stream_event',
            event: {
                type: 'tool_activity',
                timestamp: Date.now(),
                source: '工具运行器',
                ...activity,
            },
        });
    }

    private withBoundedToolOutput(
        event: Record<string, unknown> | null,
        outputLimits: Map<string, ToolOutputLimitState>,
        latestToolIdByName: Map<string, string>,
    ): Record<string, unknown> | null {
        if (!event) return null;

        if (event.type === 'tool_output_delta' && typeof event.delta === 'string') {
            const toolName = this.stringValue(event.toolName);
            const toolId = this.stringValue(event.toolUseId) || latestToolIdByName.get(toolName) || toolName || 'tool';
            const delta = this.takeToolOutputChunk(toolId, event.delta, outputLimits);
            if (delta === null) return null;
            return delta === event.delta ? event : { ...event, delta, truncated: true };
        }

        if (event.type === 'tool_end' && typeof event.output === 'string') {
            const toolName = this.stringValue(event.toolName);
            const toolId = this.stringValue(event.toolId) || latestToolIdByName.get(toolName) || toolName || 'tool';
            const bounded = this.truncateToolOutput(event.output);
            outputLimits.set(toolId, {
                bytes: Math.min(bounded.originalBytes, MAX_CLIENT_TOOL_OUTPUT_BYTES),
                truncated: bounded.truncated,
            });
            return bounded.truncated
                ? {
                      ...event,
                      output: bounded.text,
                      outputTruncated: true,
                      originalOutputBytes: bounded.originalBytes,
                  }
                : event;
        }

        return event;
    }

    private takeToolOutputChunk(
        toolId: string,
        delta: string,
        outputLimits: Map<string, ToolOutputLimitState>,
    ): string | null {
        const state = outputLimits.get(toolId) ?? { bytes: 0, truncated: false };
        const remaining = MAX_CLIENT_TOOL_OUTPUT_BYTES - state.bytes;
        if (remaining <= 0) {
            if (state.truncated) return null;
            state.truncated = true;
            outputLimits.set(toolId, state);
            return TOOL_OUTPUT_TRUNCATION_NOTICE;
        }

        const deltaBytes = Buffer.byteLength(delta, 'utf8');
        if (deltaBytes <= remaining) {
            state.bytes += deltaBytes;
            outputLimits.set(toolId, state);
            return delta;
        }

        const clipped = Buffer.from(delta, 'utf8').subarray(0, remaining).toString('utf8');
        state.bytes = MAX_CLIENT_TOOL_OUTPUT_BYTES;
        state.truncated = true;
        outputLimits.set(toolId, state);
        return `${clipped}${TOOL_OUTPUT_TRUNCATION_NOTICE}`;
    }

    private truncateToolOutput(text: string): { text: string; truncated: boolean; originalBytes: number } {
        const originalBytes = Buffer.byteLength(text, 'utf8');
        if (originalBytes <= MAX_CLIENT_TOOL_OUTPUT_BYTES) {
            return { text, truncated: false, originalBytes };
        }
        const clipped = Buffer.from(text, 'utf8').subarray(0, MAX_CLIENT_TOOL_OUTPUT_BYTES).toString('utf8');
        return {
            text: `${clipped}${TOOL_OUTPUT_TRUNCATION_NOTICE}`,
            truncated: true,
            originalBytes,
        };
    }

    private stringValue(value: unknown): string {
        return typeof value === 'string' && value.trim() ? value.trim() : '';
    }

    private recordValue(value: unknown): Record<string, unknown> | undefined {
        return value && typeof value === 'object' && !Array.isArray(value)
            ? (value as Record<string, unknown>)
            : undefined;
    }

    private numberValue(value: unknown): number | undefined {
        if (typeof value === 'number' && Number.isFinite(value)) return value;
        if (typeof value === 'string' && value.trim()) {
            const parsed = Number(value);
            if (Number.isFinite(parsed)) return parsed;
        }
        return undefined;
    }

    private extractTotalTokens(event: AgentEvent, data: Record<string, unknown>): number | undefined {
        return (
            this.numberValue(event.totalTokens) ??
            this.numberValue(data.totalTokens) ??
            this.numberValue(data.total_tokens)
        );
    }

    private extractConfirmationDetails(event: AgentEvent): {
        toolId?: string;
        toolName?: string;
        toolInput?: Record<string, unknown>;
    } {
        const data = parseAgentEventData(event);
        const toolInput =
            data.args && typeof data.args === 'object' && !Array.isArray(data.args)
                ? (data.args as Record<string, unknown>)
                : undefined;
        return {
            toolId:
                typeof data.toolId === 'string'
                    ? data.toolId
                    : typeof event.toolId === 'string'
                      ? event.toolId
                      : undefined,
            toolName:
                typeof data.toolName === 'string'
                    ? data.toolName
                    : typeof event.toolName === 'string'
                      ? event.toolName
                      : undefined,
            toolInput,
        };
    }

    private previewValue(value: unknown, limit = 180): string | undefined {
        if (value == null) return undefined;
        const text =
            typeof value === 'string'
                ? value
                : (() => {
                      try {
                          return JSON.stringify(value);
                      } catch {
                          return String(value);
                      }
                  })();
        const normalized = text.replace(/\s+/g, ' ').trim();
        if (!normalized) return undefined;
        return normalized.length > limit ? `${normalized.slice(0, limit)}...` : normalized;
    }

    private normalizeToolInput(input: unknown): Record<string, unknown> {
        if (!input || typeof input !== 'object' || Array.isArray(input)) {
            return {};
        }
        return input as Record<string, unknown>;
    }
}
