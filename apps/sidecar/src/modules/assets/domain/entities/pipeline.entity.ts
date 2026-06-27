import { Entity } from '@/shared/domain/entity';

/**
 * Pipeline Entity
 * Represents a CI/CD pipeline definition
 */
export interface Pipeline extends Entity<string> {
    readonly assetId: string;
    readonly name: string;
    readonly description?: string;
    readonly filePath: string;
    readonly isEnabled: boolean;
    readonly triggerEvents: string[];
    readonly inputs?: PipelineInputDefinition[];
    readonly createdAt: Date;
    readonly updatedAt: Date;
}

export interface PipelineInputDefinition {
    readonly name: string;
    readonly description?: string;
    readonly required?: boolean;
    readonly defaultValue?: string;
    readonly type?: 'string' | 'boolean' | 'choice' | 'environment' | 'number';
    readonly options?: string[];
}
