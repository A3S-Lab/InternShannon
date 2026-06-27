import { BaseNodeExecutor, NodeExecutorResult } from './base.executor';
import { ExecutionContext } from '../execution-context';
import { WorkflowNode, WorkflowNodeType } from '../../domain/value-objects';
import { CancellationToken } from '../cancellation-token';

/**
 * Start Node Executor
 * Outputs the workflow input as node outputs
 */
export class StartNodeExecutor extends BaseNodeExecutor {
    readonly type = WorkflowNodeType.Start;

    protected async doExecute(
        context: ExecutionContext,
        node: WorkflowNode,
        inputs: Record<string, unknown>,
        _cancellationToken?: CancellationToken,
    ): Promise<NodeExecutorResult> {
        // Start node outputs the workflow input
        return {
            outputs: context.getAllVariables(),
        };
    }
}
