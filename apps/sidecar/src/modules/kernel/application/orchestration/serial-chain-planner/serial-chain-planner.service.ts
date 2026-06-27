/**
 * Public NestJS entry-point to the planner algorithm.
 *
 * Designed to be injected by the built-in OrchestrationAgent (via forwardRef
 * if needed) and called directly when the agent decides a deterministic plan
 * should be produced. The algorithm itself lives in pure TS modules; this
 * service is thin glue.
 */
import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { ChainPlanner, type TaskViewGenerator } from './chain-planner';
import { chainToGraph, chainFromGraph, collectLockedAgents } from './canvas-adapter';
import { ContractCompiler } from './contract-compiler';
import { ConversationReplanner } from './conversation';
import { HardVerifier } from './verifier';
import { BUILTIN_REGISTRY } from './registry';
import type { AgentRegistryView, Chain, ChainChangeOperation, ChainRevision } from './schemas';
import type { WorkflowDefinitionSpec } from '../workflow-definition.types';

export const PLANNER_TASK_VIEW_GENERATOR = Symbol('PLANNER_TASK_VIEW_GENERATOR');
export const PLANNER_AGENT_REGISTRY = Symbol('PLANNER_AGENT_REGISTRY');

export interface PlanGraphInput {
    prompt: string;
    files?: { name: string; uri: string }[];
    maxTasks?: number;
    chainId?: string;
    /**
     * Called every time a new task record is appended during streaming, and
     * once more with the final verified chain. Receives both the chain and
     * the equivalent canvas graph so callers can pick whichever projection
     * they need (frontend usually wants the graph).
     */
    onProgress?: (result: PlanGraphResult) => void;
    /** Forwarded from the LLM generator's reasoning stream. */
    onReasoning?: (text: string) => void;
}

export interface PlanGraphResult {
    chain: Chain;
    graph: WorkflowDefinitionSpec;
}

export interface ApplyMessageResult {
    chain: Chain;
    graph: WorkflowDefinitionSpec;
    revision: ChainRevision;
    changeSet: ChainChangeOperation[];
    dirtySpan: string[];
    lockedTasks: string[];
}

@Injectable()
export class SerialChainPlannerService {
    private readonly logger = new Logger(SerialChainPlannerService.name);
    private readonly planner: ChainPlanner;
    private readonly replanner: ConversationReplanner;

    constructor(
        @Optional()
        @Inject(PLANNER_TASK_VIEW_GENERATOR)
        viewGenerator?: TaskViewGenerator,
        @Optional()
        @Inject(PLANNER_AGENT_REGISTRY)
        registry?: AgentRegistryView,
    ) {
        const effectiveRegistry: AgentRegistryView = registry ?? BUILTIN_REGISTRY;
        const compiler = new ContractCompiler({ registry: effectiveRegistry });
        const verifier = new HardVerifier({ registry: effectiveRegistry });
        const plannerOpts: ConstructorParameters<typeof ChainPlanner>[0] = {
            compiler,
            verifier,
            registry: effectiveRegistry,
        };
        if (viewGenerator) plannerOpts.viewGenerator = viewGenerator;
        this.planner = new ChainPlanner(plannerOpts);
        this.replanner = new ConversationReplanner({ compiler, verifier });
    }

    /** Generate a verified canvas from a free-form user prompt. */
    async generateGraph(input: PlanGraphInput): Promise<PlanGraphResult> {
        const promptWithFiles = input.files?.length ? appendFileHints(input.prompt, input.files) : input.prompt;
        const opts: Parameters<ChainPlanner['plan']>[0] = { prompt: promptWithFiles };
        if (input.maxTasks !== undefined) opts.maxTasks = input.maxTasks;
        if (input.chainId !== undefined) opts.chainId = input.chainId;
        if (input.onProgress) {
            opts.onProgress = (snapshot) => {
                input.onProgress!({ chain: snapshot, graph: chainToGraph(snapshot) });
            };
        }
        if (input.onReasoning) opts.onReasoning = input.onReasoning;

        const chain = await this.planner.plan(opts);
        if (chain.status !== 'verified') {
            this.logger.warn(
                `Planner produced a chain that did not pass verification on first try: ${chain.repair_trace.length} repair attempts, status=${chain.status}`,
            );
        }
        return { chain, graph: chainToGraph(chain) };
    }

    /** Re-verify and repair an existing canvas, preserving locked agents. */
    async repairGraph(graph: WorkflowDefinitionSpec): Promise<PlanGraphResult> {
        const chain = chainFromGraph(graph);
        const lockedAgents = collectLockedAgents(graph);
        const repaired = this.planner.repair(chain, { lockedAgents });
        return { chain: repaired, graph: chainToGraph(repaired) };
    }

    /** Apply a free-form user message as a deterministic edit on an existing chain. */
    applyMessage(chain: Chain, message: string): ApplyMessageResult {
        const result = this.replanner.apply(chain, message);
        return {
            chain: result.chain,
            graph: chainToGraph(result.chain),
            revision: result.revision,
            changeSet: result.changeSet,
            dirtySpan: result.dirtySpan,
            lockedTasks: result.lockedTasks,
        };
    }

    /** Convenience accessor for tests and callers that already hold a Chain. */
    chainToGraph(chain: Chain): WorkflowDefinitionSpec {
        return chainToGraph(chain);
    }

    chainFromGraph(graph: WorkflowDefinitionSpec): Chain {
        return chainFromGraph(graph);
    }
}

function appendFileHints(prompt: string, files: { name: string; uri: string }[]): string {
    const summary = files
        .map((file) => `- ${file.name} (${file.uri})`)
        .join('\n');
    return `${prompt}\n\n# 已上传文件\n${summary}`;
}
