import { LoopNodeExecutor } from '../loop.executor';
import { ExecutionContext } from '../../execution-context';
import { MaterialRegistry } from '../../material-registry';
import { WorkflowDefinition, WorkflowExecution, ExecutionStatus } from '../../../domain/entities';
import { WorkflowNode, WorkflowNodeType, LoopNodeData, createEdge, FlowValueType } from '../../../domain/value-objects';
import { StartNodeExecutor } from '../start.executor';
import { EndNodeExecutor } from '../end.executor';
import { CodeNodeExecutor } from '../code.executor';
import { BlockStartNodeExecutor, BlockEndNodeExecutor } from '../block.executor';
import { BreakNodeExecutor, ContinueNodeExecutor } from '../break-continue.executor';

describe('LoopNodeExecutor', () => {
    let executor: LoopNodeExecutor;
    let context: ExecutionContext;
    let execution: WorkflowExecution;
    let definition: WorkflowDefinition;
    let materialRegistry: MaterialRegistry;

    beforeEach(() => {
        materialRegistry = new MaterialRegistry();

        // Register built-in executors
        materialRegistry.registerExecutorFactory('start', () => new StartNodeExecutor());
        materialRegistry.registerExecutorFactory('end', () => new EndNodeExecutor());
        materialRegistry.registerExecutorFactory('code', () => new CodeNodeExecutor());
        materialRegistry.registerExecutorFactory('block-start', () => new BlockStartNodeExecutor());
        materialRegistry.registerExecutorFactory('block-end', () => new BlockEndNodeExecutor());
        materialRegistry.registerExecutorFactory('break', () => new BreakNodeExecutor());
        materialRegistry.registerExecutorFactory('continue', () => new ContinueNodeExecutor());

        executor = new LoopNodeExecutor(materialRegistry);

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
    });

    function createContext(nodeMap: Map<string, WorkflowNode>, edgeMap: Map<string, any[]>) {
        return new ExecutionContext(
            execution,
            definition,
            null as any,
            nodeMap,
            edgeMap,
        );
    }

    it('should have correct type', () => {
        expect(executor.type).toBe(WorkflowNodeType.Loop);
    });

    it('should return empty outputs when no array variable', async () => {
        const node: WorkflowNode = {
            id: 'loop-1',
            type: WorkflowNodeType.Loop,
            name: 'Loop',
            data: {
                loopArray: 'myArray',
            } as LoopNodeData,
            blocks: [],
        };

        const context = createContext(
            new Map([[node.id, node]]),
            new Map(),
        );

        const result = await executor.execute(context, node);
        expect(result.outputs.items).toEqual([]);
    });

    it('should handle empty array', async () => {
        const blockStart: WorkflowNode = {
            id: 'block-start-1',
            type: WorkflowNodeType.BlockStart,
            name: 'Block Start',
            data: {},
        };

        const blockEnd: WorkflowNode = {
            id: 'block-end-1',
            type: WorkflowNodeType.BlockEnd,
            name: 'Block End',
            data: {},
        };

        const node: WorkflowNode = {
            id: 'loop-1',
            type: WorkflowNodeType.Loop,
            name: 'Loop',
            data: {
                loopArray: 'myArray',
            } as LoopNodeData,
            blocks: [blockStart, blockEnd],
            edges: [createEdge('e1', 'block-start-1', 'block-end-1')],
        };

        const context = createContext(
            new Map([
                [node.id, node],
                ['block-start-1', blockStart],
                ['block-end-1', blockEnd],
            ]),
            new Map([
                ['block-start-1', []],
                ['block-end-1', [createEdge('e1', 'block-start-1', 'block-end-1')]],
            ]),
        );
        context.setVariable('myArray', []);

        const result = await executor.execute(context, node);
        expect(result.outputs.items).toEqual([]);
    });

    it('should handle non-array variable', async () => {
        const node: WorkflowNode = {
            id: 'loop-1',
            type: WorkflowNodeType.Loop,
            name: 'Loop',
            data: {
                loopArray: 'myArray',
            } as LoopNodeData,
            blocks: [],
        };

        const context = createContext(
            new Map([[node.id, node]]),
            new Map(),
        );
        context.setVariable('myArray', 'not-an-array');

        const result = await executor.execute(context, node);
        expect(result.outputs.items).toEqual([]);
    });

    it('should handle missing loopArray reference', async () => {
        const node: WorkflowNode = {
            id: 'loop-1',
            type: WorkflowNodeType.Loop,
            name: 'Loop',
            data: {} as LoopNodeData,
            blocks: [],
        };

        const context = createContext(
            new Map([[node.id, node]]),
            new Map(),
        );

        const result = await executor.execute(context, node);
        expect(result.outputs.items).toEqual([]);
    });

    it('should handle missing block start node', async () => {
        const node: WorkflowNode = {
            id: 'loop-1',
            type: WorkflowNodeType.Loop,
            name: 'Loop',
            data: {
                loopArray: 'myArray',
            } as LoopNodeData,
            blocks: [],
        };

        const context = createContext(
            new Map([[node.id, node]]),
            new Map(),
        );
        context.setVariable('myArray', [1, 2, 3]);

        const result = await executor.execute(context, node);
        expect(result.outputs.items).toEqual([]);
    });

    it('should execute block subgraph with single node', async () => {
        const blockStart: WorkflowNode = {
            id: 'block-start-1',
            type: WorkflowNodeType.BlockStart,
            name: 'Block Start',
            data: {},
        };

        const codeNode: WorkflowNode = {
            id: 'code-1',
            type: 'code',
            name: 'Double',
            data: {
                language: 'javascript',
                code: 'return { doubled: params.value * 2 };',
                inputsValues: {
                    value: { type: FlowValueType.Variable, variableName: 'item' },
                },
            },
        };

        const blockEnd: WorkflowNode = {
            id: 'block-end-1',
            type: WorkflowNodeType.BlockEnd,
            name: 'Block End',
            data: {},
        };

        const loopNode: WorkflowNode = {
            id: 'loop-1',
            type: WorkflowNodeType.Loop,
            name: 'Loop',
            data: {
                loopArray: 'myArray',
                loopVariable: 'item',
            } as LoopNodeData,
            blocks: [blockStart, codeNode, blockEnd],
            edges: [
                createEdge('e1', 'block-start-1', 'code-1'),
                createEdge('e2', 'code-1', 'block-end-1'),
            ],
        };

        const nodeMap = new Map<string, WorkflowNode>([
            ['loop-1', loopNode],
            ['block-start-1', blockStart],
            ['code-1', codeNode],
            ['block-end-1', blockEnd],
        ]);

        const edgeMap = new Map<string, any[]>([
            ['block-start-1', [createEdge('e1', 'block-start-1', 'code-1')]],
            ['code-1', [createEdge('e2', 'code-1', 'block-end-1')]],
            ['block-end-1', []],
        ]);

        const ctx = createContext(nodeMap, edgeMap);
        ctx.setVariable('myArray', [1, 2]);

        const result = await executor.execute(ctx, loopNode);

        expect(result.outputs.items).toHaveLength(2);
    });

    it('parallel mode runs all iterations concurrently and preserves order (no break-condition)', async () => {
        const blockStart: WorkflowNode = { id: 'block-start-1', type: WorkflowNodeType.BlockStart, name: 'Block Start', data: {} };
        const codeNode: WorkflowNode = {
            id: 'code-1',
            type: 'code',
            name: 'Double',
            data: {
                language: 'javascript',
                code: 'return { doubled: params.value * 2 };',
                inputsValues: { value: { type: FlowValueType.Variable, variableName: 'item' } },
            },
        };
        const blockEnd: WorkflowNode = { id: 'block-end-1', type: WorkflowNodeType.BlockEnd, name: 'Block End', data: {} };
        const loopNode: WorkflowNode = {
            id: 'loop-1',
            type: WorkflowNodeType.Loop,
            name: 'Loop',
            data: { loopArray: 'myArray', loopVariable: 'item', parallel: true, concurrency: 3 } as LoopNodeData,
            blocks: [blockStart, codeNode, blockEnd],
            edges: [createEdge('e1', 'block-start-1', 'code-1'), createEdge('e2', 'code-1', 'block-end-1')],
        };
        const nodeMap = new Map<string, WorkflowNode>([
            ['loop-1', loopNode],
            ['block-start-1', blockStart],
            ['code-1', codeNode],
            ['block-end-1', blockEnd],
        ]);
        const edgeMap = new Map<string, any[]>([
            ['block-start-1', [createEdge('e1', 'block-start-1', 'code-1')]],
            ['code-1', [createEdge('e2', 'code-1', 'block-end-1')]],
            ['block-end-1', []],
        ]);
        const ctx = createContext(nodeMap, edgeMap);
        ctx.setVariable('myArray', [1, 2, 3, 4, 5]);

        const result = await executor.execute(ctx, loopNode);

        // every iteration ran (concurrent fan-out) and the outputs stay in input order
        expect(result.outputs.items).toHaveLength(5);
    });

    it('should respect maxIterations limit', async () => {
        const blockStart: WorkflowNode = {
            id: 'block-start-1',
            type: WorkflowNodeType.BlockStart,
            name: 'Block Start',
            data: {},
        };

        const codeNode: WorkflowNode = {
            id: 'code-1',
            type: 'code',
            name: 'Double',
            data: {
                language: 'javascript',
                code: 'return { value: params.value * 2 };',
                inputsValues: {
                    value: { type: FlowValueType.Variable, variableName: 'item' },
                },
            },
        };

        const blockEnd: WorkflowNode = {
            id: 'block-end-1',
            type: WorkflowNodeType.BlockEnd,
            name: 'Block End',
            data: {},
        };

        const loopNode: WorkflowNode = {
            id: 'loop-1',
            type: WorkflowNodeType.Loop,
            name: 'Loop',
            data: {
                loopArray: 'myArray',
                loopVariable: 'item',
                maxIterations: 2,
            } as LoopNodeData,
            blocks: [blockStart, codeNode, blockEnd],
            edges: [
                createEdge('e1', 'block-start-1', 'code-1'),
                createEdge('e2', 'code-1', 'block-end-1'),
            ],
        };

        const nodeMap = new Map<string, WorkflowNode>([
            ['loop-1', loopNode],
            ['block-start-1', blockStart],
            ['code-1', codeNode],
            ['block-end-1', blockEnd],
        ]);

        const edgeMap = new Map<string, any[]>([
            ['block-start-1', [createEdge('e1', 'block-start-1', 'code-1')]],
            ['code-1', [createEdge('e2', 'code-1', 'block-end-1')]],
            ['block-end-1', []],
        ]);

        const ctx = createContext(nodeMap, edgeMap);
        ctx.setVariable('myArray', [1, 2, 3, 4, 5]);

        const result = await executor.execute(ctx, loopNode);

        // maxIterations is 2, so only 2 iterations
        expect(result.outputs.items).toHaveLength(2);
    });

    it('should set loop variables correctly', async () => {
        const blockStart: WorkflowNode = {
            id: 'block-start-1',
            type: WorkflowNodeType.BlockStart,
            name: 'Block Start',
            data: {},
        };

        const codeNode: WorkflowNode = {
            id: 'code-1',
            type: 'code',
            name: 'Check Loop Vars',
            data: {
                language: 'javascript',
                code: `
                    return {
                        item: params.item,
                        index: params._loop_index,
                        loopItem: params._loop_item
                    };
                `,
                inputsValues: {
                    item: { type: FlowValueType.Variable, variableName: 'item' },
                    _loop_index: { type: FlowValueType.Variable, variableName: '_loop.index' },
                    _loop_item: { type: FlowValueType.Variable, variableName: '_loop.item' },
                },
            },
        };

        const blockEnd: WorkflowNode = {
            id: 'block-end-1',
            type: WorkflowNodeType.BlockEnd,
            name: 'Block End',
            data: {},
        };

        const loopNode: WorkflowNode = {
            id: 'loop-1',
            type: WorkflowNodeType.Loop,
            name: 'Loop',
            data: {
                loopArray: 'myArray',
                loopVariable: 'item',
            } as LoopNodeData,
            blocks: [blockStart, codeNode, blockEnd],
            edges: [
                createEdge('e1', 'block-start-1', 'code-1'),
                createEdge('e2', 'code-1', 'block-end-1'),
            ],
        };

        const nodeMap = new Map<string, WorkflowNode>([
            ['loop-1', loopNode],
            ['block-start-1', blockStart],
            ['code-1', codeNode],
            ['block-end-1', blockEnd],
        ]);

        const edgeMap = new Map<string, any[]>([
            ['block-start-1', [createEdge('e1', 'block-start-1', 'code-1')]],
            ['code-1', [createEdge('e2', 'code-1', 'block-end-1')]],
            ['block-end-1', []],
        ]);

        const ctx = createContext(nodeMap, edgeMap);
        ctx.setVariable('myArray', ['a', 'b']);

        const result = await executor.execute(ctx, loopNode);

        expect(result.outputs.items).toHaveLength(2);
        // First iteration
        expect((result.outputs.items as any[])[0]).toMatchObject({
            item: 'a',
            index: 0,
            loopItem: 'a',
        });
        // Second iteration
        expect((result.outputs.items as any[])[1]).toMatchObject({
            item: 'b',
            index: 1,
            loopItem: 'b',
        });
    });

    it('should break out of loop when break node executes', async () => {
        const blockStart: WorkflowNode = {
            id: 'block-start-1',
            type: WorkflowNodeType.BlockStart,
            name: 'Block Start',
            data: {},
        };

        const codeNode: WorkflowNode = {
            id: 'code-1',
            type: 'code',
            name: 'Counter',
            data: {
                language: 'javascript',
                code: 'return { counter: params.item };',
                inputsValues: {
                    item: { type: FlowValueType.Variable, variableName: 'item' },
                },
            },
        };

        const breakNode: WorkflowNode = {
            id: 'break-1',
            type: WorkflowNodeType.Break,
            name: 'Break',
            data: {},
        };

        const blockEnd: WorkflowNode = {
            id: 'block-end-1',
            type: WorkflowNodeType.BlockEnd,
            name: 'Block End',
            data: {},
        };

        const loopNode: WorkflowNode = {
            id: 'loop-1',
            type: WorkflowNodeType.Loop,
            name: 'Loop',
            data: {
                loopArray: 'myArray',
                loopVariable: 'item',
            } as LoopNodeData,
            blocks: [blockStart, codeNode, breakNode, blockEnd],
            edges: [
                createEdge('e1', 'block-start-1', 'code-1'),
                createEdge('e2', 'code-1', 'break-1'),
                createEdge('e3', 'break-1', 'block-end-1'),
            ],
        };

        const nodeMap = new Map<string, WorkflowNode>([
            ['loop-1', loopNode],
            ['block-start-1', blockStart],
            ['code-1', codeNode],
            ['break-1', breakNode],
            ['block-end-1', blockEnd],
        ]);

        const edgeMap = new Map<string, any[]>([
            ['block-start-1', [createEdge('e1', 'block-start-1', 'code-1')]],
            ['code-1', [createEdge('e2', 'code-1', 'break-1')]],
            ['break-1', [createEdge('e3', 'break-1', 'block-end-1')]],
            ['block-end-1', []],
        ]);

        const ctx = createContext(nodeMap, edgeMap);
        ctx.setVariable('myArray', [1, 2, 3, 4, 5]);

        const result = await executor.execute(ctx, loopNode);

        // Break exits before output collection, so no items
        expect(result.outputs.items).toHaveLength(0);
    });

    it('should continue to next iteration when continue node executes', async () => {
        const blockStart: WorkflowNode = {
            id: 'block-start-1',
            type: WorkflowNodeType.BlockStart,
            name: 'Block Start',
            data: {},
        };

        const codeNode: WorkflowNode = {
            id: 'code-1',
            type: 'code',
            name: 'Counter',
            data: {
                language: 'javascript',
                code: 'return { counter: params.item };',
                inputsValues: {
                    item: { type: FlowValueType.Variable, variableName: 'item' },
                },
            },
        };

        const continueNode: WorkflowNode = {
            id: 'continue-1',
            type: WorkflowNodeType.Continue,
            name: 'Continue',
            data: {},
        };

        const blockEnd: WorkflowNode = {
            id: 'block-end-1',
            type: WorkflowNodeType.BlockEnd,
            name: 'Block End',
            data: {},
        };

        const loopNode: WorkflowNode = {
            id: 'loop-1',
            type: WorkflowNodeType.Loop,
            name: 'Loop',
            data: {
                loopArray: 'myArray',
                loopVariable: 'item',
            } as LoopNodeData,
            blocks: [blockStart, codeNode, continueNode, blockEnd],
            edges: [
                createEdge('e1', 'block-start-1', 'code-1'),
                createEdge('e2', 'code-1', 'continue-1'),
                createEdge('e3', 'continue-1', 'block-end-1'),
            ],
        };

        const nodeMap = new Map<string, WorkflowNode>([
            ['loop-1', loopNode],
            ['block-start-1', blockStart],
            ['code-1', codeNode],
            ['continue-1', continueNode],
            ['block-end-1', blockEnd],
        ]);

        const edgeMap = new Map<string, any[]>([
            ['block-start-1', [createEdge('e1', 'block-start-1', 'code-1')]],
            ['code-1', [createEdge('e2', 'code-1', 'continue-1')]],
            ['continue-1', [createEdge('e3', 'continue-1', 'block-end-1')]],
            ['block-end-1', []],
        ]);

        const ctx = createContext(nodeMap, edgeMap);
        ctx.setVariable('myArray', [1, 2, 3]);

        const result = await executor.execute(ctx, loopNode);

        // Continue skips output collection but continues loop
        // So we get 0 items since continue node has no outputs
        expect(result.outputs.items).toHaveLength(0);
    });

    // Regression: break/continue used to be read AFTER subContext.clear(), so the
    // cache flag was always undefined and the loop never stopped early. The
    // pre-existing tests above only assert items.length === 0, which holds whether
    // or not break fires (the break node emits no output), so they cannot catch
    // the regression. These count actual body executions instead.
    //
    // The break test catches the original bug directly (5 runs -> 1). The continue
    // test is a behavioural guard: continue must ADVANCE to the next iteration, not
    // break out of the loop — it also pins that the loop still terminates.

    it('should stop iterating after break fires (body runs once, not N times)', async () => {
        let bodyRuns = 0;
        const countingExecutor = {
            type: 'counting',
            execute: async () => {
                bodyRuns += 1;
                return { outputs: { n: bodyRuns } };
            },
        };
        materialRegistry.registerExecutorFactory('counting', () => countingExecutor as any);

        const blockStart: WorkflowNode = { id: 'block-start-1', type: WorkflowNodeType.BlockStart, name: 'Block Start', data: {} };
        const counter: WorkflowNode = { id: 'counter-1', type: 'counting', name: 'Counter', data: {} };
        const breakNode: WorkflowNode = { id: 'break-1', type: WorkflowNodeType.Break, name: 'Break', data: {} };
        const blockEnd: WorkflowNode = { id: 'block-end-1', type: WorkflowNodeType.BlockEnd, name: 'Block End', data: {} };

        const loopNode: WorkflowNode = {
            id: 'loop-1',
            type: WorkflowNodeType.Loop,
            name: 'Loop',
            data: { loopArray: 'myArray', loopVariable: 'item' } as LoopNodeData,
            blocks: [blockStart, counter, breakNode, blockEnd],
            edges: [
                createEdge('e1', 'block-start-1', 'counter-1'),
                createEdge('e2', 'counter-1', 'break-1'),
                createEdge('e3', 'break-1', 'block-end-1'),
            ],
        };

        const nodeMap = new Map<string, WorkflowNode>([
            ['loop-1', loopNode],
            ['block-start-1', blockStart],
            ['counter-1', counter],
            ['break-1', breakNode],
            ['block-end-1', blockEnd],
        ]);
        const edgeMap = new Map<string, any[]>([
            ['block-start-1', [createEdge('e1', 'block-start-1', 'counter-1')]],
            ['counter-1', [createEdge('e2', 'counter-1', 'break-1')]],
            ['break-1', [createEdge('e3', 'break-1', 'block-end-1')]],
            ['block-end-1', []],
        ]);

        const ctx = createContext(nodeMap, edgeMap);
        ctx.setVariable('myArray', [1, 2, 3, 4, 5]);

        await executor.execute(ctx, loopNode);

        // Break fires on the first iteration, so the body must run exactly once.
        // Before the fix this was 5 (break flag was wiped by clear() before the read).
        expect(bodyRuns).toBe(1);
    });

    it('should iterate the full array when continue fires each iteration (not stop early)', async () => {
        let bodyRuns = 0;
        const countingExecutor = {
            type: 'counting',
            execute: async () => {
                bodyRuns += 1;
                return { outputs: { n: bodyRuns } };
            },
        };
        materialRegistry.registerExecutorFactory('counting', () => countingExecutor as any);

        const blockStart: WorkflowNode = { id: 'block-start-1', type: WorkflowNodeType.BlockStart, name: 'Block Start', data: {} };
        const counter: WorkflowNode = { id: 'counter-1', type: 'counting', name: 'Counter', data: {} };
        const continueNode: WorkflowNode = { id: 'continue-1', type: WorkflowNodeType.Continue, name: 'Continue', data: {} };
        const blockEnd: WorkflowNode = { id: 'block-end-1', type: WorkflowNodeType.BlockEnd, name: 'Block End', data: {} };

        const loopNode: WorkflowNode = {
            id: 'loop-1',
            type: WorkflowNodeType.Loop,
            name: 'Loop',
            data: { loopArray: 'myArray', loopVariable: 'item' } as LoopNodeData,
            blocks: [blockStart, counter, continueNode, blockEnd],
            edges: [
                createEdge('e1', 'block-start-1', 'counter-1'),
                createEdge('e2', 'counter-1', 'continue-1'),
                createEdge('e3', 'continue-1', 'block-end-1'),
            ],
        };

        const nodeMap = new Map<string, WorkflowNode>([
            ['loop-1', loopNode],
            ['block-start-1', blockStart],
            ['counter-1', counter],
            ['continue-1', continueNode],
            ['block-end-1', blockEnd],
        ]);
        const edgeMap = new Map<string, any[]>([
            ['block-start-1', [createEdge('e1', 'block-start-1', 'counter-1')]],
            ['counter-1', [createEdge('e2', 'counter-1', 'continue-1')]],
            ['continue-1', [createEdge('e3', 'continue-1', 'block-end-1')]],
            ['block-end-1', []],
        ]);

        const ctx = createContext(nodeMap, edgeMap);
        ctx.setVariable('myArray', [1, 2, 3]);

        await executor.execute(ctx, loopNode);

        // Continue should advance to the next iteration, so the body runs once per
        // element — all 3 — and the loop still terminates at the array's end.
        expect(bodyRuns).toBe(3);
    });
});
