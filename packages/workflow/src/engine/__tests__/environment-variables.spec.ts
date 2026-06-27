import { ExecutionContext } from '../execution-context';
import { WorkflowDefinition, WorkflowExecution, ExecutionStatus } from '../../domain/entities';
import { FlowValueType } from '../../domain/value-objects';

function buildContext(environmentVariables?: Record<string, unknown>): ExecutionContext {
    const execution: WorkflowExecution = {
        id: 'exec-1', workflowDefinitionId: 'def-1', version: '1.0.0', input: {},
        status: ExecutionStatus.Running, currentNodeIds: [], executedNodeIds: [], failedNodeIds: [],
        variables: {}, nodeOutputs: {}, createdAt: new Date(),
    };
    const definition: WorkflowDefinition = {
        id: 'def-1', packageId: 'pkg-1', version: '1.0.0', name: 'T',
        graph: { nodes: [], edges: [] }, environmentVariables, createdAt: new Date(), updatedAt: new Date(),
    };
    return new ExecutionContext(execution, definition, null as never, new Map(), new Map());
}

describe('Workflow environment variables (env.* namespace, Dify-aligned)', () => {
    it('resolves a whole-expression env reference to the raw value', () => {
        const ctx = buildContext({ API_BASE: 'https://api.example.com', RETRIES: 3 });
        expect(ctx.resolveFlowValue({ type: FlowValueType.Expression, expression: '${env.API_BASE}' })).toBe('https://api.example.com');
        expect(ctx.resolveFlowValue({ type: FlowValueType.Expression, expression: '${env.RETRIES}' })).toBe(3);
    });

    it('interpolates env references inside surrounding text', () => {
        const ctx = buildContext({ API_BASE: 'https://api.example.com' });
        expect(ctx.resolveFlowValue({ type: FlowValueType.Expression, expression: '${env.API_BASE}/v1/users' })).toBe(
            'https://api.example.com/v1/users',
        );
    });

    it('also exposes the `environment` alias', () => {
        const ctx = buildContext({ TOKEN: 'abc' });
        expect(ctx.resolveFlowValue({ type: FlowValueType.Expression, expression: '${environment.TOKEN}' })).toBe('abc');
    });

    it('defaults to an empty namespace when no env vars are defined', () => {
        const ctx = buildContext();
        // Embedded interpolation of an undefined ref yields empty string (existing behaviour).
        expect(ctx.resolveFlowValue({ type: FlowValueType.Expression, expression: 'x=${env.NOPE}' })).toBe('x=');
    });
});
