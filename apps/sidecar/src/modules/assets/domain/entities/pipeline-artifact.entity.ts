import { Entity } from '@/shared/domain/entity';

/**
 * Pipeline Artifact Entity
 * Represents a build artifact from a pipeline run
 */
export interface PipelineArtifact extends Entity<string> {
    readonly runId: string;
    readonly name: string;
    readonly sizeBytes: number;
    readonly objectKey?: string;
    readonly downloadUrl?: string;
    readonly expiredAt?: Date;
    readonly createdAt: Date;
}
