/**
 * Node Execution Repository Interface
 * Handles persistence of individual node executions within a workflow
 */
import { NodeExecution, NodeExecutionStatus } from '../domain/entities';

/**
 * Node Execution Repository
 */
export interface INodeExecutionRepository {
  /**
   * Find a node execution by ID
   */
  findById(id: string): Promise<NodeExecution | null>;

  /**
   * Find all node executions for a workflow execution
   */
  findByExecutionId(executionId: string): Promise<NodeExecution[]>;

  /**
   * Find a node execution by execution ID and node ID
   */
  findByExecutionIdAndNodeId(
    executionId: string,
    nodeId: string,
  ): Promise<NodeExecution | null>;

  /**
   * Save a new node execution
   */
  save(execution: NodeExecution): Promise<void>;

  /**
   * Update node execution status
   */
  updateStatus(id: string, status: NodeExecutionStatus, error?: string): Promise<void>;

  /**
   * Update node execution output
   */
  updateOutput(id: string, output: Record<string, unknown>): Promise<void>;

  /**
   * Delete node executions for an execution
   */
  deleteByExecutionId(executionId: string): Promise<void>;

  /**
   * List node executions with pagination
   */
  list(options?: {
    limit?: number;
    offset?: number;
    executionId?: string;
    nodeId?: string;
    status?: NodeExecutionStatus;
  }): Promise<NodeExecution[]>;
}
