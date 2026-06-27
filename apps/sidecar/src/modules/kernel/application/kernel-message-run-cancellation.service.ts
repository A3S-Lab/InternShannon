import { Injectable, Logger } from '@nestjs/common';
import { KernelSessionRuntimeStateService } from './kernel-session-runtime-state.service';

export interface KernelMessageRunCancellationInput {
    sessionId: string;
    emit: (message: unknown) => void;
}

export interface KernelSubagentTaskCancellationInput {
    sessionId: string;
    taskId: string;
    emit?: (message: unknown) => void;
}

export interface KernelRunCancellationInput {
    sessionId: string;
    runId: string;
    emit?: (message: unknown) => void;
}

@Injectable()
export class KernelMessageRunCancellationService {
    private readonly logger = new Logger(KernelMessageRunCancellationService.name);

    constructor(private readonly runtimeState: KernelSessionRuntimeStateService) {}

    async cancel(input: KernelMessageRunCancellationInput): Promise<void> {
        this.runtimeState.markCancelled(input.sessionId);

        const activeSession = this.runtimeState.getActiveSession(input.sessionId);
        const cancelled = activeSession ? activeSession.session.cancel() : false;

        input.emit({
            type: 'stream_event',
            event: {
                type: 'main_agent_activity',
                id: `main:${Date.now()}:cancel_requested`,
                runId: input.sessionId,
                status: 'cancelled',
                phase: 'cancel_requested',
                label: '已请求取消',
                detail: cancelled ? '取消信号已发送给当前运行时' : '当前没有可取消的运行时任务',
                source: '用户操作',
                activeToolCount: 0,
                timestamp: Date.now(),
            },
        });
        input.emit({ type: 'status_change', status: null });
        input.emit({ type: 'cancelled', cancelled });
        input.emit({ type: 'cli_connected' });
    }

    /**
     * Cancel a single in-flight subagent task without disturbing the parent
     * session. Powered by `Session.cancelSubagentTask(taskId)` from
     * `@a3s-lab/code` 3.2.x — the SDK looks up the task by id and only fires
     * its cancellation token when the task is still running. Returns:
     *  - `true` when the SDK fired a cancel token,
     *  - `false` when the id is unknown, the task already finished, or the
     *    session is no longer active (caller can surface "task not cancellable").
     *
     * This is the canonical way to abort a long-running delegated operation
     * (e.g. an asset diagnose worker, a market-publish helper task) from the
     * BFF/admin UI. It does **not** mark the parent session as cancelled, so
     * subsequent user messages continue to work.
     */
    async cancelSubagentTask(input: KernelSubagentTaskCancellationInput): Promise<boolean> {
        const activeSession = this.runtimeState.getActiveSession(input.sessionId);
        if (!activeSession) return false;
        let cancelled = false;
        try {
            cancelled = await activeSession.session.cancelSubagentTask(input.taskId);
        } catch (error) {
            this.logger.warn(
                `cancelSubagentTask(${input.taskId}) failed for session ${input.sessionId}: ${
                    error instanceof Error ? error.message : String(error)
                }`,
            );
            return false;
        }
        input.emit?.({
            type: 'stream_event',
            event: {
                type: 'subagent_task_cancelled',
                sessionId: input.sessionId,
                taskId: input.taskId,
                cancelled,
                timestamp: Date.now(),
            },
        });
        return cancelled;
    }

    /**
     * Cancel a specific SDK run without disturbing a newer run that may have
     * started on the same session. This maps directly to
     * `Session.cancelRun(runId)` from `@a3s-lab/code` 3.2.x.
     */
    async cancelRun(input: KernelRunCancellationInput): Promise<boolean> {
        const activeSession = this.runtimeState.getActiveSession(input.sessionId);
        if (!activeSession) return false;
        let cancelled = false;
        try {
            cancelled = await activeSession.session.cancelRun(input.runId);
        } catch (error) {
            this.logger.warn(
                `cancelRun(${input.runId}) failed for session ${input.sessionId}: ${
                    error instanceof Error ? error.message : String(error)
                }`,
            );
            return false;
        }
        input.emit?.({
            type: 'stream_event',
            event: {
                type: 'run_cancelled',
                sessionId: input.sessionId,
                runId: input.runId,
                cancelled,
                timestamp: Date.now(),
            },
        });
        return cancelled;
    }
}
