import { Entity } from '@/shared/domain/entity';

/**
 * Pipeline Run Entity
 * Represents an execution of a pipeline
 */
export interface PipelineRun extends Entity<string> {
    readonly pipelineId: string;
    readonly assetId: string;
    readonly runNumber: number;
    readonly status: 'queued' | 'in_progress' | 'success' | 'failure' | 'cancelled' | 'skipped';
    readonly conclusion?: 'success' | 'failure' | 'cancelled' | 'skipped' | 'timed_out' | 'action_required';
    readonly event: string;
    readonly branch: string;
    readonly commitSha: string;
    readonly triggeredBy: string;
    readonly inputs?: Record<string, string>;
    readonly startedAt?: Date;
    readonly completedAt?: Date;
    readonly createdAt: Date;
}
