import { KernelSessionConnectionService } from "./kernel-session-connection.service";
import type { KernelSessionRuntimeAccessService } from "./kernel-session-runtime-access.service";

describe("KernelSessionConnectionService", () => {
    function harness(operationActive = false) {
        const runtimeAccess = {
            closeActive: jest.fn().mockReturnValue(true),
            isOperationActive: jest.fn().mockReturnValue(operationActive),
        } as unknown as jest.Mocked<KernelSessionRuntimeAccessService>;
        return {
            service: new KernelSessionConnectionService(runtimeAccess),
            runtimeAccess,
            join: jest.fn(),
            leave: jest.fn(),
        };
    }

    it("closes an idle runtime after the final client disconnects", () => {
        const state = harness(false);
        state.service.subscribe({
            clientId: "client-1",
            sessionId: "session-1",
            join: state.join,
            leave: state.leave,
            emitSubscribed: jest.fn(),
        });

        expect(state.service.disconnect({ clientId: "client-1", leave: state.leave })).toBe("session-1");
        expect(state.runtimeAccess.closeActive).toHaveBeenCalledWith("session-1");
    });

    it("does not close an in-flight runtime when its final websocket disconnects", () => {
        const state = harness(true);
        state.service.subscribe({
            clientId: "client-1",
            sessionId: "session-1",
            join: state.join,
            leave: state.leave,
            emitSubscribed: jest.fn(),
        });

        expect(state.service.disconnect({ clientId: "client-1", leave: state.leave })).toBe("session-1");
        expect(state.runtimeAccess.isOperationActive).toHaveBeenCalledWith("session-1");
        expect(state.runtimeAccess.closeActive).not.toHaveBeenCalled();
    });

    it("keeps a runtime while another client is still subscribed", () => {
        const state = harness(false);
        for (const clientId of ["client-1", "client-2"]) {
            state.service.subscribe({
                clientId,
                sessionId: "session-1",
                join: state.join,
                leave: state.leave,
                emitSubscribed: jest.fn(),
            });
        }

        state.service.disconnect({ clientId: "client-1", leave: state.leave });
        expect(state.runtimeAccess.closeActive).not.toHaveBeenCalled();
        state.service.disconnect({ clientId: "client-2", leave: state.leave });
        expect(state.runtimeAccess.closeActive).toHaveBeenCalledTimes(1);
    });
});
