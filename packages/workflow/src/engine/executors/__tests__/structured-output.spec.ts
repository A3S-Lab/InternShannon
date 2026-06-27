import { LLMNodeExecutor, validateAgainstSchema } from '../llm.executor';
import { ExecutionContext } from '../../execution-context';
import { WorkflowDefinition, WorkflowExecution, ExecutionStatus } from '../../../domain/entities';
import { WorkflowNode, WorkflowNodeType, LLMNodeData } from '../../../domain/value-objects';

const mockFetch = jest.fn();
global.fetch = mockFetch as unknown as typeof fetch;

function mockLLMContent(content: string): void {
    mockFetch.mockResolvedValue({
        ok: true,
        json: jest.fn().mockResolvedValue({ choices: [{ message: { content } }] }),
    });
}

const SCHEMA = {
    type: 'object',
    properties: { name: { type: 'string' }, age: { type: 'integer' } },
    required: ['name'],
};

function buildContext(data: Record<string, unknown>): { executor: LLMNodeExecutor; context: ExecutionContext; node: WorkflowNode } {
    const node: WorkflowNode = { id: 'llm-1', type: WorkflowNodeType.LLM, name: 'LLM', data: data as LLMNodeData };
    const execution: WorkflowExecution = {
        id: 'exec-1', workflowDefinitionId: 'def-1', version: '1.0.0', input: {},
        status: ExecutionStatus.Running, currentNodeIds: [], executedNodeIds: [], failedNodeIds: [],
        variables: {}, nodeOutputs: {}, createdAt: new Date(),
    };
    const definition: WorkflowDefinition = {
        id: 'def-1', packageId: 'pkg-1', version: '1.0.0', name: 'T',
        graph: { nodes: [], edges: [] }, createdAt: new Date(), updatedAt: new Date(),
    };
    const context = new ExecutionContext(execution, definition, null as never, new Map([[node.id, node]]), new Map());
    return { executor: new LLMNodeExecutor(), context, node };
}

const BASE = { model: 'gpt-4', apiKey: 'k', apiHost: 'https://api.openai.com/v1', prompt: 'hi', retryTimes: 0 };

describe('LLM structured output (Dify-aligned)', () => {
    beforeEach(() => mockFetch.mockReset());

    it('parses, validates and surfaces text + structured_output', async () => {
        mockLLMContent('{"name":"Tom","age":3}');
        const { executor, context, node } = buildContext({ ...BASE, structuredOutput: { enabled: true, schema: SCHEMA } });

        const result = await executor.execute(context, node);

        expect(result.outputs.structured_output).toEqual({ name: 'Tom', age: 3 });
        expect(result.outputs.result).toEqual({ name: 'Tom', age: 3 });
        expect(result.outputs.text).toBe('{"name":"Tom","age":3}');
    });

    it('throws when the model output violates the schema (missing required field)', async () => {
        mockLLMContent('{"age":3}');
        const { executor, context, node } = buildContext({ ...BASE, structuredOutput: { enabled: true, schema: SCHEMA } });

        await expect(executor.execute(context, node)).rejects.toThrow(/schema 校验/);
    });

    it('throws when a typed field has the wrong type', async () => {
        mockLLMContent('{"name":"Tom","age":"three"}');
        const { executor, context, node } = buildContext({ ...BASE, structuredOutput: { enabled: true, schema: SCHEMA } });

        await expect(executor.execute(context, node)).rejects.toThrow(/age/);
    });

    it('leaves plain (non-structured) output untouched', async () => {
        mockLLMContent('just text');
        const { executor, context, node } = buildContext({ ...BASE });

        const result = await executor.execute(context, node);
        expect(result.outputs.result).toBe('just text');
        expect(result.outputs.structured_output).toBeUndefined();
    });
});

describe('validateAgainstSchema', () => {
    it('accepts valid, rejects missing-required / wrong-type / non-array', () => {
        expect(validateAgainstSchema({ name: 'a' }, SCHEMA)).toBeUndefined();
        expect(validateAgainstSchema({ age: 1 }, SCHEMA)).toMatch(/name/);
        expect(validateAgainstSchema({ name: 1 }, SCHEMA)).toMatch(/name/);
        expect(validateAgainstSchema('x', { type: 'array', items: { type: 'string' } })).toMatch(/array/);
        expect(validateAgainstSchema(['a', 2], { type: 'array', items: { type: 'string' } })).toMatch(/元素\[1\]/);
    });

    it('enforces enum / string length / pattern / number bounds (Dify constraints)', () => {
        const enumSchema = { type: 'string', enum: ['low', 'high'] };
        expect(validateAgainstSchema('low', enumSchema)).toBeUndefined();
        expect(validateAgainstSchema('mid', enumSchema)).toMatch(/枚举/);

        expect(validateAgainstSchema('ab', { type: 'string', minLength: 3 })).toMatch(/最小/);
        expect(validateAgainstSchema('abcd', { type: 'string', maxLength: 3 })).toMatch(/最大/);
        expect(validateAgainstSchema('xyz', { type: 'string', pattern: '^[0-9]+$' })).toMatch(/正则/);
        expect(validateAgainstSchema('123', { type: 'string', pattern: '^[0-9]+$' })).toBeUndefined();

        expect(validateAgainstSchema(2, { type: 'integer', minimum: 5 })).toMatch(/最小/);
        expect(validateAgainstSchema(9, { type: 'number', maximum: 8 })).toMatch(/最大/);
        expect(validateAgainstSchema(6, { type: 'integer', minimum: 5, maximum: 8 })).toBeUndefined();
    });
});
