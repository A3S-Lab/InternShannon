export interface KernelToolInputDeltaCoalescerOptions {
    maxPendingBytes?: number;
    maxPendingMs?: number;
}

const DEFAULT_MAX_PENDING_BYTES = 2 * 1024;
const DEFAULT_MAX_PENDING_MS = 250;

export class KernelToolInputDeltaCoalescer {
    private pending = '';
    private pendingStartedAt: number | null = null;
    private readonly maxPendingBytes: number;
    private readonly maxPendingMs: number;

    constructor(options: KernelToolInputDeltaCoalescerOptions = {}) {
        this.maxPendingBytes = positiveInt(options.maxPendingBytes, DEFAULT_MAX_PENDING_BYTES);
        this.maxPendingMs = positiveInt(options.maxPendingMs, DEFAULT_MAX_PENDING_MS);
    }

    push(partialJson: string, now = Date.now()): string | null {
        if (!partialJson) return null;
        if (!this.pending) {
            this.pendingStartedAt = now;
        }
        this.pending += partialJson;
        if (Buffer.byteLength(this.pending, 'utf8') >= this.maxPendingBytes) {
            return this.flush();
        }
        if (this.pendingStartedAt !== null && now - this.pendingStartedAt >= this.maxPendingMs) {
            return this.flush();
        }
        return null;
    }

    flush(): string | null {
        if (!this.pending) return null;
        const flushed = this.pending;
        this.pending = '';
        this.pendingStartedAt = null;
        return flushed;
    }
}

function positiveInt(value: number | undefined, fallback: number): number {
    return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}
