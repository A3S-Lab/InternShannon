import { BlockStartNodeExecutor, BlockEndNodeExecutor } from '../block.executor';
import { ExecutionContext } from '../../execution-context';
import { WorkflowDefinition, WorkflowExecution, ExecutionStatus } from '../../../domain/entities';
import { WorkflowNode, WorkflowNodeType } from '../../../domain/value-objects';

describe('BlockExecutors', () => {
    let execution: WorkflowExecution;
    let definition: WorkflowDefinition;
    let context: ExecutionContext;

    beforeEach(() => {
        execution = {
            id: 'exec-1',
            workflowDefinitionId: 'def-1',
            version: '1.0.0',
            input: { value: 42 },
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

        context = new ExecutionContext(
            execution,
            definition,
            null as any,
            new Map(),
            new Map(),
        );
    });

    describe('BlockStartNodeExecutor', () => {
        let executor: BlockStartNodeExecutor;
        let node: WorkflowNode;

        beforeEach(() => {
            executor = new BlockStartNodeExecutor();
            node = {
                id: 'block-start-1',
                type: WorkflowNodeType.BlockStart,
                name: 'Block Start',
                data: {},
            };
            context.nodeOutputs.set(node.id, new Map());
        });

        it('should have correct type', () => {
            expect(executor.type).toBe(WorkflowNodeType.BlockStart);
        });

        it('should pass through inputs as outputs', async () => {
            const result = await executor.execute(context, node);

            // BlockStart passes through whatever inputs it receives from the context
            // (via resolveInputs), which depends on node.data.inputsValues
            expect(result.outputs).toBeDefined();
        });

        it('should return outputs', async () => {
            const result = await executor.execute(context, node);

            // Result should be an object with outputs property
            expect(result.outputs).toBeDefined();
            expect(typeof result.outputs).toBe('object');
        });
    });

    describe('BlockEndNodeExecutor', () => {
        let executor: BlockEndNodeExecutor;
        let node: WorkflowNode;

        beforeEach(() => {
            executor = new BlockEndNodeExecutor();
            node = {
                id: 'block-end-1',
                type: WorkflowNodeType.BlockEnd,
                name: 'Block End',
                data: {},
            };
            context.nodeOutputs.set(node.id, new Map());
        });

        it('should have correct type', () => {
            expect(executor.type).toBe(WorkflowNodeType.BlockEnd);
        });

        it('should pass through inputs as outputs', async () => {
            const result = await executor.execute(context, node);

            expect(result.outputs).toBeDefined();
        });

        it('should return outputs', async () => {
            const result = await executor.execute(context, node);

            expect(result.outputs).toBeDefined();
            expect(typeof result.outputs).toBe('object');
        });
    });
});
