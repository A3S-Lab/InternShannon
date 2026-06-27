import { WorkflowDefinition, WorkflowExecution, ExecutionStatus } from '../../../domain/entities';
import { FlowValueType, WorkflowEdge, WorkflowNode, WorkflowNodeType } from '../../../domain/value-objects';
import { ExecutionContext } from '../../execution-context';
import { AggregatorNodeExecutor, AnswerNodeExecutor, TemplateNodeExecutor } from '../data-flow.executor';

function createContext(nodes: WorkflowNode[], edges: WorkflowEdge[] = [], input: Record<string, unknown> = {}): ExecutionContext {
    const execution: WorkflowExecution = {
        id: 'exec-1',
        workflowDefinitionId: 'def-1',
        version: '1.0.0',
        input,
        status: ExecutionStatus.Running,
        currentNodeIds: [],
        executedNodeIds: [],
        failedNodeIds: [],
        variables: {},
        nodeOutputs: {},
        createdAt: new Date(),
    };
    const definition: WorkflowDefinition = {
        id: 'def-1',
        packageId: 'pkg-1',
        version: '1.0.0',
        name: 'Data flow workflow',
        graph: { nodes, edges },
        createdAt: new Date(),
        updatedAt: new Date(),
    };
    const edgeMap = new Map<string, WorkflowEdge[]>();
    for (const node of nodes) edgeMap.set(node.id, []);
    for (const edge of edges) edgeMap.set(edge.sourceNodeId, [...(edgeMap.get(edge.sourceNodeId) ?? []), edge]);
    return new ExecutionContext(
        execution,
        definition,
        null,
        new Map(nodes.map(node => [node.id, node])),
        edgeMap,
    );
}

describe('DataFlowNodeExecutors', () => {
    it('aggregates incoming edge values and explicit bindings into declared outputs', async () => {
        const sourceA: WorkflowNode = { id: 'source-a', type: 'code', name: 'Source A', data: {} };
        const sourceB: WorkflowNode = { id: 'source-b', type: 'code', name: 'Source B', data: {} };
        const aggregator: WorkflowNode = {
            id: 'aggregate',
            type: WorkflowNodeType.Aggregator,
            name: 'Aggregate',
            data: {
                outputs: {
                    summary: { type: 'string' },
                    detail: { type: 'string' },
                    score: { type: 'number' },
                },
                inputsValues: {
                    score: { type: FlowValueType.Static, value: 10 },
                },
            },
        };
        const edges: WorkflowEdge[] = [
            { id: 'a-aggregate', sourceNodeId: sourceA.id, targetNodeId: aggregator.id },
            { id: 'b-aggregate', sourceNodeId: sourceB.id, targetNodeId: aggregator.id, targetPortId: 'detail' },
        ];
        const context = createContext([sourceA, sourceB, aggregator], edges);
        context.setNodeOutputs(sourceA.id, { summary: 'from-a', score: 1 });
        context.setNodeOutputs(sourceB.id, { output: 'from-b' });

        const result = await new AggregatorNodeExecutor().execute(context, aggregator);

        expect(result.outputs).toEqual({
            summary: 'from-a',
            detail: 'from-b',
            score: 10,
        });
    });

    it('firstNonNull mode coalesces to the first non-null input (Dify variable-aggregator)', async () => {
        const sourceA: WorkflowNode = { id: 'src-a', type: 'code', name: 'A', data: {} };
        const sourceB: WorkflowNode = { id: 'src-b', type: 'code', name: 'B', data: {} };
        const aggregator: WorkflowNode = {
            id: 'coalesce',
            type: WorkflowNodeType.Aggregator,
            name: 'Coalesce',
            data: { aggregateMode: 'firstNonNull' },
        };
        const edges: WorkflowEdge[] = [
            { id: 'a', sourceNodeId: sourceA.id, targetNodeId: aggregator.id, targetPortId: 'a' },
            { id: 'b', sourceNodeId: sourceB.id, targetNodeId: aggregator.id, targetPortId: 'b' },
        ];
        const context = createContext([sourceA, sourceB, aggregator], edges);
        context.setNodeOutputs(sourceA.id, { a: null });
        context.setNodeOutputs(sourceB.id, { b: 'fallback' });

        const result = await new AggregatorNodeExecutor().execute(context, aggregator);

        // a is null → skipped; coalesces to the first non-null (b), under a single `output`.
        expect(result.outputs).toEqual({ output: 'fallback' });
    });

    it('renders template node input with designer ${path} placeholders', async () => {
        const node: WorkflowNode = {
            id: 'template',
            type: WorkflowNodeType.Template,
            name: 'Template',
            data: {
                inputsValues: {
                    template: { type: FlowValueType.Expression, expression: 'Hello ${input.name}' },
                },
            },
        };
        const context = createContext([node], [], { name: 'Ada' });

        const result = await new TemplateNodeExecutor().execute(context, node);

        expect(result.outputs).toEqual({ output: 'Hello Ada' });
    });

    it('renders answer node data against upstream node outputs', async () => {
        const source: WorkflowNode = { id: 'template', type: WorkflowNodeType.Template, name: 'Template', data: {} };
        const node: WorkflowNode = {
            id: 'answer',
            type: WorkflowNodeType.Answer,
            name: 'Answer',
            data: {
                answer: '结果：${template.output}',
            },
        };
        const context = createContext([source, node]);
        context.setNodeOutputs(source.id, { output: '已完成' });

        const result = await new AnswerNodeExecutor().execute(context, node);

        expect(result.outputs).toEqual({ answer: '结果：已完成' });
    });
});
