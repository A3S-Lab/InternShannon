/**
 * ChainPlanner — generate task views, compile contracts, verify, and repair.
 *
 * Ported from `serial_agent_chain/planner.py`. The deterministic Chinese
 * fallback that produces a 5-step "材料整理 → 依据对照 → 差距分析 → 建议生成 →
 * 定稿" template is inlined here; pluggable LLM-based generators can replace it
 * by injecting a `TaskViewGenerator` into the SerialChainPlannerService.
 */
import { ContractCompiler } from './contract-compiler';
import { outputFromView } from './contract-compiler';
import { sha256Json } from './hashing';
import { LocalRepairer } from './repair/patch-search';
import {
    ChainStatus,
    type AgentRegistryView,
    type Chain,
    type ChainStatusValue,
    type TaskContract,
    type TaskMetadata,
    type TaskRecord,
    type TaskView,
} from './schemas';
import { HardVerifier } from './verifier';

let chainCounter = 0;
function nextChainId(): string {
    chainCounter += 1;
    return `chain_${String(chainCounter).padStart(4, '0')}`;
}

export interface TaskViewGenerator {
    /**
     * Streaming generator. Implementations that can stream call `onView` for
     * each task view as soon as it's parsed, and additionally return the full
     * array at the end. Implementations that can't stream just return the
     * array; the planner will catch up by snapshotting after the fact.
     * Returning [] falls back to the deterministic template.
     */
    generate(input: {
        prompt: string;
        maxTasks: number;
        onView?: (view: TaskView) => void;
        onReasoning?: (text: string) => void;
    }): Promise<TaskView[]>;
}

export interface ChainPlannerOptions {
    compiler?: ContractCompiler;
    verifier?: HardVerifier;
    registry?: AgentRegistryView;
    viewGenerator?: TaskViewGenerator;
}

export interface PlanInput {
    prompt: string;
    chainId?: string;
    maxTasks?: number;
    /**
     * Called with a fresh `Chain` snapshot every time a task record is added
     * during streaming, and once more after the final verify/repair pass.
     */
    onProgress?: (chain: Chain) => void;
    /**
     * Called with each chunk of reasoning text the model emits before its
     * structured output begins (e.g. MiniMax `reasoning_content`).
     */
    onReasoning?: (text: string) => void;
}

export class ChainPlanner {
    private readonly compiler: ContractCompiler;
    private readonly verifier: HardVerifier;
    private readonly viewGenerator?: TaskViewGenerator;

    constructor(options: ChainPlannerOptions = {}) {
        this.compiler =
            options.compiler ??
            (options.registry ? new ContractCompiler({ registry: options.registry }) : new ContractCompiler());
        this.verifier =
            options.verifier ??
            (options.registry ? new HardVerifier({ registry: options.registry }) : new HardVerifier());
        if (options.viewGenerator) this.viewGenerator = options.viewGenerator;
    }

    async plan(input: PlanInput): Promise<Chain> {
        const maxTasks = input.maxTasks ?? 5;
        const chainId = input.chainId ?? nextChainId();
        const expectedFinal = expectedFinalOutputs(input.prompt);
        const records: TaskRecord[] = [];
        const upstreamOutputs: string[] = [];

        const buildSnapshot = (status: ChainStatusValue = ChainStatus.Draft): Chain => ({
            chain_id: chainId,
            version: 1,
            status,
            records: records.map((record) => ({ ...record })),
            repair_trace: [],
            expected_final_outputs: [...expectedFinal],
            original_prompt: input.prompt,
            current_revision_id: 'rev_0001',
            revision_counter: 1,
            conversation_summary: '',
        });

        const addView = (rawView: TaskView) => {
            if (records.length >= maxTasks) return;
            const view: TaskView = { ...rawView, task_id: `t${records.length + 1}` };
            const contract = this.compiler.compile(view, upstreamOutputs);
            records.push(makeRecord(view, contract));
            upstreamOutputs.push(...contract.outputs);
            input.onProgress?.(buildSnapshot(ChainStatus.Draft));
        };

        const generated = await this.generateTaskViews(input.prompt, maxTasks, {
            onView: addView,
            onReasoning: input.onReasoning,
        });

        // Catch up any views the generator returned without streaming (rule-based
        // fallback or generator implementations that don't honor `onView`).
        for (let i = records.length; i < Math.min(generated.length, maxTasks); i++) {
            addView(generated[i]!);
        }

        const chain = buildSnapshot();
        const verified = this.verifyAndRepair(chain);
        input.onProgress?.(verified);
        return verified;
    }

    /** Re-run verify + repair on an existing chain. Used for canvas repair. */
    repair(chain: Chain, options: { dirtySpan?: string[]; lockedAgents?: ReadonlySet<string> } = {}): Chain {
        const next: Chain = {
            ...chain,
            records: chain.records.map((record) => ({ ...record })),
            repair_trace: [...chain.repair_trace],
            expected_final_outputs: [...chain.expected_final_outputs],
        };
        return this.verifyAndRepair(next, options);
    }

    private async generateTaskViews(
        prompt: string,
        maxTasks: number,
        hooks: {
            onView?: (view: TaskView) => void;
            onReasoning?: (text: string) => void;
        } = {},
    ): Promise<TaskView[]> {
        if (this.viewGenerator) {
            try {
                const llmViews = await this.viewGenerator.generate({
                    prompt,
                    maxTasks,
                    onView: hooks.onView,
                    onReasoning: hooks.onReasoning,
                });
                if (llmViews.length > 0) return llmViews.slice(0, maxTasks);
            } catch {
                // Fall back to deterministic template on any LLM failure.
            }
        }
        return fallbackTaskViews(prompt, maxTasks);
    }

    private verifyAndRepair(
        chain: Chain,
        options: { dirtySpan?: string[]; lockedAgents?: ReadonlySet<string> } = {},
    ): Chain {
        const result = this.verifier.verify(chain);
        if (result.pass) {
            chain.status = ChainStatus.Verified;
            return chain;
        }
        const repairer = new LocalRepairer(this.verifier);
        const { chain: repaired, result: finalResult } = repairer.repair(chain, options);
        repaired.status = finalResult.pass ? ChainStatus.Verified : ChainStatus.NeedsRepair;
        return repaired;
    }
}

// ────────────────────────────────────────────────────────────────────────────
// Helpers (private to this module)
// ────────────────────────────────────────────────────────────────────────────

function makeRecord(view: TaskView, contract: TaskContract, locked = false): TaskRecord {
    const metadata: TaskMetadata = {
        version: 1,
        view_hash: sha256Json(view),
        contract_hash: sha256Json(contract),
        locked,
        created_by: 'planner',
        last_modified_by: 'system',
    };
    return { task_id: view.task_id, view, contract, metadata };
}

function cleanPhrase(value: string, fallback: string): string {
    const trimmed = value.replace(/^[，,。；;\s]+|[，,。；;\s]+$/g, '').trim();
    return trimmed.length > 0 ? trimmed : fallback;
}

function extractBetween(prompt: string, starts: string[], stops: string[]): string | null {
    for (const start of starts) {
        const index = prompt.indexOf(start);
        if (index === -1) continue;
        const begin = index + start.length;
        let end = prompt.length;
        for (const stop of stops) {
            const stopIndex = prompt.indexOf(stop, begin);
            if (stopIndex !== -1) end = Math.min(end, stopIndex);
        }
        const candidate = cleanPhrase(prompt.slice(begin, end), '');
        if (candidate) return candidate;
    }
    return null;
}

function extractDeliverable(prompt: string): string {
    const deliverable = extractBetween(prompt, ['输出一份', '生成一份', '输出', '生成'], ['。', '；', ';', '\n']);
    return cleanPhrase(deliverable ?? '最终交付物', '最终交付物');
}

function extractMaterialScope(prompt: string): string {
    const material = extractBetween(
        prompt,
        ['基于', '根据', '使用', '结合'],
        ['，参照', '，对照', '，依据', '，输出', '，生成', '参照', '对照', '依据', '输出', '生成', '。'],
    );
    return cleanPhrase(material ?? '用户输入材料', '用户输入材料');
}

function extractReferenceScope(prompt: string): string {
    const reference = extractBetween(
        prompt,
        ['参照', '对照', '依据'],
        ['，输出', '，生成', '输出', '生成', '。', '\n'],
    );
    return cleanPhrase(reference ?? '相关标准、政策、规则或业务约束', '相关标准、政策、规则或业务约束');
}

function subjectFromDeliverable(deliverable: string): string {
    const subject = deliverable.replace(/(报告|建议书|方案|清单|结论|说明|文档)$/, '');
    return cleanPhrase(subject, '任务');
}

function appendSuffixOnce(value: string, suffix: string): string {
    return value.endsWith(suffix) ? value : `${value}${suffix}`;
}

function optimizationPhrase(subject: string): string {
    return /优化$|建议$/.test(subject) ? subject : `${subject}优化`;
}

export function expectedFinalOutputs(prompt: string): string[] {
    const deliverable = extractDeliverable(prompt);
    if (deliverable === '最终交付物') return [];
    const probe: TaskView = {
        task_id: 't_final',
        title: deliverable,
        description: deliverable,
        requirement: `输出${deliverable}。`,
    };
    return [outputFromView(probe)];
}

export function fallbackTaskViews(prompt: string, maxTasks: number): TaskView[] {
    const materialScope = extractMaterialScope(prompt);
    const referenceScope = extractReferenceScope(prompt);
    const deliverable = extractDeliverable(prompt);
    const subject = subjectFromDeliverable(deliverable);

    const candidates: Array<[string, string, string]> = [
        [
            '输入材料整理',
            `梳理${materialScope}，提取与${deliverable}相关的基础事实、对象、时间范围和约束条件。`,
            '需识别材料类型、关键信息、缺失项、冲突项和待确认事项；输出标准化材料摘要。',
        ],
        [
            '依据要求对照',
            `对照${referenceScope}，抽取适用于当前任务的审查要求、判断依据和约束边界。`,
            '需列出适用依据、关键条款或规则要求，并形成可用于后续分析的依据对照表。',
        ],
        [
            `${subject}差距分析`,
            `基于标准化材料摘要和依据对照表，分析当前材料或方案与${referenceScope}之间的差距。`,
            '需列出问题项、依据来源、影响范围、风险等级和待补充材料；输出差距及风险清单。',
        ],
        [
            `${appendSuffixOnce(subject, '建议')}生成`,
            `围绕已识别差距和风险，形成可执行的${optimizationPhrase(subject)}建议。`,
            '需给出优化措施、实施步骤、优先级、责任角色和复核事项；输出优化建议草案。',
        ],
        [
            `${deliverable}定稿`,
            `整合材料摘要、依据对照、差距分析和优化建议，形成面向交付的${deliverable}。`,
            `需保证结构完整、依据可追溯、风险和待确认事项明确；输出${deliverable}。`,
        ],
    ];

    let selected: Array<[string, string, string]>;
    if (maxTasks <= 1) selected = [candidates[candidates.length - 1]!];
    else if (maxTasks === 2) selected = [candidates[0]!, candidates[candidates.length - 1]!];
    else if (maxTasks === 3) selected = [candidates[0]!, candidates[2]!, candidates[candidates.length - 1]!];
    else if (maxTasks === 4) selected = [candidates[0]!, candidates[1]!, candidates[2]!, candidates[candidates.length - 1]!];
    else selected = candidates.slice(0, Math.min(maxTasks, candidates.length));

    return selected.map(([title, description, requirement], index) => ({
        task_id: `t${index + 1}`,
        title,
        description,
        requirement,
    }));
}
