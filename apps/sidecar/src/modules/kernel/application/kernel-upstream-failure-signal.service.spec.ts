import {
    KernelUpstreamFailureSignalService,
    KernelUpstreamModelBusyError,
} from "./kernel-upstream-failure-signal.service";

describe("KernelUpstreamFailureSignalService", () => {
    it("safely correlates a headerless failure when exactly one session is waiting", async () => {
        const service = new KernelUpstreamFailureSignalService();
        const attempt = service.beginAttempt("session-only", 100);
        const waiting = service.subscribeSince("session-only", 100);

        expect(
            service.recordForUniqueWaitingSession({ status: 429, code: "1305", message: "busy", occurredAt: 101 }),
        ).toBe("session-only");
        await expect(waiting.promise).resolves.toEqual(expect.objectContaining({ sessionId: "session-only" }));
        attempt.dispose();
    });

    it("refuses to guess between concurrent waiting sessions", () => {
        const service = new KernelUpstreamFailureSignalService();
        const first = service.beginAttempt("session-a", 100);
        const second = service.beginAttempt("session-b", 100);

        expect(
            service.recordForUniqueWaitingSession({ status: 429, code: "1305", message: "busy", occurredAt: 101 }),
        ).toBeNull();
        first.dispose();
        second.dispose();
    });
    it("delivers a correlated failure that was recorded before subscription", async () => {
        const service = new KernelUpstreamFailureSignalService();
        const after = Date.now();
        service.record({
            sessionId: " session-429 ",
            status: 429,
            code: "1305",
            message: "busy",
            occurredAt: after + 1,
        });

        const subscription = service.subscribeSince("session-429", after);

        await expect(subscription.promise).resolves.toEqual(
            expect.objectContaining({ sessionId: "session-429", status: 429, code: "1305" }),
        );
    });

    it("does not consume a stale failure from a prior attempt", () => {
        const service = new KernelUpstreamFailureSignalService();
        service.record({
            sessionId: "session-retry",
            status: 429,
            code: "1305",
            message: "old busy response",
            occurredAt: 100,
        });

        expect(service.consumeSince("session-retry", 101)).toBeNull();
    });

    it("isolates simultaneous sessions and supports waiter disposal", async () => {
        const service = new KernelUpstreamFailureSignalService();
        const after = Date.now();
        const first = service.subscribeSince("session-first", after);
        const second = service.subscribeSince("session-second", after);
        first.dispose();

        service.record({
            sessionId: "session-second",
            status: 503,
            code: "1305",
            message: "busy",
            occurredAt: after + 1,
        });

        await expect(second.promise).resolves.toEqual(expect.objectContaining({ sessionId: "session-second" }));
        expect(service.consumeSince("session-first", after)).toBeNull();
    });

    it("preserves the observed HTTP status in the user-facing busy error", () => {
        const error = new KernelUpstreamModelBusyError({
            sessionId: "session-503",
            status: 503,
            code: "1305",
            message: "busy",
            occurredAt: Date.now(),
        });

        expect(error.status).toBe(503);
        expect(error.code).toBe("1305");
        expect(error.message).toContain("未自动切换模型");
    });
});
