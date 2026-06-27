/**
 * Workflow Execution Status
 */
export enum ExecutionStatus {
    Pending = 'pending',
    Running = 'running',
    Succeeded = 'succeeded',
    Failed = 'failed',
    Cancelled = 'cancelled',
}

/**
 * Workflow Execution - represents a single run of a workflow
 */
export interface WorkflowExecution {
    id: string;
    workflowDefinitionId: string;
    version: string;

    // Input/Output
    input: Record<string, unknown>;
    output?: Record<string, unknown>;

    // Status
    status: ExecutionStatus;
    error?: string;

    // Execution tracking
    currentNodeIds: string[];
    executedNodeIds: string[];
    failedNodeIds: string[];

    // Variables
    variables: Record<string, unknown>;
    nodeOutputs: Record<string, Record<string, unknown>>;
    // Conversation/session variables (aligned with Dify): writable state exposed
    // to expressions as the `conversation.*` namespace; persisted with the
    // execution so it survives across runs of the same conversation.
    conversationVariables?: Record<string, unknown>;
    metadata?: Record<string, unknown>;

    // Nesting
    parentExecutionId?: string;
    rootExecutionId?: string;

    // Timing
    startedAt?: Date;
    completedAt?: Date;
    createdAt: Date;
}

/**
 * Node Execution Status
 */
export enum NodeExecutionStatus {
    Pending = 'pending',
    Running = 'running',
    Succeeded = 'succeeded',
    Failed = 'failed',
    Skipped = 'skipped',
}

/**
 * Node Execution - represents a single node execution within a workflow
 */
export interface NodeExecution {
    readonly id: string;
    readonly executionId: string;
    readonly nodeId: string;
    readonly nodeType: string;

    // Status
    readonly status: NodeExecutionStatus;
    readonly error?: string;

    // Input/Output
    readonly input: Record<string, unknown>;
    readonly output?: Record<string, unknown>;

    // Execution reference (for Package nodes)
    readonly jobId?: string;

    // Timing
    readonly startedAt?: Date;
    readonly completedAt?: Date;
    readonly createdAt: Date;
}
