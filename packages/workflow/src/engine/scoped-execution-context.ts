import { WorkflowDefinition, WorkflowExecution } from '../domain/entities';
import { FlowValue, FlowValueType, WorkflowEdge, WorkflowNode } from '../domain/value-objects';
import { IWorkflowRuntime } from '../interfaces';
import { ExecutionContext } from './execution-context';
import { expressionEvaluator } from './expression-evaluator';

/**
 * Variable Scope - represents a single scope in the scope stack
 */
export class VariableScope {
    private variables: Map<string, unknown> = new Map();

    constructor(public readonly scopeId: string) {}

    has(name: string): boolean {
        return this.variables.has(name);
    }

    get(name: string): unknown {
        return this.variables.get(name);
    }

    set(name: string, value: unknown): void {
        this.variables.set(name, value);
    }

    delete(name: string): boolean {
        return this.variables.delete(name);
    }

    getAllVariables(): Record<string, unknown> {
        return Object.fromEntries(this.variables);
    }
}

/**
 * Execution context with explicit nested variable scopes.
 */
export class ScopedExecutionContext extends ExecutionContext {
    private readonly rootScope = new VariableScope('__root');
    private readonly scopeStack: VariableScope[] = [];

    constructor(
        execution: WorkflowExecution,
        definition: WorkflowDefinition,
        runtime: IWorkflowRuntime | null,
        nodeMap: Map<string, WorkflowNode>,
        edgeMap: Map<string, WorkflowEdge[]>,
    ) {
        super(execution, definition, runtime, nodeMap, edgeMap);
        for (const [key, value] of Object.entries(super.getAllVariables())) {
            this.rootScope.set(key, value);
        }
    }

    enterScope(scopeId: string): void {
        this.scopeStack.push(new VariableScope(scopeId));
    }

    exitScope(): void {
        if (this.scopeStack.length === 0) {
            throw new Error('Cannot exit scope: scope stack is empty');
        }
        this.scopeStack.pop();
    }

    getScopeDepth(): number {
        return this.scopeStack.length;
    }

    hasVariable(name: string): boolean {
        return this.scopeChain().some(scope => scope.has(name));
    }

    override getVariable(name: string): unknown {
        for (const scope of this.scopeChain()) {
            if (scope.has(name)) {
                return scope.get(name);
            }
        }
        return undefined;
    }

    override setVariable(name: string, value: unknown): void {
        this.currentScope().set(name, value);
    }

    override getAllVariables(): Record<string, unknown> {
        return this.scopeStack.reduce(
            (variables, scope) => ({ ...variables, ...scope.getAllVariables() }),
            this.rootScope.getAllVariables(),
        );
    }

    override resolveFlowValue(flowValue: FlowValue): unknown {
        switch (flowValue.type) {
            case FlowValueType.Static:
                return flowValue.value;
            case FlowValueType.Variable:
                return flowValue.variableName ? this.getVariable(flowValue.variableName) : undefined;
            case FlowValueType.Expression:
                return flowValue.expression ? this.evaluateScopedExpression(flowValue.expression) : undefined;
            default:
                return undefined;
        }
    }

    private currentScope(): VariableScope {
        return this.scopeStack[this.scopeStack.length - 1] ?? this.rootScope;
    }

    private scopeChain(): VariableScope[] {
        return [...this.scopeStack].reverse().concat(this.rootScope);
    }

    private evaluateScopedExpression(expression: string): unknown {
        const context = this.getAllVariables();
        const normalized = expression.trim().startsWith('$.')
            ? expression.trim().slice(2)
            : expression.trim();
        const pathValue = expressionEvaluator.resolvePath(normalized, context);
        return pathValue !== undefined
            ? pathValue
            : expressionEvaluator.evaluate(normalized, context);
    }
}
