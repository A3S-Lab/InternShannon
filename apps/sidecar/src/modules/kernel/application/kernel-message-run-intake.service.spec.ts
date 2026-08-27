import { ConflictException } from "@nestjs/common";
import type { IKernelService } from "../domain/services/kernel-service.interface";
import type { KernelConversationLogService } from "./kernel-conversation-log.service";
import { KernelMessageRunIntakeService } from "./kernel-message-run-intake.service";
import type { KernelMessageRunnerService } from "./kernel-message-runner.service";
import type { KernelSessionRuntimeAccessService } from "./kernel-session-runtime-access.service";
import { KernelSessionRuntimeStateService } from "./kernel-session-runtime-state.service";
import type { ActiveSession } from "./session-runtime.types";

describe("KernelMessageRunIntakeService single-flight lifecycle", () => {
    it("rejects a concurrent run, releases the lock, and emits the final correlated idle state", async () => {
        let releaseRun!: () => void;
        const runGate = new Promise<void>((resolve) => {
            releaseRun = resolve;
        });
        const runtimeState = new KernelSessionRuntimeStateService();
        const emit = jest.fn();
        const runUserMessage = jest
            .fn()
            .mockImplementationOnce(async () => runGate)
            .mockResolvedValue(undefined);
        const messageRunner = {
            runUserMessage,
        } as unknown as KernelMessageRunnerService;
        const service = new KernelMessageRunIntakeService(
            {
                recordUserMessage: jest
                    .fn()
                    .mockResolvedValueOnce({ id: "message-1" })
                    .mockResolvedValueOnce({ id: "message-2" }),
            } as unknown as KernelConversationLogService,
            runtimeState,
            {
                getOrCreate: jest.fn().mockResolvedValue(makeActiveSession()),
            } as unknown as KernelSessionRuntimeAccessService,
            messageRunner,
            {
                getSession: jest.fn().mockResolvedValue({
                    id: "session-1",
                    sessionId: "session-1",
                    agentId: "default",
                    metadata: {},
                }),
            } as unknown as IKernelService,
        );

        const first = service.run({ sessionId: "session-1", content: "first", emit });
        await waitFor(() => runUserMessage.mock.calls.length === 1);

        await expect(service.run({ sessionId: "session-1", content: "second", emit })).rejects.toBeInstanceOf(
            ConflictException,
        );
        expect(runtimeState.activeOperation("session-1")?.runId).toBe("message-1");

        releaseRun();
        await first;
        expect(runtimeState.isOperationActive("session-1")).toBe(false);
        expect(emit).toHaveBeenCalledWith({
            type: "status_change",
            status: null,
            runId: "message-1",
        });

        await expect(service.run({ sessionId: "session-1", content: "third", emit })).resolves.toBeUndefined();
    });
});

function makeActiveSession(): ActiveSession {
    return {
        session: {} as ActiveSession["session"],
        workspace: "/workspace",
        agentId: "default",
        userId: "desktop-user",
        runtimeKey: "runtime-key",
        runtimeOverrides: {},
        nativeConfirmationEnabled: false,
        nativeConfirmedToolKeys: new Set(),
        createdAt: Date.now(),
        lastActivityAt: Date.now(),
    };
}

async function waitFor(predicate: () => boolean): Promise<void> {
    for (let attempt = 0; attempt < 20; attempt += 1) {
        if (predicate()) return;
        await new Promise<void>((resolve) => setImmediate(resolve));
    }
    throw new Error("condition not reached");
}
