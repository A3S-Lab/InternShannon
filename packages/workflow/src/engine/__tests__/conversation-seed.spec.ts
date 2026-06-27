import { WorkflowEngine } from '../workflow-engine';
import { InMemoryWorkflowRepository } from '../../infrastructure/in-memory-repository';
import { WorkflowDefinition, ExecutionStatus } from '../../domain/entities';
import { WorkflowNode, WorkflowNodeType, createEdge } from '../../domain/value-objects';
import { StandaloneRuntime } from '../standalone-runtime';

const startNode: WorkflowNode = { id: 'start', type: WorkflowNodeType.Start, name: 'Start', data: {} };
const endNode: WorkflowNode = { id: 'end', type: WorkflowNodeType.End, name: 'End', data: {} };
// Assigner copies the seeded conversation variable into a new one — proving the
// seed reached the run's conversation.* namespace.
const assignNode: WorkflowNode = {
    id: 'assign',
    type: WorkflowNodeType.VariableAssigner,
    name: 'Assign',
    data: { assignments: { copy: '${conversation.seed}' } },
};

async function run(repository: InMemoryWorkflowRepository, engine: WorkflowEngine, seed?: Record<string, unknown>) {
    const definition: WorkflowDefinition = {
        id: 'seed-wf', packageId: 'pkg', version: '1.0.0', name: 'Seed',
        graph: {
            nodes: [startNode, assignNode, endNode],
            edges: [createEdge('e1', 'start', 'assign'), createEdge('e2', 'assign', 'end')],
        },
        createdAt: new Date(), updatedAt: new Date(),
    };
    await repository.saveDefinition(definition);
    await engine.execute('seed-wf', {}, undefined, { executionId: 'seed-exec', conversationVariables: seed });
    return repository.findExecutionById('seed-exec');
}

describe('Cross-run conversation seeding (WorkflowExecutionOptions.conversationVariables)', () => {
    it('seeds conversation.* so the run can read prior-turn state, and persists the result', async () => {
        const repository = new InMemoryWorkflowRepository();
        const engine = new WorkflowEngine(new StandaloneRuntime(), repository);
        const execution = await run(repository, engine, { seed: 'hello' });

        expect(execution?.status).toBe(ExecutionStatus.Succeeded);
        // The assigner read ${conversation.seed} ('hello') and wrote it to 'copy'.
        expect(execution?.conversationVariables).toMatchObject({ seed: 'hello', copy: 'hello' });
    });

    it('is opt-in: without a seed, conversation.seed is undefined (unchanged behaviour)', async () => {
        const repository = new InMemoryWorkflowRepository();
        const engine = new WorkflowEngine(new StandaloneRuntime(), repository);
        const execution = await run(repository, engine, undefined);

        expect(execution?.status).toBe(ExecutionStatus.Succeeded);
        // copy resolves to undefined (no seed); JSON-safe shape — copy is absent or undefined.
        expect((execution?.conversationVariables ?? {}).seed).toBeUndefined();
    });
});
