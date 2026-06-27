import { Inject, Injectable, Logger } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import {
    AppendEventInput,
    ILoopRunRepository,
    LOOP_RUN_REPOSITORY,
    LoopRunRecord,
} from '../domain/repositories/loop-run.repository.interface';
import {
    LoopDag,
    LoopDagEdge,
    LoopDagNode,
    LoopRunStatus,
} from '../domain/services/loop-controller.interface';

/** One generate→verify→repair iteration recorded onto the dev loop run's state. */
export interface DevLoopIteration {
    turn: number;
    /** Files the agent mutated this turn (relative paths). */
    mutatedFiles?: string[];
    /** Verify outcome (diagnose / 质检). */
    verify?: { reportId?: string | null; passed: boolean; failedScopes?: string[] };
    /** Whether failed scopes were injected back as the next repair prompt. */
    repaired?: boolean;
    note?: string;
}

interface DevLoopState {
    goal: string;
    ref: string | null;
    iterations: DevLoopIteration[];
    /** Dynamic execution DAG accumulated per turn (same shape the driven loops persist in state.dag). */
    dag?: LoopDag;
    [k: string]: unknown;
}

const CLAIM_STALE_MS = 5 * 60_000;
const MAX_ITERATIONS_CAP = 20;

/**
 * Interactive driver for the SOFTWARE loop (review §4.3).
 *
 * The dev loop is the human-turn / model-paced interactive closed loop: the WebIDE turn loop is
 * the real driver (generate via agent → verify via diagnose → repair via next-turn injection), NOT
 * the LoopRunDriver (which skips dev-kind runs — see loop-run-driver.service.ts safety guard).
 *
 * Every write still routes through the repository's fenced claim→commit, so dev loop_runs share
 * the SAME transactional outbox / event timeline as the driven loops — only the *trigger* is
 * interactive. This keeps observability (loop-runs page + WebIDE 内核循环 panel) uniform across the
 * three loops without a setInterval driver.
 */
@Injectable()
export class DevLoopRunService {
    private readonly logger = new Logger(DevLoopRunService.name);

    constructor(@Inject(LOOP_RUN_REPOSITORY) private readonly repo: ILoopRunRepository) {}

    /** Start an autonomous dev loop bound to an asset; returns the run already flipped to running. */
    async createRun(input: { assetId: string; ref?: string | null; goal: string; maxIterations: number }): Promise<LoopRunRecord> {
        const maxIterations = Math.min(Math.max(Math.trunc(input.maxIterations) || 1, 1), MAX_ITERATIONS_CAP);
        const state: DevLoopState = { goal: input.goal, ref: input.ref ?? null, iterations: [], dag: this.buildDevDag([]) };
        const run = await this.repo.create({
            loopKind: 'dev',
            subjectType: 'asset',
            subjectId: input.assetId,
            budget: { maxIterations },
            state,
        });
        // Flip pending→running immediately — interactive: no driver will pick it up.
        return (
            (await this.commitStep(run.id, {
                status: 'running',
                iteration: 0,
                state,
                eventType: 'loop.started',
                payload: { goal: input.goal, maxIterations },
            })) ?? run
        );
    }

    /** Append one iteration's outcome; stays running (or awaiting_human when HITL is requested). */
    async recordIteration(
        id: string,
        iteration: DevLoopIteration,
        opts: { status?: Extract<LoopRunStatus, 'running' | 'awaiting_human'>; errorSignature?: string | null } = {},
    ): Promise<LoopRunRecord | null> {
        const run = await this.repo.findById(id);
        if (!run || run.loopKind !== 'dev') return null;
        const state = this.readState(run.state);
        state.iterations = [...state.iterations.filter(it => it.turn !== iteration.turn), iteration].sort(
            (a, b) => a.turn - b.turn,
        );
        // Rebuild the execution DAG from the (now authoritative) iteration list — the dev loop
        // dynamically produces a DAG too, mirroring the driven loops' state.dag.
        state.dag = this.buildDevDag(state.iterations);
        return this.commitStep(id, {
            status: opts.status ?? 'running',
            iteration: iteration.turn,
            state,
            errorSignature: opts.errorSignature ?? null,
            eventType: 'loop.iteration',
            payload: {
                turn: iteration.turn,
                passed: iteration.verify?.passed ?? null,
                failedScopes: iteration.verify?.failedScopes ?? [],
            },
        });
    }

    /** Terminal transition (succeeded / failed / terminated / cancelled). */
    async finalize(
        id: string,
        status: Extract<LoopRunStatus, 'succeeded' | 'failed' | 'terminated' | 'cancelled'>,
        errorSignature?: string | null,
    ): Promise<LoopRunRecord | null> {
        const run = await this.repo.findById(id);
        if (!run || run.loopKind !== 'dev') return null;
        return this.commitStep(id, {
            status,
            iteration: run.iteration,
            state: run.state,
            errorSignature: errorSignature ?? null,
            eventType: 'loop.finished',
            payload: { status },
        });
    }

    /** Route one transition through the fenced claim→commit (transactional outbox), interactively. */
    private async commitStep(
        id: string,
        step: {
            status: LoopRunStatus;
            iteration: number;
            state: Record<string, unknown>;
            errorSignature?: string | null;
            eventType: string;
            payload?: Record<string, unknown>;
        },
    ): Promise<LoopRunRecord | null> {
        const worker = `webide-${randomUUID()}`;
        const claimed = await this.repo.claim(id, worker, new Date(), CLAIM_STALE_MS);
        if (!claimed) {
            this.logger.warn(`dev loop ${id} claim failed (contended or already terminal)`);
            return null;
        }
        const events: AppendEventInput[] = [
            {
                runId: id,
                iteration: step.iteration,
                eventType: step.eventType,
                eventId: createHash('sha256').update(`${id}:${step.iteration}:${step.eventType}`).digest('hex').slice(0, 32),
                payload: step.payload,
            },
        ];
        const ok = await this.repo.commit({
            id,
            workerId: worker,
            claimEpoch: claimed.claimEpoch,
            nextState: step.state,
            iteration: step.iteration,
            spent: { iterations: step.iteration },
            status: step.status,
            errorSignature: step.errorSignature ?? null,
            events,
        });
        if (!ok) {
            this.logger.warn(`dev loop ${id} commit fenced out (concurrent writer)`);
            return null;
        }
        return this.repo.findById(id);
    }

    private readState(raw: Record<string, unknown>): DevLoopState {
        const goal = typeof raw.goal === 'string' ? raw.goal : '';
        const ref = typeof raw.ref === 'string' ? raw.ref : null;
        const iterations = Array.isArray(raw.iterations) ? (raw.iterations as DevLoopIteration[]) : [];
        return { ...raw, goal, ref, iterations };
    }

    /**
     * Build the dev loop's execution DAG from its recorded turns. Per turn:
     *   修复·turnN (kind 'repair', detail = mutated-file count) → 诊断·turnN (kind 'diagnose',
     *   success when verify.passed else failed, detail = failed scopes), edge repair→diagnose.
     * Each turn's diagnose chains to the next turn's repair, so the accumulated graph stays connected.
     * Stable ids `iterN:repair` / `iterN:diagnose` (N = turn) so the UI lays nodes out by iteration.
     */
    private buildDevDag(iterations: DevLoopIteration[]): LoopDag {
        const nodes: LoopDagNode[] = [];
        const edges: LoopDagEdge[] = [];
        const sorted = [...iterations].sort((a, b) => a.turn - b.turn);
        let prevDiagnoseId: string | undefined;
        let tailId: string | undefined;

        for (const it of sorted) {
            const turn = it.turn;
            const repairId = `iter${turn}:repair`;
            const diagnoseId = `iter${turn}:diagnose`;
            const mutatedCount = it.mutatedFiles?.length ?? 0;
            const passed = it.verify?.passed === true;
            const failedScopes = it.verify?.failedScopes ?? [];

            // detail = this turn's reason/result; prompt = the operative instruction (提示词) for the step.
            nodes.push({
                id: repairId,
                label: `修复·turn${turn}`,
                status: 'success',
                iteration: turn,
                kind: 'repair',
                detail: `改动 ${mutatedCount} 个文件`,
                prompt:
                    turn <= 1
                        ? '按目标生成首版实现(generate)'
                        : '依据上一轮诊断失败的检查项,在本轮修复对应问题(repair)',
            });
            nodes.push({
                id: diagnoseId,
                label: `诊断·turn${turn}`,
                status: it.verify ? (passed ? 'success' : 'failed') : 'pending',
                iteration: turn,
                kind: 'diagnose',
                detail: it.verify
                    ? passed
                        ? '质检通过'
                        : `质检失败:${failedScopes.length ? failedScopes.join(', ') : '未通过'}`
                    : '待诊断',
                prompt: '对本轮改动运行质检/诊断,产出失败检查项以驱动下一轮修复',
            });
            edges.push({ from: repairId, to: diagnoseId });
            if (prevDiagnoseId) edges.push({ from: prevDiagnoseId, to: repairId });
            prevDiagnoseId = diagnoseId;
            tailId = diagnoseId;
        }

        return { nodes, edges, tailId };
    }
}
