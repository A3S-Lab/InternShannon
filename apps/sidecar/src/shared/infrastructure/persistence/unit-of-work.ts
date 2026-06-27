import { Injectable } from '@nestjs/common';
import { IUnitOfWork } from './unit-of-work.interface';

// ============================================================================
// In-Memory Unit of Work
// For development and testing purposes
// ============================================================================

@Injectable()
export class InMemoryUnitOfWork implements IUnitOfWork {
    private started = false;
    private changes: Map<string, unknown> = new Map();

    async start(): Promise<void> {
        this.started = true;
        this.changes.clear();
    }

    async commit(): Promise<void> {
        if (!this.started) {
            throw new Error('UnitOfWork has not been started');
        }
        // In-memory implementation: changes are already applied
        // This is a no-op for the in-memory version
        this.started = false;
        this.changes.clear();
    }

    async rollback(): Promise<void> {
        if (!this.started) {
            throw new Error('UnitOfWork has not been started');
        }
        // In-memory implementation: no actual rollback needed
        // All changes are transient in memory
        this.started = false;
        this.changes.clear();
    }

    isStarted(): boolean {
        return this.started;
    }
}
