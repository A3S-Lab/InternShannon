import { Logger } from '@nestjs/common';
import { BaseNodeExecutor, NodeExecutorResult } from './base.executor';
import { ExecutionContext } from '../execution-context';
import { WorkflowNode, WorkflowNodeType } from '../../domain/value-objects';
import { CancellationToken } from '../cancellation-token';

/**
 * Break Node Executor
 * Sets loop-break flag in the current context's cache (Flowgram.ai style)
 */
export class BreakNodeExecutor extends BaseNodeExecutor {
    readonly type = WorkflowNodeType.Break;

    protected async doExecute(
        context: ExecutionContext,
        node: WorkflowNode,
        inputs: Record<string, unknown>,
        _cancellationToken?: CancellationToken,
    ): Promise<NodeExecutorResult> {
        context.cache.set('loop-break', true);
        return { outputs: {} };
    }
}

/**
 * Continue Node Executor
 * Sets loop-continue flag in the current context's cache (Flowgram.ai style)
 */
export class ContinueNodeExecutor extends BaseNodeExecutor {
    readonly type = WorkflowNodeType.Continue;

    protected async doExecute(
        context: ExecutionContext,
        node: WorkflowNode,
        inputs: Record<string, unknown>,
        _cancellationToken?: CancellationToken,
    ): Promise<NodeExecutorResult> {
        context.cache.set('loop-continue', true);
        return { outputs: {} };
    }
}
