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
});
