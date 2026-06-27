import { ExecutionContext } from '../../execution-context';
import { WorkflowDefinition, WorkflowExecution, ExecutionStatus } from '../../../domain/entities';
import { WorkflowNode, WorkflowNodeType } from '../../../domain/value-objects';
import { EndNodeExecutor } from '../end.executor';

describe('EndNodeExecutor', () => {
    let executor: EndNodeExecutor;
    let context: ExecutionContext;
    let execution: WorkflowExecution;
    let definition: WorkflowDefinition;
    let node: WorkflowNode;

    beforeEach(() => {
        executor = new EndNodeExecutor();

        execution = {
            id: 'exec-1',
            workflowDefinitionId: 'def-1',
            version: '1.0.0',
            input: { name: 'test' },
            status: ExecutionStatus.Running,
            currentNodeIds: [],
            executedNodeIds: [],
            failedNodeIds: [],
            variables: { name: 'test', result: 100 },
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

        // End node returns empty outputs when no inputsValues defined
        node = {
            id: 'node-1',
            type: WorkflowNodeType.End,
            name: 'End',
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
        expect(executor.type).toBe(WorkflowNodeType.End);
    });

    it('should return inputs from node data', async () => {
        const result = await executor.execute(context, node);

        // End node returns whatever inputs it receives
        // Since no inputsValues defined, returns empty object
        expect(result.outputs).toBeDefined();
    });

    it('should set node output in context', async () => {
        await executor.execute(context, node);

        expect(context.getNodeOutputs('node-1')).toBeDefined();
    });
});
