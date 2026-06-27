/**
 * Hard verification — six structural checks on a Chain.
 *
 * Ported from `serial_agent_chain/verifier.py`. Errors collected here drive
 * the auto-repair loop in `repair/patch-search.ts`.
 */
import { BUILTIN_REGISTRY, toolIds } from './registry';
import {
    CAPABILITY_ARTIFACT_RULES,
    CAPABILITY_INPUT_RULES,
    DEFAULT_INITIAL_INPUTS,
    matchAny,
} from './rules';
import { chainContracts } from './schemas';
import type {
    AgentRegistryView,
    Chain,
    HardError,
    TaskContract,
    VerificationResult,
} from './schemas';

export interface VerifierOptions {
    registry?: AgentRegistryView;
    initialInputs?: Iterable<string>;
    finalOutputs?: Iterable<string>;
}

export class HardVerifier {
    readonly registry: AgentRegistryView;
    private readonly initialInputs: Set<string>;
    private readonly finalOutputs: Set<string>;

    constructor(options: VerifierOptions = {}) {
        this.registry = options.registry ?? BUILTIN_REGISTRY;
        this.initialInputs = new Set(options.initialInputs ?? DEFAULT_INITIAL_INPUTS);
        this.finalOutputs = new Set(options.finalOutputs ?? []);
    }

    verify(chain: Chain): VerificationResult {
        const errors: HardError[] = [];
        errors.push(...this.verifyUniqueTaskIds(chain));
        errors.push(...this.verifyViewContractLink(chain));
        const contracts = chainContracts(chain);
        errors.push(...this.verifyContracts(contracts));
        errors.push(...this.verifyOutputConsumption(contracts));
        errors.push(...this.verifyFinalOutputs(contracts, chain.expected_final_outputs));
        errors.push(...this.verifyAgents(contracts));
        return { pass: errors.length === 0, errors };
    }

    private verifyUniqueTaskIds(chain: Chain): HardError[] {
        const errors: HardError[] = [];
        const seen = new Set<string>();
        for (const record of chain.records) {
            if (seen.has(record.task_id)) {
                errors.push({
                    type: 'duplicate_task',
                    task_id: record.task_id,
                    field: 'task_id',
                    message: 'Task ids must be unique',
                    missing: [record.task_id],
                    allowed_repair: ['rewrite_task'],
                });
            }
            seen.add(record.task_id);
        }
        return errors;
    }

    private verifyViewContractLink(chain: Chain): HardError[] {
        const errors: HardError[] = [];
        for (const record of chain.records) {
            if (record.view.task_id !== record.contract.task_id) {
                errors.push({
                    type: 'view_contract_mismatch',
                    task_id: record.task_id,
                    field: 'task_id',
                    message: 'TaskView and TaskContract task_id mismatch',
                    missing: [],
                    allowed_repair: [],
                });
            }
            if (record.contract.outputs.length === 0) {
                errors.push({
                    type: 'missing_output',
                    task_id: record.task_id,
                    field: 'contract.outputs',
                    message: 'TaskContract must produce at least one output',
                    missing: [],
                    allowed_repair: ['rewrite_task'],
                });
            }
        }
        return errors;
    }

    private verifyContracts(contracts: TaskContract[]): HardError[] {
        const errors: HardError[] = [];
        const available = new Set(this.initialInputs);
        for (const contract of contracts) {
            const missing = contract.inputs.filter((input) => !available.has(input));
            if (missing.length > 0) {
                errors.push({
                    type: 'missing_input',
                    task_id: contract.task_id,
                    field: 'contract.inputs',
                    message: 'Task input is not provided by initial inputs or upstream outputs',
                    missing,
                    allowed_repair: ['insert_task', 'relabel_output', 'rewrite_task'],
                });
            }
            for (const output of contract.outputs) available.add(output);
        }
        return errors;
    }

    private verifyOutputConsumption(contracts: TaskContract[]): HardError[] {
        const errors: HardError[] = [];
        const consumed = new Set<string>();
        for (const contract of contracts) {
            for (const input of contract.inputs) consumed.add(input);
        }
        const finalOutputs = new Set(
            contracts.length > 0 ? contracts[contracts.length - 1]!.outputs : [],
        );
        for (let i = 0; i < contracts.length - 1; i++) {
            const contract = contracts[i]!;
            const unused = contract.outputs.filter(
                (output) => !consumed.has(output) && !finalOutputs.has(output),
            );
            if (unused.length > 0) {
                errors.push({
                    type: 'unused_output',
                    task_id: contract.task_id,
                    field: 'contract.outputs',
                    message: 'Non-final output is not consumed downstream',
                    missing: unused,
                    allowed_repair: ['consume_downstream', 'merge_task', 'relabel_output'],
                });
            }
        }
        return errors;
    }

    private verifyFinalOutputs(
        contracts: TaskContract[],
        chainFinalOutputs: string[] = [],
    ): HardError[] {
        const expected = this.finalOutputs.size > 0 ? this.finalOutputs : new Set(chainFinalOutputs);
        if (expected.size === 0 || contracts.length === 0) return [];
        const last = contracts[contracts.length - 1]!;
        const actual = new Set(last.outputs);
        const missing: string[] = [];
        for (const output of expected) {
            if (!actual.has(output)) missing.push(output);
        }
        missing.sort();
        if (missing.length === 0) return [];
        return [
            {
                type: 'goal_gap',
                task_id: last.task_id,
                field: 'contract.outputs',
                message: 'Final task outputs do not cover expected final outputs',
                missing,
                allowed_repair: ['rewrite_task', 'insert_task'],
            },
        ];
    }

    private verifyAgents(contracts: TaskContract[]): HardError[] {
        const errors: HardError[] = [];
        for (const contract of contracts) {
            const seenOrders = new Set<number>();
            const assignedCapabilities = new Set<string>();
            for (const assignment of contract.agents) {
                if (seenOrders.has(assignment.order)) {
                    errors.push({
                        type: 'bad_agent_order',
                        task_id: contract.task_id,
                        field: 'contract.agents',
                        message: 'Agent order values must be unique',
                        missing: [],
                        allowed_repair: ['reorder_agents'],
                    });
                }
                seenOrders.add(assignment.order);
                const card = this.registry.get(assignment.agent);
                if (!card) {
                    errors.push({
                        type: 'bad_agent_fit',
                        task_id: contract.task_id,
                        field: 'contract.agents',
                        message: `Unknown agent: ${assignment.agent}`,
                        missing: [assignment.agent],
                        allowed_repair: ['replace_agent'],
                    });
                } else {
                    for (const capability of card.capabilities) assignedCapabilities.add(capability);
                    for (const tool of toolIds(card)) assignedCapabilities.add(tool);
                }
            }
            const required = this.requiredCapabilities(contract);
            const missing: string[] = [];
            for (const cap of required) {
                if (!assignedCapabilities.has(cap)) missing.push(cap);
            }
            missing.sort();
            if (missing.length > 0) {
                errors.push({
                    type: 'bad_agent_fit',
                    task_id: contract.task_id,
                    field: 'contract.agents',
                    message: 'Assigned agents do not cover inferred task capabilities',
                    missing,
                    allowed_repair: ['replace_agent'],
                });
            }
        }
        return errors;
    }

    private requiredCapabilities(contract: TaskContract): Set<string> {
        const required = new Set<string>();
        const outputsText = contract.outputs.join(' ');
        for (const rule of CAPABILITY_ARTIFACT_RULES) {
            if (matchAny(outputsText, rule.keywords)) required.add(rule.value);
        }
        const inputsText = contract.inputs.join(' ');
        for (const rule of CAPABILITY_INPUT_RULES) {
            if (matchAny(inputsText, rule.keywords)) required.add(rule.value);
        }
        return required;
    }
}
