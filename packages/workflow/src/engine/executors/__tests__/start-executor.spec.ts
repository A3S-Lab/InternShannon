import { ExecutionContext } from '../../execution-context';
import { WorkflowDefinition, WorkflowExecution, ExecutionStatus } from '../../../domain/entities';
import { WorkflowNode, WorkflowNodeType } from '../../../domain/value-objects';
import { StartNodeExecutor } from '../start.executor';

describe('StartNodeExecutor', () => {
    let executor: StartNodeExecutor;
    let context: ExecutionContext;
    let execution: WorkflowExecution;
    let definition: WorkflowDefinition;
    let node: WorkflowNode;

    beforeEach(() => {
        executor = new StartNodeExecutor();

        execution = {
            id: 'exec-1',
            workflowDefinitionId: 'def-1',
            version: '1.0.0',
            input: { name: 'test', value: 42 },
            status: ExecutionStatus.Running,
            currentNodeIds: [],
            executedNodeIds: [],
            failedNodeIds: [],
            variables: { name: 'test', value: 42 },
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
            type: WorkflowNodeType.Start,
            name: 'Start',
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

    it('should have correct type', () => {
        expect(executor.type).toBe(WorkflowNodeType.Start);
    });

    it('should return workflow input as outputs', async () => {
        const result = await executor.execute(context, node);

        expect(result.outputs).toEqual({ name: 'test', value: 42 });
    });

    it('should set node output in context', async () => {
        await executor.execute(context, node);

        expect(context.getNodeOutputs('node-1')).toEqual({ name: 'test', value: 42 });
    });
});
