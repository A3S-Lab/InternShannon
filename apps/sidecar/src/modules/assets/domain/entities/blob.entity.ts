import { Entity } from '@/shared/domain/entity';

/**
 * Blob Entity
 * Represents a file in git
 */
export interface Blob extends Entity<string> {
    readonly assetId: string;
    readonly path: string;
    readonly size: number;
    readonly contentSha: string;
    readonly isBinary: boolean;
}
