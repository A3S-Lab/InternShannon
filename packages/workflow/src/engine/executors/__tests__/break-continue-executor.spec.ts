import { BreakNodeExecutor, ContinueNodeExecutor } from '../break-continue.executor';
import { ExecutionContext } from '../../execution-context';
import { WorkflowDefinition, WorkflowExecution, ExecutionStatus } from '../../../domain/entities';
import { WorkflowNode, WorkflowNodeType } from '../../../domain/value-objects';

describe('BreakContinueNodeExecutors', () => {
    let context: ExecutionContext;
    let execution: WorkflowExecution;
    let definition: WorkflowDefinition;
    let node: WorkflowNode;

    beforeEach(() => {
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
            id: 'node-1',
            type: WorkflowNodeType.Break,
            name: 'Break',
            data: {},
        };

        context = new ExecutionContext(
            execution,
            definition,
            null as any,
            new Map([[node.id, node]]),
            new Map(),
        );
    });

    describe('BreakNodeExecutor', () => {
        let executor: BreakNodeExecutor;

        beforeEach(() => {
            executor = new BreakNodeExecutor();
        });

        it('should have correct type', () => {
            expect(executor.type).toBe(WorkflowNodeType.Break);
        });

        it('should set break flag in context cache', async () => {
            await executor.execute(context, node);

            expect(context.cache.get('loop-break')).toBe(true);
        });

        it('should return empty outputs', async () => {
            const result = await executor.execute(context, node);

            expect(result.outputs).toEqual({});
        });
    });

    describe('ContinueNodeExecutor', () => {
        let executor: ContinueNodeExecutor;

        beforeEach(() => {
            executor = new ContinueNodeExecutor();
        });

        it('should have correct type', () => {
            expect(executor.type).toBe(WorkflowNodeType.Continue);
        });

        it('should set continue flag in context cache', async () => {
            await executor.execute(context, node);

            expect(context.cache.get('loop-continue')).toBe(true);
        });

        it('should return empty outputs', async () => {
            const result = await executor.execute(context, node);

            expect(result.outputs).toEqual({});
        });
    });
});
