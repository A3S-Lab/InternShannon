import { ScopedExecutionContext, VariableScope } from '../scoped-execution-context';
import { WorkflowDefinition, WorkflowExecution, ExecutionStatus } from '../../domain/entities';
import { WorkflowGraph, WorkflowNode } from '../../domain/value-objects';

/**
 * Unit tests for ScopedExecutionContext
 *
 * Test coverage:
 * - Variable scope isolation
 * - Scope stack management
 * - Variable lookup across scopes
 * - Loop/Block node variable isolation
 */
describe('ScopedExecutionContext', () => {
    let context: ScopedExecutionContext;
    let execution: WorkflowExecution;
    let definition: WorkflowDefinition;

    beforeEach(() => {
        const graph: WorkflowGraph = {
            nodes: [
                { id: 'start', type: 'start', name: 'Start', data: {} },
                { id: 'end', type: 'end', name: 'End', data: {} },
            ],
            edges: [
                { id: 'e1', sourceNodeId: 'start', targetNodeId: 'end' },
            ],
        };

        definition = {
            id: 'test-workflow',
            packageId: 'test/workflow',
            version: '1.0.0',
            name: 'Test Workflow',
            graph,
            createdAt: new Date(),
            updatedAt: new Date(),
        };

        execution = {
            id: 'exec-1',
            workflowDefinitionId: definition.id,
            version: definition.version,
            input: { globalVar: 'global-value' },
            status: ExecutionStatus.Running,
            currentNodeIds: [],
            executedNodeIds: [],
            failedNodeIds: [],
            variables: {},
            nodeOutputs: {},
            createdAt: new Date(),
        };

        const nodeMap = new Map<string, WorkflowNode>(
            graph.nodes.map(node => [node.id, node])
        );
        const edgeMap = new Map();

        context = new ScopedExecutionContext(
            execution,
            definition,
            null,
            nodeMap,
            edgeMap,
        );
    });

    describe('Variable Scope Isolation', () => {
        it('should isolate variables in nested scopes', () => {
            // Set variable in global scope
            context.setVariable('x', 1);
            expect(context.getVariable('x')).toBe(1);

            // Enter first scope
            context.enterScope('loop-1');
            context.setVariable('x', 2);
            context.setVariable('y', 20);
            expect(context.getVariable('x')).toBe(2); // Shadowed
            expect(context.getVariable('y')).toBe(20);

            // Enter nested scope
            context.enterScope('loop-2');
            context.setVariable('x', 3);
            context.setVariable('z', 30);
            expect(context.getVariable('x')).toBe(3); // Shadowed again
            expect(context.getVariable('y')).toBe(20); // From parent scope
            expect(context.getVariable('z')).toBe(30);

            // Exit nested scope
            context.exitScope();
            expect(context.getVariable('x')).toBe(2); // Back to loop-1 value
            expect(context.getVariable('y')).toBe(20);
            expect(context.getVariable('z')).toBeUndefined(); // No longer accessible

            // Exit first scope
            context.exitScope();
            expect(context.getVariable('x')).toBe(1); // Back to global value
            expect(context.getVariable('y')).toBeUndefined(); // No longer accessible
        });

        it('should return correct scope depth', () => {
            expect(context.getScopeDepth()).toBe(0);

            context.enterScope('scope-1');
            expect(context.getScopeDepth()).toBe(1);

            context.enterScope('scope-2');
            expect(context.getScopeDepth()).toBe(2);

            context.exitScope();
            expect(context.getScopeDepth()).toBe(1);

            context.exitScope();
            expect(context.getScopeDepth()).toBe(0);
        });

        it('should throw error when exiting empty scope stack', () => {
            expect(() => context.exitScope()).toThrow('Cannot exit scope: scope stack is empty');
        });
    });

    describe('Variable Lookup', () => {
        it('should find variables from parent scopes', () => {
            context.setVariable('global', 'value');

            context.enterScope('scope-1');
            expect(context.getVariable('global')).toBe('value');

            context.enterScope('scope-2');
            expect(context.getVariable('global')).toBe('value');
        });

        it('should check variable existence across scopes', () => {
            context.setVariable('global', 'value');
            expect(context.hasVariable('global')).toBe(true);

            context.enterScope('scope-1');
            context.setVariable('local', 'value');
            expect(context.hasVariable('global')).toBe(true);
            expect(context.hasVariable('local')).toBe(true);

            context.exitScope();
            expect(context.hasVariable('global')).toBe(true);
            expect(context.hasVariable('local')).toBe(false);
        });
    });
});
