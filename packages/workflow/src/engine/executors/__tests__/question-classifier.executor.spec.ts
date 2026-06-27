import { QuestionClassifierNodeExecutor } from '../question-classifier.executor';
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

function mockClassify(classId: string) {
    mockFetch.mockResolvedValue({
        ok: true,
        json: jest.fn().mockResolvedValue({ choices: [{ message: { content: JSON.stringify({ classId }) } }] }),
    });
}

const node: WorkflowNode = {
    id: 'qc',
    type: WorkflowNodeType.QuestionClassifier,
    name: 'Classifier',
    data: {
        model: 'gpt-4',
        apiKey: 'k',
        apiHost: 'https://api.openai.com/v1',
        classes: [
            { id: 'billing', name: '账单', targetNodeId: 'n-billing' },
            { id: 'tech', name: '技术', targetNodeId: 'n-tech' },
        ],
    } as any,
};

describe('QuestionClassifierNodeExecutor', () => {
    beforeEach(() => mockFetch.mockReset());

    it('routes to the selected class branch and asks for JSON', async () => {
        mockClassify('tech');
        const executor = new QuestionClassifierNodeExecutor();
        const result = await executor.execute(ctxFor(node), { ...node, data: { ...(node.data as any), query: 'my app crashes' } } as any);
        expect(result.branch).toBe('n-tech');
        expect(result.outputs).toMatchObject({ classId: 'tech', class: '技术' });
        const [, init] = mockFetch.mock.calls[0];
        expect(JSON.parse(init.body).response_format).toEqual({ type: 'json_object' });
    });

    it('matches a class even when the model echoes the name in prose (fuzzy)', async () => {
        mockFetch.mockResolvedValue({
            ok: true,
            json: jest.fn().mockResolvedValue({ choices: [{ message: { content: '{"classId":"the billing category"}' } }] }),
        });
        const executor = new QuestionClassifierNodeExecutor();
        const result = await executor.execute(ctxFor(node), { ...node, data: { ...(node.data as any), query: 'charge me' } } as any);
        expect(result.branch).toBe('n-billing');
    });

    it('falls back to the first class rather than stranding the run', async () => {
        mockClassify('nonexistent-id');
        const executor = new QuestionClassifierNodeExecutor();
        const result = await executor.execute(ctxFor(node), { ...node, data: { ...(node.data as any), query: 'huh' } } as any);
        expect(result.branch).toBe('n-billing'); // first class
    });

    it('throws when no classes are declared', async () => {
        const bad: WorkflowNode = { ...node, data: { apiKey: 'k', classes: [], query: 'x' } as any };
        await expect(new QuestionClassifierNodeExecutor().execute(ctxFor(bad), bad)).rejects.toThrow('at least one class');
    });
});
