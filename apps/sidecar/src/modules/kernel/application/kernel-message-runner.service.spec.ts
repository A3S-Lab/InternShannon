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

    it('prompts max tool round continuation to inspect before continuing', () => {
        const runner = createRunner();

        const prompt = runner.maxToolRoundContinuationPrompt(1, 1);

        expect(prompt).toContain('First inspect what is already complete');
        expect(prompt).toContain('batch edit');
        expect(prompt).toContain('Do not write scratch files to arbitrary absolute paths');
    });
});
