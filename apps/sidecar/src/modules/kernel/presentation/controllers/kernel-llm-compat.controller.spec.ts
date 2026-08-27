import type { Request, Response } from "express";
import {
    KERNEL_SESSION_ID_HEADER,
    KernelUpstreamFailureSignalService,
} from "../../application/kernel-upstream-failure-signal.service";
import { KernelLlmCompatController } from "./kernel-llm-compat.controller";

describe("KernelLlmCompatController", () => {
    const originalFetch = global.fetch;

    afterEach(() => {
        global.fetch = originalFetch;
        jest.restoreAllMocks();
    });

    it("records a Zhipu 1305 response against only the forwarded A3S session", async () => {
        const failures = new KernelUpstreamFailureSignalService();
        const record = jest.spyOn(failures, "record");
        const controller = new KernelLlmCompatController(failures);
        global.fetch = jest.fn().mockResolvedValue(
            new globalThis.Response(JSON.stringify({ error: { code: 1305, message: "busy" } }), {
                status: 429,
                headers: { "content-type": "application/json" },
            }),
        );
        const request = {
            method: "POST",
            headers: {
                authorization: "Bearer test",
                "content-type": "application/json",
                [KERNEL_SESSION_ID_HEADER]: "session-controller-429",
            },
            body: { model: "glm-test" },
        } as unknown as Request;
        const response = responseStub();

        await controller.proxyZhipuCoding(request, response.value);

        expect(record).toHaveBeenCalledWith(
            expect.objectContaining({
                sessionId: "session-controller-429",
                status: 429,
                code: "1305",
            }),
        );
        expect(response.status).toHaveBeenCalledWith(429);
    });

    it("correlates a headerless failure when one runner is waiting", async () => {
        const failures = new KernelUpstreamFailureSignalService();
        const record = jest.spyOn(failures, "record");
        const attempt = failures.beginAttempt("session-only-waiter", Date.now() - 1);
        const waiting = failures.subscribeSince("session-only-waiter", Date.now() - 1);
        const controller = new KernelLlmCompatController(failures);
        global.fetch = jest
            .fn()
            .mockResolvedValue(
                new globalThis.Response(JSON.stringify({ error: { code: 1305, message: "busy" } }), { status: 429 }),
            );
        const request = {
            method: "POST",
            headers: { authorization: "Bearer test" },
            body: {},
        } as unknown as Request;

        await controller.proxyZhipuCoding(request, responseStub().value);

        expect(record).toHaveBeenCalledWith(expect.objectContaining({ sessionId: "session-only-waiter" }));
        attempt.dispose();
        waiting.dispose();
    });

    it("does not guess for a headerless failure when multiple runners are waiting", async () => {
        const failures = new KernelUpstreamFailureSignalService();
        const record = jest.spyOn(failures, "record");
        const first = failures.beginAttempt("session-a", Date.now() - 1);
        const second = failures.beginAttempt("session-b", Date.now() - 1);
        global.fetch = jest
            .fn()
            .mockResolvedValue(
                new globalThis.Response(JSON.stringify({ error: { code: 1305, message: "busy" } }), { status: 429 }),
            );
        const request = {
            method: "POST",
            headers: { authorization: "Bearer test" },
            body: {},
        } as unknown as Request;

        await controllerFor(failures).proxyZhipuCoding(request, responseStub().value);

        expect(record).not.toHaveBeenCalled();
        first.dispose();
        second.dispose();
    });
});

function controllerFor(failures: KernelUpstreamFailureSignalService): KernelLlmCompatController {
    return new KernelLlmCompatController(failures);
}

function responseStub(): {
    value: Response;
    status: jest.Mock;
} {
    const status = jest.fn().mockReturnThis();
    const value = {
        status,
        setHeader: jest.fn(),
        send: jest.fn(),
        json: jest.fn(),
        write: jest.fn(),
        end: jest.fn(),
    } as unknown as Response;
    return { value, status };
}
