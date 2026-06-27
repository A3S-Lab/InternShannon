/**
 * Workflow Definition Repository Interface
 * Handles persistence of workflow definitions
 */
import { WorkflowDefinition } from '../domain/entities';
import { JsonSchema } from '../domain/value-objects';

/**
 * Workflow Definition Repository
 */
export interface IWorkflowDefinitionRepository {
  /**
   * Find a workflow definition by ID
   */
  findById(id: string): Promise<WorkflowDefinition | null>;

  /**
   * Find a workflow definition by package ID and version
   */
  findByPackageId(packageId: string, version?: string): Promise<WorkflowDefinition | null>;

  /**
   * Find all versions of a workflow by package ID
   */
  findVersionsByPackageId(packageId: string): Promise<WorkflowDefinition[]>;

  /**
   * Save a workflow definition
   */
  save(definition: WorkflowDefinition): Promise<void>;

  /**
   * Update a workflow definition
   */
  update(definition: WorkflowDefinition): Promise<void>;

  /**
   * Delete a workflow definition
   */
  delete(id: string): Promise<void>;

  /**
   * List workflow definitions with pagination
   */
  list(limit?: number, offset?: number): Promise<WorkflowDefinition[]>;

  /**
   * Count total workflow definitions
   */
  count(): Promise<number>;
}
