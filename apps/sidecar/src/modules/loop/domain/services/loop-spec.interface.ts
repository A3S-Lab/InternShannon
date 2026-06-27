/**
 * LoopSpec — a read-only declarative MODEL of one kernel loop, expressed with the user's six
 * elements (trigger / scope / context / action / evaluator / state-continuation) plus the remaining
 * declared fields. This is "循环工程建模(只读)": it does NOT change runtime behavior — it describes the
 * five loops that already exist so the 认知 / loop-engineering pages can render them honestly.
 *
 * ★ This is a CODE registry, NOT a DB table. A spec is tightly coupled to the controller code it
 * describes (prompts, budgets, env flags, DAG node kinds), so its single source of truth is the
 * controller itself: each LoopController returns its own spec(s), which are aggregated under the
 * LOOP_SPEC multi-provider token (mirroring LOOP_CONTROLLER). Pure TS (domain layer): no Nest / DB /
 * HTTP imports.
 *
 * Honesty contract: `enforcement` separates fields the engine actually ENFORCES at runtime (budgets,
 * stop conditions, write-scope HITL gating, isolation that is truly applied) from fields that are only
 * DECLARED here for modeling/documentation (e.g. trust lists, read scopes that nothing checks). The UI
 * marks declared-only fields as "声明未强制" so operators are never misled into thinking a guardrail
 * exists when it does not.
 */

import type { LoopKind } from './loop-controller.interface';

/**
 * Stable key for a loop spec. dev/ops/knowledge each model multiple specs: dev (interactive /
 * diagnose), ops (reconcile/deploy), knowledge (freshness/curation).
 */
export type LoopSpecKey =
    | 'dev'
    | 'dev:diagnose'
    | 'ops:reconcile'
    | 'ops:deploy'
    | 'knowledge:freshness'
    | 'knowledge:curation';

/** What kicks a loop off. */
export interface LoopSpecTrigger {
    kinds: ('schedule' | 'event' | 'manual' | 'goal-unmet')[];
    /** Concrete trigger surfaces: endpoints / scanners / env flags that actually start runs. */
    detail: string;
}

export interface LoopSpec {
    key: LoopSpecKey;
    loopKind: LoopKind;
    /** Run-mode discriminator inside a shared kind (e.g. 'deploy', 'curation'); omitted for the default mode. */
    mode?: string;
    /** One sentence: business goal / which repetitive cost it lowers / which quality it raises. */
    name: string;

    // ——— 6 要素 (the six elements) ———
    trigger: LoopSpecTrigger;
    scope: { subjectTypes: string[]; description: string };
    context: { rules: string };
    action: { steps: string[]; description: string };
    evaluator: {
        method: ('test' | 'lint' | 'screenshot' | 'log' | 'reviewer-agent' | 'health-check' | 'restraint')[];
        detail: string;
    };
    stateContinuation: { ledger: string };

    // ——— remaining declared fields ———
    inputSources: string[];
    trust: { trusted: string[]; reference: string[] };
    readScope: string[];
    writeScope: { default: 'read-only' | 'writable'; where: string };
    isolation: 'none' | 'worktree' | 'temp-branch' | 'sandbox' | 'readonly-snapshot' | 'hitl-gated';
    processAssets: { skillIds?: string[]; runbookIds?: string[]; prompts?: Record<string, string> };
    validation: string;
    budgetDefaults: Record<string, unknown>;
    stopConditions: string[];
    humanEscalation: string;
    rollback: string;
    retroEntry: { sink: 'skill' | 'runbook' | 'knowledge'; targetAssetId?: string } | null;
    availability: { cloud: boolean; desktop: boolean };

    /**
     * Which declared fields the engine TRULY enforces at runtime vs. those that are declared only for
     * modeling. The UI marks `declaredOnly` field names as "声明未强制".
     */
    enforcement: { enforced: string[]; declaredOnly: string[] };
}

/**
 * Each LoopController exposes its spec(s) via this surface (a controller that hosts two run modes —
 * ops reconcile/deploy, knowledge freshness/curation — returns an array). Aggregated by the
 * LoopSpecRegistry.
 */
export interface LoopSpecProvider {
    loopSpec(): LoopSpec | LoopSpec[];
}

/** Multi-provider DI token: each loop binds its LoopSpecProvider; the registry injects the array. */
export const LOOP_SPEC = Symbol('LOOP_SPEC');
