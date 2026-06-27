import { Logger } from '@nestjs/common';
import { BaseNodeExecutor, NodeExecutorResult } from './base.executor';
import { ExecutionContext } from '../execution-context';
import { WorkflowNode, WorkflowNodeType } from '../../domain/value-objects';
import { CancellationToken } from '../cancellation-token';

/**
 * Block Start Node Executor
 * Entry point for a block (loop body, condition branch, etc.)
 */
export class BlockStartNodeExecutor extends BaseNodeExecutor {
    readonly type = WorkflowNodeType.BlockStart;

    protected async doExecute(
        context: ExecutionContext,
        node: WorkflowNode,
        inputs: Record<string, unknown>,
        _cancellationToken?: CancellationToken,
    ): Promise<NodeExecutorResult> {
        return { outputs: inputs };
    }
}

/**
 * Block End Node Executor
 * Exit point for a block
 */
export class BlockEndNodeExecutor extends BaseNodeExecutor {
    readonly type = WorkflowNodeType.BlockEnd;

    protected async doExecute(
        context: ExecutionContext,
        node: WorkflowNode,
        inputs: Record<string, unknown>,
        _cancellationToken?: CancellationToken,
    ): Promise<NodeExecutorResult> {
        return { outputs: inputs };
    }
}
