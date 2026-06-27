import { WorkflowEngine } from '../workflow-engine';
import { InMemoryWorkflowRepository } from '../../infrastructure/in-memory-repository';
import { WorkflowDefinition, WorkflowExecution, NodeExecution, ExecutionStatus, NodeExecutionStatus } from '../../domain/entities';
import { WorkflowNode, WorkflowEdge, WorkflowNodeType, createEdge, LoopNodeData, ConditionNodeData, CodeNodeData, MaterialDefinition, FlowValueType } from '../../domain/value-objects';
import { StandaloneRuntime } from '../standalone-runtime';
import { MaterialRegistry } from '../material-registry';
import { BUILT_IN_PACKAGE_MATERIAL_ID, MaterialService } from '../material.service';
import { CodeNodeExecutor } from '../executors/code.executor';
import { ConditionNodeExecutor } from '../executors/condition.executor';
import { LoopNodeExecutor } from '../executors/loop.executor';
import { BlockStartNodeExecutor, BlockEndNodeExecutor } from '../executors/block.executor';
import { BreakNodeExecutor, ContinueNodeExecutor } from '../executors/break-continue.executor';
import { BaseNodeExecutor, NodeExecutorResult } from '../executors/base.executor';
import { ExecutionContext } from '../execution-context';
import { CancellationToken } from '../cancellation-token';

async function waitForExecutionStatus(
    repository: InMemoryWorkflowRepository,
    executionId: string,
    status: ExecutionStatus,
    timeoutMs = 1000,
): Promise<WorkflowExecution> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        const execution = await repository.findExecutionById(executionId);
        if (execution?.status === status) {
            return execution;
        }
        await new Promise(resolve => setTimeout(resolve, 10));
    }
    const latest = await repository.findExecutionById(executionId);
    throw new Error(`Execution ${executionId} did not reach ${status}; latest=${latest?.status ?? 'missing'}`);
}

describe('WorkflowEngine', () => {
    let engine: WorkflowEngine;
    let repository: InMemoryWorkflowRepository;
    let runtime: StandaloneRuntime;
    let definition: WorkflowDefinition;

    beforeEach(async () => {
        repository = new InMemoryWorkflowRepository();
        runtime = new StandaloneRuntime();
        engine = new WorkflowEngine(runtime, repository);

        // Create a simple workflow: Start -> End
        const startNode: WorkflowNode = {
            id: 'start',
            type: WorkflowNodeType.Start,
            name: 'Start',
            data: {},
        };

        const endNode: WorkflowNode = {
            id: 'end',
            type: WorkflowNodeType.End,
            name: 'End',
            data: {},
        };

        const workflowNode: WorkflowNode = {
            id: 'agent-1',
            type: 'package-agent',
            name: 'Agent',
            data: { packageId: 'test-agent', packageVersion: '1.0.0' },
        };

        const edges: WorkflowEdge[] = [
            createEdge('e1', 'start', 'agent-1'),
            createEdge('e2', 'agent-1', 'end'),
        ];

        definition = {
            id: 'workflow-1',
            packageId: 'pkg-workflow-1',
            version: '1.0.0',
            name: 'Test Workflow',
            graph: {
                nodes: [startNode, workflowNode, endNode],
                edges: edges,
            },
            createdAt: new Date(),
            updatedAt: new Date(),
        };

        await repository.saveDefinition(definition);
    });

    it('should have a material registry', () => {
        const registry = engine.getMaterialRegistry();
        expect(registry).toBeDefined();
    });

    it('should load workflow materials before execution', async () => {
        await engine.loadWorkflowMaterials(definition);
        expect(engine.getMaterialRegistry().getNodeType('package-agent')).toBeDefined();
    });

    it('should find definition by id', async () => {
        const found = await repository.findDefinitionById('workflow-1');
        expect(found).toBeDefined();
        expect(found?.id).toBe('workflow-1');
    });

    it('should throw error when definition not found', async () => {
        await expect(
            engine.execute('nonexistent', { input: {} })
        ).rejects.toThrow('Workflow definition nonexistent not found');
    });
});

describe('MaterialService built-in package nodes', () => {
    it('does not register package-model as a workflow node', async () => {
        const materialService = new MaterialService();
        const material = await materialService.getMaterialById(BUILT_IN_PACKAGE_MATERIAL_ID);
        const nodeTypes = material?.nodeTypes.map(nodeType => nodeType.type) ?? [];

        expect(nodeTypes).toContain('package-agent');
        expect(nodeTypes).toContain('package-tool');
        expect(nodeTypes).toContain('package-mcp');
        // Sub-workflow nodes were removed: a workflow asset is the workflow
        // itself (top-level), never a DAG node embedded in another workflow.
        expect(nodeTypes).not.toContain('package-workflow');
        expect(nodeTypes).not.toContain('package-model');
    });
});

describe('WorkflowEngine with real execution', () => {
    let engine: WorkflowEngine;
    let repository: InMemoryWorkflowRepository;
    let runtime: StandaloneRuntime;

    beforeEach(() => {
        repository = new InMemoryWorkflowRepository();
        runtime = new StandaloneRuntime();
        engine = new WorkflowEngine(runtime, repository);
    });

    it('should execute a simple Start -> End workflow', async () => {
        const startNode: WorkflowNode = {
            id: 'start',
            type: WorkflowNodeType.Start,
            name: 'Start',
            data: {},
        };

        const endNode: WorkflowNode = {
            id: 'end',
            type: WorkflowNodeType.End,
            name: 'End',
            data: {},
        };

        const definition: WorkflowDefinition = {
            id: 'simple-workflow',
            packageId: 'pkg-1',
            version: '1.0.0',
            name: 'Simple Workflow',
            graph: {
                nodes: [startNode, endNode],
                edges: [createEdge('e1', 'start', 'end')],
            },
            createdAt: new Date(),
            updatedAt: new Date(),
        };

        await repository.saveDefinition(definition);

        // Register a mock package executor
        runtime.registerPackageExecutor('mock-agent', async (input) => {
            return { result: 'mocked' };
        });

        const execution = await engine.execute('simple-workflow', { name: 'test' });

        expect(execution).toBeDefined();
        expect(execution.id).toBeDefined();
        expect(execution.workflowDefinitionId).toBe('simple-workflow');
    });

    it('should persist node executions and execution options', async () => {
        const definition: WorkflowDefinition = {
            id: 'tracked-workflow',
            packageId: 'pkg-1',
            version: '1.0.0',
            name: 'Tracked Workflow',
            graph: {
                nodes: [
                    { id: 'start', type: WorkflowNodeType.Start, name: 'Start', data: {} },
                    { id: 'end', type: WorkflowNodeType.End, name: 'End', data: {} },
                ],
                edges: [createEdge('e1', 'start', 'end')],
            },
            createdAt: new Date(),
            updatedAt: new Date(),
        };
        await repository.saveDefinition(definition);

        const execution = await engine.execute('tracked-workflow', { value: 1 }, undefined, {
            executionId: 'exec-fixed',
            rootExecutionId: 'root-fixed',
            metadata: { source: 'test' },
        });

        expect(execution.id).toBe('exec-fixed');
        expect(execution.rootExecutionId).toBe('root-fixed');
        expect(execution.metadata).toMatchObject({
            source: 'test',
            lastHeartbeatStatus: ExecutionStatus.Succeeded,
            lastHeartbeatNodeIds: [],
        });
        expect(typeof execution.metadata?.lastHeartbeatAt).toBe('string');
        expect(execution.executedNodeIds).toEqual(['start', 'end']);

        const persisted = await repository.findExecutionById('exec-fixed');
        expect(persisted?.executedNodeIds).toEqual(['start', 'end']);
        expect(persisted?.currentNodeIds).toEqual([]);
        expect(persisted?.metadata).toMatchObject({
            source: 'test',
            lastHeartbeatStatus: ExecutionStatus.Succeeded,
            lastHeartbeatNodeIds: [],
        });

        const nodeExecutions = await repository.findNodeExecutionsByExecutionId('exec-fixed');
        expect(nodeExecutions.map(node => node.status)).toEqual([
            NodeExecutionStatus.Succeeded,
            NodeExecutionStatus.Succeeded,
        ]);
        expect(nodeExecutions.every(node => node.startedAt && node.completedAt)).toBe(true);
    });

    it('should submit a workflow and complete it in the background', async () => {
        const definition: WorkflowDefinition = {
            id: 'async-workflow',
            packageId: 'pkg-1',
            version: '1.0.0',
            name: 'Async Workflow',
            graph: {
                nodes: [
                    { id: 'start', type: WorkflowNodeType.Start, name: 'Start', data: {} },
                    {
                        id: 'code',
                        type: WorkflowNodeType.Code,
                        name: 'Double',
                        data: {
                            language: 'javascript',
                            code: 'return { doubled: params.value * 2 };',
                            inputsValues: {
                                value: { type: FlowValueType.Expression, expression: '${input.value}' },
                            },
                        } as CodeNodeData,
                    },
                    {
                        id: 'end',
                        type: WorkflowNodeType.End,
                        name: 'End',
                        data: {
                            inputsValues: {
                                final: { type: FlowValueType.Expression, expression: '${nodes.code.outputs.doubled}' },
                            },
                        },
                    },
                ],
                edges: [
                    createEdge('e1', 'start', 'code'),
                    createEdge('e2', 'code', 'end'),
                ],
            },
            createdAt: new Date(),
            updatedAt: new Date(),
        };
        await repository.saveDefinition(definition);

        const submitted = await engine.submit('async-workflow', { value: 3, input: { value: 3 } }, undefined, {
            executionId: 'async-exec',
            metadata: { source: 'async-test' },
        });

        expect(submitted.status).toBe(ExecutionStatus.Pending);
        expect(submitted.startedAt).toBeUndefined();
        expect(submitted.metadata).toEqual({ source: 'async-test' });

        const persisted = await repository.findExecutionById('async-exec');
        expect(persisted?.status).toBe(ExecutionStatus.Pending);

        const completed = await waitForExecutionStatus(repository, 'async-exec', ExecutionStatus.Succeeded);
        expect(completed.output).toEqual({ final: 6 });
        expect(completed.executedNodeIds).toEqual(['start', 'code', 'end']);
        expect(completed.metadata).toMatchObject({
            source: 'async-test',
            lastHeartbeatStatus: ExecutionStatus.Succeeded,
            lastHeartbeatNodeIds: [],
        });
    });

    it('should resume an existing pending execution', async () => {
        const definition: WorkflowDefinition = {
            id: 'resumable-workflow',
            packageId: 'pkg-1',
            version: '1.0.0',
            name: 'Resumable Workflow',
            graph: {
                nodes: [
                    { id: 'start', type: WorkflowNodeType.Start, name: 'Start', data: {} },
                    {
                        id: 'end',
                        type: WorkflowNodeType.End,
                        name: 'End',
                        data: {
                            inputsValues: {
                                value: { type: FlowValueType.Expression, expression: '${input.value}' },
                            },
                        },
                    },
                ],
                edges: [createEdge('e1', 'start', 'end')],
            },
            createdAt: new Date(),
            updatedAt: new Date(),
        };
        await repository.saveDefinition(definition);
        await repository.saveExecution({
            id: 'resume-exec',
            workflowDefinitionId: 'resumable-workflow',
            version: '1.0.0',
            input: { value: 'restored', input: { value: 'restored' } },
            status: ExecutionStatus.Pending,
            currentNodeIds: [],
            executedNodeIds: [],
            failedNodeIds: [],
            variables: {},
            nodeOutputs: {},
            createdAt: new Date(),
        });

        const execution = await engine.resume('resume-exec');

        expect(execution.status).toBe(ExecutionStatus.Succeeded);
        expect(execution.output).toEqual({ value: 'restored' });
        expect(execution.executedNodeIds).toEqual(['start', 'end']);
    });

    it('should resume from the frontier without re-running already-succeeded nodes', async () => {
        // A partial run completed start + work (persisted as Succeeded node rows
        // with outputs). Resume must re-drive only `end`, NOT re-run `work` (which
        // for a real Package node would re-dispatch a external job), and must restore
        // work's output so `end` can reference it.
        let workRuns = 0;
        engine.registerExecutor('counting-work', {
            type: 'counting-work',
            execute: async () => { workRuns += 1; return { outputs: { value: 42 } }; },
        } as any);

        const definition: WorkflowDefinition = {
            id: 'partial-resume-workflow',
            packageId: 'pkg-1',
            version: '1.0.0',
            name: 'Partial Resume Workflow',
            graph: {
                nodes: [
                    { id: 'start', type: WorkflowNodeType.Start, name: 'Start', data: {} },
                    { id: 'work', type: 'counting-work', name: 'Work', data: {} },
                    {
                        id: 'end',
                        type: WorkflowNodeType.End,
                        name: 'End',
                        data: {
                            inputsValues: {
                                final: { type: FlowValueType.Expression, expression: '${nodes.work.outputs.value}' },
                            },
                        },
                    },
                ],
                edges: [
                    createEdge('e1', 'start', 'work'),
                    createEdge('e2', 'work', 'end'),
                ],
            },
            createdAt: new Date(),
            updatedAt: new Date(),
        };
        await repository.saveDefinition(definition);
        await repository.saveExecution({
            id: 'partial-exec',
            workflowDefinitionId: 'partial-resume-workflow',
            version: '1.0.0',
            input: {},
            status: ExecutionStatus.Pending,
            currentNodeIds: [],
            executedNodeIds: [],
            failedNodeIds: [],
            variables: {},
            nodeOutputs: {},
            createdAt: new Date(),
        });
        // Persisted incremental checkpoint from the crashed run.
        const seedNode = (nodeId: string, nodeType: string, output: Record<string, unknown>): NodeExecution => ({
            id: `partial-exec:${nodeId}`,
            executionId: 'partial-exec',
            nodeId,
            nodeType,
            status: NodeExecutionStatus.Succeeded,
            input: {},
            output,
            createdAt: new Date(),
            completedAt: new Date(),
        });
        await repository.saveNodeExecution(seedNode('start', WorkflowNodeType.Start, {}));
        await repository.saveNodeExecution(seedNode('work', 'counting-work', { value: 42 }));

        const execution = await engine.resume('partial-exec');

        expect(execution.status).toBe(ExecutionStatus.Succeeded);
        expect(workRuns).toBe(0); // already-succeeded node must NOT be re-run
        expect(execution.output).toEqual({ final: 42 }); // restored output reachable downstream
        expect([...execution.executedNodeIds].sort()).toEqual(['end', 'start', 'work']);
    });

    it('should execute selected condition branch and skip unselected branch before merge', async () => {
        const definition: WorkflowDefinition = {
            id: 'condition-merge-workflow',
            packageId: 'pkg-1',
            version: '1.0.0',
            name: 'Condition Merge Workflow',
            graph: {
                nodes: [
                    { id: 'start', type: WorkflowNodeType.Start, name: 'Start', data: {} },
                    {
                        id: 'decision',
                        type: WorkflowNodeType.Condition,
                        name: 'Decision',
                        data: {
                            conditions: [
                                {
                                    type: 'simple',
                                    id: 'score-high',
                                    expression: '${input.score} >= 80',
                                    targetNodeId: 'approve',
                                },
                            ],
                            defaultNodeId: 'reject',
                        } as ConditionNodeData,
                    },
                    {
                        id: 'approve',
                        type: WorkflowNodeType.Code,
                        name: 'Approve',
                        data: {
                            language: 'javascript',
                            code: 'return { result: "approved" };',
                        } as CodeNodeData,
                    },
                    {
                        id: 'reject',
                        type: WorkflowNodeType.Code,
                        name: 'Reject',
                        data: {
                            language: 'javascript',
                            code: 'return { result: "rejected" };',
                        } as CodeNodeData,
                    },
                    {
                        id: 'end',
                        type: WorkflowNodeType.End,
                        name: 'End',
                        data: {
                            inputsValues: {
                                final: { type: FlowValueType.Expression, expression: '${nodes.approve.outputs.result}' },
                            },
                        },
                    },
                ],
                edges: [
                    createEdge('e1', 'start', 'decision'),
                    { id: 'e2', sourceNodeId: 'decision', targetNodeId: 'approve', sourcePortId: 'approve' },
                    { id: 'e3', sourceNodeId: 'decision', targetNodeId: 'reject', sourcePortId: 'reject' },
                    createEdge('e4', 'approve', 'end'),
                    createEdge('e5', 'reject', 'end'),
                ],
            },
            createdAt: new Date(),
            updatedAt: new Date(),
        };
        await repository.saveDefinition(definition);

        const execution = await engine.execute('condition-merge-workflow', { score: 90, input: { score: 90 } });

        expect(execution.status).toBe(ExecutionStatus.Succeeded);
        expect(execution.output).toEqual({ final: 'approved' });
        expect(execution.executedNodeIds).toEqual(['start', 'decision', 'approve', 'end']);

        const nodeExecutions = await repository.findNodeExecutionsByExecutionId(execution.id);
        const byNodeId = new Map(nodeExecutions.map(node => [node.nodeId, node]));
        expect(byNodeId.get('approve')?.status).toBe(NodeExecutionStatus.Succeeded);
        expect(byNodeId.get('reject')?.status).toBe(NodeExecutionStatus.Skipped);
    });

    describe('per-node errorStrategy', () => {
        function failingWorkflow(strategy: unknown, defaultValue?: Record<string, unknown>): WorkflowDefinition {
            return {
                id: 'error-strategy-workflow',
                packageId: 'pkg-1',
                version: '1.0.0',
                name: 'Error Strategy Workflow',
                graph: {
                    nodes: [
                        { id: 'start', type: WorkflowNodeType.Start, name: 'Start', data: {} },
                        {
                            id: 'boom',
                            type: 'boom',
                            name: 'Boom',
                            data: {
                                ...(strategy === undefined ? {} : { errorStrategy: strategy }),
                                ...(defaultValue ? { errorDefaultValue: defaultValue } : {}),
                            },
                        },
                        {
                            id: 'end',
                            type: WorkflowNodeType.End,
                            name: 'End',
                            data: {
                                inputsValues: {
                                    final: { type: FlowValueType.Expression, expression: '${nodes.boom.outputs.result}' },
                                },
                            },
                        },
                    ],
                    edges: [createEdge('e1', 'start', 'boom'), createEdge('e2', 'boom', 'end')],
                },
                createdAt: new Date(),
                updatedAt: new Date(),
            };
        }

        beforeEach(() => {
            engine.registerExecutor('boom', {
                type: 'boom',
                execute: async () => { throw new Error('node blew up'); },
            } as any);
        });

        it("fails the whole run by default (errorStrategy 'fail')", async () => {
            await repository.saveDefinition(failingWorkflow(undefined));
            const execution = await engine.execute('error-strategy-workflow', {});
            expect(execution.status).toBe(ExecutionStatus.Failed);
            const byNodeId = new Map(
                (await repository.findNodeExecutionsByExecutionId(execution.id)).map(n => [n.nodeId, n]),
            );
            expect(byNodeId.get('boom')?.status).toBe(NodeExecutionStatus.Failed);
            expect(byNodeId.get('end')?.status).not.toBe(NodeExecutionStatus.Succeeded);
        });

        it("emits the default output and continues downstream (errorStrategy 'default')", async () => {
            await repository.saveDefinition(failingWorkflow('default', { result: 'fallback' }));
            const execution = await engine.execute('error-strategy-workflow', {});
            expect(execution.status).toBe(ExecutionStatus.Succeeded);
            expect(execution.output).toEqual({ final: 'fallback' });
            const byNodeId = new Map(
                (await repository.findNodeExecutionsByExecutionId(execution.id)).map(n => [n.nodeId, n]),
            );
            // node recorded Succeeded (so successors run) but keeps the error for the drawer
            expect(byNodeId.get('boom')?.status).toBe(NodeExecutionStatus.Succeeded);
            expect(byNodeId.get('boom')?.error).toContain('node blew up');
            expect(byNodeId.get('end')?.status).toBe(NodeExecutionStatus.Succeeded);
        });

        it("continues with empty output (errorStrategy 'continue')", async () => {
            await repository.saveDefinition(failingWorkflow('continue'));
            const execution = await engine.execute('error-strategy-workflow', {});
            expect(execution.status).toBe(ExecutionStatus.Succeeded);
            const byNodeId = new Map(
                (await repository.findNodeExecutionsByExecutionId(execution.id)).map(n => [n.nodeId, n]),
            );
            expect(byNodeId.get('boom')?.status).toBe(NodeExecutionStatus.Succeeded);
            expect(byNodeId.get('end')?.status).toBe(NodeExecutionStatus.Succeeded);
        });
    });

    it('routes a question-classifier to the selected class branch and skips the others', async () => {
        const realFetch = global.fetch;
        global.fetch = jest.fn().mockResolvedValue({
            ok: true,
            json: jest.fn().mockResolvedValue({ choices: [{ message: { content: '{"classId":"tech"}' } }] }),
        }) as any;
        try {
            const definition: WorkflowDefinition = {
                id: 'qc-workflow', packageId: 'pkg-1', version: '1.0.0', name: 'QC Workflow',
                graph: {
                    nodes: [
                        { id: 'start', type: WorkflowNodeType.Start, name: 'Start', data: {} },
                        {
                            id: 'classify',
                            type: WorkflowNodeType.QuestionClassifier,
                            name: 'Classify',
                            data: {
                                apiKey: 'k', apiHost: 'https://api.openai.com/v1',
                                // the query input is mapped from the workflow input,
                                // exactly as the designer wires it
                                inputsValues: { query: { type: FlowValueType.Expression, expression: '${input.query}' } },
                                classes: [
                                    { id: 'billing', name: 'Billing', targetNodeId: 'billing' },
                                    { id: 'tech', name: 'Tech', targetNodeId: 'tech' },
                                ],
                            } as any,
                        },
                        { id: 'billing', type: WorkflowNodeType.Code, name: 'Billing', data: { language: 'javascript', code: 'return { handled: "billing" };' } as any },
                        { id: 'tech', type: WorkflowNodeType.Code, name: 'Tech', data: { language: 'javascript', code: 'return { handled: "tech" };' } as any },
                        { id: 'end', type: WorkflowNodeType.End, name: 'End', data: { inputsValues: { final: { type: FlowValueType.Expression, expression: '${nodes.tech.outputs.handled}' } } } },
                    ],
                    edges: [
                        createEdge('e1', 'start', 'classify'),
                        { id: 'e2', sourceNodeId: 'classify', targetNodeId: 'billing' },
                        { id: 'e3', sourceNodeId: 'classify', targetNodeId: 'tech' },
                        createEdge('e4', 'billing', 'end'),
                        createEdge('e5', 'tech', 'end'),
                    ],
                },
                createdAt: new Date(), updatedAt: new Date(),
            };
            await repository.saveDefinition(definition);

            const execution = await engine.execute('qc-workflow', { query: 'my app crashes', input: { query: 'my app crashes' } });

            expect(execution.status).toBe(ExecutionStatus.Succeeded);
            const byNodeId = new Map((await repository.findNodeExecutionsByExecutionId(execution.id)).map(n => [n.nodeId, n]));
            expect(byNodeId.get('tech')?.status).toBe(NodeExecutionStatus.Succeeded);
            expect(byNodeId.get('billing')?.status).toBe(NodeExecutionStatus.Skipped);
        } finally {
            global.fetch = realFetch;
        }
    });

    describe('runNode (single-node test run)', () => {
        it('runs a built-in node in isolation and returns its output', async () => {
            const node: WorkflowNode = {
                id: 'c1',
                type: WorkflowNodeType.Code,
                name: 'Code',
                data: { language: 'javascript', code: 'async function main() { return { result: 42 }; }' } as CodeNodeData,
            };
            const result = await engine.runNode(node);
            expect(result.outputs.result).toBe(42);
        });

        it('resolves seeded upstream outputs for the node bindings (condition branch)', async () => {
            const node: WorkflowNode = {
                id: 'd1',
                type: WorkflowNodeType.Condition,
                name: 'Decide',
                data: {
                    conditions: [
                        {
                            type: 'structured',
                            id: 'c',
                            key: 'c',
                            value: {
                                left: { type: 'expression', value: '${nodes.up.output.score}' },
                                operator: 'gt',
                                right: { type: 'static', value: 60 },
                            },
                            targetNodeId: 'pass',
                        },
                    ],
                    defaultNodeId: 'fail',
                } as ConditionNodeData,
            };
            const result = await engine.runNode(node, {}, { up: { score: 90 } });
            expect(result.branch).toBe('pass');
        });

        it('throws for a node type with no executor', async () => {
            await expect(
                engine.runNode({ id: 'x', type: 'no-such-type', name: 'X', data: {} } as WorkflowNode),
            ).rejects.toThrow('No executor');
        });
    });

    it('should execute a diamond join node exactly once under concurrent fan-in', async () => {
        // Both branches of the diamond finish at the same time (barrier), so both
        // predecessors of `merge` observe its predecessors as executed and both
        // race into executeNode(merge). `merge` then yields a tick, so it is still
        // pending (not yet marked executed) when the second predecessor checks.
        // Without the pending-claim guard the join runs twice (a duplicate external job
        // for a real Package merge node); with it, exactly once.
        let arrivedA: () => void = () => {};
        let arrivedB: () => void = () => {};
        const bothArrived = Promise.all([
            new Promise<void>(resolve => { arrivedA = resolve; }),
            new Promise<void>(resolve => { arrivedB = resolve; }),
        ]);

        let mergeRuns = 0;
        engine.registerExecutor('slow-a', {
            type: 'slow-a',
            execute: async () => { arrivedA(); await bothArrived; return { outputs: {} }; },
        } as any);
        engine.registerExecutor('slow-b', {
            type: 'slow-b',
            execute: async () => { arrivedB(); await bothArrived; return { outputs: {} }; },
        } as any);
        engine.registerExecutor('merge', {
            type: 'merge',
            execute: async () => {
                mergeRuns += 1;
                await new Promise<void>(resolve => setTimeout(resolve, 0));
                return { outputs: {} };
            },
        } as any);

        const definition: WorkflowDefinition = {
            id: 'diamond-workflow',
            packageId: 'pkg-1',
            version: '1.0.0',
            name: 'Diamond Workflow',
            graph: {
                nodes: [
                    { id: 'start', type: WorkflowNodeType.Start, name: 'Start', data: {} },
                    { id: 'a', type: 'slow-a', name: 'A', data: {} },
                    { id: 'b', type: 'slow-b', name: 'B', data: {} },
                    { id: 'merge', type: 'merge', name: 'Merge', data: {} },
                    { id: 'end', type: WorkflowNodeType.End, name: 'End', data: {} },
                ],
                edges: [
                    createEdge('e1', 'start', 'a'),
                    createEdge('e2', 'start', 'b'),
                    createEdge('e3', 'a', 'merge'),
                    createEdge('e4', 'b', 'merge'),
                    createEdge('e5', 'merge', 'end'),
                ],
            },
            createdAt: new Date(),
            updatedAt: new Date(),
        };
        await repository.saveDefinition(definition);

        const execution = await engine.execute('diamond-workflow', {});

        expect(mergeRuns).toBe(1);
        expect(execution.status).toBe(ExecutionStatus.Succeeded);
        expect(execution.executedNodeIds).toContain('merge');
    });

    it('should report Cancelled (not Failed) when a node is cancelled mid-flight', async () => {
        // The node cancels its own token while executing, simulating an external
        // cancel() landing in flight. The cancelled node must not be counted as a
        // failure, and the run must terminate as Cancelled — matching what the
        // external cancel() writes — instead of racing it to Failed.
        engine.registerExecutor('self-cancel', {
            type: 'self-cancel',
            execute: async (_context: any, _node: any, token: CancellationToken) => {
                token.cancel();
                return { outputs: {} };
            },
        } as any);

        const definition: WorkflowDefinition = {
            id: 'cancel-workflow',
            packageId: 'pkg-1',
            version: '1.0.0',
            name: 'Cancel Workflow',
            graph: {
                nodes: [
                    { id: 'start', type: WorkflowNodeType.Start, name: 'Start', data: {} },
                    { id: 'cancel-me', type: 'self-cancel', name: 'Cancel Me', data: {} },
                    { id: 'end', type: WorkflowNodeType.End, name: 'End', data: {} },
                ],
                edges: [
                    createEdge('e1', 'start', 'cancel-me'),
                    createEdge('e2', 'cancel-me', 'end'),
                ],
            },
            createdAt: new Date(),
            updatedAt: new Date(),
        };
        await repository.saveDefinition(definition);

        const execution = await engine.execute('cancel-workflow', {});

        expect(execution.status).toBe(ExecutionStatus.Cancelled);
        expect(execution.executedNodeIds).not.toContain('end'); // cancellation halts propagation
        expect(execution.failedNodeIds).not.toContain('cancel-me'); // cancelled != failed

        const nodeExecutions = await repository.findNodeExecutionsByExecutionId(execution.id);
        const byNodeId = new Map(nodeExecutions.map(node => [node.nodeId, node]));
        expect(byNodeId.get('cancel-me')?.status).toBe(NodeExecutionStatus.Skipped);
    });
});

describe('WorkflowEngine integration - Code node', () => {
    let engine: WorkflowEngine;
    let repository: InMemoryWorkflowRepository;
    let runtime: StandaloneRuntime;
    let materialRegistry: MaterialRegistry;

    beforeEach(() => {
        repository = new InMemoryWorkflowRepository();
        runtime = new StandaloneRuntime();
        materialRegistry = new MaterialRegistry();

        // Register built-in executors
        materialRegistry.registerExecutorFactory('start', () => ({ type: 'start', execute: async () => ({ outputs: {} }) } as any));
        materialRegistry.registerExecutorFactory('end', () => ({ type: 'end', execute: async () => ({ outputs: {} }) } as any));
        materialRegistry.registerExecutorFactory('code', () => new CodeNodeExecutor());

        engine = new WorkflowEngine(runtime, repository, materialRegistry);
    });

    it('should execute workflow with code node', async () => {
        const startNode: WorkflowNode = {
            id: 'start',
            type: WorkflowNodeType.Start,
            name: 'Start',
            data: {},
        };

        const codeNode: WorkflowNode = {
            id: 'code',
            type: WorkflowNodeType.Code,
            name: 'Double',
            data: {
                language: 'javascript',
                code: 'return { doubled: params.value * 2 };',
                inputsValues: {
                    value: { type: 'variable', variableName: 'inputValue' },
                },
            } as CodeNodeData,
        };

        const endNode: WorkflowNode = {
            id: 'end',
            type: WorkflowNodeType.End,
            name: 'End',
            data: {},
        };

        const definition: WorkflowDefinition = {
            id: 'code-workflow',
            packageId: 'pkg-1',
            version: '1.0.0',
            name: 'Code Workflow',
            graph: {
                nodes: [startNode, codeNode, endNode],
                edges: [
                    createEdge('e1', 'start', 'code'),
                    createEdge('e2', 'code', 'end'),
                ],
            },
            createdAt: new Date(),
            updatedAt: new Date(),
        };

        await repository.saveDefinition(definition);

        const execution = await engine.execute('code-workflow', { inputValue: 5 });

        expect(execution.status).toBe(ExecutionStatus.Succeeded);
        expect(execution.output).toBeDefined();
        // End node outputs are set based on its inputs - in this case empty since no inputsValues defined
        // But code node should have its outputs stored
    });

    it('should store code node outputs in context', async () => {
        const startNode: WorkflowNode = {
            id: 'start',
            type: WorkflowNodeType.Start,
            name: 'Start',
            data: {},
        };

        const codeNode: WorkflowNode = {
            id: 'code',
            type: WorkflowNodeType.Code,
            name: 'Double',
            data: {
                language: 'javascript',
                code: 'return { doubled: params.value * 2 };',
                inputsValues: {
                    value: { type: 'variable', variableName: 'inputValue' },
                },
            } as CodeNodeData,
        };

        const endNode: WorkflowNode = {
            id: 'end',
            type: WorkflowNodeType.End,
            name: 'End',
            data: {},
        };

        const definition: WorkflowDefinition = {
            id: 'code-workflow-2',
            packageId: 'pkg-1',
            version: '1.0.0',
            name: 'Code Workflow',
            graph: {
                nodes: [startNode, codeNode, endNode],
                edges: [
                    createEdge('e1', 'start', 'code'),
                    createEdge('e2', 'code', 'end'),
                ],
            },
            createdAt: new Date(),
            updatedAt: new Date(),
        };

        await repository.saveDefinition(definition);

        const execution = await engine.execute('code-workflow-2', { inputValue: 5 });

        expect(execution.status).toBe(ExecutionStatus.Succeeded);
        // Code node outputs stored in nodeOutputs
        expect(execution.nodeOutputs['code']).toBeDefined();
        // The doubled output should be 10 (5 * 2)
        expect(execution.nodeOutputs['code'].doubled).toBe(10);
    });

    it('should resolve dotted input and node output expressions', async () => {
        const definition: WorkflowDefinition = {
            id: 'expression-workflow',
            packageId: 'pkg-1',
            version: '1.0.0',
            name: 'Expression Workflow',
            graph: {
                nodes: [
                    { id: 'start', type: WorkflowNodeType.Start, name: 'Start', data: {} },
                    {
                        id: 'code',
                        type: WorkflowNodeType.Code,
                        name: 'Double',
                        data: {
                            language: 'javascript',
                            code: 'return { doubled: params.value * 2 };',
                            inputsValues: {
                                value: { type: FlowValueType.Expression, expression: '${input.value}' },
                            },
                        } as CodeNodeData,
                    },
                    {
                        id: 'end',
                        type: WorkflowNodeType.End,
                        name: 'End',
                        data: {
                            inputsValues: {
                                final: { type: FlowValueType.Expression, expression: '${nodes.code.outputs.doubled}' },
                            },
                        },
                    },
                ],
                edges: [
                    createEdge('e1', 'start', 'code'),
                    createEdge('e2', 'code', 'end'),
                ],
            },
            createdAt: new Date(),
            updatedAt: new Date(),
        };

        await repository.saveDefinition(definition);

        const execution = await engine.execute('expression-workflow', { value: 7, input: { value: 7 } });

        expect(execution.status).toBe(ExecutionStatus.Succeeded);
        expect(execution.nodeOutputs.code.doubled).toBe(14);
        expect(execution.output).toEqual({ final: 14 });
    });
});

describe('WorkflowEngine integration - Loop node', () => {
    let engine: WorkflowEngine;
    let repository: InMemoryWorkflowRepository;
    let runtime: StandaloneRuntime;
    let materialRegistry: MaterialRegistry;

    beforeEach(() => {
        repository = new InMemoryWorkflowRepository();
        runtime = new StandaloneRuntime();
        materialRegistry = new MaterialRegistry();

        // Register built-in executors
        materialRegistry.registerExecutorFactory('start', () => ({ type: 'start', execute: async () => ({ outputs: {} }) } as any));
        materialRegistry.registerExecutorFactory('end', () => ({ type: 'end', execute: async () => ({ outputs: {} }) } as any));
        materialRegistry.registerExecutorFactory('code', () => new CodeNodeExecutor());
        materialRegistry.registerExecutorFactory('block-start', () => new BlockStartNodeExecutor());
        materialRegistry.registerExecutorFactory('block-end', () => new BlockEndNodeExecutor());
        materialRegistry.registerExecutorFactory('loop', () => new LoopNodeExecutor(materialRegistry));

        engine = new WorkflowEngine(runtime, repository, materialRegistry);
    });

    it('should execute workflow with loop node', async () => {
        const startNode: WorkflowNode = {
            id: 'start',
            type: WorkflowNodeType.Start,
            name: 'Start',
            data: {},
        };

        const blockStart: WorkflowNode = {
            id: 'block-start',
            type: WorkflowNodeType.BlockStart,
            name: 'Block Start',
            data: {},
        };

        const codeNode: WorkflowNode = {
            id: 'doubler',
            type: WorkflowNodeType.Code,
            name: 'Doubler',
            data: {
                language: 'javascript',
                code: 'return { result: params.item * 2 };',
                inputsValues: {
                    item: { type: 'Variable', variableName: 'item' },
                },
            } as CodeNodeData,
        };

        const blockEnd: WorkflowNode = {
            id: 'block-end',
            type: WorkflowNodeType.BlockEnd,
            name: 'Block End',
            data: {},
        };

        const loopNode: WorkflowNode = {
            id: 'loop',
            type: WorkflowNodeType.Loop,
            name: 'Loop',
            data: {
                loopArray: 'items',
                loopVariable: 'item',
            } as LoopNodeData,
            blocks: [blockStart, codeNode, blockEnd],
            edges: [
                createEdge('e1', 'block-start', 'doubler'),
                createEdge('e2', 'doubler', 'block-end'),
            ],
        };

        const endNode: WorkflowNode = {
            id: 'end',
            type: WorkflowNodeType.End,
            name: 'End',
            data: {},
        };

        const definition: WorkflowDefinition = {
            id: 'loop-workflow',
            packageId: 'pkg-1',
            version: '1.0.0',
            name: 'Loop Workflow',
            graph: {
                nodes: [startNode, loopNode, endNode],
                edges: [
                    createEdge('e1', 'start', 'loop'),
                    createEdge('e2', 'loop', 'end'),
                ],
            },
            createdAt: new Date(),
            updatedAt: new Date(),
        };

        await repository.saveDefinition(definition);

        const execution = await engine.execute('loop-workflow', { items: [1, 2, 3] });

        expect(execution.status).toBe(ExecutionStatus.Succeeded);
        // Verify loop node was executed (check via nodeOutputs which should have loop's items)
        expect(execution.nodeOutputs['loop']).toBeDefined();
    });
});

describe('WorkflowEngine integration - Custom node package reference', () => {
    let engine: WorkflowEngine;
    let repository: InMemoryWorkflowRepository;
    let runtime: StandaloneRuntime;
    let materialRegistry: MaterialRegistry;
    let materialService: MaterialService;

    // Custom executor for testing
    class CustomNodeExecutor extends BaseNodeExecutor {
        type = 'custom-transform';
        async doExecute(
            context: ExecutionContext,
            node: WorkflowNode,
            inputs: Record<string, unknown>,
            _cancellationToken?: CancellationToken,
        ): Promise<NodeExecutorResult> {
            const value = inputs['value'] as number;
            return {
                outputs: {
                    transformed: value * 3,
                },
            };
        }
    }

    beforeEach(async () => {
        repository = new InMemoryWorkflowRepository();
        runtime = new StandaloneRuntime();
        materialRegistry = new MaterialRegistry();
        materialService = new MaterialService();

        // Register a custom material
        const customMaterial: MaterialDefinition = {
            id: 'test-transform-material',
            name: 'Test Transform Material',
            version: '1.0.0',
            nodeTypes: [
                {
                    type: 'custom-transform',
                    label: 'Custom Transform',
                    executorType: 'custom-transform',
                    defaultConfig: {},
                },
            ],
            createdAt: new Date(),
            updatedAt: new Date(),
        };
        await materialService.registerMaterial(customMaterial);

        // Register custom executor in registry
        materialRegistry.registerExecutorFactory('custom-transform', () => new CustomNodeExecutor());

        engine = new WorkflowEngine(runtime, repository, materialRegistry, materialService);
    });

    it('should execute workflow with custom node using packageId', async () => {
        const startNode: WorkflowNode = {
            id: 'start',
            type: WorkflowNodeType.Start,
            name: 'Start',
            data: {},
        };

        // Custom node with packageId reference
        const customNode: WorkflowNode = {
            id: 'transform',
            type: 'custom-transform',
            name: 'Transform',
            packageId: 'test-transform-material',
            data: {
                inputsValues: {
                    value: { type: 'variable', variableName: 'inputValue' },
                },
            },
        };

        const endNode: WorkflowNode = {
            id: 'end',
            type: WorkflowNodeType.End,
            name: 'End',
            data: {},
        };

        const definition: WorkflowDefinition = {
            id: 'custom-node-workflow',
            packageId: 'pkg-1',
            version: '1.0.0',
            name: 'Custom Node Workflow',
            graph: {
                nodes: [startNode, customNode, endNode],
                edges: [
                    createEdge('e1', 'start', 'transform'),
                    createEdge('e2', 'transform', 'end'),
                ],
            },
            createdAt: new Date(),
            updatedAt: new Date(),
        };

        await repository.saveDefinition(definition);

        // Load materials before execution
        await engine.loadWorkflowMaterials(definition);

        const execution = await engine.execute('custom-node-workflow', { inputValue: 5 });

        expect(execution.status).toBe(ExecutionStatus.Succeeded);
        // Custom node outputs should be stored
        expect(execution.nodeOutputs['transform']).toBeDefined();
        expect(execution.nodeOutputs['transform'].transformed).toBe(15); // 5 * 3
    });

    it('should load material definition when executing workflow with packageId', async () => {
        const startNode: WorkflowNode = {
            id: 'start',
            type: WorkflowNodeType.Start,
            name: 'Start',
            data: {},
        };

        const customNode: WorkflowNode = {
            id: 'transform',
            type: 'custom-transform',
            name: 'Transform',
            packageId: 'test-transform-material',
            data: {},
        };

        const endNode: WorkflowNode = {
            id: 'end',
            type: WorkflowNodeType.End,
            name: 'End',
            data: {},
        };

        const definition: WorkflowDefinition = {
            id: 'custom-node-workflow-2',
            packageId: 'pkg-1',
            version: '1.0.0',
            name: 'Custom Node Workflow 2',
            graph: {
                nodes: [startNode, customNode, endNode],
                edges: [
                    createEdge('e1', 'start', 'transform'),
                    createEdge('e2', 'transform', 'end'),
                ],
            },
            createdAt: new Date(),
            updatedAt: new Date(),
        };

        await repository.saveDefinition(definition);

        // Verify material is loaded before execution
        await engine.loadWorkflowMaterials(definition);

        const material = materialRegistry.getMaterial('test-transform-material');
        expect(material).toBeDefined();
        expect(material?.nodeTypes).toHaveLength(1);
        expect(material?.nodeTypes[0].type).toBe('custom-transform');
    });
});

describe('WorkflowEngine integration - Error handling', () => {
    let engine: WorkflowEngine;
    let repository: InMemoryWorkflowRepository;
    let runtime: StandaloneRuntime;

    beforeEach(() => {
        repository = new InMemoryWorkflowRepository();
        runtime = new StandaloneRuntime();
        engine = new WorkflowEngine(runtime, repository);
    });

    it('should handle missing workflow definition', async () => {
        await expect(
            engine.execute('nonexistent', { input: {} })
        ).rejects.toThrow('Workflow definition nonexistent not found');
    });

    it('should handle workflow with no start node', async () => {
        const endNode: WorkflowNode = {
            id: 'end',
            type: WorkflowNodeType.End,
            name: 'End',
            data: {},
        };

        const definition: WorkflowDefinition = {
            id: 'no-start-workflow',
            packageId: 'pkg-1',
            version: '1.0.0',
            name: 'No Start Workflow',
            graph: {
                nodes: [endNode],
                edges: [],
            },
            createdAt: new Date(),
            updatedAt: new Date(),
        };

        await repository.saveDefinition(definition);

        const execution = await engine.execute('no-start-workflow', {});

        expect(execution.status).toBe(ExecutionStatus.Failed);
        expect(execution.error).toContain('no start node');
    });
});

describe('WorkflowEngine fan-out concurrency', () => {
    let repository: InMemoryWorkflowRepository;
    let runtime: StandaloneRuntime;

    beforeEach(() => {
        repository = new InMemoryWorkflowRepository();
        runtime = new StandaloneRuntime();
    });

    // start -> n0..n(width-1) -> end. Each leaf node awaits a couple of ticks so
    // concurrent executors overlap, letting us observe the true peak in-flight.
    function buildWideFanOut(width: number): { definition: WorkflowDefinition; trackPeak: () => number } {
        let inFlight = 0;
        let peak = 0;
        const leafExecutor = {
            type: 'leaf',
            execute: async () => {
                inFlight += 1;
                peak = Math.max(peak, inFlight);
                await new Promise<void>(resolve => setTimeout(resolve, 0));
                await new Promise<void>(resolve => setTimeout(resolve, 0));
                inFlight -= 1;
                return { outputs: {} };
            },
        };
        const nodes: WorkflowNode[] = [
            { id: 'start', type: WorkflowNodeType.Start, name: 'Start', data: {} },
            { id: 'end', type: WorkflowNodeType.End, name: 'End', data: {} },
        ];
        const edges: WorkflowEdge[] = [];
        for (let i = 0; i < width; i++) {
            const id = `leaf-${i}`;
            nodes.push({ id, type: 'leaf', name: id, data: {} });
            edges.push(createEdge(`s-${i}`, 'start', id));
            edges.push(createEdge(`e-${i}`, id, 'end'));
        }
        const definition: WorkflowDefinition = {
            id: `fanout-${width}`,
            packageId: 'pkg-1',
            version: '1.0.0',
            name: 'Fan-out Workflow',
            graph: { nodes, edges },
            createdAt: new Date(),
            updatedAt: new Date(),
        };
        (definition as any).__leafExecutor = leafExecutor;
        return { definition, trackPeak: () => peak };
    }

    it('caps the number of sibling nodes in flight at maxNodeConcurrency', async () => {
        const engine = new WorkflowEngine(runtime, repository, undefined, undefined, undefined, { maxNodeConcurrency: 2 });
        const { definition, trackPeak } = buildWideFanOut(5);
        engine.registerExecutor('leaf', (definition as any).__leafExecutor);
        await repository.saveDefinition(definition);

        const execution = await engine.execute(definition.id, {});

        expect(execution.status).toBe(ExecutionStatus.Succeeded);
        expect(trackPeak()).toBeLessThanOrEqual(2);
        expect(trackPeak()).toBe(2); // 5 nodes, cap 2 -> peak should saturate the cap
    });

    it('runs all siblings concurrently when the cap is disabled (<= 0)', async () => {
        const engine = new WorkflowEngine(runtime, repository, undefined, undefined, undefined, { maxNodeConcurrency: 0 });
        const { definition, trackPeak } = buildWideFanOut(5);
        engine.registerExecutor('leaf', (definition as any).__leafExecutor);
        await repository.saveDefinition(definition);

        const execution = await engine.execute(definition.id, {});

        expect(execution.status).toBe(ExecutionStatus.Succeeded);
        expect(trackPeak()).toBe(5);
    });
});
