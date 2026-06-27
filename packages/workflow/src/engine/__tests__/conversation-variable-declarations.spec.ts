import { ExecutionContext } from '../execution-context';
import { WorkflowDefinition, WorkflowExecution, ExecutionStatus } from '../../domain/entities';
import { FlowValueType } from '../../domain/value-objects';

function buildContext(
    declared?: Record<string, unknown>,
    runtime?: Record<string, unknown>,
): ExecutionContext {
    const execution: WorkflowExecution = {
        id: 'exec-1', workflowDefinitionId: 'def-1', version: '1.0.0', input: {},
        status: ExecutionStatus.Running, currentNodeIds: [], executedNodeIds: [], failedNodeIds: [],
        variables: {}, nodeOutputs: {}, conversationVariables: runtime, createdAt: new Date(),
    };
    const definition: WorkflowDefinition = {
        id: 'def-1', packageId: 'pkg-1', version: '1.0.0', name: 'T',
        graph: { nodes: [], edges: [] }, conversationVariables: declared, createdAt: new Date(), updatedAt: new Date(),
    };
    return new ExecutionContext(execution, definition, null as never, new Map(), new Map());
}

const expr = (ctx: ExecutionContext, name: string) =>
    ctx.resolveFlowValue({ type: FlowValueType.Expression, expression: `\${conversation.${name}}` });

describe('Conversation variable declarations (definition defaults, Dify-aligned)', () => {
    it('seeds conversation.* from the definition declarations when the execution has none', () => {
        const ctx = buildContext({ turns: 0, topic: 'general' });
        expect(expr(ctx, 'turns')).toBe(0);
        expect(expr(ctx, 'topic')).toBe('general');
    });

    it('lets the execution runtime value override the declared default', () => {
        const ctx = buildContext({ turns: 0 }, { turns: 7 });
        expect(expr(ctx, 'turns')).toBe(7);
    });

    it('merges: declared-only keys keep defaults, runtime-only keys are added', () => {
        const ctx = buildContext({ a: 1, b: 2 }, { b: 20, c: 30 });
        expect(expr(ctx, 'a')).toBe(1);
        expect(expr(ctx, 'b')).toBe(20);
        expect(expr(ctx, 'c')).toBe(30);
    });
});
