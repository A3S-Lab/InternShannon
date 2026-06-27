import { Entity } from '@/shared/domain/entity';

/**
 * Pipeline Job Entity
 * Represents a job in a pipeline run
 */
export interface PipelineJob extends Entity<string> {
    readonly runId: string;
    readonly sourceId?: string;
    readonly name: string;
    readonly needs?: string[];
    readonly status: 'queued' | 'in_progress' | 'success' | 'failure' | 'cancelled';
    readonly conclusion?: 'success' | 'failure' | 'cancelled' | 'timed_out' | 'skipped';
    readonly stepNumber: number;
    readonly stepName: string;
    readonly logs?: string;
    readonly startedAt?: Date;
    readonly completedAt?: Date;
    readonly createdAt: Date;
}
