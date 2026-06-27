import { Entity } from '@/shared/domain/entity';

export interface AssetWebhook extends Entity<string> {
    readonly assetId: string;
    readonly url: string;
    readonly secret?: string;
    readonly events: string[];
    readonly isActive: boolean;
    readonly lastStatus?: 'success' | 'failure';
    readonly lastStatusCode?: number;
    readonly lastError?: string;
    readonly lastDeliveredAt?: Date;
    readonly createdAt: Date;
    readonly updatedAt: Date;
}
