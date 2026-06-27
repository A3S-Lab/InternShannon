import { WorkflowDefinition, WorkflowExecution, NodeExecution, ExecutionStatus, NodeExecutionStatus } from '../domain/entities';
import { WorkflowNode, WorkflowEdge, FlowValue, FlowValueType } from '../domain/value-objects';
import { IWorkflowRuntime } from '../interfaces';
import { expressionEvaluator } from './expression-evaluator';

/**
 * Template helper functions exposed inside `${expr}` evaluation. Mirrors
 * the historical runtime data-mapping service
 * `tryFunctionCall()`. The runtime layer and engine layer are two parallel
 * template engines today; this set is the contract between them — keep them
 * in lockstep until the duplication is collapsed.
 */
export const TEMPLATE_HELPERS: Record<string, (...args: unknown[]) => unknown> = {
    coalesce: (...args: unknown[]) =>
        args.find(arg => arg !== undefined && arg !== null && arg !== ''),
    concat: (...args: unknown[]) => args.map(stringifyHelperValue).join(''),
    join: (arr: unknown, sep?: unknown) =>
        Array.isArray(arr) ? arr.map(stringifyHelperValue).join(String(sep ?? ',')) : '',
    length: (value: unknown) =>
        typeof value === 'string' || Array.isArray(value)
            ? value.length
            : value && typeof value === 'object'
                ? Object.keys(value as Record<string, unknown>).length
                : 0,
    toNumber: (value: unknown) => Number(value ?? 0),
    toString: (value: unknown) => stringifyHelperValue(value),
    toBoolean: (value: unknown) => Boolean(value),
    lower: (value: unknown) => stringifyHelperValue(value).toLowerCase(),
    upper: (value: unknown) => stringifyHelperValue(value).toUpperCase(),
    json: (value: unknown) => JSON.stringify(value ?? null),
    now: () => new Date().toISOString(),
};

function stringifyHelperValue(value: unknown): string {
    if (value === null || value === undefined) return '';
    if (typeof value === 'string') return value;
    return JSON.stringify(value);
}

/**
 * ExecutionContext - runtime context for workflow execution
 */
export class ExecutionContext {
    private variables: Map<string, unknown> = new Map();
    /** Deploy-time environment variables, exposed to expressions as `env.*` (Dify-aligned, read-only). */
    private readonly environmentVariables: Record<string, unknown>;
    /** Conversation/session variables, exposed as `conversation.*` (Dify-aligned, writable + persisted). */
    private conversationVariables: Map<string, unknown> = new Map();
    public nodeOutputs: Map<string, Map<string, unknown>> = new Map();
    private portOutputs: Map<string, Map<string, unknown>> = new Map();
    private executedNodes: Set<string> = new Set();
    private pendingNodes: Set<string> = new Set();
    private skippedNodes: Set<string> = new Set();
    public failedNodes: Set<string> = new Set();
    public cancelledNodes: Set<string> = new Set();
    /** Stack of active loop node IDs for nested loop break/continue support */
    private loopStack: string[] = [];
    /** Cache for execution control (break/continue flags) */
    public cache: Map<string, unknown> = new Map();
    /** Sub-contexts created by this context */
    private subContexts: ExecutionContext[] = [];

    /** Optional package executors map (for JS runtime) */
    private packageExecutors?: Map<string, (input: Record<string, unknown>) => Promise<Record<string, unknown>>>;

    /** Optional live token sink — set by the engine from execution options so a
     *  streaming executor (LLM / Answer) can push `text_delta` chunks to the UI as
     *  they arrive. Ephemeral; never persisted. */
    private deltaSink?: (nodeId: string, text: string) => void;

    constructor(
        public readonly execution: WorkflowExecution,
        public readonly definition: WorkflowDefinition,
        public readonly runtime: IWorkflowRuntime | null,
        private nodeMap: Map<string, WorkflowNode>,
        private edgeMap: Map<string, WorkflowEdge[]>,
    ) {
        // Deploy-time environment variables (read-only `env.*` namespace).
        this.environmentVariables = definition.environmentVariables ?? {};
        // Conversation variables (writable `conversation.*` namespace): start from
        // the definition's declared defaults, then overlay the execution's own
        // values so a resumed / continued conversation keeps its latest state.
        for (const [key, value] of Object.entries(definition.conversationVariables ?? {})) {
            this.conversationVariables.set(key, value);
        }
        for (const [key, value] of Object.entries(execution.conversationVariables ?? {})) {
            this.conversationVariables.set(key, value);
        }
        // Initialize variables from execution input
        for (const [key, value] of Object.entries(execution.input)) {
            this.variables.set(key, value);
        }
        // Initialize node outputs from execution
        for (const [nodeId, output] of Object.entries(execution.nodeOutputs)) {
            this.nodeOutputs.set(nodeId, new Map(Object.entries(output)));
        }
    }

    /** Install the live token sink (engine wires this from execution options). */
    setDeltaSink(sink: ((nodeId: string, text: string) => void) | undefined): void {
        this.deltaSink = sink;
    }

    /** Whether a live token sink is installed. Executors use this to decide
     *  whether to take the (more expensive) streaming request path at all. */
    hasDeltaSink(): boolean {
        return Boolean(this.deltaSink);
    }

    /** Emit a streamed text chunk for a node. No-op when no sink is installed, so
     *  executors can call it unconditionally. Sink errors are swallowed — token
     *  streaming is best-effort and must never fail a node. */
    emitDelta(nodeId: string, text: string): void {
        if (!this.deltaSink || !text) {
            return;
        }
        try {
            this.deltaSink(nodeId, text);
        } catch {
            // best-effort streaming — ignore
        }
    }

    /**
     * Get a variable value
     */
    getVariable(name: string): unknown {
        return this.variables.get(name);
    }

    /**
     * Set a variable value
     */
    setVariable(name: string, value: unknown): void {
        this.variables.set(name, value);
    }

    /** Read a conversation/session variable (`conversation.*`). */
    getConversationVariable(name: string): unknown {
        return this.conversationVariables.get(name);
    }

    /**
     * Write a conversation/session variable. Mirrors into the execution entity so
     * the value is carried by toSnapshot() persistence and survives across runs
     * of the same conversation.
     */
    setConversationVariable(name: string, value: unknown): void {
        this.conversationVariables.set(name, value);
        this.execution.conversationVariables = Object.fromEntries(this.conversationVariables);
    }

    /**
     * Get all variables
     */
    getAllVariables(): Record<string, unknown> {
        return Object.fromEntries(this.variables);
    }

    /**
     * Set package executors (for JS runtime)
     */
    setPackageExecutors(
        executors: Map<string, (input: Record<string, unknown>) => Promise<Record<string, unknown>>>,
    ): void {
        this.packageExecutors = executors;
    }

    /**
     * Get package executor by package ID
     */
    getPackageExecutor(packageId: string): ((input: Record<string, unknown>) => Promise<Record<string, unknown>>) | undefined {
        return this.packageExecutors?.get(packageId);
    }

    /**
     * Get node output by key
     */
    getNodeOutput(nodeId: string, key: string): unknown {
        const outputs = this.nodeOutputs.get(nodeId);
        return outputs?.get(key);
    }

    /**
     * Get all outputs for a node
     */
    getNodeOutputs(nodeId: string): Record<string, unknown> {
        const outputs = this.nodeOutputs.get(nodeId);
        return outputs ? Object.fromEntries(outputs) : {};
    }

    /**
     * Set node output
     */
    setNodeOutput(nodeId: string, key: string, value: unknown): void {
        if (!this.nodeOutputs.has(nodeId)) {
            this.nodeOutputs.set(nodeId, new Map());
        }
        this.nodeOutputs.get(nodeId)!.set(key, value);
    }

    /**
     * Set all node outputs at once
     */
    setNodeOutputs(nodeId: string, outputs: Record<string, unknown>): void {
        this.nodeOutputs.set(nodeId, new Map(Object.entries(outputs)));
    }

    /**
     * Set port output (for port-based data routing)
     */
    setPortOutput(nodeId: string, portId: string, value: unknown): void {
        if (!this.portOutputs.has(nodeId)) {
            this.portOutputs.set(nodeId, new Map());
        }
        this.portOutputs.get(nodeId)!.set(portId, value);
    }

    /**
     * Get port output
     */
    getPortOutput(nodeId: string, portId: string): unknown {
        return this.portOutputs.get(nodeId)?.get(portId);
    }

    /**
     * Get all outputs for a node's port
     */
    getPortOutputs(nodeId: string): Record<string, unknown> {
        const outputs = this.portOutputs.get(nodeId);
        return outputs ? Object.fromEntries(outputs) : {};
    }

    /**
     * Mark node as executed
     */
    markNodeExecuted(nodeId: string): void {
        this.executedNodes.add(nodeId);
        this.pendingNodes.delete(nodeId);
    }

    /**
     * Mark node as pending
     */
    markNodePending(nodeId: string): void {
        this.pendingNodes.add(nodeId);
    }

    /**
     * Mark node as failed
     */
    markNodeFailed(nodeId: string): void {
        this.failedNodes.add(nodeId);
        this.pendingNodes.delete(nodeId);
    }

    /**
     * Mark node as cancelled (the execution was cancelled while this node was
     * in flight). Tracked separately from failures so the run is reported as
     * Cancelled rather than Failed.
     */
    markNodeCancelled(nodeId: string): void {
        this.cancelledNodes.add(nodeId);
        this.pendingNodes.delete(nodeId);
    }

    /**
     * Mark node as skipped by a branch decision
     */
    markNodeSkipped(nodeId: string): void {
        this.skippedNodes.add(nodeId);
        this.pendingNodes.delete(nodeId);
    }

    /**
     * Seed completed-node state from a previous (e.g. crashed) run so a resumed
     * execution re-drives only the unfinished frontier instead of replaying the
     * whole graph — which would re-fire already-committed side effects and, for
     * Package nodes, create duplicate external jobs. Failed/running/pending nodes are
     * intentionally NOT seeded, so they get re-attempted on resume.
     */
    restoreCompletedState(state: {
        executedNodeIds?: string[];
        skippedNodeIds?: string[];
        nodeOutputs?: Record<string, Record<string, unknown>>;
    }): void {
        for (const nodeId of state.executedNodeIds ?? []) {
            this.executedNodes.add(nodeId);
        }
        for (const nodeId of state.skippedNodeIds ?? []) {
            this.skippedNodes.add(nodeId);
        }
        for (const [nodeId, outputs] of Object.entries(state.nodeOutputs ?? {})) {
            this.nodeOutputs.set(nodeId, new Map(Object.entries(outputs)));
        }
    }

    /**
     * Push a loop context onto the stack (enter a loop)
     */
    pushLoopContext(loopNodeId: string): void {
        this.loopStack.push(loopNodeId);
    }

    /**
     * Pop a loop context from the stack (exit a loop)
     */
    popLoopContext(): void {
        this.loopStack.pop();
    }

    /**
     * Get the current loop node ID (top of stack, innermost loop)
     */
    getCurrentLoopId(): string | undefined {
        return this.loopStack[this.loopStack.length - 1];
    }

    /**
     * Check if node has been executed
     */
    isNodeExecuted(nodeId: string): boolean {
        return this.executedNodes.has(nodeId);
    }

    /**
     * Check if node has failed
     */
    isNodeFailed(nodeId: string): boolean {
        return this.failedNodes.has(nodeId);
    }

    /**
     * Check if node has been skipped
     */
    isNodeSkipped(nodeId: string): boolean {
        return this.skippedNodes.has(nodeId);
    }

    /**
     * Check if node is currently claimed/in-flight (pending).
     * Used as a synchronous re-entrancy guard so that two predecessors
     * completing concurrently in a diamond/join cannot both execute the
     * same downstream node (TOCTOU between the executed-check and mark).
     */
    isNodePending(nodeId: string): boolean {
        return this.pendingNodes.has(nodeId);
    }

    /**
     * Parent context reference for variable inheritance
     */
    private parentContext: ExecutionContext | null = null;

    /**
     * Create a sub-context for isolated execution (e.g., loop body)
     * The sub-context has its own cache and variables but inherits from parent
     */
    sub(): ExecutionContext {
        const subContext = new ExecutionContext(
            this.execution,
            this.definition,
            this.runtime,
            this.nodeMap,
            this.edgeMap,
        );
        // Sub-context has its own cache but shares nodeOutputs, executedNodes, etc.
        subContext.cache = new Map();
        subContext.subContexts = [];
        subContext.parentContext = this; // Chain to parent for variable inheritance
        // Inherit variables from parent
        for (const [key, value] of this.variables) {
            subContext.variables.set(key, value);
        }
        this.subContexts.push(subContext);
        return subContext;
    }

    /**
     * Clear sub-context to prevent memory leaks
     * Breaks parent chain and clears cached data
     */
    clear(): void {
        this.parentContext = null;
        this.cache.clear();
        this.variables.clear();
        this.subContexts = [];
    }

    /**
     * Get previous nodes for a node from edgeMap
     */
    getPrevNodes(nodeId: string): WorkflowNode[] {
        return this.allEdges()
            .filter((e) => e.targetNodeId === nodeId)
            .map((e) => this.nodeMap.get(e.sourceNodeId))
            .filter((n): n is WorkflowNode => n !== undefined);
    }

    /**
     * Get next nodes for a node from edgeMap, optionally filtered by sourcePortId (branch)
     */
    getNextNodes(nodeId: string, branch?: string): WorkflowNode[] {
        const edges = this.edgeMap.get(nodeId) || [];
        const filteredEdges = branch
            ? edges.filter((e) => e.sourceNodeId === nodeId && (e.sourcePortId === branch || e.targetNodeId === branch))
            : edges.filter((e) => e.sourceNodeId === nodeId);
        return filteredEdges
            .map((e) => this.nodeMap.get(e.targetNodeId))
            .filter((n): n is WorkflowNode => n !== undefined);
    }

    /**
     * Get predecessors (upstream nodes)
     */
    getPredecessors(nodeId: string): WorkflowNode[] {
        return this.allEdges()
            .filter((e) => e.targetNodeId === nodeId)
            .map((e) => this.nodeMap.get(e.sourceNodeId))
            .filter((n): n is WorkflowNode => n !== undefined);
    }

    /**
     * Get successors (downstream nodes)
     */
    getSuccessors(nodeId: string): WorkflowNode[] {
        return this.allEdges()
            .filter((e) => e.sourceNodeId === nodeId)
            .map((e) => this.nodeMap.get(e.targetNodeId))
            .filter((n): n is WorkflowNode => n !== undefined);
    }

    /**
     * Get incoming edges (edges targeting this node)
     */
    getIncomingEdges(nodeId: string): WorkflowEdge[] {
        return this.allEdges().filter((e) => e.targetNodeId === nodeId);
    }

    private allEdges(): WorkflowEdge[] {
        return Array.from(this.edgeMap.values()).flat();
    }

    /**
     * Check if all predecessors are executed
     */
    allPredecessorsExecuted(nodeId: string): boolean {
        const predecessors = this.getPredecessors(nodeId);
        return predecessors.every((p) => this.executedNodes.has(p.id) || this.skippedNodes.has(p.id));
    }

    /**
     * Resolve a FlowValue to actual value
     */
    resolveFlowValue(flowValue: FlowValue): unknown {
        switch (flowValue.type) {
            case FlowValueType.Static:
                return flowValue.value;
            case FlowValueType.Variable:
                return this.variables.get(flowValue.variableName!);
            case FlowValueType.Expression:
                return this.evaluateExpression(flowValue.expression!);
            default:
                return undefined;
        }
    }

    /**
     * Simple expression evaluator. Three shapes:
     *  - `${expr}` (whole string, possibly with surrounding whitespace)
     *    → evaluate `expr` and return its native value (so `${input.foo}`
     *      can yield an object/array, not its stringification).
     *  - `text ${expr1} more ${expr2} ...` (embedded interpolation)
     *    → evaluate each occurrence and stitch the result back into the
     *      surrounding text. Without this, inputMappings like
     *      "任务：... 用户请求：${coalesce(input.request, '默认')}" are
     *      passed verbatim to agents.
     *  - everything else → treated as a bare expression (legacy behaviour
     *    for raw JS-like fragments used outside of `${}` syntax).
     */
    private evaluateExpression(expr: string): unknown {
        if (expr.includes('{{') || expr.includes('}}')) {
            return undefined;
        }
        const context = this.expressionContext();
        const wholeMatch = expr.match(/^\s*\$\{\s*([^]+?)\s*\}\s*$/);
        if (wholeMatch) {
            return this.evalSingle(wholeMatch[1], context);
        }
        if (expr.includes('${')) {
            return expr.replace(/\$\{\s*([^}]+?)\s*\}/g, (_match, inner: string) => {
                const resolved = this.evalSingle(inner, context);
                return resolved === undefined || resolved === null ? '' : String(resolved);
            });
        }
        return this.evalSingle(expr, context);
    }

    private evalSingle(expression: string, context: Record<string, unknown>): unknown {
        const normalized = this.normalizeExpression(expression);
        const pathValue = expressionEvaluator.resolvePath(normalized, context);
        if (pathValue !== undefined) {
            return pathValue;
        }
        return expressionEvaluator.evaluate(normalized, context);
    }

    private expressionContext(): Record<string, unknown> {
        const variables = this.getAllVariables();
        const nodes = Object.fromEntries(Array.from(this.nodeOutputs.entries()).map(([nodeId, outputs]) => {
            const output = Object.fromEntries(outputs);
            return [nodeId, { output, outputs: output, ...output }];
        }));
        const nodeOutputs = Object.fromEntries(Array.from(this.nodeOutputs.entries()).map(([nodeId, outputs]) => [
            nodeId,
            Object.fromEntries(outputs),
        ]));
        return {
            ...variables,
            ...nodes,
            input: this.recordValue(variables.input) ?? variables,
            variables,
            vars: variables,
            env: this.environmentVariables,
            environment: this.environmentVariables,
            conversation: Object.fromEntries(this.conversationVariables),
            nodes,
            nodeOutputs,
            workflow: {
                input: this.recordValue(variables.input) ?? variables,
                variables,
            },
            // Template helpers — must mirror the set registered in
            // the historical runtime data-mapping service
            // tryFunctionCall(). Both code paths must agree on the available
            // helper set; otherwise inputMappings using e.g. coalesce/json get
            // silently dropped here (evaluator's try/catch returns the raw
            // expression text) and agents receive literal "coalesce(input.request,
            // ...)" instead of the resolved value.
            ...TEMPLATE_HELPERS,
        };
    }

    private normalizeExpression(expression: string): string {
        const value = expression.trim();
        return value.startsWith('$.') ? value.slice(2) : value;
    }

    private recordValue(value: unknown): Record<string, unknown> | undefined {
        return value && typeof value === 'object' && !Array.isArray(value)
            ? value as Record<string, unknown>
            : undefined;
    }

    /**
     * Create snapshot for persistence
     */
    toSnapshot(): {
        executedNodeIds: string[];
        failedNodeIds: string[];
        skippedNodeIds: string[];
        pendingNodeIds: string[];
        variables: Record<string, unknown>;
        conversationVariables: Record<string, unknown>;
        nodeOutputs: Record<string, Record<string, unknown>>;
    } {
        return {
            executedNodeIds: Array.from(this.executedNodes),
            failedNodeIds: Array.from(this.failedNodes),
            skippedNodeIds: Array.from(this.skippedNodes),
            pendingNodeIds: Array.from(this.pendingNodes),
            variables: this.getAllVariables(),
            conversationVariables: Object.fromEntries(this.conversationVariables),
            nodeOutputs: Object.fromEntries(
                Array.from(this.nodeOutputs.entries()).map(([k, v]) => [k, Object.fromEntries(v)])
            ),
        };
    }
}
