import { ExecutionContext } from '../execution-context';
import { WorkflowDefinition, WorkflowExecution, ExecutionStatus } from '../../domain/entities';
import { FlowValueType, WorkflowNode, WorkflowEdge, WorkflowNodeType, createEdge } from '../../domain/value-objects';

describe('ExecutionContext', () => {
    let context: ExecutionContext;
    let execution: WorkflowExecution;
    let definition: WorkflowDefinition;
    let nodeMap: Map<string, WorkflowNode>;
    let edgeMap: Map<string, WorkflowEdge[]>;

    beforeEach(() => {
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

        const startNode: WorkflowNode = {
            id: 'start',
            type: WorkflowNodeType.Start,
            name: 'Start',
            data: {},
        };

        const taskNode: WorkflowNode = {
            id: 'task',
            type: 'task',
            name: 'Task',
            data: {},
        };

        const endNode: WorkflowNode = {
            id: 'end',
            type: WorkflowNodeType.End,
            name: 'End',
            data: {},
        };

        nodeMap = new Map([
            ['start', startNode],
            ['task', taskNode],
            ['end', endNode],
        ]);

        // Edge map stores edges by targetNodeId (incoming edges)
        edgeMap = new Map([
            ['start', []], // No incoming edges to start
            ['task', [createEdge('e1', 'start', 'task')]], // edge into task
            ['end', [createEdge('e2', 'task', 'end')]], // edge into end
        ]);

        context = new ExecutionContext(
            execution,
            definition,
            null as any,
            nodeMap,
            edgeMap,
        );
    });

    describe('variables', () => {
        it('should get variable value', () => {
            expect(context.getVariable('name')).toBe('test');
            expect(context.getVariable('value')).toBe(42);
        });

        it('should return undefined for non-existent variable', () => {
            expect(context.getVariable('nonexistent')).toBeUndefined();
        });

        it('should set variable value', () => {
            context.setVariable('newVar', 'newValue');
            expect(context.getVariable('newVar')).toBe('newValue');
        });

        it('should get all variables', () => {
            const vars = context.getAllVariables();
            expect(vars).toEqual({ name: 'test', value: 42 });
        });
    });

    describe('node outputs', () => {
        it('should set and get node output', () => {
            context.setNodeOutput('task', 'result', 'success');
            expect(context.getNodeOutput('task', 'result')).toBe('success');
        });

        it('should set multiple node outputs', () => {
            context.setNodeOutputs('task', { a: 1, b: 2 });
            expect(context.getNodeOutputs('task')).toEqual({ a: 1, b: 2 });
        });

        it('should return empty object for non-existent node output', () => {
            expect(context.getNodeOutputs('nonexistent')).toEqual({});
        });

        it('should resolve bracket notation for node ids containing dashes', () => {
            context.setNodeOutputs('agent-report-write', {
                report_markdown: '# 合规审查报告',
                report_json: { title: '合规审查报告' },
            });

            expect(context.resolveFlowValue({
                type: FlowValueType.Expression,
                expression: "nodeOutputs['agent-report-write'].report_markdown",
            })).toBe('# 合规审查报告');
            expect(context.resolveFlowValue({
                type: FlowValueType.Expression,
                expression: "nodeOutputs['agent-report-write'].report_json",
            })).toEqual({ title: '合规审查报告' });
        });
    });

    describe('node execution tracking', () => {
        it('should mark node as executed', () => {
            context.markNodeExecuted('task');
            expect(context.isNodeExecuted('task')).toBe(true);
        });

        it('should mark node as pending', () => {
            context.markNodePending('task');
            expect(context.isNodeExecuted('task')).toBe(false);
        });

        it('should mark node as failed', () => {
            context.markNodeFailed('task');
            expect(context.isNodeFailed('task')).toBe(true);
        });
    });

    describe('predecessors and successors', () => {
        it('should get predecessors', () => {
            const preds = context.getPredecessors('task');
            expect(preds).toHaveLength(1);
            expect(preds[0].id).toBe('start');
        });

        it('should get successors', () => {
            const succs = context.getSuccessors('task');
            expect(succs).toHaveLength(1);
            expect(succs[0].id).toBe('end');
        });

        it('should check if all predecessors executed', () => {
            expect(context.allPredecessorsExecuted('start')).toBe(true); // No predecessors
            expect(context.allPredecessorsExecuted('task')).toBe(false); // start not executed

            context.markNodeExecuted('start');
            expect(context.allPredecessorsExecuted('task')).toBe(true);
        });
    });

    describe('snapshot', () => {
        it('should create snapshot of current state', () => {
            context.setVariable('newVar', 'value');
            context.setNodeOutputs('task', { result: 'ok' });
            context.markNodeExecuted('start');
            context.markNodeFailed('task');

            const snapshot = context.toSnapshot();

            expect(snapshot.variables).toEqual({ name: 'test', value: 42, newVar: 'value' });
            expect(snapshot.nodeOutputs).toEqual({ task: { result: 'ok' } });
            expect(snapshot.executedNodeIds).toContain('start');
            expect(snapshot.failedNodeIds).toContain('task');
        });
    });

    describe('sub()', () => {
        it('should inherit variables from parent context', () => {
            context.setVariable('parentVar', 'parentValue');
            const sub = context.sub();

            // Sub-context should have parent's variables
            expect(sub.getVariable('name')).toBe('test');
            expect(sub.getVariable('value')).toBe(42);
            expect(sub.getVariable('parentVar')).toBe('parentValue');
        });

        it('should allow setting variables on sub-context without affecting parent', () => {
            const sub = context.sub();
            sub.setVariable('childVar', 'childValue');

            // Child has the new variable
            expect(sub.getVariable('childVar')).toBe('childValue');
            // Parent does not have the new variable
            expect(context.getVariable('childVar')).toBeUndefined();
        });

        it('should have isolated cache per sub-context', () => {
            const sub1 = context.sub();
            const sub2 = context.sub();

            sub1.cache.set('key', 'value1');
            sub2.cache.set('key', 'value2');

            expect(sub1.cache.get('key')).toBe('value1');
            expect(sub2.cache.get('key')).toBe('value2');
            expect(context.cache.get('key')).toBeUndefined();
        });

        it('should allow nested sub-contexts to inherit from parent chain', () => {
            context.setVariable('rootVar', 'rootValue');
            const sub1 = context.sub();
            sub1.setVariable('sub1Var', 'sub1Value');

            // sub1 has both root and its own vars
            expect(sub1.getVariable('rootVar')).toBe('rootValue');
            expect(sub1.getVariable('sub1Var')).toBe('sub1Value');

            const sub2 = sub1.sub();
            sub2.setVariable('sub2Var', 'sub2Value');

            // sub2 has all vars from chain
            expect(sub2.getVariable('rootVar')).toBe('rootValue');
            expect(sub2.getVariable('sub1Var')).toBe('sub1Value');
            expect(sub2.getVariable('sub2Var')).toBe('sub2Value');

            // sub2 shadows sub1's var
            sub2.setVariable('sub1Var', 'sub2ShadowingSub1');
            expect(sub2.getVariable('sub1Var')).toBe('sub2ShadowingSub1');
            expect(sub1.getVariable('sub1Var')).toBe('sub1Value');
        });

        it('should copy variables at sub-context creation time', () => {
            context.setVariable('original', 'value');
            const sub = context.sub();

            // Change parent after sub creation
            context.setVariable('original', 'changed');

            // Sub should have the original value (copied at creation)
            expect(sub.getVariable('original')).toBe('value');
        });

        it('should clear sub-context to prevent memory leaks', () => {
            context.setVariable('var1', 'value1');
            const sub = context.sub();
            sub.setVariable('subVar', 'subValue');
            sub.cache.set('key', 'cachedValue');

            // Before clear, sub has data
            expect(sub.getVariable('subVar')).toBe('subValue');
            expect(sub.cache.get('key')).toBe('cachedValue');

            // After clear, sub is cleaned up
            sub.clear();

            expect(sub.getVariable('subVar')).toBeUndefined();
            expect(sub.cache.get('key')).toBeUndefined();
        });
    });
});
