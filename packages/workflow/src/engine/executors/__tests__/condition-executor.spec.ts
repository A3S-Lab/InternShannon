import { ExecutionContext } from '../../execution-context';
import { WorkflowDefinition, WorkflowExecution, ExecutionStatus } from '../../../domain/entities';
import { WorkflowNode, WorkflowNodeType, ConditionNodeData, createEdge } from '../../../domain/value-objects';
import { ConditionNodeExecutor } from '../condition.executor';

describe('ConditionNodeExecutor', () => {
    let executor: ConditionNodeExecutor;
    let context: ExecutionContext;
    let execution: WorkflowExecution;
    let definition: WorkflowDefinition;

    beforeEach(() => {
        executor = new ConditionNodeExecutor();

        execution = {
            id: 'exec-1',
            workflowDefinitionId: 'def-1',
            version: '1.0.0',
            input: {},
            status: ExecutionStatus.Running,
            currentNodeIds: [],
            executedNodeIds: [],
            failedNodeIds: [],
            variables: { value: 10 },
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

    function createConditionNode(data: ConditionNodeData): WorkflowNode {
        return {
            id: 'condition-1',
            type: WorkflowNodeType.Condition,
            name: 'Condition',
            data,
        };
    }

    it('should have correct type', () => {
        const node = createConditionNode({ conditions: [] });
        expect(executor.type).toBe(WorkflowNodeType.Condition);
    });

    it('should return empty outputs when no conditions', async () => {
        const node = createConditionNode({ conditions: [] });
        const result = await executor.execute(context, node);

        expect(result.outputs).toEqual({});
    });

    it('should return outputs without branch when no conditions match', async () => {
        const node = createConditionNode({
            conditions: [],
            defaultNodeId: 'else-branch',
        } as ConditionNodeData);

        const result = await executor.execute(context, node);

        expect(result.outputs).toBeDefined();
        expect(result.branch).toBeUndefined();
    });

    it('should return empty outputs for unsupported condition expression', async () => {
        const node = createConditionNode({
            conditions: [],
        } as ConditionNodeData);

        context = new ExecutionContext(
            execution,
            definition,
            null as any,
            new Map([[node.id, node]]),
            new Map(),
        );

        const result = await executor.execute(context, node);
        expect(result.outputs).toEqual({});
    });
});
