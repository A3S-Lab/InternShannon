import { ParameterExtractorNodeExecutor } from '../parameter-extractor.executor';
import { ExecutionContext } from '../../execution-context';
import { WorkflowDefinition, WorkflowExecution, ExecutionStatus } from '../../../domain/entities';
import { WorkflowNode, WorkflowNodeType } from '../../../domain/value-objects';

const mockFetch = jest.fn();
global.fetch = mockFetch;

function ctxFor(node: WorkflowNode): ExecutionContext {
    const execution: WorkflowExecution = {
        id: 'e1', workflowDefinitionId: 'd1', version: '1', input: {}, status: ExecutionStatus.Running,
        currentNodeIds: [], executedNodeIds: [], failedNodeIds: [], variables: {}, nodeOutputs: {}, createdAt: new Date(),
    };
    const definition: WorkflowDefinition = {
        id: 'd1', packageId: 'p1', version: '1', name: 'wf', graph: { nodes: [node], edges: [] }, createdAt: new Date(), updatedAt: new Date(),
    };
    return new ExecutionContext(execution, definition, null as any, new Map([[node.id, node]]), new Map());
}

const node: WorkflowNode = {
    id: 'pe',
    type: WorkflowNodeType.ParameterExtractor,
    name: 'Extractor',
    data: {
        model: 'gpt-4',
        apiKey: 'k',
        apiHost: 'https://api.openai.com/v1',
        parameters: [
            { name: 'orderId', type: 'string', required: true },
            { name: 'amount', type: 'number' },
        ],
        text: 'Order SO-42 for 199 dollars',
    } as any,
};

describe('ParameterExtractorNodeExecutor', () => {
    beforeEach(() => mockFetch.mockReset());

    it('extracts declared parameters via json_schema and projects them as outputs', async () => {
        mockFetch.mockResolvedValue({
            ok: true,
            json: jest.fn().mockResolvedValue({
                choices: [{ message: { content: '{"orderId":"SO-42","amount":199,"extra":"ignored"}' } }],
            }),
        });
        const result = await new ParameterExtractorNodeExecutor().execute(ctxFor(node), node);
        // only declared params projected; the model's `extra` field is dropped
        expect(result.outputs).toEqual({ orderId: 'SO-42', amount: 199 });
        const [, init] = mockFetch.mock.calls[0];
        const body = JSON.parse(init.body);
        expect(body.response_format.type).toBe('json_schema');
        expect(body.response_format.json_schema.schema.required).toEqual(['orderId']);
    });

    it('fills missing parameters with null', async () => {
        mockFetch.mockResolvedValue({
            ok: true,
            json: jest.fn().mockResolvedValue({ choices: [{ message: { content: '{"orderId":"SO-9"}' } }] }),
        });
        const result = await new ParameterExtractorNodeExecutor().execute(ctxFor(node), node);
        expect(result.outputs).toEqual({ orderId: 'SO-9', amount: null });
    });

    it('throws when no parameters are declared', async () => {
        const bad: WorkflowNode = { ...node, data: { apiKey: 'k', parameters: [], text: 'x' } as any };
        await expect(new ParameterExtractorNodeExecutor().execute(ctxFor(bad), bad)).rejects.toThrow('at least one parameter');
    });
});
