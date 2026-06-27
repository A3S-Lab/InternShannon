import { WorkflowDefinition, WorkflowExecution, NodeExecution } from '../domain/entities';

/**
 * IWorkflowRepository - Repository interface for workflow persistence
 */
export interface IWorkflowRepository {
    // Workflow Definition
    findDefinitionById(id: string): Promise<WorkflowDefinition | null>;
    findDefinitionByPackageId(packageId: string, version?: string): Promise<WorkflowDefinition | null>;
    saveDefinition(definition: WorkflowDefinition): Promise<void>;
    deleteDefinition(id: string): Promise<void>;

    // Workflow Execution
    findExecutionById(id: string): Promise<WorkflowExecution | null>;
    findExecutionsByDefinitionId(definitionId: string, limit?: number): Promise<WorkflowExecution[]>;
    findChildExecutions(parentExecutionId: string): Promise<WorkflowExecution[]>;
    saveExecution(execution: WorkflowExecution): Promise<void>;
    updateExecutionStatus(id: string, status: Partial<WorkflowExecution>): Promise<void>;
    touchExecution?(id: string, metadata?: Record<string, unknown>): Promise<void>;

    // Node Execution
    findNodeExecutionById(id: string): Promise<NodeExecution | null>;
    findNodeExecutionsByExecutionId(executionId: string): Promise<NodeExecution[]>;
    saveNodeExecution(execution: NodeExecution): Promise<void>;
    updateNodeExecutionStatus(id: string, status: Partial<NodeExecution>): Promise<void>;
}
