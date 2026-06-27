import { Inject, Injectable, Logger } from '@nestjs/common';
import { ASSET_SERVICE, type IAssetService } from '@/modules/assets/domain/services/asset.service.interface';

export type OrchestrationPhase = 'requirement_collection' | 'design' | 'refinement' | 'complete';

export interface OrchestrationTimelineEvent {
    id: string;
    timestamp: string;
    sessionId: string;
    type: 'phase_transition' | 'requirement_captured' | 'file_attached' | 'dag_version' | 'decision_point';
    data: Record<string, unknown>;
}

export interface PhaseTransitionData {
    from: OrchestrationPhase | null;
    to: OrchestrationPhase;
    reason: string;
}

export interface FileAttachedData {
    uploadId: string;
    fileName: string;
    mimeType?: string;
    size: number;
    sha256: string;
    purpose?: string;
}

export interface DagVersionData {
    commitSha: string;
    nodeCount: number;
    edgeCount: number;
    changeDescription: string;
    triggerMessageId?: string;
}

export interface RequirementCapturedData {
    summary: string;
    sourceMessageId?: string;
    confidence?: number;
}

export interface DecisionPointData {
    question: string;
    options?: string[];
    chosen?: string;
    messageId?: string;
}

const TIMELINE_PATH = 'timeline.jsonl';

@Injectable()
export class OrchestrationTimelineService {
    private readonly logger = new Logger(OrchestrationTimelineService.name);
    private readonly writeLocks = new Map<string, Promise<void>>();

    constructor(@Inject(ASSET_SERVICE) private readonly assetService: IAssetService) {}

    async appendEvent(assetId: string, event: OrchestrationTimelineEvent): Promise<void> {
        await this.withLock(assetId, async () => {
            try {
                let existing = '';
                try {
                    existing = await this.assetService.getBlobContent(assetId, TIMELINE_PATH);
                } catch {
                    // File doesn't exist yet — will be created on first write
                }
                const updated = existing + JSON.stringify(event) + '\n';
                await this.assetService.updateBlob(
                    assetId,
                    TIMELINE_PATH,
                    updated,
                    `timeline: ${event.type}`,
                    'main',
                );
            } catch (err) {
                this.logger.warn(`Failed to append timeline event to asset ${assetId}: ${err}`);
            }
        });
    }

    async getTimeline(assetId: string): Promise<OrchestrationTimelineEvent[]> {
        try {
            const content = await this.assetService.getBlobContent(assetId, TIMELINE_PATH);
            return content
                .split('\n')
                .filter(Boolean)
                .map((line) => JSON.parse(line) as OrchestrationTimelineEvent);
        } catch {
            return [];
        }
    }

    createEvent(
        sessionId: string,
        type: OrchestrationTimelineEvent['type'],
        data: Record<string, unknown>,
    ): OrchestrationTimelineEvent {
        return {
            id: `evt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            timestamp: new Date().toISOString(),
            sessionId,
            type,
            data,
        };
    }

    private async withLock(key: string, fn: () => Promise<void>): Promise<void> {
        const prev = this.writeLocks.get(key) ?? Promise.resolve();
        const next = prev.then(fn, fn);
        this.writeLocks.set(key, next);
        try {
            await next;
        } finally {
            if (this.writeLocks.get(key) === next) {
                this.writeLocks.delete(key);
            }
        }
    }
}
