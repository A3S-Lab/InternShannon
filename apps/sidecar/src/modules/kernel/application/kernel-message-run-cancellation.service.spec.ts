import { KernelMessageRunCancellationService } from "./kernel-message-run-cancellation.service";

describe("KernelMessageRunCancellationService", () => {
    it("uses the controlled A3S settlement barrier before reporting cancellation", async () => {
        let settled = false;
        const session = {
            cancelAndSettle: jest.fn().mockImplementation(async () => {
                settled = true;
                return true;
            }),
            cancel: jest.fn(),
        };
        const runtimeState = {
            markCancelled: jest.fn(),
            updateActiveOperationPhase: jest.fn(),
            getActiveSession: jest.fn().mockReturnValue({ session }),
            activeOperation: jest.fn().mockReturnValue({ runId: "msg-run-1" }),
        };
        const emitted: unknown[] = [];
        const service = new KernelMessageRunCancellationService(runtimeState as never);

        await service.cancel({
            sessionId: "session-cancel",
            emit: (message) => {
                expect(settled).toBe(true);
                emitted.push(message);
            },
        });

        expect(session.cancelAndSettle).toHaveBeenCalledTimes(1);
        expect(session.cancel).not.toHaveBeenCalled();
        expect(emitted).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ type: "cancelled", cancelled: true, runId: "msg-run-1" }),
            ]),
        );
    });
});
