import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { desktopJsonFilePath } from '@/shared/infrastructure/desktop/desktop-paths';
import {
    AppendEventInput,
    CommitLoopRunInput,
    CreateLoopRunInput,
    ILoopRunRepository,
    ListLoopRunsFilter,
    LoopRunEventRecord,
    LoopRunRecord,
} from '@/modules/loop/domain/repositories/loop-run.repository.interface';
import type {
    LoopKind,
    LoopRunStatus,
} from '@/modules/loop/domain/services/loop-controller.interface';

interface StoredRun {
    id: string;
    loopKind: LoopRunRecord['loopKind'];
    subjectType: string | null;
    subjectId: string | null;
    status: LoopRunStatus;
    state: Record<string, unknown>;
    iteration: number;
    budget: LoopRunRecord['budget'];
    spent: LoopRunRecord['spent'];
    errorSignature: string | null;
    correlationId: string | null;
    claimedBy: string | null;
    claimedAt: string | null;
    claimEpoch: number;
    createdAt: string;
    updatedAt: string;
}

interface StoredEvent {
    id: string;
    runId: string;
    iteration: number;
    eventType: string;
    eventId: string;
    payload: Record<string, unknown>;
    createdAt: string;
    relayedAt?: string | null;
}

const TERMINAL: ReadonlySet<LoopRunStatus> = new Set<LoopRunStatus>(['succeeded', 'failed', 'terminated', 'cancelled']);

/** Serializes all ops (desktop is single-process; one global FIFO mutex avoids RMW interleaving). */
class Mutex {
    private tail: Promise<unknown> = Promise.resolve();
    run<T>(fn: () => Promise<T>): Promise<T> {
        const result = this.tail.then(fn, fn) as Promise<T>;
        this.tail = result.then(
            () => undefined,
            () => undefined,
        );
        return result;
    }
}

/**
 * Desktop (single-process, file-backed) LoopRunRepository.
 * State lives in ~/.internshannon/loop-runs.json (truth); in-memory maps are a cache. Writes are
 * atomic (tmp + rename) and serialized through a mutex (review §12: advisory; sidecar should also
 * enforce single-process via pidfile/port). Fencing (claim_epoch) is honored identically.
 */
@Injectable()
export class DesktopLoopRunRepository implements ILoopRunRepository {
    private readonly logger = new Logger(DesktopLoopRunRepository.name);
    private readonly filePath = desktopJsonFilePath('loop-runs.json', this.logger);
    private readonly mutex = new Mutex();
    private runs = new Map<string, StoredRun>();
    private events: StoredEvent[] = [];
    private loaded = false;

    async create(input: CreateLoopRunInput): Promise<LoopRunRecord> {
        return this.mutex.run(async () => {
            this.ensureLoaded();
            const nowIso = new Date().toISOString();
            const run: StoredRun = {
                id: randomUUID(),
                loopKind: input.loopKind,
                subjectType: input.subjectType ?? null,
                subjectId: input.subjectId ?? null,
                status: 'pending',
                state: input.state ?? {},
                iteration: 0,
                budget: input.budget,
                spent: { iterations: 0 },
                errorSignature: null,
                correlationId: input.correlationId ?? null,
                claimedBy: null,
                claimedAt: null,
                claimEpoch: 0,
                createdAt: nowIso,
                updatedAt: nowIso,
            };
            this.runs.set(run.id, run);
            this.persist();
            return this.toRecord(run);
        });
    }

    async findById(id: string): Promise<LoopRunRecord | null> {
        return this.mutex.run(async () => {
            this.ensureLoaded();
            const run = this.runs.get(id);
            return run ? this.toRecord(run) : null;
        });
    }

    async findDue(limit: number, now: Date, claimStaleMs: number): Promise<LoopRunRecord[]> {
        return this.mutex.run(async () => {
            this.ensureLoaded();
            const staleBefore = now.getTime() - claimStaleMs;
            return Array.from(this.runs.values())
                .filter(
                    r =>
                        (r.status === 'pending' || r.status === 'running' || r.status === 'terminating') &&
                        (r.claimedAt === null || new Date(r.claimedAt).getTime() < staleBefore),
                )
                .sort((a, b) => a.updatedAt.localeCompare(b.updatedAt) || a.id.localeCompare(b.id))
                .slice(0, Math.max(1, Math.min(limit, 100)))
                .map(r => this.toRecord(r));
        });
    }

    async claim(id: string, workerId: string, now: Date, claimStaleMs: number): Promise<LoopRunRecord | null> {
        return this.mutex.run(async () => {
            this.ensureLoaded();
            const run = this.runs.get(id);
            if (!run) return null;
            const staleBefore = now.getTime() - claimStaleMs;
            const claimable =
                (run.status === 'pending' || run.status === 'running') &&
                (run.claimedAt === null || new Date(run.claimedAt).getTime() < staleBefore);
            if (!claimable) return null;
            run.claimedBy = workerId;
            run.claimedAt = now.toISOString();
            run.claimEpoch += 1;
            if (run.status === 'pending') run.status = 'running';
            run.updatedAt = now.toISOString();
            this.persist();
            return this.toRecord(run);
        });
    }

    async appendEvent(input: AppendEventInput): Promise<void> {
        return this.mutex.run(async () => {
            this.ensureLoaded();
            this.insertEvent(input);
            this.persist();
        });
    }

    async hasEvent(runId: string, iteration: number, eventType: string): Promise<boolean> {
        return this.mutex.run(async () => {
            this.ensureLoaded();
            return this.events.some(e => e.runId === runId && e.iteration === iteration && e.eventType === eventType);
        });
    }

    async commit(input: CommitLoopRunInput): Promise<boolean> {
        return this.mutex.run(async () => {
            this.ensureLoaded();
            const run = this.runs.get(input.id);
            if (!run || run.claimedBy !== input.workerId || run.claimEpoch !== input.claimEpoch) {
                return false; // fenced out
            }
            run.state = input.nextState;
            run.iteration = input.iteration;
            run.spent = input.spent;
            run.status = input.status;
            run.errorSignature = input.errorSignature ?? null;
            run.claimedBy = null;
            run.claimedAt = null;
            run.updatedAt = new Date().toISOString();
            for (const ev of input.events) this.insertEvent(ev);
            this.persist();
            return true;
        });
    }

    async hasActiveRun(loopKind: LoopKind, subjectId: string): Promise<boolean> {
        return this.mutex.run(async () => {
            this.ensureLoaded();
            return Array.from(this.runs.values()).some(
                r =>
                    r.loopKind === loopKind &&
                    r.subjectId === subjectId &&
                    (r.status === 'pending' || r.status === 'running' || r.status === 'awaiting_human'),
            );
        });
    }

    async list(
        filter: ListLoopRunsFilter,
        options: { limit: number; offset: number },
    ): Promise<{ items: LoopRunRecord[]; total: number }> {
        return this.mutex.run(async () => {
            this.ensureLoaded();
            let items = Array.from(this.runs.values());
            if (filter.loopKind) items = items.filter(r => r.loopKind === filter.loopKind);
            if (filter.status) items = items.filter(r => r.status === filter.status);
            if (filter.subjectId) items = items.filter(r => r.subjectId === filter.subjectId);
            items.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id));
            const total = items.length;
            const page = items.slice(options.offset, options.offset + options.limit).map(r => this.toRecord(r));
            return { items: page, total };
        });
    }

    async listEvents(runId: string, limit = 200): Promise<LoopRunEventRecord[]> {
        return this.mutex.run(async () => {
            this.ensureLoaded();
            return this.events
                .filter(e => e.runId === runId)
                .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
                .slice(0, Math.max(1, Math.min(limit, 1000)))
                .map(e => ({
                    id: e.id,
                    runId: e.runId,
                    iteration: e.iteration,
                    eventType: e.eventType,
                    eventId: e.eventId,
                    payload: e.payload,
                    createdAt: new Date(e.createdAt),
                }));
        });
    }

    async requestCancel(id: string): Promise<boolean> {
        return this.mutex.run(async () => {
            this.ensureLoaded();
            const run = this.runs.get(id);
            if (!run || !(run.status === 'pending' || run.status === 'running' || run.status === 'awaiting_human')) {
                return false;
            }
            run.status = 'terminating';
            run.updatedAt = new Date().toISOString();
            this.persist();
            return true;
        });
    }

    async adjudicate(id: string, decision: 'approve' | 'reject', note?: string): Promise<boolean> {
        return this.mutex.run(async () => {
            this.ensureLoaded();
            const run = this.runs.get(id);
            if (!run || run.status !== 'awaiting_human') return false;
            run.status = decision === 'approve' ? 'running' : 'terminated';
            run.errorSignature = decision === 'reject' ? (note ?? 'rejected_by_human') : null;
            run.claimedBy = null;
            run.claimedAt = null;
            run.updatedAt = new Date().toISOString();
            this.persist();
            return true;
        });
    }

    async countByStatus(filter: ListLoopRunsFilter = {}): Promise<Record<string, number>> {
        return this.mutex.run(async () => {
            this.ensureLoaded();
            const counts: Record<string, number> = {};
            for (const run of this.runs.values()) {
                if (filter.loopKind && run.loopKind !== filter.loopKind) continue;
                counts[run.status] = (counts[run.status] ?? 0) + 1;
            }
            return counts;
        });
    }

    async countRecentRuns(loopKind: LoopKind, subjectId: string, since: Date): Promise<number> {
        return this.mutex.run(async () => {
            this.ensureLoaded();
            const threshold = since.getTime();
            let count = 0;
            for (const run of this.runs.values()) {
                if (run.loopKind === loopKind && run.subjectId === subjectId && new Date(run.createdAt).getTime() >= threshold) {
                    count += 1;
                }
            }
            return count;
        });
    }

    async countByKind(): Promise<Record<string, number>> {
        return this.mutex.run(async () => {
            this.ensureLoaded();
            const counts: Record<string, number> = {};
            for (const run of this.runs.values()) counts[run.loopKind] = (counts[run.loopKind] ?? 0) + 1;
            return counts;
        });
    }

    async listUnrelayedEvents(limit = 100): Promise<LoopRunEventRecord[]> {
        return this.mutex.run(async () => {
            this.ensureLoaded();
            return this.events
                .filter(e => !e.relayedAt)
                .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
                .slice(0, Math.max(1, Math.min(limit, 1000)))
                .map(e => ({
                    id: e.id,
                    runId: e.runId,
                    iteration: e.iteration,
                    eventType: e.eventType,
                    eventId: e.eventId,
                    payload: e.payload,
                    createdAt: new Date(e.createdAt),
                }));
        });
    }

    async markRelayed(eventRowIds: string[]): Promise<void> {
        if (eventRowIds.length === 0) return;
        return this.mutex.run(async () => {
            this.ensureLoaded();
            const ids = new Set(eventRowIds);
            for (const event of this.events) {
                if (ids.has(event.id)) event.relayedAt = new Date().toISOString();
            }
            this.persist();
        });
    }

    private insertEvent(input: AppendEventInput): void {
        const exists = this.events.some(
            e => e.runId === input.runId && e.iteration === input.iteration && e.eventType === input.eventType,
        );
        if (exists) return; // unique(run_id, iteration, event_type)
        this.events.push({
            id: `lre-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
            runId: input.runId,
            iteration: input.iteration,
            eventType: input.eventType,
            eventId: input.eventId,
            payload: input.payload ?? {},
            createdAt: new Date().toISOString(),
        });
    }

    private ensureLoaded(): void {
        if (this.loaded) return;
        try {
            if (existsSync(this.filePath)) {
                const parsed = JSON.parse(readFileSync(this.filePath, 'utf-8')) as {
                    runs?: StoredRun[];
                    events?: StoredEvent[];
                };
                this.runs = new Map((parsed.runs ?? []).map(r => [r.id, r]));
                this.events = parsed.events ?? [];
            }
        } catch (error) {
            this.logger.warn(`Failed to load ${this.filePath}, starting empty: ${error instanceof Error ? error.message : String(error)}`);
            this.runs = new Map();
            this.events = [];
        }
        this.loaded = true;
    }

    private persist(): void {
        const data = JSON.stringify({ runs: Array.from(this.runs.values()), events: this.events }, null, 2);
        const tmp = `${this.filePath}.${process.pid}.tmp`;
        writeFileSync(tmp, data, 'utf-8');
        renameSync(tmp, this.filePath); // atomic on same filesystem
    }

    private toRecord(run: StoredRun): LoopRunRecord {
        return {
            id: run.id,
            loopKind: run.loopKind,
            subjectType: run.subjectType,
            subjectId: run.subjectId,
            status: run.status,
            state: run.state,
            iteration: run.iteration,
            budget: run.budget,
            spent: run.spent,
            errorSignature: run.errorSignature,
            correlationId: run.correlationId,
            claimedBy: run.claimedBy,
            claimedAt: run.claimedAt ? new Date(run.claimedAt) : null,
            claimEpoch: run.claimEpoch,
            createdAt: new Date(run.createdAt),
            updatedAt: new Date(run.updatedAt),
        };
    }
}
