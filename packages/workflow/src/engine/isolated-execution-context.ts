/**
 * Isolated Execution Context for Subgraph Execution
 * Provides variable scoping for Loop and Condition branches
 */

import { WorkflowExecution, ExecutionStatus } from '../domain/entities';
import { WorkflowNode, WorkflowEdge, FlowValue, FlowValueType } from '../domain/value-objects';
import { IWorkflowRuntime } from '../interfaces';

export interface VariableScope {
    parent?: VariableScope;
    variables: Map<string, unknown>;
}

export class IsolatedExecutionContext {
    private scopes: VariableScope[] = [{ variables: new Map() }];
    private nodeOutputs: Map<string, Map<string, unknown>> = new Map();
    private executedNodes: Set<string> = new Set();
    private pendingNodes: Set<string> = new Set();
    public failedNodes: Set<string> = new Set();

    constructor(
        public readonly execution: WorkflowExecution,
        public readonly definition: WorkflowNode,
        public readonly runtime: IWorkflowRuntime | null,
    ) {}

    /**
     * Get current scope
     */
    private get currentScope(): VariableScope {
        return this.scopes[this.scopes.length - 1];
    }

    /**
     * Push a new scope (entering a subgraph)
     */
    pushScope(parent?: VariableScope): void {
        this.scopes.push({ parent, variables: new Map() });
    }

    /**
     * Pop current scope (exiting a subgraph)
     */
    popScope(): void {
        if (this.scopes.length > 1) {
            this.scopes.pop();
        }
    }

    /**
     * Get a variable value from current or parent scopes
     */
    getVariable(name: string): unknown {
        for (let i = this.scopes.length - 1; i >= 0; i--) {
            if (this.scopes[i].variables.has(name)) {
                return this.scopes[i].variables.get(name);
            }
        }
        return undefined;
    }

    /**
     * Set a variable in current scope
     */
    setVariable(name: string, value: unknown): void {
        this.currentScope.variables.set(name, value);
    }

    /**
     * Get all variables from all scopes
     */
    getAllVariables(): Record<string, unknown> {
        const result: Record<string, unknown> = {};
        for (let i = 0; i < this.scopes.length; i++) {
            for (const [key, value] of this.scopes[i].variables) {
                result[key] = value;
            }
        }
        return result;
    }

    /**
     * Create a snapshot of current variables
     */
    snapshotVariables(): Record<string, unknown> {
        return this.getAllVariables();
    }

    /**
     * Restore variables from snapshot
     */
    restoreVariables(snapshot: Record<string, unknown>): void {
        this.currentScope.variables.clear();
        for (const [key, value] of Object.entries(snapshot)) {
            this.currentScope.variables.set(key, value);
        }
    }

    /**
     * Get node output
     */
    getNodeOutput(nodeId: string, key: string): unknown {
        return this.nodeOutputs.get(nodeId)?.get(key);
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
     * Resolve FlowValue to actual value
     */
    resolveFlowValue(flowValue: FlowValue): unknown {
        switch (flowValue.type) {
            case FlowValueType.Static:
                return flowValue.value;
            case FlowValueType.Variable:
                return this.getVariable(flowValue.variableName!);
            case FlowValueType.Expression: {
                // Use expression evaluator
                const { expressionEvaluator } = require('./expression-evaluator');
                return expressionEvaluator.evaluate(flowValue.expression!, this.getAllVariables());
            }
            default:
                return undefined;
        }
    }
}
