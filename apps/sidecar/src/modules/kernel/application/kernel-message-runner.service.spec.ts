import { KernelMessageRunnerService } from './kernel-message-runner.service';

type RunnerInternals = {
    normalizeRunStopReason(value: unknown): string | null;
    extractRunStopReason(
        event: { type: string; [key: string]: unknown },
        data: Record<string, unknown>,
        normalizedEvent: Record<string, unknown> | null,
    ): string | null;
    deriveRunVerdict(input: {
        wasCancelled: boolean;
        stopReason: string | null;
        openPlanTasks: number;
        activeToolCount: number;
        hasAssistantContent: boolean;
        lastBlockWasToolResult?: boolean;
    }): { status: string; stopReason: string; retryable: boolean };
    runVerdictMessage(verdict: {
        status: string;
        stopReason: string;
        retryable: boolean;
    }): string;
    maxToolRoundAutoContinueLimit(overrides?: {
        continuationEnabled?: boolean;
        maxContinuationTurns?: number;
    }): number;
    shouldAutoContinueAfterMaxToolRounds(input: {
        stopReason: string | null;
        activeToolCount: number;
        used: number;
        limit: number;
        wasCancelled: boolean;
    }): boolean;
    maxToolRoundContinuationPrompt(attempt: number, maxAttempts: number): string;
    shouldAutoContinueAfterSdkStreamEnd(input: {
        stopReason: string | null;
        activeToolCount: number;
        openPlanTasks: number;
        lastBlockWasToolResult: boolean;
        used: number;
        limit: number;
        wasCancelled: boolean;
    }): boolean;
    sdkStreamContinuationPrompt(attempt: number, maxAttempts: number): string;
    shouldAutoContinueAfterToolInputStreamStall(input: {
        stopReason: string | null;
        activeToolCount: number;
        discardedToolCount: number;
        used: number;
        limit: number;
        wasCancelled: boolean;
    }): boolean;
    streamStallHardMsForPhase(
        phase: 'model_stream' | 'tool_input_streaming' | 'tool_exec',
        thresholds: { modelStreamMs: number; toolInputStreamMs: number; toolExecMs: number },
    ): number;
    streamStallStopReasonForPhase(phase: 'model_stream' | 'tool_input_streaming' | 'tool_exec'): string;
    toolInputStreamStallContinuationPrompt(attempt: number, maxAttempts: number, discardedTools?: string[]): string;
    appendFallbackAssistantTextBlock(blocks: Array<Record<string, unknown>>, text: string): void;
};

function createRunner(): RunnerInternals {
    return new KernelMessageRunnerService(
        null as never,
        null as never,
        null as never,
        null as never,
    ) as unknown as RunnerInternals;
}

function iteratorFromEvents(events: Array<Record<string, unknown>>, stallAfterEvents = false): AsyncIterator<unknown> {
    let index = 0;
    return {
        next: () => {
            if (index < events.length) {
                const value = events[index];
                index += 1;
                return Promise.resolve({ value, done: false });
            }
            if (stallAfterEvents) return new Promise(() => undefined);
            return Promise.resolve({ value: undefined, done: true });
        },
    };
}

describe('KernelMessageRunnerService run stop reasons', () => {
    it('maps SDK max tool rounds error messages to max_tool_rounds', () => {
        const runner = createRunner();

        expect(runner.normalizeRunStopReason('Max tool rounds (12) exceeded')).toBe('max_tool_rounds');
        expect(
            runner.extractRunStopReason({ type: 'error', message: 'Max tool rounds (12) exceeded' }, {}, null),
        ).toBe('max_tool_rounds');
    });

    it('does not treat ordinary terminal message text as a stop reason', () => {
        const runner = createRunner();

        expect(
            runner.extractRunStopReason(
                {
                    type: 'message_end',
                    message: 'I am still appending styles to the file.',
                },
                {},
                null,
            ),
        ).toBeNull();
    });

    it('gets no completion signal when the SDK closes a terminal event without a stop reason', () => {
        const runner = createRunner();

        expect(
            runner.extractRunStopReason(
                {
                    type: 'turn_end',
                    totalTokens: 20078,
                },
                {
                    total_tokens: 20078,
                },
                {
                    type: 'turn_end',
                    totalTokens: 20078,
                },
            ),
        ).toBeNull();
    });

    it('treats terminal events with an explicit completion reason as successful', () => {
        const runner = createRunner();

        const stopReason = runner.extractRunStopReason(
            {
                type: 'turn_end',
                totalTokens: 20078,
            },
            {
                reason: 'complete',
                total_tokens: 20078,
            },
            {
                type: 'turn_end',
                totalTokens: 20078,
            },
        );

        expect(stopReason).toBe('end_turn');
        expect(
            runner.deriveRunVerdict({
                wasCancelled: false,
                stopReason,
                openPlanTasks: 0,
                activeToolCount: 0,
                hasAssistantContent: true,
            }),
        ).toEqual({
            status: 'succeeded',
            stopReason: 'end_turn',
            retryable: false,
        });
    });

    it('infers successful completion for bare stream end with final assistant text', () => {
        const runner = createRunner();

        const verdict = runner.deriveRunVerdict({
            wasCancelled: false,
            stopReason: null,
            openPlanTasks: 0,
            activeToolCount: 0,
            hasAssistantContent: true,
            lastBlockWasToolResult: false,
        });

        expect(verdict).toEqual({
            status: 'succeeded',
            stopReason: 'end_turn',
            retryable: false,
        });
        expect(runner.runVerdictMessage(verdict)).toBe('任务已完成');
    });

    it('keeps a bare stream end after a tool result as retryable incomplete', () => {
        const runner = createRunner();

        const verdict = runner.deriveRunVerdict({
            wasCancelled: false,
            stopReason: null,
            openPlanTasks: 0,
            activeToolCount: 0,
            hasAssistantContent: true,
            lastBlockWasToolResult: true,
        });

        expect(verdict).toEqual({
            status: 'incomplete',
            stopReason: 'sdk_stream_ended_without_stop_reason',
            retryable: true,
        });
        expect(runner.runVerdictMessage(verdict)).toBe('运行提前结束，未收到明确完成信号');
    });

    it('keeps max tool rounds visible as an incomplete retryable verdict', () => {
        const runner = createRunner();

        const verdict = runner.deriveRunVerdict({
            wasCancelled: false,
            stopReason: 'max_tool_rounds',
            openPlanTasks: 0,
            activeToolCount: 0,
            hasAssistantContent: true,
        });

        expect(verdict).toEqual({
            status: 'incomplete',
            stopReason: 'max_tool_rounds',
            retryable: true,
        });
        expect(runner.runVerdictMessage(verdict)).toBe('本轮达到续跑或工具轮次上限，任务尚未确认完成');
    });

    it('allows one host-level auto continuation for max tool rounds by default', () => {
        const runner = createRunner();

        const limit = runner.maxToolRoundAutoContinueLimit({});

        expect(limit).toBe(1);
        expect(
            runner.shouldAutoContinueAfterMaxToolRounds({
                stopReason: 'max_tool_rounds',
                activeToolCount: 0,
                used: 0,
                limit,
                wasCancelled: false,
            }),
        ).toBe(true);
    });

    it('does not auto continue max tool rounds when continuation is disabled or unsafe', () => {
        const runner = createRunner();

        expect(runner.maxToolRoundAutoContinueLimit({ continuationEnabled: false })).toBe(0);
        expect(
            runner.shouldAutoContinueAfterMaxToolRounds({
                stopReason: 'max_tool_rounds',
                activeToolCount: 1,
                used: 0,
                limit: 1,
                wasCancelled: false,
            }),
        ).toBe(false);
        expect(
            runner.shouldAutoContinueAfterMaxToolRounds({
                stopReason: 'max_tool_rounds',
                activeToolCount: 0,
                used: 1,
                limit: 1,
                wasCancelled: false,
            }),
        ).toBe(false);
    });

    it('uses a dedicated stall reason and threshold for tool input streaming', () => {
        const runner = createRunner();
        const thresholds = {
            modelStreamMs: 300_000,
            toolInputStreamMs: 90_000,
            toolExecMs: 600_000,
        };

        expect(runner.streamStallStopReasonForPhase('model_stream')).toBe('event_stream_stalled');
        expect(runner.streamStallStopReasonForPhase('tool_exec')).toBe('event_stream_stalled');
        expect(runner.streamStallStopReasonForPhase('tool_input_streaming')).toBe('tool_input_stream_stalled');
        expect(runner.streamStallHardMsForPhase('model_stream', thresholds)).toBe(300_000);
        expect(runner.streamStallHardMsForPhase('tool_input_streaming', thresholds)).toBe(90_000);
        expect(runner.streamStallHardMsForPhase('tool_exec', thresholds)).toBe(600_000);
        expect(runner.normalizeRunStopReason('tool_input_stream_stalled: no SDK events')).toBe(
            'tool_input_stream_stalled',
        );
    });

    it('auto continues tool input stream stalls only after discarding unfinished tools', () => {
        const runner = createRunner();

        const readyToContinue = {
            stopReason: 'tool_input_stream_stalled',
            activeToolCount: 0,
            discardedToolCount: 1,
            used: 0,
            limit: 1,
            wasCancelled: false,
        };

        expect(runner.shouldAutoContinueAfterToolInputStreamStall(readyToContinue)).toBe(true);
        expect(
            runner.shouldAutoContinueAfterToolInputStreamStall({
                ...readyToContinue,
                discardedToolCount: 0,
            }),
        ).toBe(false);
        expect(
            runner.shouldAutoContinueAfterToolInputStreamStall({
                ...readyToContinue,
                activeToolCount: 1,
            }),
        ).toBe(false);
        expect(
            runner.shouldAutoContinueAfterToolInputStreamStall({
                ...readyToContinue,
                used: 1,
            }),
        ).toBe(false);
        expect(
            runner.shouldAutoContinueAfterToolInputStreamStall({
                ...readyToContinue,
                wasCancelled: true,
            }),
        ).toBe(false);
    });

    it('auto continues a bare SDK stream end only after a tool result', () => {
        const runner = createRunner();

        const readyToContinue = {
            stopReason: null,
            activeToolCount: 0,
            openPlanTasks: 0,
            lastBlockWasToolResult: true,
            used: 0,
            limit: 1,
            wasCancelled: false,
        };

        expect(runner.shouldAutoContinueAfterSdkStreamEnd(readyToContinue)).toBe(true);
        expect(
            runner.shouldAutoContinueAfterSdkStreamEnd({
                ...readyToContinue,
                lastBlockWasToolResult: false,
            }),
        ).toBe(false);
        expect(
            runner.shouldAutoContinueAfterSdkStreamEnd({
                ...readyToContinue,
                activeToolCount: 1,
            }),
        ).toBe(false);
        expect(
            runner.shouldAutoContinueAfterSdkStreamEnd({
                ...readyToContinue,
                openPlanTasks: 1,
            }),
        ).toBe(false);
        expect(
            runner.shouldAutoContinueAfterSdkStreamEnd({
                ...readyToContinue,
                used: 1,
            }),
        ).toBe(false);
        expect(
            runner.shouldAutoContinueAfterSdkStreamEnd({
                ...readyToContinue,
                wasCancelled: true,
            }),
        ).toBe(false);
    });

    it('prompts max tool round continuation to inspect before continuing', () => {
        const runner = createRunner();

        const prompt = runner.maxToolRoundContinuationPrompt(1, 1);

        expect(prompt).toContain('First inspect what is already complete');
        expect(prompt).toContain('batch edit');
        expect(prompt).toContain('100 KB');
        expect(prompt).toContain('one large inline write argument');
        expect(prompt).toContain('A single huge write is not a batch edit');
        expect(prompt).toContain('Do not write scratch files to arbitrary absolute paths');
    });

    it('prompts SDK stream continuation to avoid repeating completed tool calls', () => {
        const runner = createRunner();

        const prompt = runner.sdkStreamContinuationPrompt(1, 1);

        expect(prompt).toContain('ended after a tool result');
        expect(prompt).toContain('Do not repeat completed tool calls');
        expect(prompt).toContain('current workspace');
    });

    it('prompts tool input stall continuation without write-tool special casing', () => {
        const runner = createRunner();

        const prompt = runner.toolInputStreamStallContinuationPrompt(1, 1, ['bash']);

        expect(prompt).toContain('generating tool arguments before any tool executed');
        expect(prompt).toContain('bash');
        expect(prompt).toContain('100 KB');
        expect(prompt).toContain('A single huge write is not a batch edit');
        expect(prompt).not.toContain("tool 'write'");
    });

    it('appends history fallback text after a tool result so final verdict can succeed', () => {
        const runner = createRunner();
        const blocks: Array<Record<string, unknown>> = [
            { type: 'tool_use', id: 'toolu_1', name: 'read', input: {} },
            { type: 'tool_result', toolUseId: 'toolu_1', content: 'file contents' },
        ];

        runner.appendFallbackAssistantTextBlock(blocks, ' 已完成总结。 ');

        expect(blocks[blocks.length - 1]).toEqual({ type: 'text', text: '已完成总结。' });
        expect(
            runner.deriveRunVerdict({
                wasCancelled: false,
                stopReason: null,
                openPlanTasks: 0,
                activeToolCount: 0,
                hasAssistantContent: true,
                lastBlockWasToolResult: false,
            }),
        ).toEqual({
            status: 'succeeded',
            stopReason: 'end_turn',
            retryable: false,
        });
    });

    it('recovers a stalled non-write tool input stream by discarding and continuing', async () => {
        const conversationLog = {
            recordAssistantMessage: jest.fn().mockResolvedValue(undefined),
            listRuntimeHistory: jest.fn().mockResolvedValue([]),
        };
        const runtimeState = {
            isCancelled: jest.fn().mockReturnValue(false),
            clearCancelled: jest.fn(),
        };
        const session = {
            history: jest.fn().mockReturnValue([]),
            currentRun: jest
                .fn()
                .mockResolvedValueOnce({ id: 'run-stalled' })
                .mockResolvedValueOnce({ id: 'run-recovered' }),
            cancelRun: jest.fn().mockResolvedValue(undefined),
            cancel: jest.fn(),
            stream: jest
                .fn()
                .mockResolvedValueOnce(
                    iteratorFromEvents(
                        [
                            {
                                type: 'tool_use',
                                toolName: 'Bash',
                                toolId: 'toolu_bash',
                                input: { command: 'generate too much inline content' },
                            },
                        ],
                        true,
                    ),
                )
                .mockResolvedValueOnce(
                    iteratorFromEvents([
                        { type: 'text_delta', text: '恢复完成。' },
                        { type: 'turn_end', totalTokens: 42 },
                    ]),
                ),
        };
        const runner = new KernelMessageRunnerService(
            conversationLog as never,
            runtimeState as never,
            null as never,
            { resolve: jest.fn().mockReturnValue(undefined) } as never,
        );
        Object.assign(runner as unknown as { logger: Record<string, jest.Mock> }, {
            logger: {
                log: jest.fn(),
                warn: jest.fn(),
                error: jest.fn(),
            },
        });
        const emitted: unknown[] = [];

        await runner.runUserMessage({
            sessionId: 'session-tool-input-stall',
            content: '生成一批数据',
            emit: message => emitted.push(message),
            activeSession: {
                session,
                workspace: '/tmp/workspace',
                agentId: 'default',
                userId: 'user-1',
                runtimeKey: 'default',
                runtimeOverrides: {
                    streamStallWarningMs: 500,
                    toolInputStreamStallHardMs: 600,
                    continuationEnabled: true,
                    maxContinuationTurns: 1,
                },
                nativeConfirmationEnabled: false,
                nativeConfirmedToolKeys: new Set<string>(),
                createdAt: Date.now(),
                lastActivityAt: Date.now(),
            } as never,
        });

        expect(session.stream).toHaveBeenCalledTimes(2);
        expect(session.cancelRun).toHaveBeenCalledWith('run-stalled');
        expect(session.cancel).not.toHaveBeenCalled();
        expect(
            emitted.some(
                message =>
                    isStreamEvent(message, 'tool_input_stream_stalled') &&
                    (message as { event: Record<string, unknown> }).event.activeToolPhase === 'tool_input_streaming',
            ),
        ).toBe(true);
        expect(
            emitted.some(
                message =>
                    isStreamEvent(message, 'run_auto_continue') &&
                    (message as { event: Record<string, unknown> }).event.reason === 'tool_input_stream_stalled',
            ),
        ).toBe(true);
        expect(
            emitted.some(
                message =>
                    isResult(message) &&
                    (message as { data: Record<string, unknown> }).data.status === 'succeeded' &&
                    (message as { data: Record<string, unknown> }).data.stopReason === 'end_turn',
            ),
        ).toBe(true);
    }, 5_000);
});

function isStreamEvent(message: unknown, eventType: string): boolean {
    return (
        Boolean(message) &&
        typeof message === 'object' &&
        (message as { type?: unknown }).type === 'stream_event' &&
        typeof (message as { event?: { type?: unknown } }).event === 'object' &&
        (message as { event: { type?: unknown } }).event.type === eventType
    );
}

function isResult(message: unknown): boolean {
    return Boolean(message) && typeof message === 'object' && (message as { type?: unknown }).type === 'result';
}
