import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { BadRequestException, NotFoundException } from '@/shared/common/errors';
import { ASSET_SERVICE, type IAssetService } from '../domain/services/asset.service.interface';
import { KnowledgeAuditService } from './knowledge-audit.service';
import { KNOWLEDGE_INDEX_ROOT, KnowledgeIngestionService, type KnowledgeReindexResult } from './knowledge-ingestion.service';

export type KnowledgeIngestJobState = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';

export interface KnowledgeIngestJobProgress {
    percent: number;
    stage: string;
    message: string;
    updatedAt: string;
}

export interface KnowledgeIngestJobStatus {
    jobId: string;
    assetId: string;
    sourcePaths: string[];
    status: KnowledgeIngestJobState;
    progress: KnowledgeIngestJobProgress;
    createdAt: string;
    startedAt?: string;
    completedAt?: string;
    failedReason?: string;
    retryOf?: string;
    actorId?: string;
    result?: KnowledgeReindexResult;
}

const JOBS_ROOT = `${KNOWLEDGE_INDEX_ROOT}/jobs`;

@Injectable()
export class KnowledgeIngestJobService {
    private readonly jobs = new Map<string, KnowledgeIngestJobStatus>();
    private readonly queues = new Map<string, Promise<void>>();
    private readonly abortControllers = new Map<string, AbortController>();

    constructor(
        @Inject(ASSET_SERVICE) private readonly assets: IAssetService,
        private readonly ingestion: KnowledgeIngestionService,
        private readonly audit: KnowledgeAuditService,
    ) {}

    async start(assetId: string, sourcePaths: string[] = [], actorId = 'system', retryOf?: string) {
        const asset = await this.assets.getAsset(assetId);
        if (!asset || asset.category !== 'knowledge') throw new NotFoundException('Knowledge asset not found');
        const normalizedPaths = Array.from(new Set(sourcePaths.map(path => path.trim()).filter(Boolean)));
        if (normalizedPaths.some(path => !path.startsWith('raw/sources/'))) {
            throw new BadRequestException('sourcePaths must stay under raw/sources/');
        }
        const now = new Date().toISOString();
        const job: KnowledgeIngestJobStatus = {
            jobId: randomUUID(),
            assetId,
            sourcePaths: normalizedPaths,
            status: 'queued',
            progress: { percent: 0, stage: 'queued', message: '等待摄取', updatedAt: now },
            createdAt: now,
            retryOf,
            actorId,
        };
        this.jobs.set(job.jobId, job);
        await this.persist(job);
        this.enqueue(job);
        return this.clone(job);
    }

    async retry(assetId: string, jobId: string, actorId = 'system') {
        const previous = await this.get(assetId, jobId);
        if (previous.status !== 'failed' && previous.status !== 'cancelled') {
            throw new BadRequestException('Only failed or cancelled jobs can be retried');
        }
        return this.start(assetId, previous.sourcePaths, actorId, previous.jobId);
    }

    async cancel(assetId: string, jobId: string) {
        const job = await this.getMutable(assetId, jobId);
        if (job.status === 'queued') {
            job.status = 'cancelled';
            job.completedAt = new Date().toISOString();
            job.progress = { percent: job.progress.percent, stage: 'cancelled', message: '已取消', updatedAt: job.completedAt };
            await this.persist(job);
            return this.clone(job);
        }
        if (job.status !== 'running') return this.clone(job);
        this.abortControllers.get(jobId)?.abort();
        job.progress = {
            percent: job.progress.percent,
            stage: 'cancelling',
            message: '正在取消',
            updatedAt: new Date().toISOString(),
        };
        await this.persist(job);
        return this.clone(job);
    }

    async get(assetId: string, jobId: string): Promise<KnowledgeIngestJobStatus> {
        return this.clone(await this.getMutable(assetId, jobId));
    }

    async list(assetId: string, requestedLimit = 20): Promise<KnowledgeIngestJobStatus[]> {
        const asset = await this.assets.getAsset(assetId);
        if (!asset || asset.category !== 'knowledge') throw new NotFoundException('Knowledge asset not found');
        const paths = asset.blobs
            .map(blob => blob.path)
            .filter(path => path.startsWith(`${JOBS_ROOT}/`) && path.endsWith('.json'));
        await Promise.all(
            paths.map(async path => {
                const jobId = path.slice(`${JOBS_ROOT}/`.length, -'.json'.length);
                if (this.jobs.has(jobId)) return;
                const loaded = await this.readPersisted(assetId, jobId);
                if (loaded) this.jobs.set(jobId, this.recoverInterrupted(loaded));
            }),
        );
        return Array.from(this.jobs.values())
            .filter(job => job.assetId === assetId)
            .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
            .slice(0, Math.max(1, Math.min(200, Number(requestedLimit) || 20)))
            .map(job => this.clone(job));
    }

    private enqueue(job: KnowledgeIngestJobStatus): void {
        const previous = this.queues.get(job.assetId) ?? Promise.resolve();
        const current = previous
            .catch(() => undefined)
            .then(() => new Promise<void>(resolve => setImmediate(resolve)))
            .then(() => this.run(job))
            .finally(() => {
                if (this.queues.get(job.assetId) === current) this.queues.delete(job.assetId);
            });
        this.queues.set(job.assetId, current);
    }

    private async run(job: KnowledgeIngestJobStatus): Promise<void> {
        if (job.status === 'cancelled') return;
        const controller = new AbortController();
        this.abortControllers.set(job.jobId, controller);
        job.status = 'running';
        job.startedAt = new Date().toISOString();
        await this.updateProgress(job, 1, 'starting', '开始摄取');
        try {
            job.result = await this.ingestion.reindex(job.assetId, {
                sourcePaths: job.sourcePaths,
                signal: controller.signal,
                onProgress: progress => this.updateProgress(job, progress.percent, progress.stage, progress.message),
            });
            if (controller.signal.aborted) throw new DOMException('Ingest cancelled', 'AbortError');
            job.status = 'succeeded';
            job.completedAt = new Date().toISOString();
            job.progress = { percent: 100, stage: 'complete', message: '摄取完成', updatedAt: job.completedAt };
            await this.persist(job);
            await this.audit.append(job.assetId, {
                action: 'ingest.complete',
                target: job.sourcePaths.length === 1 ? job.sourcePaths[0] : null,
                actorId: job.actorId,
                metadata: { jobId: job.jobId, sourceCount: job.result.sourceCount, chunkCount: job.result.chunkCount },
            });
        } catch (error) {
            const cancelled = controller.signal.aborted || (error instanceof DOMException && error.name === 'AbortError');
            job.status = cancelled ? 'cancelled' : 'failed';
            job.completedAt = new Date().toISOString();
            job.failedReason = cancelled ? 'Cancelled' : error instanceof Error ? error.message : String(error);
            job.progress = {
                percent: job.progress.percent,
                stage: job.status,
                message: cancelled ? '已取消' : '摄取失败',
                updatedAt: job.completedAt,
            };
            await this.persist(job);
            await this.audit.append(job.assetId, {
                action: cancelled ? 'ingest.cancelled' : 'ingest.failed',
                actorId: job.actorId,
                metadata: { jobId: job.jobId, failedReason: job.failedReason },
            });
        } finally {
            this.abortControllers.delete(job.jobId);
        }
    }

    private async updateProgress(
        job: KnowledgeIngestJobStatus,
        percent: number,
        stage: string,
        message: string,
    ): Promise<void> {
        job.progress = {
            percent: Math.max(0, Math.min(100, Math.round(percent))),
            stage,
            message,
            updatedAt: new Date().toISOString(),
        };
        await this.persist(job);
    }

    private async getMutable(assetId: string, jobId: string): Promise<KnowledgeIngestJobStatus> {
        let job = this.jobs.get(jobId);
        if (!job) {
            const persisted = await this.readPersisted(assetId, jobId);
            if (persisted) {
                job = this.recoverInterrupted(persisted);
                this.jobs.set(jobId, job);
                await this.persist(job);
            }
        }
        if (!job || job.assetId !== assetId) throw new NotFoundException('Ingest job not found');
        return job;
    }

    private recoverInterrupted(job: KnowledgeIngestJobStatus): KnowledgeIngestJobStatus {
        if (job.status !== 'running' && job.status !== 'queued') return job;
        const completedAt = new Date().toISOString();
        return {
            ...job,
            status: 'failed',
            completedAt,
            failedReason: 'Sidecar restarted before the ingest job completed',
            progress: {
                percent: job.progress.percent,
                stage: 'failed',
                message: '服务重启，任务可重试',
                updatedAt: completedAt,
            },
        };
    }

    private async persist(job: KnowledgeIngestJobStatus): Promise<void> {
        await this.assets.updateBlob(
            job.assetId,
            `${JOBS_ROOT}/${job.jobId}.json`,
            `${JSON.stringify(job, null, 2)}\n`,
            `Update knowledge ingest job ${job.jobId}`,
            'main',
        );
    }

    private async readPersisted(assetId: string, jobId: string): Promise<KnowledgeIngestJobStatus | null> {
        const content = await this.assets.getBlobContent(assetId, `${JOBS_ROOT}/${jobId}.json`).catch(() => null);
        if (!content) return null;
        try {
            const parsed = JSON.parse(content) as KnowledgeIngestJobStatus;
            return parsed.jobId === jobId && parsed.assetId === assetId ? parsed : null;
        } catch {
            return null;
        }
    }

    private clone(job: KnowledgeIngestJobStatus): KnowledgeIngestJobStatus {
        return JSON.parse(JSON.stringify(job)) as KnowledgeIngestJobStatus;
    }
}
