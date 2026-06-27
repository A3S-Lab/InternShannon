/**
 * Cancellation Token for Node Execution
 * Allows cancellation of long-running node executions
 */

export interface CancellationToken {
    readonly isCancelled: boolean;
    cancel(): void;
    throwIfCancelled(): void;
    onCancelled(callback: () => void): void;
    unregister(callback: () => void): void;
}

export class CancellationTokenImpl implements CancellationToken {
    private _isCancelled = false;
    private callbacks: Set<() => void> = new Set();

    get isCancelled(): boolean {
        return this._isCancelled;
    }

    cancel(): void {
        this._isCancelled = true;
        for (const callback of this.callbacks) {
            callback();
        }
    }

    throwIfCancelled(): void {
        if (this._isCancelled) {
            throw new CancellationError('Execution was cancelled');
        }
    }

    onCancelled(callback: () => void): void {
        this.callbacks.add(callback);
    }

    unregister(callback: () => void): void {
        this.callbacks.delete(callback);
    }
}

export class CancellationError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'CancellationError';
    }
}

/**
 * Registry of active cancellation tokens for running nodes
 */
export class CancellationRegistry {
    private tokens = new Map<string, CancellationToken>();

    register(executionId: string, nodeId: string): CancellationToken {
        const key = `${executionId}:${nodeId}`;
        const token = new CancellationTokenImpl();
        this.tokens.set(key, token);
        return token;
    }

    get(executionId: string, nodeId: string): CancellationToken | undefined {
        const key = `${executionId}:${nodeId}`;
        return this.tokens.get(key);
    }

    cancel(executionId: string, nodeId: string): void {
        const token = this.get(executionId, nodeId);
        if (token) {
            token.cancel();
        }
    }

    cancelAll(executionId: string): void {
        for (const key of this.tokens.keys()) {
            if (key.startsWith(`${executionId}:`)) {
                const token = this.tokens.get(key);
                if (token) token.cancel();
            }
        }
    }

    unregister(executionId: string, nodeId: string): void {
        const key = `${executionId}:${nodeId}`;
        this.tokens.delete(key);
    }

    unregisterAll(executionId: string): void {
        for (const key of [...this.tokens.keys()]) {
            if (key.startsWith(`${executionId}:`)) {
                this.tokens.delete(key);
            }
        }
    }
}

// Global registry instance
export const cancellationRegistry = new CancellationRegistry();
