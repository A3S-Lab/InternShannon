import { ExecutionContext } from '../execution-context';
import { WorkflowDefinition, WorkflowExecution, ExecutionStatus } from '../../domain/entities';
import { FlowValueType } from '../../domain/value-objects';

function buildContext(conversationVariables?: Record<string, unknown>): { ctx: ExecutionContext; execution: WorkflowExecution } {
    const execution: WorkflowExecution = {
        id: 'exec-1', workflowDefinitionId: 'def-1', version: '1.0.0', input: {},
        status: ExecutionStatus.Running, currentNodeIds: [], executedNodeIds: [], failedNodeIds: [],
        variables: {}, nodeOutputs: {}, conversationVariables, createdAt: new Date(),
    };
    const definition: WorkflowDefinition = {
        id: 'def-1', packageId: 'pkg-1', version: '1.0.0', name: 'T',
        graph: { nodes: [], edges: [] }, createdAt: new Date(), updatedAt: new Date(),
    };
    return { ctx: new ExecutionContext(execution, definition, null as never, new Map(), new Map()), execution };
}

describe('Workflow conversation variables (conversation.* namespace, Dify-aligned)', () => {
    it('seeds conversation.* from the execution and resolves via expressions', () => {
        const { ctx } = buildContext({ turns: 2, lastUser: 'hi' });
        expect(ctx.getConversationVariable('turns')).toBe(2);
        expect(ctx.resolveFlowValue({ type: FlowValueType.Expression, expression: '${conversation.lastUser}' })).toBe('hi');
    });

    it('writes are readable via expressions and mirrored onto the execution for persistence', () => {
        const { ctx, execution } = buildContext();
        ctx.setConversationVariable('counter', 5);
        expect(ctx.resolveFlowValue({ type: FlowValueType.Expression, expression: '${conversation.counter}' })).toBe(5);
        // Mirrored onto the execution entity → carried by persistence.
        expect(execution.conversationVariables).toEqual({ counter: 5 });
    });

    it('round-trips through toSnapshot', () => {
        const { ctx } = buildContext({ a: 1 });
        ctx.setConversationVariable('b', 2);
        expect(ctx.toSnapshot().conversationVariables).toEqual({ a: 1, b: 2 });
    });
});
