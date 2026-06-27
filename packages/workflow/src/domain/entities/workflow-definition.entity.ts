import { WorkflowGraph, JsonSchema } from '../value-objects';

/**
 * Workflow Definition - represents a published workflow Package
 */
export interface WorkflowDefinition {
    readonly id: string;
    readonly packageId: string;
    readonly version: string;
    readonly name: string;
    readonly description?: string;

    // Graph structure
    readonly graph: WorkflowGraph;

    // Schema
    readonly inputSchema?: JsonSchema;
    readonly outputSchema?: JsonSchema;

    // Deploy-time environment variables (aligned with Dify): read-only constants
    // exposed to expressions as the `env.*` namespace (e.g. ${env.API_BASE}).
    readonly environmentVariables?: Record<string, unknown>;

    // Conversation variable declarations (aligned with Dify): name → default value.
    // Seed the writable `conversation.*` runtime state; an execution's own
    // conversation values (from a prior turn) override these defaults.
    readonly conversationVariables?: Record<string, unknown>;

    // Metadata
    readonly metadata?: Record<string, unknown>;
    readonly createdAt: Date;
    readonly updatedAt: Date;
}
