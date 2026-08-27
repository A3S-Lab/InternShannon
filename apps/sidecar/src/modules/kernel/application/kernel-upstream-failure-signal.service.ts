import { Injectable } from "@nestjs/common";

export const KERNEL_SESSION_ID_HEADER = "x-internshannon-session-id";

export interface KernelUpstreamFailureSignal {
    sessionId: string;
    status: number;
    code?: string;
    message: string;
    occurredAt: number;
}

interface FailureWaiter {
    after: number;
    resolve: (failure: KernelUpstreamFailureSignal) => void;
}

/**
 * Correlates errors observed by the local LLM compatibility proxy with the
 * controlled A3S session that issued the request. The SDK can otherwise turn
 * an upstream HTTP 429 into a silent stream, leaving the runner to wait for its
 * long generic stall watchdog.
 */
@Injectable()
export class KernelUpstreamFailureSignalService {
    private readonly latest = new Map<string, KernelUpstreamFailureSignal>();
    private readonly waiters = new Map<string, Set<FailureWaiter>>();
    private readonly activeAttempts = new Map<string, Map<symbol, number>>();

    beginAttempt(sessionId: string, after: number): { dispose: () => void } {
        const normalized = sessionId.trim();
        const token = Symbol(normalized);
        const attempts = this.activeAttempts.get(normalized) ?? new Map<symbol, number>();
        attempts.set(token, after);
        this.activeAttempts.set(normalized, attempts);
        return {
            dispose: () => {
                const current = this.activeAttempts.get(normalized);
                if (!current) return;
                current.delete(token);
                if (current.size === 0) this.activeAttempts.delete(normalized);
            },
        };
    }

    record(failure: KernelUpstreamFailureSignal): void {
        const sessionId = failure.sessionId.trim();
        if (!sessionId) return;
        const normalized = { ...failure, sessionId };
        this.latest.set(sessionId, normalized);
        const waiters = this.waiters.get(sessionId);
        if (waiters) {
            for (const waiter of Array.from(waiters)) {
                if (normalized.occurredAt < waiter.after) continue;
                waiters.delete(waiter);
                waiter.resolve(normalized);
            }
            if (waiters.size === 0) this.waiters.delete(sessionId);
        }
        this.prune(normalized.occurredAt);
    }

    /**
     * The controlled A3S native provider currently strips custom HCL headers.
     * Correlate a headerless local-proxy failure only when exactly one session
     * is actively waiting for an upstream event. Ambiguous concurrent requests
     * are intentionally left unassigned rather than terminating the wrong run.
     */
    recordForUniqueWaitingSession(failure: Omit<KernelUpstreamFailureSignal, "sessionId">): string | null {
        const candidates = Array.from(this.activeAttempts.entries()).filter(([, attempts]) =>
            Array.from(attempts.values()).some((after) => failure.occurredAt >= after),
        );
        if (candidates.length !== 1) return null;
        const sessionId = candidates[0][0];
        this.record({ ...failure, sessionId });
        return sessionId;
    }

    consumeSince(sessionId: string, after: number): KernelUpstreamFailureSignal | null {
        const failure = this.latest.get(sessionId);
        if (!failure || failure.occurredAt < after) return null;
        this.latest.delete(sessionId);
        return failure;
    }

    subscribeSince(
        sessionId: string,
        after: number,
    ): { promise: Promise<KernelUpstreamFailureSignal>; dispose: () => void } {
        const existing = this.consumeSince(sessionId, after);
        if (existing) {
            return { promise: Promise.resolve(existing), dispose: () => undefined };
        }
        let waiter: FailureWaiter;
        const promise = new Promise<KernelUpstreamFailureSignal>((resolve) => {
            waiter = { after, resolve };
            const waiters = this.waiters.get(sessionId) ?? new Set<FailureWaiter>();
            waiters.add(waiter);
            this.waiters.set(sessionId, waiters);
        });
        return {
            promise,
            dispose: () => {
                const waiters = this.waiters.get(sessionId);
                if (!waiters) return;
                waiters.delete(waiter);
                if (waiters.size === 0) this.waiters.delete(sessionId);
            },
        };
    }

    private prune(now: number): void {
        const cutoff = now - 5 * 60_000;
        for (const [sessionId, failure] of this.latest) {
            if (failure.occurredAt < cutoff) this.latest.delete(sessionId);
        }
        while (this.latest.size > 256) this.latest.delete(this.latest.keys().next().value as string);
    }
}

export class KernelUpstreamModelBusyError extends Error {
    readonly status: number;
    readonly code?: string;

    constructor(failure: KernelUpstreamFailureSignal) {
        super("模型服务繁忙，请稍后在当前模型上重试；本轮未自动切换模型。");
        this.name = "KernelUpstreamModelBusyError";
        this.status = failure.status;
        this.code = failure.code;
    }
}
