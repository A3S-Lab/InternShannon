import { BaseNodeExecutor, NodeExecutorResult } from './base.executor';
import { ExecutionContext } from '../execution-context';
import { WorkflowNode, WorkflowNodeType } from '../../domain/value-objects';
import { CancellationToken } from '../cancellation-token';

/**
 * End Node Executor
 * Sets workflow output and completes execution
 */
export class EndNodeExecutor extends BaseNodeExecutor {
    readonly type = WorkflowNodeType.End;

    protected async doExecute(
        context: ExecutionContext,
        node: WorkflowNode,
        inputs: Record<string, unknown>,
        _cancellationToken?: CancellationToken,
    ): Promise<NodeExecutorResult> {
        // End node sets the workflow output
        return {
            outputs: inputs,
        };
    }
}
