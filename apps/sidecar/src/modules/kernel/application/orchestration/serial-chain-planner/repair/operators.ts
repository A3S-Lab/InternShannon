/**
 * Repair operators — apply a RepairPatch to a Chain.
 *
 * Ported from `serial_agent_chain/repair/operators.py`. Each operator does a
 * targeted, in-place edit on a deep-cloned chain and refreshes touched
 * metadata hashes.
 */
import { sha256Json } from '../hashing';
import { RepairOperator } from '../schemas';
import type { AgentAssignment, Chain, RepairPatch } from '../schemas';

function deepClone<T>(value: T): T {
    return structuredClone(value);
}

function isAgentAssignment(value: unknown): value is AgentAssignment {
    return (
        typeof value === 'object' &&
        value !== null &&
        'order' in value &&
        'agent' in value &&
        'responsibility' in value
    );
}

function coerceAgentAssignments(items: unknown[]): AgentAssignment[] {
    const out: AgentAssignment[] = [];
    for (const item of items) {
        if (isAgentAssignment(item)) {
            out.push({
                order: Number(item.order),
                agent: String(item.agent),
                responsibility: String(item.responsibility),
            });
        }
    }
    return out;
}

export function applyRepairPatch(chain: Chain, patch: RepairPatch): Chain {
    const candidate = deepClone(chain);
    const touched = new Set(patch.touched_tasks);

    if (patch.operator === RepairOperator.AddInputSource) {
        const taskId = patch.touched_tasks[0];
        if (!taskId) return candidate;
        const inputs = (patch.payload['inputs'] as string[] | undefined) ?? [];
        for (const record of candidate.records) {
            if (record.task_id !== taskId) continue;
            for (const item of inputs) {
                if (!record.contract.inputs.includes(item)) record.contract.inputs.push(item);
            }
            break;
        }
    } else if (patch.operator === RepairOperator.RelabelOutput) {
        const sourceTask = patch.payload['source_task'] as string | undefined;
        const oldOutput = patch.payload['old_output'] as string | undefined;
        const newOutput = patch.payload['new_output'] as string | undefined;
        if (sourceTask) touched.add(sourceTask);
        if (sourceTask && oldOutput && newOutput) {
            for (const record of candidate.records) {
                if (record.task_id === sourceTask) {
                    record.contract.outputs = record.contract.outputs.map((output) =>
                        output === oldOutput ? newOutput : output,
                    );
                }
            }
            for (const record of candidate.records) {
                if (!touched.has(record.task_id)) continue;
                record.contract.inputs = record.contract.inputs.map((input) =>
                    input === oldOutput ? newOutput : input,
                );
            }
        }
    } else if (patch.operator === RepairOperator.RewriteTask) {
        const taskId = patch.touched_tasks[0];
        if (!taskId) return candidate;
        const outputs = patch.payload['outputs'] as string[] | undefined;
        const inputs = patch.payload['inputs'] as string[] | undefined;
        const rawAgents = patch.payload['agents'] as unknown[] | undefined;
        for (const record of candidate.records) {
            if (record.task_id !== taskId) continue;
            if (outputs !== undefined) record.contract.outputs = Array.from(new Set(outputs));
            if (inputs !== undefined) record.contract.inputs = Array.from(new Set(inputs));
            if (rawAgents !== undefined) {
                record.contract.agents = coerceAgentAssignments(rawAgents);
            }
            break;
        }
    }

    refreshMetadata(candidate, touched);
    return candidate;
}

function refreshMetadata(chain: Chain, taskIds: ReadonlySet<string>): void {
    for (const record of chain.records) {
        if (!taskIds.has(record.task_id)) continue;
        record.metadata.view_hash = sha256Json(record.view);
        record.metadata.contract_hash = sha256Json(record.contract);
    }
}
