import { Logger } from '@nestjs/common';
import { IWorkflowRepository } from '../interfaces';
import {
    WorkflowDefinition,
    WorkflowExecution,
    NodeExecution,
    ExecutionStatus,
    NodeExecutionStatus,
} from '../domain/entities';

/**
 * InMemory Workflow Repository
 * For single-machine testing without database
 */
export class InMemoryWorkflowRepository implements IWorkflowRepository {
    private readonly logger = new Logger(InMemoryWorkflowRepository.name);

    private definitions: Map<string, WorkflowDefinition> = new Map();
    private executions: Map<string, WorkflowExecution> = new Map();
    private nodeExecutions: Map<string, NodeExecution> = new Map();

    constructor(initialDefinitions?: WorkflowDefinition[]) {
        if (initialDefinitions) {
            for (const def of initialDefinitions) {
                this.definitions.set(def.id, def);
            }
        }
    }

    // Workflow Definition
    async findDefinitionById(id: string): Promise<WorkflowDefinition | null> {
        return this.definitions.get(id) || null;
    }

    async findDefinitionByPackageId(packageId: string, version?: string): Promise<WorkflowDefinition | null> {
        for (const def of this.definitions.values()) {
            if (def.packageId === packageId && (!version || def.version === version)) {
                return def;
            }
        }
        return null;
    }

    async saveDefinition(definition: WorkflowDefinition): Promise<void> {
        this.definitions.set(definition.id, definition);
        this.logger.debug(`Saved definition: ${definition.id}`);
    }

    async deleteDefinition(id: string): Promise<void> {
        this.definitions.delete(id);
    }

    // Workflow Execution
    async findExecutionById(id: string): Promise<WorkflowExecution | null> {
        return this.executions.get(id) || null;
    }

    async findExecutionsByDefinitionId(definitionId: string, limit = 100): Promise<WorkflowExecution[]> {
        return Array.from(this.executions.values())
            .filter((e) => e.workflowDefinitionId === definitionId)
            .slice(0, limit);
    }

    async findChildExecutions(parentExecutionId: string): Promise<WorkflowExecution[]> {
        return Array.from(this.executions.values())
            .filter((e) => e.parentExecutionId === parentExecutionId);
    }

    async saveExecution(execution: WorkflowExecution): Promise<void> {
        this.executions.set(execution.id, execution);
        this.logger.debug(`Saved execution: ${execution.id}`);
    }

    async updateExecutionStatus(id: string, status: Partial<WorkflowExecution>): Promise<void> {
        const execution = this.executions.get(id);
        if (execution) {
            Object.assign(execution, status);
        }
    }

    async touchExecution(id: string, metadata: Record<string, unknown> = {}): Promise<void> {
        const execution = this.executions.get(id);
        if (execution) {
            execution.metadata = {
                ...(execution.metadata ?? {}),
                ...metadata,
            };
        }
    }

    // Node Execution
    async findNodeExecutionById(id: string): Promise<NodeExecution | null> {
        return this.nodeExecutions.get(id) || null;
    }

    async findNodeExecutionsByExecutionId(executionId: string): Promise<NodeExecution[]> {
        return Array.from(this.nodeExecutions.values())
            .filter((n) => n.executionId === executionId);
    }

    async saveNodeExecution(execution: NodeExecution): Promise<void> {
        this.nodeExecutions.set(execution.id, execution);
    }

    async updateNodeExecutionStatus(id: string, status: Partial<NodeExecution>): Promise<void> {
        const execution = this.nodeExecutions.get(id);
        if (execution) {
            Object.assign(execution, status);
        }
    }

    /**
     * Add a definition for testing
     */
    addDefinition(definition: WorkflowDefinition): void {
        this.definitions.set(definition.id, definition);
    }

    /**
     * Clear all data (for testing)
     */
    clear(): void {
        this.definitions.clear();
        this.executions.clear();
        this.nodeExecutions.clear();
    }
}
