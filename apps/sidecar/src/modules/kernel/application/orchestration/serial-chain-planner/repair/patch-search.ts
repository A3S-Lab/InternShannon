/**
 * Local repair search — generate candidate patches per HardError and accept
 * the first one that strictly reduces error signatures.
 *
 * Ported from `serial_agent_chain/repair/patch_search.py`.
 */
import { toolIds } from '../registry';
import { RepairOperator, errorSignature } from '../schemas';
import type {
    AgentAssignment,
    AgentRegistryView,
    Chain,
    HardError,
    RepairPatch,
    RepairTraceItem,
    TaskRecord,
    VerificationResult,
} from '../schemas';
import type { HardVerifier } from '../verifier';
import { applyRepairPatch } from './operators';

function recordByTaskId(chain: Chain, taskId: string): TaskRecord | null {
    return chain.records.find((record) => record.task_id === taskId) ?? null;
}

function findUpstreamOutput(
    chain: Chain,
    taskId: string,
    target: string,
): { sourceTask: string; oldOutput: string } | null {
    let previous: TaskRecord | null = null;
    for (const record of chain.records) {
        if (record.task_id === taskId) break;
        for (const output of record.contract.outputs) {
            if (output === target) return { sourceTask: record.task_id, oldOutput: output };
        }
        previous = record;
    }
    if (previous && previous.contract.outputs.length > 0) {
        return { sourceTask: previous.task_id, oldOutput: previous.contract.outputs[0]! };
    }
    return null;
}

function inputsWith(chain: Chain, taskId: string, artifact: string): string[] {
    const record = recordByTaskId(chain, taskId);
    if (!record) return [artifact];
    return Array.from(new Set([...record.contract.inputs, artifact]));
}

function agentForCapability(
    capability: string,
    registry: AgentRegistryView,
    selectedIds: ReadonlySet<string>,
): string | null {
    for (const card of registry.list()) {
        if (selectedIds.has(card.agent_id)) continue;
        const capabilities = new Set(card.capabilities);
        const tools = new Set(toolIds(card));
        if (capabilities.has(capability) || tools.has(capability)) return card.agent_id;
    }
    return null;
}

function agentsCoveringCapabilities(
    currentAgents: AgentAssignment[],
    missingCapabilities: string[],
    registry: AgentRegistryView,
    lockedAgents: ReadonlySet<string>,
): AgentAssignment[] {
    const selected: AgentAssignment[] = [...currentAgents];
    const selectedIds = new Set(selected.map((a) => a.agent));
    const covered = new Set<string>();
    for (const assignment of selected) {
        const card = registry.get(assignment.agent);
        if (!card) continue;
        for (const cap of card.capabilities) covered.add(cap);
        for (const tool of toolIds(card)) covered.add(tool);
    }
    let nextOrder = selected.reduce((max, a) => Math.max(max, a.order), 0) + 1;
    for (const capability of missingCapabilities) {
        if (covered.has(capability)) continue;
        const candidate = agentForCapability(capability, registry, selectedIds);
        if (!candidate) continue;
        if (lockedAgents.has(candidate)) continue;
        selected.push({
            order: nextOrder++,
            agent: candidate,
            responsibility: `Cover required capability: ${capability}`,
        });
        selectedIds.add(candidate);
        const card = registry.get(candidate);
        if (card) {
            for (const cap of card.capabilities) covered.add(cap);
            for (const tool of toolIds(card)) covered.add(tool);
        }
    }
    return selected;
}

function patchesForError(
    chain: Chain,
    error: HardError,
    roundNumber: number,
    registry: AgentRegistryView,
    lockedAgents: ReadonlySet<string>,
): RepairPatch[] {
    const patches: RepairPatch[] = [];
    const taskId = error.task_id;
    if (!taskId) return patches;
    const nextId = () => `p${roundNumber}_${patches.length + 1}`;

    if (error.type === 'missing_input') {
        for (const missing of error.missing) {
            const upstream = findUpstreamOutput(chain, taskId, missing);
            if (upstream) {
                patches.push({
                    patch_id: nextId(),
                    hypothesis: `${taskId} 缺少 ${missing}，可将上游 ${upstream.oldOutput} 重命名或重绑定。`,
                    operator: RepairOperator.RelabelOutput,
                    touched_tasks: [upstream.sourceTask, taskId],
                    payload: {
                        source_task: upstream.sourceTask,
                        old_output: upstream.oldOutput,
                        new_output: missing,
                    },
                    patch_cost: 2,
                });
            }
            patches.push({
                patch_id: nextId(),
                hypothesis: `${taskId} 需要外部输入 ${missing}，将其登记为可用输入源。`,
                operator: RepairOperator.AddInputSource,
                touched_tasks: [taskId],
                payload: { inputs: [] },
                patch_cost: 3,
            });
        }
    } else if (error.type === 'unused_output') {
        const output = error.missing[0];
        if (output) {
            const ids = chain.records.map((record) => record.task_id);
            const finalTaskId = ids[ids.length - 1];
            if (finalTaskId && finalTaskId !== taskId) {
                patches.push({
                    patch_id: nextId(),
                    hypothesis: `${output} is unused; add it as an input to final task ${finalTaskId}.`,
                    operator: RepairOperator.RewriteTask,
                    touched_tasks: [finalTaskId],
                    payload: { inputs: inputsWith(chain, finalTaskId, output) },
                    patch_cost: 1,
                });
            }
            const idx = ids.indexOf(taskId);
            if (idx >= 0 && idx + 1 < ids.length) {
                const nextTask = ids[idx + 1]!;
                patches.push({
                    patch_id: nextId(),
                    hypothesis: `${output} 未被下游消费，将其接入 ${nextTask}。`,
                    operator: RepairOperator.RewriteTask,
                    touched_tasks: [nextTask],
                    payload: { inputs: inputsWith(chain, nextTask, output) },
                    patch_cost: 1,
                });
            }
        }
    } else if (error.type === 'goal_gap') {
        const finalRecord =
            chain.records.length > 0 ? chain.records[chain.records.length - 1]! : null;
        if (finalRecord && error.missing.length > 0) {
            const outputs = Array.from(new Set([...finalRecord.contract.outputs, ...error.missing]));
            patches.push({
                patch_id: nextId(),
                hypothesis: 'Final task does not cover expected final outputs; add missing outputs.',
                operator: RepairOperator.RewriteTask,
                touched_tasks: [finalRecord.task_id],
                payload: { outputs },
                patch_cost: 1,
            });
        }
    } else if (error.type === 'bad_agent_fit') {
        const record = recordByTaskId(chain, taskId);
        if (record && error.missing.length > 0) {
            const agents = agentsCoveringCapabilities(
                record.contract.agents,
                error.missing,
                registry,
                lockedAgents,
            );
            if (agents.length > 0) {
                patches.push({
                    patch_id: nextId(),
                    hypothesis: 'Assigned agents do not cover inferred capabilities; add capable agents.',
                    operator: RepairOperator.RewriteTask,
                    touched_tasks: [taskId],
                    payload: { agents },
                    patch_cost: 2,
                });
            }
        }
    }
    return patches;
}

function patchWithinDirtySpan(patch: RepairPatch, dirtySpan: ReadonlySet<string>): boolean {
    return patch.touched_tasks.every((id) => dirtySpan.has(id));
}

function errorSignatures(result: VerificationResult): Set<string> {
    return new Set(result.errors.map(errorSignature));
}

function patchMakesProgress(
    current: VerificationResult,
    candidate: VerificationResult,
    target: HardError,
): boolean {
    if (candidate.pass || candidate.errors.length < current.errors.length) return true;
    const currentSigs = errorSignatures(current);
    const candidateSigs = errorSignatures(candidate);
    if (currentSigs.size !== candidateSigs.size) return true;
    for (const sig of currentSigs) {
        if (!candidateSigs.has(sig)) return true;
    }
    return !candidateSigs.has(errorSignature(target));
}

export interface LocalRepairerOptions {
    repairRounds?: number;
    lockedAgents?: ReadonlySet<string>;
}

export interface RepairOptions {
    dirtySpan?: string[];
    /** Agents that must not be replaced (e.g. user-locked in the canvas). */
    lockedAgents?: ReadonlySet<string>;
}

export class LocalRepairer {
    private readonly verifier: HardVerifier;
    private readonly repairRounds: number;
    private readonly defaultLockedAgents: ReadonlySet<string>;

    constructor(verifier: HardVerifier, options: LocalRepairerOptions = {}) {
        this.verifier = verifier;
        this.repairRounds = options.repairRounds ?? 20;
        this.defaultLockedAgents = options.lockedAgents ?? new Set<string>();
    }

    repair(chain: Chain, options: RepairOptions = {}): { chain: Chain; result: VerificationResult } {
        const dirtySpanList = options.dirtySpan ?? chain.records.map((record) => record.task_id);
        const dirtySpan = new Set(dirtySpanList);
        const lockedAgents = options.lockedAgents ?? this.defaultLockedAgents;
        let current = chain;
        const seenSignatures = new Map<string, number>();

        for (let round = 1; round <= this.repairRounds; round++) {
            const result = this.verifier.verify(current);
            if (result.pass) return { chain: current, result };

            const signature = result.errors.map(errorSignature).join('|');
            seenSignatures.set(signature, (seenSignatures.get(signature) ?? 0) + 1);
            if ((seenSignatures.get(signature) ?? 0) >= 2) return { chain: current, result };

            let accepted = false;
            for (const error of result.errors) {
                if (error.task_id && !dirtySpan.has(error.task_id)) continue;
                const candidates = patchesForError(
                    current,
                    error,
                    round,
                    this.verifier.registry,
                    lockedAgents,
                );
                for (const patch of candidates) {
                    if (!patchWithinDirtySpan(patch, dirtySpan)) {
                        current.repair_trace.push(
                            traceEntry(round, patch, result, result, false, 'rejected: patch touches tasks outside dirty_span'),
                        );
                        continue;
                    }
                    const candidate = applyRepairPatch(current, patch);
                    const candidateResult = this.verifier.verify(candidate);
                    const ok = patchMakesProgress(result, candidateResult, error);
                    current.repair_trace.push(
                        traceEntry(round, patch, result, candidateResult, ok, patch.hypothesis),
                    );
                    if (ok) {
                        candidate.repair_trace = current.repair_trace;
                        current = candidate;
                        accepted = true;
                        break;
                    }
                }
                if (accepted) break;
            }
            if (!accepted) return { chain: current, result };
        }

        const finalResult = this.verifier.verify(current);
        return { chain: current, result: finalResult };
    }
}

function traceEntry(
    round: number,
    patch: RepairPatch,
    before: VerificationResult,
    after: VerificationResult,
    accepted: boolean,
    hypothesis: string,
): RepairTraceItem {
    return {
        round,
        operator: patch.operator,
        touched_tasks: patch.touched_tasks,
        errors_before: before.errors.length,
        errors_after: after.errors.length,
        accepted,
        hypothesis,
        patch_cost: patch.patch_cost,
    };
}
