import { HTTPNodeExecutor, buildAuthorizationHeader } from '../http.executor';
import { ExecutionContext } from '../../execution-context';
import { WorkflowDefinition, WorkflowExecution, ExecutionStatus } from '../../../domain/entities';
import { WorkflowNode, WorkflowNodeType, HTTPNodeData } from '../../../domain/value-objects';

// Mock global fetch
const mockFetch = jest.fn();
global.fetch = mockFetch;

describe('HTTPNodeExecutor', () => {
    let executor: HTTPNodeExecutor;
    let context: ExecutionContext;
    let execution: WorkflowExecution;
    let definition: WorkflowDefinition;
    let node: WorkflowNode;

    beforeEach(() => {
        executor = new HTTPNodeExecutor();
        mockFetch.mockReset();

        execution = {
            id: 'exec-1',
            workflowDefinitionId: 'def-1',
            version: '1.0.0',
            input: {},
            status: ExecutionStatus.Running,
            currentNodeIds: [],
            executedNodeIds: [],
            failedNodeIds: [],
            variables: {},
            nodeOutputs: {},
            createdAt: new Date(),
        };

        definition = {
            id: 'def-1',
            packageId: 'pkg-1',
            version: '1.0.0',
            name: 'Test Workflow',
            graph: { nodes: [], edges: [] },
            createdAt: new Date(),
            updatedAt: new Date(),
        };

        node = {
            id: 'http-1',
            type: WorkflowNodeType.HTTP,
            name: 'HTTP Request',
            data: {
                method: 'GET',
                url: 'https://api.example.com/data',
                timeout: 5000,
                retryTimes: 0,
            } as HTTPNodeData,
        };

        context = new ExecutionContext(
            execution,
            definition,
            null as any,
            new Map([[node.id, node]]),
            new Map(),
        );
    });

    it('should have correct type', () => {
        expect(executor.type).toBe(WorkflowNodeType.HTTP);
    });

    it('should throw error when URL is missing', async () => {
        node.data = { method: 'GET' } as HTTPNodeData;

        await expect(executor.execute(context, node)).rejects.toThrow('url is required');
    });

    function mockResponse(opts: {
        ok: boolean;
        status: number;
        statusText?: string;
        contentType?: string;
        body: unknown;
    }) {
        const contentType = opts.contentType ?? 'application/json';
        return {
            ok: opts.ok,
            status: opts.status,
            statusText: opts.statusText ?? '',
            headers: {
                forEach: (cb: (v: string, k: string) => void) => cb(contentType, 'content-type'),
                get: (k: string) => (k.toLowerCase() === 'content-type' ? contentType : null),
            },
            json: async () => opts.body,
            text: async () => (typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body)),
        };
    }

    it('throws on a non-2xx response so the node fails instead of swallowing the error body', async () => {
        mockFetch.mockResolvedValue(
            mockResponse({
                ok: false,
                status: 403,
                statusText: 'Forbidden',
                body: { error: { code: 'insufficient_user_quota', message: '用户额度不足' } },
            }),
        );

        await expect(executor.execute(context, node)).rejects.toThrow(/HTTP 403/);
        await expect(executor.execute(context, node)).rejects.toThrow(/insufficient_user_quota/);
    });

    it('returns the error body without throwing when failOnErrorStatus is false', async () => {
        node.data = { ...(node.data as HTTPNodeData), failOnErrorStatus: false };
        mockFetch.mockResolvedValue(
            mockResponse({ ok: false, status: 404, body: { message: 'not found' } }),
        );

        const result = await executor.execute(context, node);

        expect(result.outputs.statusCode).toBe(404);
        expect(result.outputs.body).toEqual({ message: 'not found' });
    });

    it('returns the parsed body on a 2xx response', async () => {
        mockFetch.mockResolvedValue(mockResponse({ ok: true, status: 200, body: { data: 1 } }));

        const result = await executor.execute(context, node);

        expect(result.outputs.statusCode).toBe(200);
        expect(result.outputs.body).toEqual({ data: 1 });
    });
});

describe('buildAuthorizationHeader (Dify http auth parity)', () => {
    it('bearer → Authorization: Bearer <token>', () => {
        expect(buildAuthorizationHeader({ type: 'bearer', token: 'abc123' })).toEqual({ name: 'Authorization', value: 'Bearer abc123' });
    });
    it('basic → base64(user:pass)', () => {
        const h = buildAuthorizationHeader({ type: 'basic', username: 'u', password: 'p' });
        expect(h?.name).toBe('Authorization');
        expect(Buffer.from(String(h?.value).replace('Basic ', ''), 'base64').toString()).toBe('u:p');
    });
    it('custom → named header', () => {
        expect(buildAuthorizationHeader({ type: 'custom', headerName: 'X-API-Key', headerValue: 'k' })).toEqual({ name: 'X-API-Key', value: 'k' });
    });
    it('none / empty → null', () => {
        expect(buildAuthorizationHeader({ type: 'none' })).toBeNull();
        expect(buildAuthorizationHeader(undefined)).toBeNull();
        expect(buildAuthorizationHeader({ type: 'bearer', token: '' })).toBeNull();
    });
});
