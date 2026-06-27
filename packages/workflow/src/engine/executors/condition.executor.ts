import { BaseNodeExecutor, NodeExecutorResult } from './base.executor';
import { ExecutionContext } from '../execution-context';
import {
    WorkflowNode,
    WorkflowNodeType,
    ConditionNodeData,
} from '../../domain/value-objects';
import { CancellationToken } from '../cancellation-token';
import { evaluateConditionBranch } from './condition-evaluator';

/**
 * Condition Node Executor
 * Evaluates conditions and selects the branch to execute
 * Supports simple conditions, structured conditions (Flowgram.ai aligned), and nested AND/OR groups
 * Delegates evaluation to the shared `condition-evaluator` so the core engine and
 * the definition walker (agent fallback path) route IF/ELSE identically.
 */
export class ConditionNodeExecutor extends BaseNodeExecutor {
    readonly type = WorkflowNodeType.Condition;

    protected async doExecute(
        context: ExecutionContext,
        node: WorkflowNode,
        inputs: Record<string, unknown>,
        _cancellationToken?: CancellationToken,
    ): Promise<NodeExecutorResult> {
        const data = node.data as ConditionNodeData;

        if (!data.conditions || data.conditions.length === 0) {
            return { outputs: inputs };
        }

        const evalContext = this.buildEvaluationContext(context, inputs);
        const { branch } = evaluateConditionBranch(data.conditions, data.defaultNodeId, evalContext);
        if (branch) {
            return {
                outputs: { ...inputs, selectedBranch: branch },
                branch,
            };
        }

        return { outputs: inputs };
    }

    /**
     * Build evaluation context from execution context and inputs. Shape must stay
     * in lockstep with `buildConditionEvalContext` in `condition-evaluator.ts`.
     */
    private buildEvaluationContext(context: ExecutionContext, inputs: Record<string, unknown>): Record<string, unknown> {
        const variables = context.getAllVariables();
        const snapshot = context.toSnapshot();
        const nodes = Object.fromEntries(Object.entries(snapshot.nodeOutputs).map(([nodeId, output]) => [
            nodeId,
            { output, outputs: output, ...output },
        ]));

        return {
            ...variables,
            ...nodes,
            ...inputs,
            input: variables.input ?? inputs,
            variables,
            vars: variables,
            nodes,
            nodeOutputs: snapshot.nodeOutputs,
            workflow: {
                input: variables.input ?? inputs,
                variables,
            },
        };
    }
}
