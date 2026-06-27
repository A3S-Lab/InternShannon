/**
 * Simple Workflow Example - WorkflowRuntimeJS (Single Machine)
 * Demonstrates running a workflow with Start -> PackageAgent -> End
 */

import {
  WorkflowRuntimeJS,
  InMemoryWorkflowRepository,
  WorkflowDefinition,
  WorkflowGraph,
  WorkflowNodeType,
  PackageType,
  buildPackageNodeType,
} from '../src';

// Create a simple workflow: Start -> [Agent] -> End
const workflowGraph: WorkflowGraph = {
  nodes: [
    {
      id: 'start-1',
      type: WorkflowNodeType.Start,
      name: 'Start',
      data: {},
    },
    {
      id: 'agent-1',
      type: buildPackageNodeType(PackageType.Agent),
      name: 'My Agent',
      packageId: 'packages',
      data: {
        packageId: 'agent-hello',
        packageVersion: '1.0.0',
      },
    },
    {
      id: 'end-1',
      type: WorkflowNodeType.End,
      name: 'End',
      data: {},
    },
  ],
  edges: [
    { id: 'e1', sourceNodeId: 'start-1', targetNodeId: 'agent-1' },
    { id: 'e2', sourceNodeId: 'agent-1', targetNodeId: 'end-1' },
  ],
};

const definition: WorkflowDefinition = {
  id: 'workflow-simple-1',
  packageId: 'pkg-simple-workflow',
  version: '1.0.0',
  name: 'Simple Workflow',
  description: 'A simple workflow with Start -> Agent -> End',
  graph: workflowGraph,
  createdAt: new Date(),
  updatedAt: new Date(),
};

async function main() {
  console.log('=== Simple Workflow Example (WorkflowRuntimeJS) ===\n');

  // 1. Create repository and runtime
  const repository = new InMemoryWorkflowRepository([definition]);
  const runtime = new WorkflowRuntimeJS(repository);

  // 2. Register a custom agent executor
  runtime.registerPackageExecutor('agent-hello', async (input) => {
    console.log('Agent received input:', input);
    return {
      result: `Hello from agent! Input was: ${JSON.stringify(input)}`,
      timestamp: new Date().toISOString(),
    };
  });

  // 3. Execute workflow
  console.log('Executing workflow...\n');

  const execution = await runtime.execute('workflow-simple-1', {
    message: 'World',
    userId: 'user-123',
  });

  console.log('\n=== Execution Result ===');
  console.log('Execution ID:', execution.id);
  console.log('Status:', execution.status);
  console.log('Output:', JSON.stringify(execution.output, null, 2));

  if (execution.error) {
    console.error('Error:', execution.error);
  }

  return execution;
}

main().catch(console.error);
