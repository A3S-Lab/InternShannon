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
});
