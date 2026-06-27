import { applyListOperations, ListOperatorNodeExecutor } from '../list-operator.executor';
import { ExecutionContext } from '../../execution-context';
import { WorkflowDefinition, WorkflowExecution, ExecutionStatus } from '../../../domain/entities';
import { WorkflowNode, WorkflowNodeType, FlowValueType } from '../../../domain/value-objects';

describe('applyListOperations', () => {
    const people = [
        { name: 'a', age: 30 },
        { name: 'b', age: 20 },
        { name: 'c', age: 40 },
        { name: 'b', age: 25 },
    ];

    it('filters by a field comparison', () => {
        expect(applyListOperations(people, [{ type: 'filter', field: 'age', operator: 'gte', value: 30 }])).toEqual([
            { name: 'a', age: 30 },
            { name: 'c', age: 40 },
        ]);
    });

    it('sorts ascending and descending by a field', () => {
        expect(applyListOperations([3, 1, 2], [{ type: 'sort', order: 'asc' }])).toEqual([1, 2, 3]);
        expect(applyListOperations([3, 1, 2], [{ type: 'sort', order: 'desc' }])).toEqual([3, 2, 1]);
    });

    it('limits first N and last N (negative)', () => {
        expect(applyListOperations([1, 2, 3, 4], [{ type: 'limit', count: 2 }])).toEqual([1, 2]);
        expect(applyListOperations([1, 2, 3, 4], [{ type: 'limit', count: -2 }])).toEqual([3, 4]);
    });

    it('extracts a field and de-duplicates', () => {
        expect(applyListOperations(people, [{ type: 'extract', field: 'name' }])).toEqual(['a', 'b', 'c', 'b']);
        expect(applyListOperations(people, [{ type: 'unique', field: 'name' }, { type: 'extract', field: 'name' }])).toEqual(['a', 'b', 'c']);
    });

    it('chains operations in order (filter → sort → extract)', () => {
        const result = applyListOperations(people, [
            { type: 'filter', field: 'age', operator: 'gte', value: 25 },
            { type: 'sort', field: 'age', order: 'desc' },
            { type: 'extract', field: 'name' },
        ]);
        expect(result).toEqual(['c', 'a', 'b']); // ages 40,30,25
    });

    it('tolerates a non-array input', () => {
        expect(applyListOperations(undefined as never, [{ type: 'reverse' }])).toEqual([]);
    });

    it('at extracts the Nth item (negative from end, out-of-range → empty)', () => {
        expect(applyListOperations([10, 20, 30], [{ type: 'at', count: 0 }])).toEqual([10]);
        expect(applyListOperations([10, 20, 30], [{ type: 'at', count: -1 }])).toEqual([30]);
        expect(applyListOperations([10, 20, 30], [{ type: 'at', count: 5 }])).toEqual([]);
    });
});

describe('ListOperatorNodeExecutor', () => {
    function ctxFor(node: WorkflowNode): ExecutionContext {
        const execution: WorkflowExecution = {
            id: 'e1', workflowDefinitionId: 'd1', version: '1', input: {}, status: ExecutionStatus.Running,
            currentNodeIds: [], executedNodeIds: [], failedNodeIds: [], variables: {}, nodeOutputs: {}, createdAt: new Date(),
        };
        const definition: WorkflowDefinition = {
            id: 'd1', packageId: 'p1', version: '1', name: 'wf', graph: { nodes: [node], edges: [] }, createdAt: new Date(), updatedAt: new Date(),
        };
        return new ExecutionContext(execution, definition, null as never, new Map([[node.id, node]]), new Map());
    }

    it('exposes result + first/last/length', async () => {
        const node: WorkflowNode = {
            id: 'lo',
            type: WorkflowNodeType.ListOperator,
            name: 'List',
            data: {
                inputsValues: { array: { type: FlowValueType.Static, value: [3, 1, 2] } },
                operations: [{ type: 'sort', order: 'asc' }],
            } as never,
        };
        const result = await new ListOperatorNodeExecutor().execute(ctxFor(node), node);
        expect(result.outputs).toEqual({ result: [1, 2, 3], first: 1, last: 3, length: 3 });
    });
});
