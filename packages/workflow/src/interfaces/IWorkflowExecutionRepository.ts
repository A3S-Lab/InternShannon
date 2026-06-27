/**
 * Workflow Execution Repository Interface
 * Handles persistence of workflow executions
 */
import { WorkflowExecution, ExecutionStatus } from '../domain/entities';

/**
 * Workflow Execution Repository
 */
export interface IWorkflowExecutionRepository {
  /**
   * Find an execution by ID
   */
  findById(id: string): Promise<WorkflowExecution | null>;

  /**
   * Find all executions for a workflow definition
   */
  findByDefinitionId(
    definitionId: string,
    options?: { limit?: number; offset?: number; status?: ExecutionStatus },
  ): Promise<WorkflowExecution[]>;

  /**
   * Find child executions (nested workflow executions)
   */
  findByParentId(parentExecutionId: string): Promise<WorkflowExecution[]>;

  /**
   * Find root execution for a nested execution
   */
  findRootExecution(executionId: string): Promise<WorkflowExecution | null>;

  /**
   * Save a new execution
   */
  save(execution: WorkflowExecution): Promise<void>;

  /**
   * Update execution status and other fields
   */
  update(id: string, updates: Partial<WorkflowExecution>): Promise<void>;

  /**
   * Delete an execution (cascade delete node executions)
   */
  delete(id: string): Promise<void>;

  /**
   * List executions with pagination and filters
   */
  list(options?: {
    limit?: number;
    offset?: number;
    status?: ExecutionStatus;
    definitionId?: string;
  }): Promise<WorkflowExecution[]>;

  /**
   * Count executions with filters
   */
  count(options?: { status?: ExecutionStatus; definitionId?: string }): Promise<number>;

  /**
   * Get execution statistics
   */
  getStats(definitionId?: string): Promise<{
    total: number;
    succeeded: number;
    failed: number;
    running: number;
    pending: number;
  }>;
}
