import { Injectable, Logger } from '@nestjs/common';
import { WorkflowDefinition, WorkflowExecution, ExecutionStatus, NodeExecutionStatus } from '../domain/entities';
import {
    WorkflowNode,
    WorkflowEdge,
    WorkflowNodeType,
    MaterialDefinition,
    MaterialNodeType,
    isPackageNodeType,
    workflowNodeMaterialPackageId,
} from '../domain/value-objects';
import { ExecutionContext } from './execution-context';
import { resolveNodeErrorDefaultOutput, resolveNodeErrorStrategy } from './node-error-strategy';
import { IsolatedExecutionContext, VariableScope } from './isolated-execution-context';
import { BaseNodeExecutor, NodeExecutorResult } from './executors';
import {
    StartNodeExecutor,
    EndNodeExecutor,
    ConditionNodeExecutor,
    LoopNodeExecutor,
    BlockStartNodeExecutor,
    BlockEndNodeExecutor,
    BreakNodeExecutor,
    ContinueNodeExecutor,
    HTTPNodeExecutor,
    CodeNodeExecutor,
    LLMNodeExecutor,
    PassThroughNodeExecutor,
    AggregatorNodeExecutor,
    TemplateNodeExecutor,
    AnswerNodeExecutor,
    VariableAssignerNodeExecutor,
    QuestionClassifierNodeExecutor,
    ParameterExtractorNodeExecutor,
    ListOperatorNodeExecutor,
} from './executors';
import { PackageNodeExecutor, createPackageExecutor } from './executors/package.executor';
import { LLMCredentialResolver } from './executors/llm-credential-resolver';
import { MaterialRegistry, ExecutorType } from './material-registry';
import { BUILT_IN_PACKAGE_MATERIAL_ID, MaterialService } from './material.service';
import { IWorkflowRuntime, IWorkflowRepository } from '../interfaces';
import { dagScheduler, DagScheduler, NodeDependency } from './dag-scheduler';
import { cancellationRegistry, CancellationToken, CancellationError } from './cancellation-token';
import { mapWithConcurrency, DEFAULT_NODE_FANOUT_CONCURRENCY } from './map-with-concurrency';

export interface WorkflowExecutionOptions {
    executionId?: string;
    rootExecutionId?: string;
    metadata?: Record<string, unknown>;
    /**
     * Seed for the writable `conversation.*` namespace — typically a prior run's
     * persisted conversationVariables, enabling cross-run continuation. Opt-in:
     * when omitted, behaviour is unchanged. The caller decides what defines a
     * "conversation" (kernel session, explicit conversationId, …); the engine
     * only provides the seed mechanism. Overrides the definition's declared defaults.
     */
    conversationVariables?: Record<string, unknown>;
    /** Live token sink — invoked per streamed chunk by streaming executors (LLM /
     *  Answer) so the caller can push tokens to a UI. Held in memory only (not
     *  serialized), so it survives into the background run within the same process. */
    onNodeDelta?: (nodeId: string, text: string) => void;
}

export interface WorkflowEngineOptions {
    /**
     * Maximum number of sibling nodes executed concurrently at a single fan-out
     * point. Bounds the burst of external jobs a wide parallel branch can create.
     * `<= 0` disables the cap (unbounded Promise.all). Defaults to
     * {@link DEFAULT_NODE_FANOUT_CONCURRENCY}.
     */
    maxNodeConcurrency?: number;
}

/**
 * Completed-node state reconstructed from persisted per-node execution rows,
 * used to resume a partially-run execution without replaying finished nodes.
 */
interface ResumeState {
    executedNodeIds: string[];
    skippedNodeIds: string[];
    nodeOutputs: Record<string, Record<string, unknown>>;
}

/**
 * Workflow Engine - core execution engine for workflows
 * Implements full parallel DAG execution with subgraph isolation
 */
@Injectable()
export class WorkflowEngine {
    private static readonly HEARTBEAT_INTERVAL_MS = 15_000;
    /** Branch port id used to route a node's error-handled output (errorStrategy='fail-branch'). */
    static readonly FAIL_BRANCH = 'fail';

    private readonly logger = new Logger(WorkflowEngine.name);
    private readonly materialRegistry: MaterialRegistry;

    /** Live token sinks keyed by executionId. Set from execution options (the
     *  callback can't be persisted), read when the (possibly background) run builds
     *  its ExecutionContext, and cleared when the run finishes. */
    private readonly deltaSinks = new Map<string, (nodeId: string, text: string) => void>();
    private readonly materialService: MaterialService;
    private readonly scheduler: DagScheduler;
    private readonly maxNodeConcurrency: number;

    constructor(
        private readonly runtime: IWorkflowRuntime,
        private readonly repository: IWorkflowRepository,
        materialRegistry?: MaterialRegistry,
        materialService?: MaterialService,
        private readonly llmCredentialResolver?: LLMCredentialResolver,
        options?: WorkflowEngineOptions,
    ) {
        this.materialRegistry = materialRegistry || new MaterialRegistry();
        this.materialService = materialService || new MaterialService();
        this.scheduler = dagScheduler;
        this.maxNodeConcurrency = options?.maxNodeConcurrency ?? DEFAULT_NODE_FANOUT_CONCURRENCY;
        this.registerBuiltInExecutors();
    }

    /**
     * Get the material registry for external access
     */
    getMaterialRegistry(): MaterialRegistry {
        return this.materialRegistry;
    }

    /**
     * Register default built-in executors
     */
    private registerBuiltInExecutors(): void {
        // Control flow executors
        this.materialRegistry.registerExecutorFactory(ExecutorType.Start, () => new StartNodeExecutor());
        this.materialRegistry.registerExecutorFactory(ExecutorType.End, () => new EndNodeExecutor());
        this.materialRegistry.registerExecutorFactory(ExecutorType.Condition, () => new ConditionNodeExecutor());
        this.materialRegistry.registerExecutorFactory(ExecutorType.Loop, () => new LoopNodeExecutor(this.materialRegistry));

        // Block executors
        this.materialRegistry.registerExecutorFactory(ExecutorType.BlockStart, () => new BlockStartNodeExecutor());
        this.materialRegistry.registerExecutorFactory(ExecutorType.BlockEnd, () => new BlockEndNodeExecutor());
        this.materialRegistry.registerExecutorFactory(ExecutorType.Comment, () => new PassThroughNodeExecutor(WorkflowNodeType.Comment));
        this.materialRegistry.registerExecutorFactory(ExecutorType.Group, () => new PassThroughNodeExecutor(WorkflowNodeType.Group));
        // Data-flow executors
        this.materialRegistry.registerExecutorFactory(ExecutorType.Aggregator, () => new AggregatorNodeExecutor());
        this.materialRegistry.registerExecutorFactory(ExecutorType.VariableAssigner, () => new VariableAssignerNodeExecutor());
        this.materialRegistry.registerExecutorFactory(ExecutorType.Template, () => new TemplateNodeExecutor());
        this.materialRegistry.registerExecutorFactory(ExecutorType.Answer, () => new AnswerNodeExecutor());
        this.materialRegistry.registerExecutorFactory(ExecutorType.ListOperator, () => new ListOperatorNodeExecutor());

        // Loop control executors
        this.materialRegistry.registerExecutorFactory(ExecutorType.Break, () => new BreakNodeExecutor());
        this.materialRegistry.registerExecutorFactory(ExecutorType.Continue, () => new ContinueNodeExecutor());

        // Execution executors
        this.materialRegistry.registerExecutorFactory(ExecutorType.LLM, () => new LLMNodeExecutor(this.llmCredentialResolver));
        this.materialRegistry.registerExecutorFactory(ExecutorType.HTTP, () => new HTTPNodeExecutor());
        this.materialRegistry.registerExecutorFactory(ExecutorType.Code, () => new CodeNodeExecutor());
        this.materialRegistry.registerExecutorFactory(ExecutorType.QuestionClassifier, () => new QuestionClassifierNodeExecutor(this.llmCredentialResolver));
        this.materialRegistry.registerExecutorFactory(ExecutorType.ParameterExtractor, () => new ParameterExtractorNodeExecutor(this.llmCredentialResolver));

        // Package executor factory
        this.materialRegistry.registerExecutorFactory(ExecutorType.Package, createPackageExecutor);

        this.logger.debug('Registered built-in executor factories');
    }

    /**
     * Load materials for a workflow definition
     */
    async loadWorkflowMaterials(definition: WorkflowDefinition): Promise<void> {
        const materialRefs = new Map<string, MaterialDefinition>();

        for (const node of definition.graph.nodes) {
            const packageId = workflowNodeMaterialPackageId(node);
            if (packageId && !materialRefs.has(packageId)) {
                const material = await this.loadMaterialDefinition(packageId);
                if (material) {
                    materialRefs.set(packageId, material);
                }
            }
            if (isPackageNodeType(node.type) && !materialRefs.has(BUILT_IN_PACKAGE_MATERIAL_ID)) {
                const material = await this.loadMaterialDefinition(BUILT_IN_PACKAGE_MATERIAL_ID);
                if (material) {
                    materialRefs.set(BUILT_IN_PACKAGE_MATERIAL_ID, material);
                }
            }
        }

        for (const material of materialRefs.values()) {
            await this.materialRegistry.loadMaterial(material);
        }

        this.logger.debug(`Loaded ${materialRefs.size} materials for workflow: ${definition.id}`);
    }

    protected async loadMaterialDefinition(packageId: string): Promise<MaterialDefinition | null> {
        return this.materialService.getMaterialById(packageId);
    }

    /**
     * Pre-load materials for a workflow definition
     */
    async prepareExecution(definitionId: string): Promise<void> {
        const definition = await this.repository.findDefinitionById(definitionId);
        if (!definition) {
            throw new Error(`Workflow definition ${definitionId} not found`);
        }
        await this.loadWorkflowMaterials(definition);
    }

    /**
     * Register a custom node executor directly
     */
    registerExecutor(type: string, executor: BaseNodeExecutor): void {
        this.materialRegistry.registerExecutorFactory(type, () => executor);
    }

    /**
     * Register executor factory for custom node types
     */
    registerExecutorFactory(
        executorType: string,
        factory: (nodeType: MaterialNodeType) => BaseNodeExecutor,
    ): void {
        this.materialRegistry.registerExecutorFactory(executorType, factory);
    }

    private getExecutor(type: string): BaseNodeExecutor | undefined {
        return this.materialRegistry.getExecutor(type);
    }

    /**
     * Execute a workflow with full parallel execution support
     */
    async execute(
        definitionId: string,
        input: Record<string, unknown>,
        parentExecutionId?: string,
        options: WorkflowExecutionOptions = {},
    ): Promise<WorkflowExecution> {
        const definition = await this.prepareDefinitionForExecution(definitionId);
        const execution = await this.createExecution(definition, input, parentExecutionId, options);
        await this.runExecutionSafely(execution, definition);

        return execution;
    }

    /**
     * Submit a workflow for background execution.
     */
    async submit(
        definitionId: string,
        input: Record<string, unknown>,
        parentExecutionId?: string,
        options: WorkflowExecutionOptions = {},
    ): Promise<WorkflowExecution> {
        const definition = await this.prepareDefinitionForExecution(definitionId);
        const execution = await this.createExecution(definition, input, parentExecutionId, options);
        this.scheduleBackgroundExecution(execution, definition);
        return execution;
    }

    /**
     * Run a single node in isolation with the given inputs — the engine primitive
     * behind the designer's "test this node" (Dify-style single-step debug). Builds
     * a throwaway context (no persistence, no events, no scheduling) and invokes the
     * node's executor directly. `seededNodeOutputs` lets the node reference upstream
     * outputs the caller supplies (e.g. mock data) via `${nodes.x.output.y}`. Only
     * built-in executors resolve here; package/agent nodes use the debug-run path.
     */
    async runNode(
        node: WorkflowNode,
        inputs: Record<string, unknown> = {},
        seededNodeOutputs: Record<string, Record<string, unknown>> = {},
    ): Promise<NodeExecutorResult> {
        const executor = this.getExecutor(node.type);
        if (!executor) {
            throw new Error(`No executor for node type: ${node.type}`);
        }
        const now = new Date();
        const execution: WorkflowExecution = {
            id: `single-${node.id}`,
            workflowDefinitionId: 'single-node',
            version: '0',
            input: inputs,
            status: ExecutionStatus.Running,
            currentNodeIds: [],
            executedNodeIds: [],
            failedNodeIds: [],
            variables: {},
            nodeOutputs: seededNodeOutputs,
            createdAt: now,
        };
        const definition: WorkflowDefinition = {
            id: 'single-node',
            packageId: 'single-node',
            version: '0',
            name: 'single-node',
            graph: { nodes: [node], edges: [] },
            createdAt: now,
            updatedAt: now,
        };
        // The executor resolves its business inputs internally from the node's
        // inputsValues against this context, so the seeded `inputs` (→ variables)
        // and `seededNodeOutputs` (→ `${nodes.x.output}`) are what its bindings read.
        const context = new ExecutionContext(execution, definition, this.runtime, new Map([[node.id, node]]), new Map());
        return executor.execute(context, node);
    }

    /**
     * Resume an existing pending execution from repository state.
     */
    async resume(executionId: string): Promise<WorkflowExecution> {
        const execution = await this.repository.findExecutionById(executionId);
        if (!execution) {
            throw new Error(`Workflow execution ${executionId} not found`);
        }
        if (execution.status !== ExecutionStatus.Pending) {
            throw new Error(`Workflow execution ${executionId} is not pending`);
        }
        const definition = await this.prepareDefinitionForExecution(execution.workflowDefinitionId);
        const resumeState = await this.reconstructResumeState(executionId);
        await this.runExecutionSafely(execution, definition, resumeState);
        return execution;
    }

    /**
     * Rebuild completed-node state from the persisted per-node execution rows so
     * a resumed run skips already-succeeded nodes instead of replaying from the
     * Start node (which re-fires their side effects — duplicate external jobs for
     * Package nodes). The per-node rows are the incremental checkpoint: each is
     * written Succeeded/Skipped with its output as the node completes. Running /
     * pending / failed nodes are left unseeded so resume re-drives them.
     */
    private async reconstructResumeState(executionId: string): Promise<ResumeState> {
        const nodeExecutions = await this.repository.findNodeExecutionsByExecutionId(executionId);
        const executedNodeIds: string[] = [];
        const skippedNodeIds: string[] = [];
        const nodeOutputs: Record<string, Record<string, unknown>> = {};
        for (const nodeExec of nodeExecutions) {
            if (nodeExec.status === NodeExecutionStatus.Succeeded) {
                executedNodeIds.push(nodeExec.nodeId);
                if (nodeExec.output) {
                    nodeOutputs[nodeExec.nodeId] = nodeExec.output;
                }
            } else if (nodeExec.status === NodeExecutionStatus.Skipped) {
                skippedNodeIds.push(nodeExec.nodeId);
            }
        }
        return { executedNodeIds, skippedNodeIds, nodeOutputs };
    }

    private async prepareDefinitionForExecution(definitionId: string): Promise<WorkflowDefinition> {
        const definition = await this.repository.findDefinitionById(definitionId);
        if (!definition) {
            throw new Error(`Workflow definition ${definitionId} not found`);
        }
        await this.loadWorkflowMaterials(definition);
        return definition;
    }

    private async createExecution(
        definition: WorkflowDefinition,
        input: Record<string, unknown>,
        parentExecutionId?: string,
        options: WorkflowExecutionOptions = {},
    ): Promise<WorkflowExecution> {
        const execution: WorkflowExecution = {
            id: options.executionId ?? this.generateId(),
            workflowDefinitionId: definition.id,
            version: definition.version,
            input,
            status: ExecutionStatus.Pending,
            currentNodeIds: [],
            executedNodeIds: [],
            failedNodeIds: [],
            variables: {},
            nodeOutputs: {},
            conversationVariables: options.conversationVariables,
            metadata: options.metadata,
            parentExecutionId,
            rootExecutionId: options.rootExecutionId ?? parentExecutionId,
            createdAt: new Date(),
        };
        await this.repository.saveExecution(execution);
        if (options.onNodeDelta) {
            this.deltaSinks.set(execution.id, options.onNodeDelta);
        }
        return execution;
    }

    private scheduleBackgroundExecution(
        execution: WorkflowExecution,
        definition: WorkflowDefinition,
    ): void {
        setTimeout(() => {
            void this.runExecutionSafely(execution, definition);
        }, 0);
    }

    private async runExecutionSafely(
        execution: WorkflowExecution,
        definition: WorkflowDefinition,
        resumeState?: ResumeState,
    ): Promise<void> {
        try {
            await this.runExecution(execution, definition, resumeState);
        } catch (error) {
            execution.status = ExecutionStatus.Failed;
            execution.error = error instanceof Error ? error.message : String(error);
            execution.completedAt = new Date();
            await this.repository.updateExecutionStatus(execution.id, {
                status: ExecutionStatus.Failed,
                error: execution.error,
                completedAt: execution.completedAt,
            });
        }
    }

    /**
     * Run the actual execution with recursive sequential execution
     * Follows Flowgram.ai's execution model
     */
    private async runExecution(
        execution: WorkflowExecution,
        definition: WorkflowDefinition,
        resumeState?: ResumeState,
    ): Promise<void> {
        // Build node and edge maps
        const nodeMap = new Map<string, WorkflowNode>();
        const edgeMap = new Map<string, WorkflowEdge[]>();

        for (const node of definition.graph.nodes) {
            nodeMap.set(node.id, node);
            edgeMap.set(node.id, []);
        }
        for (const edge of definition.graph.edges) {
            const edges = edgeMap.get(edge.sourceNodeId) || [];
            edges.push(edge);
            edgeMap.set(edge.sourceNodeId, edges);
        }

        // Find start node
        const startNode = definition.graph.nodes.find((n) => n.type === WorkflowNodeType.Start);
        if (!startNode) {
            throw new Error('Workflow has no start node');
        }

        // Update status to running
        execution.status = ExecutionStatus.Running;
        execution.startedAt = new Date();
        await this.repository.updateExecutionStatus(execution.id, {
            status: ExecutionStatus.Running,
            startedAt: execution.startedAt,
        });
        await this.touchExecution(execution);
        const stopHeartbeat = this.startExecutionHeartbeat(execution);

        // Create execution context
        const context = new ExecutionContext(
            execution,
            definition,
            this.runtime,
            nodeMap,
            edgeMap,
        );

        // Wire the live token sink (if the caller supplied one via options) so
        // streaming executors can push chunks out as they arrive.
        context.setDeltaSink(this.deltaSinks.get(execution.id));

        // On resume, seed the context with already-finished nodes so traversal
        // re-drives only the unfinished frontier instead of replaying from Start.
        if (resumeState) {
            context.restoreCompletedState(resumeState);
        }

        // Fresh runs start at the Start node (which fans out to the rest of the
        // graph). Resumed runs start at the frontier left by the previous run.
        const entryNodes = resumeState
            ? this.computeFrontierNodes(context, definition)
            : [startNode];

        // Start recursive execution from the entry nodes
        try {
            await mapWithConcurrency(
                entryNodes,
                this.maxNodeConcurrency,
                (entryNode) => this.executeNode(context, entryNode),
            );

            // Sync context nodeOutputs to execution
            const snapshot = context.toSnapshot();
            execution.executedNodeIds = snapshot.executedNodeIds;
            execution.failedNodeIds = snapshot.failedNodeIds;
            execution.currentNodeIds = [];
            execution.nodeOutputs = snapshot.nodeOutputs;
            execution.variables = snapshot.variables;

            // Check if workflow completed successfully
            const endNode = definition.graph.nodes.find((n) => n.type === WorkflowNodeType.End);
            if (endNode && context.isNodeExecuted(endNode.id)) {
                const output = context.getNodeOutputs(endNode.id);
                execution.output = output;
                execution.status = ExecutionStatus.Succeeded;
                execution.completedAt = new Date();
                await this.repository.updateExecutionStatus(execution.id, {
                    status: ExecutionStatus.Succeeded,
                    output,
                    currentNodeIds: execution.currentNodeIds,
                    executedNodeIds: execution.executedNodeIds,
                    failedNodeIds: execution.failedNodeIds,
                    variables: execution.variables,
                    nodeOutputs: execution.nodeOutputs,
                    completedAt: execution.completedAt,
                });
                await this.touchExecution(execution);
            } else if (context.cancelledNodes.size > 0) {
                // The execution was cancelled mid-flight. Report Cancelled (not
                // Failed) — this also matches what an external cancel() writes,
                // so the two writers no longer race to opposite terminal states.
                execution.status = ExecutionStatus.Cancelled;
                execution.completedAt = new Date();
                await this.repository.updateExecutionStatus(execution.id, {
                    status: ExecutionStatus.Cancelled,
                    currentNodeIds: execution.currentNodeIds,
                    executedNodeIds: execution.executedNodeIds,
                    failedNodeIds: execution.failedNodeIds,
                    variables: execution.variables,
                    nodeOutputs: execution.nodeOutputs,
                    completedAt: execution.completedAt,
                });
                await this.touchExecution(execution);
            } else if (context.failedNodes.size > 0) {
                execution.status = ExecutionStatus.Failed;
                execution.completedAt = new Date();
                await this.repository.updateExecutionStatus(execution.id, {
                    status: ExecutionStatus.Failed,
                    currentNodeIds: execution.currentNodeIds,
                    executedNodeIds: execution.executedNodeIds,
                    failedNodeIds: execution.failedNodeIds,
                    variables: execution.variables,
                    nodeOutputs: execution.nodeOutputs,
                    completedAt: execution.completedAt,
                });
                await this.touchExecution(execution);
            } else {
                execution.status = ExecutionStatus.Failed;
                execution.error = endNode ? 'Workflow did not reach end node' : 'Workflow has no end node';
                execution.completedAt = new Date();
                await this.repository.updateExecutionStatus(execution.id, {
                    status: ExecutionStatus.Failed,
                    error: execution.error,
                    currentNodeIds: execution.currentNodeIds,
                    executedNodeIds: execution.executedNodeIds,
                    failedNodeIds: execution.failedNodeIds,
                    variables: execution.variables,
                    nodeOutputs: execution.nodeOutputs,
                    completedAt: execution.completedAt,
                });
                await this.touchExecution(execution);
            }
        } catch (error) {
            const snapshot = context.toSnapshot();
            execution.status = ExecutionStatus.Failed;
            execution.error = error instanceof Error ? error.message : String(error);
            execution.currentNodeIds = [];
            execution.executedNodeIds = snapshot.executedNodeIds;
            execution.failedNodeIds = snapshot.failedNodeIds;
            execution.variables = snapshot.variables;
            execution.nodeOutputs = snapshot.nodeOutputs;
            execution.completedAt = new Date();
            await this.repository.updateExecutionStatus(execution.id, {
                status: ExecutionStatus.Failed,
                error: execution.error,
                currentNodeIds: execution.currentNodeIds,
                executedNodeIds: execution.executedNodeIds,
                failedNodeIds: execution.failedNodeIds,
                variables: execution.variables,
                nodeOutputs: execution.nodeOutputs,
                completedAt: execution.completedAt,
            });
            await this.touchExecution(execution);
        } finally {
            stopHeartbeat();
            this.deltaSinks.delete(execution.id);
        }
    }

    /**
     * Execute a single node and then proceed to next nodes based on branch
     */
    private async executeNode(context: ExecutionContext, node: WorkflowNode): Promise<void> {
        if (context.isNodeExecuted(node.id) || context.isNodeSkipped(node.id) || context.isNodePending(node.id)) {
            return;
        }

        // Check if all predecessors are executed
        if (!context.allPredecessorsExecuted(node.id)) {
            return;
        }

        // Claim the node synchronously, before the first await. With parallel
        // fan-out (executeNext -> Promise.all), two predecessors of a diamond
        // join can both observe the join's predecessors as executed and reach
        // this point; marking it pending here — guarded by isNodePending above —
        // ensures the join executes exactly once instead of racing into a
        // duplicate run (and, for Package nodes, a duplicate external job).
        context.markNodePending(node.id);

        // Get or create cancellation token
        const executionId = context.execution.id;
        const token = cancellationRegistry.get(executionId, node.id)
            || cancellationRegistry.register(executionId, node.id);

        let result: NodeExecutorResult | undefined;
        let terminated = false;

        try {
            context.execution.currentNodeIds = this.addNodeId(context.execution.currentNodeIds, node.id);
            await this.repository.updateExecutionStatus(context.execution.id, {
                currentNodeIds: context.execution.currentNodeIds,
            });
            await this.touchExecution(context.execution, { lastHeartbeatNodeId: node.id });
            await this.repository.saveNodeExecution({
                id: this.nodeExecutionId(context.execution.id, node.id),
                executionId: context.execution.id,
                nodeId: node.id,
                nodeType: node.type,
                status: NodeExecutionStatus.Pending,
                input: this.nodeExecutionInput(context, node),
                createdAt: new Date(),
            });
            await this.repository.updateNodeExecutionStatus(this.nodeExecutionId(context.execution.id, node.id), {
                status: NodeExecutionStatus.Running,
                startedAt: new Date(),
            });

            const executor = this.getExecutor(node.type);
            if (!executor) {
                throw new Error(`No executor for node type: ${node.type}`);
            }

            // Check for cancellation before execution
            token.throwIfCancelled();

            // Execute with retry policy, then apply the node's error-handling
            // strategy (aligned with Dify: none / default-value / fail-branch).
            // Only genuinely unhandled errors propagate to the outer catch (abort).
            try {
                result = await this.executeWithRetry(executor, context, node, token);
            } catch (error) {
                if (error instanceof CancellationError) {
                    throw error;
                }
                const handled = this.applyErrorStrategy(node, error);
                if (!handled) {
                    throw error;
                }
                this.logger.warn(
                    `Node ${node.id} failed but was handled by errorStrategy=${(node.data as { errorStrategy?: string }).errorStrategy}: ${error instanceof Error ? error.message : String(error)}`,
                );
                result = handled;
            }

            // Check for cancellation after execution
            token.throwIfCancelled();

            context.markNodeExecuted(node.id);
            context.execution.currentNodeIds = this.removeNodeId(context.execution.currentNodeIds, node.id);
            await this.repository.updateNodeExecutionStatus(this.nodeExecutionId(context.execution.id, node.id), {
                status: NodeExecutionStatus.Succeeded,
                output: result.outputs,
                completedAt: new Date(),
            });
            await this.repository.updateExecutionStatus(context.execution.id, {
                currentNodeIds: context.execution.currentNodeIds,
            });
            await this.touchExecution(context.execution, { lastHeartbeatNodeId: node.id });

            // Check if workflow was terminated (by End node, Break, Continue, etc.)
            terminated = this.isTerminatingNode(node.type);
        } catch (error) {
            if (error instanceof CancellationError) {
                context.markNodeCancelled(node.id);
                context.execution.currentNodeIds = this.removeNodeId(context.execution.currentNodeIds, node.id);
                await this.repository.updateNodeExecutionStatus(this.nodeExecutionId(context.execution.id, node.id), {
                    status: NodeExecutionStatus.Skipped,
                    completedAt: new Date(),
                });
                await this.repository.updateExecutionStatus(context.execution.id, {
                    currentNodeIds: context.execution.currentNodeIds,
                });
                await this.touchExecution(context.execution, { lastHeartbeatNodeId: node.id });
                return;
            }
            context.execution.currentNodeIds = this.removeNodeId(context.execution.currentNodeIds, node.id);
            const message = error instanceof Error ? error.message : String(error);
            const strategy = resolveNodeErrorStrategy(node.data);

            if (strategy !== 'fail') {
                // Per-node error handling (Dify parity): swallow the failure, emit a
                // fallback output, and continue downstream instead of failing the run.
                // The node is recorded Succeeded (so successors' predecessor-gate
                // passes) but keeps the original `error` for the debug drawer.
                const fallback = strategy === 'default' ? resolveNodeErrorDefaultOutput(node.data) : {};
                context.setNodeOutputs(node.id, fallback);
                context.markNodeExecuted(node.id);
                result = { outputs: fallback };
                await this.repository.updateNodeExecutionStatus(this.nodeExecutionId(context.execution.id, node.id), {
                    status: NodeExecutionStatus.Succeeded,
                    output: fallback,
                    error: message,
                    completedAt: new Date(),
                });
                await this.repository.updateExecutionStatus(context.execution.id, {
                    currentNodeIds: context.execution.currentNodeIds,
                });
                await this.touchExecution(context.execution, { lastHeartbeatNodeId: node.id });
                terminated = this.isTerminatingNode(node.type);
            } else {
                context.markNodeFailed(node.id);
                await this.repository.updateNodeExecutionStatus(this.nodeExecutionId(context.execution.id, node.id), {
                    status: NodeExecutionStatus.Failed,
                    error: message,
                    completedAt: new Date(),
                });
                await this.repository.updateExecutionStatus(context.execution.id, {
                    currentNodeIds: context.execution.currentNodeIds,
                });
                await this.touchExecution(context.execution, { lastHeartbeatNodeId: node.id });
                throw error;
            }
        } finally {
            cancellationRegistry.unregister(executionId, node.id);
        }

        // If terminated, don't proceed to next nodes
        if (terminated) {
            return;
        }

        const nextNodes = result?.branch
            ? context.getNextNodes(node.id, result.branch)
            : (node.type === WorkflowNodeType.Condition ? [] : context.getNextNodes(node.id));
        if (result?.branch) {
            const selectedNodeIds = new Set(nextNodes.map((nextNode) => nextNode.id));
            const skippedNodes = context.getSuccessors(node.id).filter((nextNode) => !selectedNodeIds.has(nextNode.id));
            await mapWithConcurrency(skippedNodes, this.maxNodeConcurrency, (skippedNode) => this.skipBranch(context, skippedNode));
        }

        // Execute next nodes
        await this.executeNext(context, node, nextNodes);
    }

    private async skipBranch(context: ExecutionContext, node: WorkflowNode): Promise<void> {
        if (context.isNodeExecuted(node.id) || context.isNodeSkipped(node.id) || context.isNodeFailed(node.id)) {
            return;
        }

        const nodeExecutionId = this.nodeExecutionId(context.execution.id, node.id);
        await this.repository.saveNodeExecution({
            id: nodeExecutionId,
            executionId: context.execution.id,
            nodeId: node.id,
            nodeType: node.type,
            status: NodeExecutionStatus.Pending,
            input: this.nodeExecutionInput(context, node),
            createdAt: new Date(),
        });

        context.markNodeSkipped(node.id);
        await this.repository.updateNodeExecutionStatus(nodeExecutionId, {
            status: NodeExecutionStatus.Skipped,
            completedAt: new Date(),
        });

        for (const successor of context.getSuccessors(node.id)) {
            const openPredecessors = context
                .getPrevNodes(successor.id)
                .filter((predecessor) => !context.isNodeSkipped(predecessor.id));
            if (openPredecessors.length === 0) {
                await this.skipBranch(context, successor);
            }
        }
    }

    /**
     * Execute next nodes after current node completes
     */
    private async executeNext(
        context: ExecutionContext,
        node: WorkflowNode,
        nextNodes: WorkflowNode[],
    ): Promise<void> {
        if (nextNodes.length === 0) {
            // Inside a loop, nodes may have no next nodes - this is expected
            return;
        }

        // Execute next nodes in parallel, but cap the fan-out so a wide branch
        // cannot burst-create more than `maxNodeConcurrency` external jobs at once.
        await mapWithConcurrency(
            nextNodes,
            this.maxNodeConcurrency,
            (nextNode) => this.executeNode(context, nextNode),
        );
    }

    /**
     * Nodes that are ready to run: not yet finished and with every predecessor
     * already executed or skipped. For a fresh run this would be just the Start
     * node; on resume it is the unfinished frontier left by the previous run.
     */
    private computeFrontierNodes(context: ExecutionContext, definition: WorkflowDefinition): WorkflowNode[] {
        return definition.graph.nodes.filter((node) =>
            !context.isNodeExecuted(node.id)
            && !context.isNodeSkipped(node.id)
            && !context.isNodeFailed(node.id)
            && context.allPredecessorsExecuted(node.id),
        );
    }

    /**
     * Check if node type terminates execution flow
     */
    private isTerminatingNode(type: string): boolean {
        return [
            WorkflowNodeType.End,
            WorkflowNodeType.BlockEnd,
            WorkflowNodeType.Break,
            WorkflowNodeType.Continue,
        ].includes(type as WorkflowNodeType);
    }

    private nodeExecutionId(executionId: string, nodeId: string): string {
        return `${executionId}:${nodeId}`;
    }

    private nodeExecutionInput(context: ExecutionContext, node: WorkflowNode): Record<string, unknown> {
        return {
            variables: context.getAllVariables(),
            nodeData: node.data,
        };
    }

    private addNodeId(nodeIds: string[], nodeId: string): string[] {
        return nodeIds.includes(nodeId) ? nodeIds : [...nodeIds, nodeId];
    }

    private removeNodeId(nodeIds: string[], nodeId: string): string[] {
        return nodeIds.filter((id) => id !== nodeId);
    }

    /**
     * Apply a node's error-handling strategy after retries are exhausted
     * (aligned with Dify). Returns a NodeExecutorResult to continue with, or
     * undefined to let the error propagate and abort the workflow.
     *
     *  - 'default-value': swallow the error, emit the predefined defaultValue
     *    outputs (plus `error`/`errorHandled` markers) and continue the main path.
     *  - 'fail-branch': emit an error output and route to the node's `fail`
     *    branch edges (sourcePortId === 'fail') via the normal branch mechanism;
     *    if no fail edge is connected, the downstream path simply ends.
     *  - 'none' / unset: undefined → abort (existing behaviour).
     */
    private applyErrorStrategy(node: WorkflowNode, error: unknown): NodeExecutorResult | undefined {
        const data = (node.data ?? {}) as { errorStrategy?: string; defaultValue?: unknown };
        const message = error instanceof Error ? error.message : String(error);
        if (data.errorStrategy === 'default-value') {
            const dv = data.defaultValue;
            const base = dv !== null && typeof dv === 'object' && !Array.isArray(dv) ? (dv as Record<string, unknown>) : {};
            return { outputs: { ...base, error: message, errorHandled: true } };
        }
        if (data.errorStrategy === 'fail-branch') {
            return { outputs: { error: message, errorHandled: true }, branch: WorkflowEngine.FAIL_BRANCH };
        }
        return undefined;
    }

    /**
     * Execute node with retry policy
     */
    private async executeWithRetry(
        executor: BaseNodeExecutor,
        context: ExecutionContext,
        node: WorkflowNode,
        token: CancellationToken,
    ): Promise<NodeExecutorResult> {
        const retryPolicy = (node.data as any).retryPolicy;
        const maxRetries = retryPolicy?.maxRetries ?? 0;
        const retryDelay = retryPolicy?.retryDelay ?? 1000;

        let lastError: Error | undefined;

        for (let attempt = 0; attempt <= maxRetries; attempt++) {
            try {
                return await executor.execute(context, node, token);
            } catch (error) {
                lastError = error as Error;

                // Don't retry on cancellation
                if (error instanceof CancellationError) {
                    throw error;
                }

                // Last attempt, don't retry
                if (attempt === maxRetries) {
                    break;
                }

                // Log retry attempt
                this.logger.warn(
                    `Node ${node.id} failed (attempt ${attempt + 1}/${maxRetries + 1}), retrying in ${retryDelay}ms: ${lastError.message}`
                );

                // Wait before retry with exponential backoff
                const backoff = retryDelay * Math.pow(2, attempt);
                await this.sleep(backoff);

                // Check for cancellation before retry
                token.throwIfCancelled();
            }
        }

        throw lastError;
    }

    /**
     * Sleep for specified milliseconds
     */
    private sleep(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    private startExecutionHeartbeat(execution: WorkflowExecution): () => void {
        const timer = setInterval(() => void this.touchExecution(execution), WorkflowEngine.HEARTBEAT_INTERVAL_MS);
        timer.unref?.();
        return () => clearInterval(timer);
    }

    private async touchExecution(
        execution: WorkflowExecution,
        metadata: Record<string, unknown> = {},
    ): Promise<void> {
        const heartbeatMetadata = {
            lastHeartbeatAt: new Date().toISOString(),
            lastHeartbeatStatus: execution.status,
            lastHeartbeatNodeIds: execution.currentNodeIds,
            ...metadata,
        };
        execution.metadata = {
            ...(execution.metadata ?? {}),
            ...heartbeatMetadata,
        };
        try {
            await this.repository.touchExecution?.(execution.id, heartbeatMetadata);
        } catch (error) {
            this.logger.warn(`Failed to update workflow execution heartbeat: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    /**
     * Cancel a running execution
     */
    async cancel(executionId: string): Promise<void> {
        const execution = await this.repository.findExecutionById(executionId);
        if (!execution) {
            throw new Error(`Execution ${executionId} not found`);
        }

        if (execution.status !== ExecutionStatus.Running) {
            throw new Error(`Execution ${executionId} is not running`);
        }

        // Cancel all running node executions
        cancellationRegistry.cancelAll(executionId);

        const nodeExecutions = await this.repository.findNodeExecutionsByExecutionId(executionId);
        for (const nodeExec of nodeExecutions) {
            if (nodeExec.jobId && nodeExec.status === 'running') {
                await this.runtime.cancelJob(nodeExec.jobId);
            }
        }

        await this.repository.updateExecutionStatus(executionId, {
            status: ExecutionStatus.Cancelled,
            completedAt: new Date(),
        });
    }

    private generateId(): string {
        return `exec_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
    }
}
