import { WorkflowEngine } from '../workflow-engine';
import { InMemoryWorkflowRepository } from '../../infrastructure/in-memory-repository';
import {
    WorkflowDefinition,
    ExecutionStatus,
    NodeExecutionStatus,
} from '../../domain/entities';
import { WorkflowNode, WorkflowEdge, WorkflowNodeType, createEdge } from '../../domain/value-objects';
import { StandaloneRuntime } from '../standalone-runtime';
import { BaseNodeExecutor, NodeExecutorResult } from '../executors/base.executor';

/** Custom executor whose node always throws — exercises the error-handling path. */
class AlwaysFailsExecutor extends BaseNodeExecutor {
    readonly type = 'always-fails';
    protected async doExecute(): Promise<NodeExecutorResult> {
        throw new Error('boom');
    }
}

const startNode: WorkflowNode = { id: 'start', type: WorkflowNodeType.Start, name: 'Start', data: {} };
const endNode: WorkflowNode = { id: 'end', type: WorkflowNodeType.End, name: 'End', data: {} };

function buildEngine(): { engine: WorkflowEngine; repository: InMemoryWorkflowRepository } {
    const repository = new InMemoryWorkflowRepository();
    const engine = new WorkflowEngine(new StandaloneRuntime(), repository);
    engine.registerExecutor('always-fails', new AlwaysFailsExecutor());
    return { engine, repository };
}

async function saveAndRun(
    engine: WorkflowEngine,
    repository: InMemoryWorkflowRepository,
    failData: Record<string, unknown>,
    edges: WorkflowEdge[],
): Promise<string> {
    const failNode: WorkflowNode = { id: 'fail', type: 'always-fails', name: 'Fail', data: failData };
    const definition: WorkflowDefinition = {
        id: 'err-wf',
        packageId: 'pkg-1',
        version: '1.0.0',
        name: 'Error Strategy Workflow',
        graph: { nodes: [startNode, failNode, endNode], edges },
        createdAt: new Date(),
        updatedAt: new Date(),
    };
    await repository.saveDefinition(definition);
    try {
        await engine.execute('err-wf', {}, undefined, { executionId: 'err-exec' });
    } catch {
        // 'none' strategy aborts by throwing — status is asserted via the repository.
    }
    return 'err-exec';
}

describe('WorkflowEngine node error-handling strategy', () => {
    it('default-value: swallows the error, emits defaultValue + markers, continues to End', async () => {
        const { engine, repository } = buildEngine();
        const execId = await saveAndRun(
            engine,
            repository,
            { errorStrategy: 'default-value', defaultValue: { fallback: 'x' } },
            [createEdge('e1', 'start', 'fail'), createEdge('e2', 'fail', 'end')],
        );

        const execution = await repository.findExecutionById(execId);
        expect(execution?.status).toBe(ExecutionStatus.Succeeded);
        expect(execution?.executedNodeIds).toEqual(expect.arrayContaining(['start', 'fail', 'end']));

        const nodes = await repository.findNodeExecutionsByExecutionId(execId);
        const failExec = nodes.find((n) => n.nodeId === 'fail');
        expect(failExec?.status).toBe(NodeExecutionStatus.Succeeded);
        expect(failExec?.output).toMatchObject({ fallback: 'x', errorHandled: true, error: 'boom' });
    });

    it('fail-branch: routes the error output to the fail-port edge and continues', async () => {
        const { engine, repository } = buildEngine();
        const failEdge: WorkflowEdge = { ...createEdge('e2', 'fail', 'end'), sourcePortId: 'fail' };
        const execId = await saveAndRun(
            engine,
            repository,
            { errorStrategy: 'fail-branch' },
            [createEdge('e1', 'start', 'fail'), failEdge],
        );

        const execution = await repository.findExecutionById(execId);
        expect(execution?.status).toBe(ExecutionStatus.Succeeded);
        expect(execution?.executedNodeIds).toEqual(expect.arrayContaining(['fail', 'end']));

        const nodes = await repository.findNodeExecutionsByExecutionId(execId);
        const failExec = nodes.find((n) => n.nodeId === 'fail');
        expect(failExec?.output).toMatchObject({ errorHandled: true, error: 'boom' });
    });

    it('none (default): the error aborts the whole workflow', async () => {
        const { engine, repository } = buildEngine();
        const execId = await saveAndRun(
            engine,
            repository,
            {},
            [createEdge('e1', 'start', 'fail'), createEdge('e2', 'fail', 'end')],
        );

        const execution = await repository.findExecutionById(execId);
        expect(execution?.status).toBe(ExecutionStatus.Failed);

        const nodes = await repository.findNodeExecutionsByExecutionId(execId);
        expect(nodes.find((n) => n.nodeId === 'fail')?.status).toBe(NodeExecutionStatus.Failed);
        expect(nodes.find((n) => n.nodeId === 'end')).toBeUndefined();
    });
});
