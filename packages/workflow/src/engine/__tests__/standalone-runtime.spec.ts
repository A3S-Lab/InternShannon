import { StandaloneRuntime } from '../standalone-runtime';
import { PackageType } from '../../domain/value-objects';

describe('StandaloneRuntime', () => {
    let runtime: StandaloneRuntime;

    beforeEach(() => {
        runtime = new StandaloneRuntime();
    });

    describe('package executor registration', () => {
        it('should register and retrieve package executor', async () => {
            runtime.registerPackageExecutor('test-pkg', async (input) => {
                return { result: (input as { value: number }).value * 2 };
            });

            const result = await runtime.executePackage({
                packageId: 'test-pkg',
                input: { value: 5 },
            });

            expect(result.success).toBe(true);
            expect(result.output).toEqual({ result: 10 });
        });

        it('should return error when package not found', async () => {
            const result = await runtime.executePackage({
                packageId: 'nonexistent-package',
                input: {},
            });

            expect(result.success).toBe(false);
            expect(result.error).toContain('not found');
        });
    });

    describe('executePackage', () => {
        it('should execute registered package executor', async () => {
            runtime.registerPackageExecutor('my-agent', async (input) => {
                return { agentOutput: `Hello ${input.name}` };
            });

            const result = await runtime.executePackage({
                packageId: 'my-agent',
                input: { name: 'World' },
            });

            expect(result.success).toBe(true);
            expect(result.output?.agentOutput).toBe('Hello World');
        });

        it('should handle package executor errors', async () => {
            runtime.registerPackageExecutor('failing-pkg', async () => {
                throw new Error('Execution failed');
            });

            const result = await runtime.executePackage({
                packageId: 'failing-pkg',
                input: {},
            });

            expect(result.success).toBe(false);
            expect(result.error).toBe('Execution failed');
        });
    });

    describe('job management', () => {
        it('should create job', async () => {
            const { jobId } = await runtime.createJob({
                packageId: 'test-pkg',
                input: {},
            });

            expect(jobId).toBeDefined();
            expect(jobId).toContain('standalone-job-');
        });

        it('should wait for job', async () => {
            const { jobId } = await runtime.createJob({
                packageId: 'test-pkg',
                input: {},
            });

            const result = await runtime.waitForJob(jobId);

            expect(result.success).toBe(true);
        });

        it('should cancel job (no-op in standalone)', async () => {
            const { jobId } = await runtime.createJob({
                packageId: 'test-pkg',
                input: {},
            });

            // Should not throw
            await expect(runtime.cancelJob(jobId)).resolves.toBeUndefined();
        });
    });

    describe('workflow execution', () => {
        it('should create workflow execution', async () => {
            const { executionId } = await runtime.createWorkflowExecution(
                'test-workflow',
                '1.0.0',
                { input: 'test' },
            );

            expect(executionId).toBeDefined();
            expect(executionId).toContain('standalone-exec-');
        });

        it('should wait for workflow execution', async () => {
            const { executionId } = await runtime.createWorkflowExecution(
                'test-workflow',
                undefined,
                {},
            );

            const result = await runtime.waitForWorkflowExecution(executionId);

            expect(result.success).toBe(true);
        });

        it('should cancel workflow execution (no-op)', async () => {
            const { executionId } = await runtime.createWorkflowExecution(
                'test-workflow',
                undefined,
                {},
            );

            await expect(runtime.cancelWorkflowExecution(executionId)).resolves.toBeUndefined();
        });
    });

    describe('getPackage', () => {
        it('should return package info for registered executor', async () => {
            runtime.registerPackageExecutor('my-agent', async () => ({}));

            const pkg = await runtime.getPackage('my-agent', '1.0.0');

            expect(pkg).toBeDefined();
            expect(pkg?.id).toBe('my-agent');
            expect(pkg?.version).toBe('1.0.0');
            expect(pkg?.type).toBe('agent');
        });

        it('should reject packages whose actual type does not match the node contract', async () => {
            runtime.registerPackageExecutor('agent-user-service', async () => ({}));

            const result = await runtime.executePackage({
                packageId: 'agent-user-service',
                expectedPackageType: PackageType.Tool,
                input: {},
            });

            expect(result.success).toBe(false);
            expect(result.error).toContain('type mismatch');
        });

        it('should infer package type from id', async () => {
            const agentPkg = await runtime.getPackage('agent-user-service');
            expect(agentPkg?.type).toBe('agent');

            const workflowPkg = await runtime.getPackage('wf-my-workflow');
            expect(workflowPkg?.type).toBe('workflow');

            const toolPkg = await runtime.getPackage('tool-utility');
            expect(toolPkg?.type).toBe('tool');
        });
    });

    describe('timeout handling', () => {
        it('should handle timeout for long-running packages', async () => {
            runtime.registerPackageExecutor('slow-pkg', async () => {
                await new Promise((resolve) => setTimeout(resolve, 100));
                return { result: 'done' };
            });

            const result = await runtime.executePackage({
                packageId: 'slow-pkg',
                input: {},
                timeout: 10, // 10ms timeout - should fail
            });

            expect(result.success).toBe(false);
            expect(result.error).toContain('timeout');
        }, 10000);
    });
});
