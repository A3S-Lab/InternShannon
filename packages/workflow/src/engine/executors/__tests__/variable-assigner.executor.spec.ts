import { VariableAssignerNodeExecutor } from '../variable-assigner.executor';
import { ExecutionContext } from '../../execution-context';
import { WorkflowDefinition, WorkflowExecution, ExecutionStatus } from '../../../domain/entities';
import { WorkflowNode, WorkflowNodeType, FlowValueType } from '../../../domain/value-objects';

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

function assignerNode(assignments: unknown): WorkflowNode {
    return { id: 'assign-1', type: WorkflowNodeType.VariableAssigner, name: 'Assign', data: { assignments } };
}

describe('VariableAssignerNodeExecutor (Dify-aligned conversation writes)', () => {
    const executor = new VariableAssignerNodeExecutor();

    it('writes conversation variables from static and literal sources', async () => {
        const { ctx, execution } = buildContext();
        const node = assignerNode([
            { variable: 'counter', value: { type: FlowValueType.Static, value: 5 } },
            { variable: 'label', value: 'hello' }, // plain literal
        ]);

        const result = await executor.execute(ctx, node);

        expect(ctx.getConversationVariable('counter')).toBe(5);
        expect(ctx.getConversationVariable('label')).toBe('hello');
        expect(result.outputs.assigned).toEqual({ counter: 5, label: 'hello' });
        // Mirrored onto the execution for persistence.
        expect(execution.conversationVariables).toEqual({ counter: 5, label: 'hello' });
    });

    it('resolves expression sources against existing conversation state', async () => {
        const { ctx } = buildContext({ counter: 1 });
        const node = assignerNode([
            { variable: 'counter', value: { type: FlowValueType.Expression, expression: '${conversation.counter + 1}' } },
        ]);

        await executor.execute(ctx, node);
        expect(ctx.getConversationVariable('counter')).toBe(2);
    });

    it('accepts the record map form and evaluates ${} expression strings', async () => {
        const { ctx } = buildContext({ username: 'Tom' });
        await executor.execute(ctx, assignerNode({ who: '${conversation.username}', count: 3 }));
        expect(ctx.getConversationVariable('who')).toBe('Tom');
        expect(ctx.getConversationVariable('count')).toBe(3);
    });

    it('skips assignments without a variable name and tolerates a missing list', async () => {
        const { ctx } = buildContext();
        await executor.execute(ctx, assignerNode([{ value: 'orphan' }, { variable: '  ' }]));
        expect((await executor.execute(ctx, assignerNode(undefined))).outputs.assigned).toEqual({});
    });
});
