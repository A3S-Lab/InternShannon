import { Entity } from '@/shared/domain/entity';

/**
 * Pipeline Step Entity
 * Represents a step in a pipeline job, steps form a DAG (Directed Acyclic Graph)
 */
export interface PipelineStep extends Entity<string> {
    readonly jobId: string;
    readonly name: string;
    readonly status: 'queued' | 'in_progress' | 'success' | 'failure' | 'cancelled';
    readonly conclusion?: 'success' | 'failure' | 'cancelled' | 'timed_out' | 'skipped';
    readonly stepNumber: number;
    readonly command?: string;
    readonly workingDirectory?: string;
    readonly envVars?: Record<string, string>;
    readonly dependsOn?: string[]; // depends on other steps by step ID
    readonly condition?: string; // e.g. "success()", "always()"
    readonly logs?: string;
    readonly startedAt?: Date;
    readonly completedAt?: Date;
    readonly createdAt: Date;
}
