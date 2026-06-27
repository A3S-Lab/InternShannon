/**
 * Compile a TaskView into a TaskContract by inferring inputs/outputs/criteria
 * from rule tables and binding agents from the registry.
 *
 * Ported from `serial_agent_chain/contract_compiler.py`.
 */
import {
    CONSTRAINT_RULES,
    CRITERIA_RULES,
    INPUT_RULES,
    OUTPUT_RULES,
    SLUG_RULES,
    UPSTREAM_AGGREGATION_KEYWORDS,
    matchAny,
} from './rules';
import { scheduleAgents } from './scheduler';
import type { AgentRegistryView, TaskContract, TaskView } from './schemas';

function unique<T>(items: Iterable<T>): T[] {
    return Array.from(new Set(items));
}

export function slugFromTitle(title: string): string {
    for (const rule of SLUG_RULES) {
        if (matchAny(title, rule.keywords)) return rule.value;
    }
    const ascii = title
        .replace(/[^a-zA-Z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .toLowerCase();
    return ascii || 'task_artifact';
}

export function outputFromView(view: TaskView): string {
    const text = `${view.title} ${view.requirement}`;
    for (const rule of OUTPUT_RULES) {
        if (matchAny(text, rule.keywords)) return rule.value;
    }
    return `${slugFromTitle(view.title)}_report`;
}

function inputsFromView(view: TaskView): string[] {
    const text = `${view.title} ${view.description} ${view.requirement}`;
    const inputs: string[] = ['user_prompt'];
    for (const rule of INPUT_RULES) {
        if (matchAny(text, rule.keywords)) inputs.push(rule.value);
    }
    return unique(inputs);
}

function criteriaFromView(view: TaskView, output: string): string[] {
    const criteria: string[] = [`输出 ${output}`, '结论必须由输入材料或上游产物支撑'];
    const text = `${view.title} ${view.requirement}`;
    for (const rule of CRITERIA_RULES) {
        if (matchAny(text, rule.keywords)) criteria.push(...rule.criteria);
    }
    return unique(criteria);
}

function constraintsFromView(view: TaskView): string[] {
    const text = `${view.title} ${view.requirement}`;
    const constraints: string[] = ['不得补造用户未提供的事实'];
    for (const rule of CONSTRAINT_RULES) {
        if (matchAny(text, rule.keywords)) constraints.push(...rule.constraints);
    }
    return unique(constraints);
}

export interface ContractCompilerOptions {
    registry?: AgentRegistryView;
}

export class ContractCompiler {
    private readonly registry?: AgentRegistryView;

    constructor(options: ContractCompilerOptions = {}) {
        this.registry = options.registry;
    }

    compile(view: TaskView, upstreamOutputs: readonly string[] = []): TaskContract {
        const output = outputFromView(view);
        let inputs = inputsFromView(view);
        const text = `${view.title} ${view.description} ${view.requirement}`;
        if (matchAny(text, UPSTREAM_AGGREGATION_KEYWORDS)) {
            inputs = inputs.concat(upstreamOutputs);
        }
        inputs = unique(inputs);
        return {
            task_id: view.task_id,
            inputs,
            outputs: [output],
            success_criteria: criteriaFromView(view, output),
            constraints: constraintsFromView(view),
            agents: scheduleAgents(view, this.registry ? { registry: this.registry } : {}),
        };
    }
}
