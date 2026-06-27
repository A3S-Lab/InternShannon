import { BaseNodeExecutor, NodeExecutorResult } from './base.executor';
import { ExecutionContext } from '../execution-context';
import { WorkflowNode } from '../../domain/value-objects';
import { CancellationToken } from '../cancellation-token';

/**
 * Pass-through executor for visual/structural nodes.
 */
export class PassThroughNodeExecutor extends BaseNodeExecutor {
    constructor(readonly type: string) {
        super();
    }

    protected async doExecute(
        _context: ExecutionContext,
        _node: WorkflowNode,
        inputs: Record<string, unknown>,
        _cancellationToken?: CancellationToken,
    ): Promise<NodeExecutorResult> {
        return { outputs: inputs };
    }
}
