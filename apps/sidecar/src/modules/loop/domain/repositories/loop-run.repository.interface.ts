import type {
    LoopBudget,
    LoopKind,
    LoopRunSnapshot,
    LoopRunStatus,
    LoopSpent,
} from '../services/loop-controller.interface';

export interface LoopRunRecord extends LoopRunSnapshot {
    createdAt: Date;
    updatedAt: Date;
}

export interface LoopRunEventRecord {
    id: string;
    runId: string;
    iteration: number;
    eventType: string;
    eventId: string;
    payload: Record<string, unknown>;
    createdAt: Date;
}

export interface ListLoopRunsFilter {
    loopKind?: LoopKind;
    status?: LoopRunStatus;
    /** 绑定主体(如资产 id):WebIDE 拉取本资产的内核循环历史。 */
    subjectId?: string;
}

export interface CreateLoopRunInput {
    loopKind: LoopKind;
    subjectType?: string | null;
    subjectId?: string | null;
    budget: LoopBudget;
    state?: Record<string, unknown>;
    correlationId?: string | null;
}

export interface AppendEventInput {
    runId: string;
    iteration: number;
    /** e.g. 'step.started' | 'step.completed' | 'step.abandoned' | 'run.terminated' | circulation names */
    eventType: string;
    /** deterministic id = hash(runId, iteration, eventType) */
    eventId: string;
    payload?: Record<string, unknown>;
}

/** Atomic commit of one advance + its outbox events, guarded by the fencing token. */
export interface CommitLoopRunInput {
    id: string;
    workerId: string;
    /** the claim_epoch returned by claim(); commit is rejected if it has since advanced */
    claimEpoch: number;
    nextState: Record<string, unknown>;
    iteration: number;
    spent: LoopSpent;
    status: LoopRunStatus;
    errorSignature?: string | null;
    /** written in the SAME transaction as the row update (transactional outbox) */
    events: AppendEventInput[];
}

export interface ILoopRunRepository {
    create(input: CreateLoopRunInput): Promise<LoopRunRecord>;
    findById(id: string): Promise<LoopRunRecord | null>;

    /** Candidates the driver may claim: status in (pending,running) with no live lease. */
    findDue(limit: number, now: Date, claimStaleMs: number): Promise<LoopRunRecord[]>;

    /**
     * Atomic claim: WHERE status in (pending,running) AND lease stale → set claimed_by/at,
     * bump claim_epoch, pending→running. Returns the claimed record (with the new claim_epoch)
     * or null if another worker owns it (C2: no double-advance).
     */
    claim(id: string, workerId: string, now: Date, claimStaleMs: number): Promise<LoopRunRecord | null>;

    /** Append one outbox/audit event (idempotent via unique(run_id,iteration,event_type)). */
    appendEvent(input: AppendEventInput): Promise<void>;

    /** True if an event of `eventType` already exists for (run, iteration) — crash-recovery probe. */
    hasEvent(runId: string, iteration: number, eventType: string): Promise<boolean>;

    /**
     * Fenced commit: updates the row + appends events in one transaction, but only if
     * claimed_by AND claim_epoch still match. Returns false if fenced out (stale worker).
     */
    commit(input: CommitLoopRunInput): Promise<boolean>;

    /** True if a non-terminal run exists for (loopKind, subjectId) — scanner dedup. */
    hasActiveRun(loopKind: LoopKind, subjectId: string): Promise<boolean>;

    /** Paginated read for the loop-runs API / future UI. */
    list(filter: ListLoopRunsFilter, options: { limit: number; offset: number }): Promise<{ items: LoopRunRecord[]; total: number }>;

    /** Append-only event timeline for a run (escape-hatch trace). */
    listEvents(runId: string, limit?: number): Promise<LoopRunEventRecord[]>;

    /** Cooperative cancel: pending/running/awaiting_human → terminating. The driver finalizes to cancelled. */
    requestCancel(id: string): Promise<boolean>;

    /** HITL adjudication of an awaiting_human run: approve → running, reject → terminated. Idempotent. */
    adjudicate(id: string, decision: 'approve' | 'reject', note?: string): Promise<boolean>;

    /** Count runs grouped by status (dashboard metrics / filter badges). */
    countByStatus(filter?: ListLoopRunsFilter): Promise<Record<string, number>>;

    /** Count runs for (loopKind, subjectId) created since `since` — per-subject circuit breaker (review §8). */
    countRecentRuns(loopKind: LoopKind, subjectId: string, since: Date): Promise<number>;

    /** Count runs grouped by loop kind — three-loop overview (dev / ops / knowledge). */
    countByKind(): Promise<Record<string, number>>;

    /** Transactional-outbox relay: un-relayed events oldest-first, then mark them relayed. */
    listUnrelayedEvents(limit?: number): Promise<LoopRunEventRecord[]>;
    markRelayed(eventRowIds: string[]): Promise<void>;
}

export const LOOP_RUN_REPOSITORY = Symbol('LOOP_RUN_REPOSITORY');
