/**
 * LoopController — the kernel's "loop engineering" core abstraction (constraint C1).
 *
 * A loop = a reconcile controller on a local truth plane. Each concrete
 * loop implements this interface and registers under the multi-provider LOOP_CONTROLLER token.
 * The LoopRunDriver claims a due loop_run, resolves its controller by `kind`, runs ONE step,
 * and commits with fencing.
 *
 * Pure TS (domain layer): no Nest / DB / HTTP imports.
 *
 * ★ Dev loop is intentionally NOT a driven LoopController here. It is a human-turn /
 * model-paced interactive closed loop and stays an AgentSpec read-only adapter (review §4.3).
 * This table/driver only drives non-interactive loops with external event sources.
 */

export type LoopKind = 'dev' | 'ops' | 'knowledge';

export type LaneId = 'system' | 'control' | 'query' | 'session' | 'skill' | 'prompt';

export type LoopRunStatus =
    | 'pending'
    | 'running'
    | 'awaiting_human'
    | 'terminating' // cooperative-cancel requested; driver finalizes to 'cancelled'
    | 'succeeded'
    | 'failed'
    | 'terminated'
    | 'cancelled';

export interface LoopBudget {
    maxIterations: number;
    maxTokens?: number;
    maxWallMs?: number;
    maxSubLlmCalls?: number;
}

export interface LoopSpent {
    iterations: number;
    tokens?: number;
    subLlmCalls?: number;
    wallMs?: number;
}

/** Immutable view of a loop_run handed to a controller for one step. */
export interface LoopRunSnapshot {
    id: string;
    loopKind: LoopKind;
    subjectType: string | null;
    subjectId: string | null;
    status: LoopRunStatus;
    state: Record<string, unknown>;
    iteration: number;
    budget: LoopBudget;
    spent: LoopSpent;
    errorSignature: string | null;
    correlationId: string | null;
    claimedBy: string | null;
    claimedAt: Date | null;
    claimEpoch: number;
}

export interface LoopTriggerEvent {
    eventName: string;
    correlationId?: string;
    payload?: Record<string, unknown>;
}

/**
 * A fact emitted onto the EventBus. eventId is DETERMINISTIC (hash of runId+iteration+eventName)
 * so re-delivery dedupes via processed_events. Carried by the outbox (loop_run_events), never
 * published directly inside the business transaction.
 */
export interface CirculationEvent {
    eventId: string;
    eventName: string;
    loopRunId: string;
    iteration: number;
    hopCount: number;
    correlationId?: string;
    body?: Record<string, unknown>;
}

/**
 * Dynamic execution DAG (constraint: every kernel loop MUST dynamically produce a DAG of its
 * process execution). The driver accumulates per-step deltas into loop_runs.state.dag; the UI
 * renders it as a live workflow canvas (nodes = processes executed, edges = dependencies).
 */
export type LoopDagNodeStatus = 'pending' | 'running' | 'success' | 'failed' | 'skipped' | 'awaiting_human';

export interface LoopDagNode {
    /** Stable id across iterations, e.g. `iter3:observe`. Upserted by id when merged. */
    id: string;
    label: string;
    status: LoopDagNodeStatus;
    /** Iteration that produced/updated this node (the UI lays nodes out by iteration). */
    iteration: number;
    /** Process kind: observe/decide/remediate/collect/ingest/repair/diagnose/… */
    kind?: string;
    /** The 原因/结果 of this step — why it ran / what it produced (the reason, shown under the node). */
    detail?: string;
    /**
     * The 操作指令/提示词 of this step — what this step was ASKED to do (the operative instruction;
     * for LLM-driven steps, the actual prompt). The 认知 page shows it alongside `detail` so each
     * step surfaces both its instruction (prompt) and its reason/result (detail).
     */
    prompt?: string;
}

export interface LoopDagEdge {
    from: string;
    to: string;
}

/** Accumulated DAG persisted under `loop_runs.state.dag`. */
export interface LoopDag {
    nodes: LoopDagNode[];
    edges: LoopDagEdge[];
    /** Last node id; the driver chains the next iteration's entry node to it. */
    tailId?: string;
}

/** Per-step DAG fragment a controller emits; the driver merges it into `state.dag`. */
export interface LoopDagDelta {
    nodes: LoopDagNode[];
    edges?: LoopDagEdge[];
}

export interface LoopStepResult {
    status: 'continue' | 'awaiting_human' | 'succeeded' | 'failed' | 'terminated';
    /** Persisted into loop_runs.state (JSONB), authoritative cross-iteration state. */
    nextState: Record<string, unknown>;
    /** Circulation facts; written to the outbox in the SAME transaction as the commit. */
    emit?: CirculationEvent[];
    budgetSpent: { iterations: number; tokens?: number; subLlmCalls?: number };
    /** Surfaced failure/terminal reason → loop_runs.error_signature (shown in the UI). */
    errorSignature?: string;
    /**
     * Dynamic execution DAG fragment for THIS step (nodes = processes executed, with status;
     * edges = intra-step dependencies). The driver merges it into loop_runs.state.dag so every
     * loop run dynamically produces a DAG. Omit → the driver records a baseline per-iteration node.
     */
    dag?: LoopDagDelta;
}

export interface TerminationVerdict {
    stop: boolean;
    reason?: string;
    status?: LoopRunStatus;
}

export interface LoopController {
    readonly kind: LoopKind;
    /** Which priority lane this loop's work rides (see application/lane.ts). */
    readonly laneId: LaneId;

    /** ops/knowledge return false on desktop (their modules are not loaded) — review §12. */
    isAvailableInMode(mode: 'cloud' | 'desktop'): boolean;

    /**
     * Run ONE iteration. ★ NOT idempotent for LLM-calling loops — the driver writes a
     * `step.started` placeholder before calling step(); a crashed step is abandoned and the
     * iteration is bumped (never re-run), so tokens are counted "fired = possibly spent".
     */
    step(input: { run: LoopRunSnapshot; trigger: LoopTriggerEvent | null }): Promise<LoopStepResult>;

    /** Read-only termination decision: budget / iteration cap / loop detection / per-subject circuit. */
    shouldTerminate(run: LoopRunSnapshot): TerminationVerdict;
}

/** Multi-provider DI token: each loop binds one LoopController; the driver injects the array. */
export const LOOP_CONTROLLER = Symbol('LOOP_CONTROLLER');
