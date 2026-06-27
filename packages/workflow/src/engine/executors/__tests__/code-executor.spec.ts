import { CodeNodeExecutor } from '../code.executor';
import { ExecutionContext } from '../../execution-context';
import { WorkflowDefinition, WorkflowExecution, ExecutionStatus } from '../../../domain/entities';
import { WorkflowNode, WorkflowNodeType, CodeNodeData, FlowValueType } from '../../../domain/value-objects';
import type { SrtCodeRunner } from '../srt-code-runner';

/**
 * Stub runner that actually evaluates the code via AsyncFunction so the
 * existing input/output mapping assertions still pass. The real srt path
 * is covered separately in srt-code-runner.spec.ts (subprocess) and the
 * integration test (full env wiring) — this file focuses on executor logic.
 */
function makeStubRunner(): SrtCodeRunner {
    return {
        isAvailable: () => true,
        run: async ({ code, params }) => {
            const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;
            const fn = new AsyncFunction('params', `${code}\nreturn await main({ params });`);
            const result = await fn(params);
            const outputs = result && typeof result === 'object' && !Array.isArray(result)
                ? (result as Record<string, unknown>)
                : { result };
            return { outputs };
        },
    };
}

describe('CodeNodeExecutor', () => {
    let executor: CodeNodeExecutor;
    let context: ExecutionContext;
    let execution: WorkflowExecution;
    let definition: WorkflowDefinition;
    let node: WorkflowNode;

    beforeEach(() => {
        executor = new CodeNodeExecutor(makeStubRunner());

        execution = {
            id: 'exec-1',
            workflowDefinitionId: 'def-1',
            version: '1.0.0',
            input: {},
            status: ExecutionStatus.Running,
            currentNodeIds: [],
            executedNodeIds: [],
            failedNodeIds: [],
            variables: { inputValue: 10 },
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
            id: 'code-1',
            type: WorkflowNodeType.Code,
            name: 'Code',
            data: {
                language: 'javascript',
                code: '',
            } as CodeNodeData,
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
        expect(executor.type).toBe(WorkflowNodeType.Code);
    });

    it('should throw error when code content is empty', async () => {
        node.data = { language: 'javascript', code: '' } as CodeNodeData;

        await expect(executor.execute(context, node)).rejects.toThrow('code content is required');
    });

    it('should throw error for unsupported language', async () => {
        node.data = { language: 'python', code: 'print("hello")' } as CodeNodeData;

        await expect(executor.execute(context, node)).rejects.toThrow('Unsupported code language');
    });

    describe('sandbox mode', () => {
        const originalEnv = process.env.A3S_CODE_SANDBOX;

        afterEach(() => {
            if (originalEnv === undefined) delete process.env.A3S_CODE_SANDBOX;
            else process.env.A3S_CODE_SANDBOX = originalEnv;
        });

        it('mode=srt + runner unavailable: throws clear install hint', async () => {
            process.env.A3S_CODE_SANDBOX = 'srt';
            const unavailable: SrtCodeRunner = {
                isAvailable: () => false,
                run: async () => { throw new Error('should not run'); },
            };
            const exec = new CodeNodeExecutor(unavailable);
            node.data = { language: 'javascript', code: 'function main(){return {}}' } as CodeNodeData;
            await expect(exec.execute(context, node)).rejects.toThrow(/srt sandbox required/);
        });

        it('mode=auto + runner unavailable: falls back to unsandboxed AsyncFunction', async () => {
            process.env.A3S_CODE_SANDBOX = 'auto';
            const unavailable: SrtCodeRunner = {
                isAvailable: () => false,
                run: async () => { throw new Error('should not run'); },
            };
            const exec = new CodeNodeExecutor(unavailable);
            node.data = {
                language: 'javascript',
                code: `function main({ params }) { return { fallback: 'ok', got: params.x }; }`,
            } as CodeNodeData;
            const result = await exec.execute(context, node);
            expect(result.outputs).toEqual({ fallback: 'ok', got: undefined });
        });

        it('mode=none: always runs unsandboxed, even when runner is available', async () => {
            process.env.A3S_CODE_SANDBOX = 'none';
            const trapRunner: SrtCodeRunner = {
                isAvailable: () => true,
                run: jest.fn(async () => { throw new Error('runner should not be called when mode=none'); }),
            };
            const exec = new CodeNodeExecutor(trapRunner);
            node.data = {
                language: 'javascript',
                code: `function main() { return { skipped_sandbox: true }; }`,
            } as CodeNodeData;
            const result = await exec.execute(context, node);
            expect(result.outputs).toEqual({ skipped_sandbox: true });
            expect(trapRunner.run).not.toHaveBeenCalled();
        });

        it('runner errors are wrapped with "Code execution failed:" prefix', async () => {
            const failingRunner: SrtCodeRunner = {
                isAvailable: () => true,
                run: async () => { throw new Error('handler exploded'); },
            };
            const exec = new CodeNodeExecutor(failingRunner);
            node.data = { language: 'javascript', code: 'function main(){return {}}' } as CodeNodeData;
            await expect(exec.execute(context, node)).rejects.toThrow(/Code execution failed: handler exploded/);
        });

        it('passes node.data.sandboxPolicy through to the runner', async () => {
            const runSpy = jest.fn().mockResolvedValue({ outputs: { ok: true } });
            const recording: SrtCodeRunner = { isAvailable: () => true, run: runSpy };
            const exec = new CodeNodeExecutor(recording);
            node.data = {
                language: 'javascript',
                code: 'function main(){return {ok:true}}',
                sandboxPolicy: {
                    network: { allowedDomains: ['api.example.com'] },
                    filesystem: { allowWrite: ['/tmp/userspace'] },
                },
            } as CodeNodeData & { sandboxPolicy: unknown };
            await exec.execute(context, node);
            expect(runSpy).toHaveBeenCalledTimes(1);
            const arg = runSpy.mock.calls[0][0];
            expect(arg.policy).toEqual({
                network: { allowedDomains: ['api.example.com'] },
                filesystem: { allowWrite: ['/tmp/userspace'] },
            });
        });
    });

    it('should resolve DAG input mappings and output mappings', async () => {
        execution.input = {
            input: { amount: 7 },
            amount: 7,
        };
        context = new ExecutionContext(
            execution,
            definition,
            null as any,
            new Map([[node.id, node]]),
            new Map(),
        );
        node.data = {
            language: 'javascript',
            inputsValues: {
                amount: { type: FlowValueType.Expression, expression: '$.input.amount' },
            },
            outputMappings: {
                doubled: '$.output.rawDoubled',
                label: "'processed'",
            },
            code: `
function main({ params }) {
    return { rawDoubled: params.amount * 2 };
}
`,
        } as CodeNodeData;

        const result = await executor.execute(context, node);

        expect(result.outputs).toEqual({
            doubled: 14,
            label: 'processed',
        });
        expect(context.getNodeOutputs(node.id)).toEqual({
            doubled: 14,
            label: 'processed',
        });
    });
});
