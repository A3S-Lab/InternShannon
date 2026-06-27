import { WorkflowDefinition, WorkflowExecution, ExecutionStatus } from '../../../domain/entities';
import { FlowValue, PackageType, WorkflowEdge, WorkflowNode } from '../../../domain/value-objects';
import { ExecutionContext } from '../../execution-context';
import { PackageNodeExecutor } from '../package.executor';

function createContext(node: WorkflowNode, edges: WorkflowEdge[] = []): ExecutionContext {
    const execution: WorkflowExecution = {
        id: 'exec-1',
        workflowDefinitionId: 'def-1',
        version: '1.0.0',
        input: { globalOnly: 'from-workflow' },
        status: ExecutionStatus.Running,
        currentNodeIds: [],
        executedNodeIds: [],
        failedNodeIds: [],
        variables: { globalOnly: 'from-workflow' },
        nodeOutputs: {},
        createdAt: new Date(),
    };
    const definition: WorkflowDefinition = {
        id: 'def-1',
        packageId: 'pkg-1',
        version: '1.0.0',
        name: 'Package workflow',
        graph: { nodes: [node], edges },
        createdAt: new Date(),
        updatedAt: new Date(),
    };
    return new ExecutionContext(
        execution,
        definition,
        null,
        new Map([[node.id, node]]),
        new Map(edges.map(edge => [edge.sourceNodeId, [edge]])),
    );
}

function createExecutor() {
    return new PackageNodeExecutor({
        type: 'package-tool',
        label: 'Tool',
        executorType: 'package',
        packageType: PackageType.Tool,
        defaultConfig: {},
    });
}

describe('PackageNodeExecutor input wiring', () => {
    it('uses explicit input bindings instead of incoming ports when inputsFromEdges is false', async () => {
        const node: WorkflowNode = {
            id: 'tool',
            type: 'package-tool',
            name: 'Tool',
            data: {
                packageId: 'tools/example',
                packageVersion: '1.0.0',
                inputsFromEdges: false,
                inputsValues: {
                    payload: FlowValue.static('from-form'),
                },
            },
        };
        const edge: WorkflowEdge = {
            id: 'edge-source-tool',
            sourceNodeId: 'source',
            targetNodeId: 'tool',
            sourcePortId: 'payload',
            targetPortId: 'payload',
        };
        const context = createContext(node, [edge]);
        context.setPortOutput('source', 'payload', 'from-edge');
        const packageExecutor = jest.fn(async (input: Record<string, unknown>) => ({ seen: input.payload }));
        context.setPackageExecutors(new Map([['tools/example', packageExecutor]]));

        const result = await createExecutor().execute(context, node);

        expect(packageExecutor).toHaveBeenCalledWith(expect.objectContaining({ payload: 'from-form' }));
        expect(result.outputs).toEqual({ seen: 'from-form' });
    });

    it('does not fall back to workflow variables when inputsFromEdges is false and no bindings are defined', async () => {
        const node: WorkflowNode = {
            id: 'tool',
            type: 'package-tool',
            name: 'Tool',
            data: {
                packageId: 'tools/example',
                packageVersion: '1.0.0',
                inputsFromEdges: false,
            },
        };
        const context = createContext(node);
        const packageExecutor = jest.fn(async (input: Record<string, unknown>) => ({
            hasGlobal: Object.prototype.hasOwnProperty.call(input, 'globalOnly'),
        }));
        context.setPackageExecutors(new Map([['tools/example', packageExecutor]]));

        const result = await createExecutor().execute(context, node);

        expect(packageExecutor).toHaveBeenCalledWith(
            expect.not.objectContaining({ globalOnly: 'from-workflow' }),
        );
        expect(result.outputs).toEqual({ hasGlobal: false });
    });
});
