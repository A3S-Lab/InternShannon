import type { ConfigService } from '../../config/domain/services/config-service.interface';
import { Asset } from '../domain/entities/asset.entity';
import type { IAssetRepository } from '../domain/repositories/asset.repository.interface';
import { AssetServiceImpl } from './asset.service';
import { KnowledgeAuditService } from './knowledge-audit.service';
import { KnowledgeIngestJobService } from './knowledge-ingest-job.service';
import { KnowledgeIngestionService } from './knowledge-ingestion.service';

function createHarness(config?: ConfigService) {
    const asset = Asset.create({
        name: 'knowledge',
        ownerId: 'user-1',
        ownerType: 'user',
        category: 'knowledge',
        visibility: 'private',
    });
    const externalBlobs = new Map<string, Buffer>();
    const repository = {
        findById: jest.fn(async (id: string) => (id === asset.id ? asset : null)),
        save: jest.fn(async () => undefined),
        readBlobData: jest.fn(async (assetId: string, path: string) => externalBlobs.get(`${assetId}:${path}`) ?? null),
        writeBlobData: jest.fn(async (assetId: string, path: string, content: Buffer) => {
            externalBlobs.set(`${assetId}:${path}`, Buffer.from(content));
        }),
        deleteBlobData: jest.fn(async (assetId: string, path: string) => {
            externalBlobs.delete(`${assetId}:${path}`);
        }),
    } as unknown as IAssetRepository;
    const assets = new AssetServiceImpl(repository);
    const ingestion = new KnowledgeIngestionService(assets, config);
    const audit = new KnowledgeAuditService(assets);
    const jobs = new KnowledgeIngestJobService(assets, ingestion, audit);
    return { asset, assets, ingestion, audit, jobs };
}

async function waitForJob(jobs: KnowledgeIngestJobService, assetId: string, jobId: string) {
    for (let attempt = 0; attempt < 100; attempt += 1) {
        const job = await jobs.get(assetId, jobId);
        if (['succeeded', 'failed', 'cancelled'].includes(job.status)) return job;
        await new Promise(resolve => setTimeout(resolve, 5));
    }
    throw new Error('Timed out waiting for ingest job');
}

async function waitForJobState(
    jobs: KnowledgeIngestJobService,
    assetId: string,
    jobId: string,
    expected: string,
) {
    for (let attempt = 0; attempt < 200; attempt += 1) {
        const job = await jobs.get(assetId, jobId);
        if (job.status === expected) return job;
        await new Promise(resolve => setTimeout(resolve, 2));
    }
    throw new Error(`Timed out waiting for ingest job state ${expected}`);
}

describe('Knowledge operations services', () => {
    it('persists asynchronous ingest progress and a unified audit entry', async () => {
        const { asset, assets, jobs, audit } = createHarness();
        await assets.updateBlob(asset.id, 'raw/sources/notes.txt', 'Asynchronous source text.', 'Add', 'main');

        const started = await jobs.start(asset.id, ['raw/sources/notes.txt'], 'user-1');
        expect(started.status).toBe('queued');
        expect(started.progress).toMatchObject({ stage: 'queued', percent: 0 });
        const completed = await waitForJob(jobs, asset.id, started.jobId);
        const listed = await jobs.list(asset.id);
        const entries = await audit.list(asset.id);

        expect(completed.status).toBe('succeeded');
        expect(completed.progress.percent).toBe(100);
        expect((await jobs.cancel(asset.id, completed.jobId)).status).toBe('succeeded');
        expect(completed.result).toMatchObject({ indexedSourceCount: 1, chunkCount: 1 });
        expect(listed).toEqual(expect.arrayContaining([expect.objectContaining({ jobId: started.jobId })]));
        expect(entries).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    action: 'ingest.complete',
                    actorId: 'user-1',
                    metadata: expect.objectContaining({ jobId: started.jobId }),
                }),
            ]),
        );
    });

    it('keeps large local ingestion cancellable in both running and queued states', async () => {
        const { asset, assets, jobs } = createHarness();
        const largeText = 'LIVE-QUEUE cancellable knowledge ingestion.\n'.repeat(16_000);
        await assets.updateBlob(asset.id, 'raw/sources/large.txt', largeText, 'Add', 'main');

        const running = await jobs.start(asset.id, ['raw/sources/large.txt'], 'user-1');
        await waitForJobState(jobs, asset.id, running.jobId, 'running');
        const queued = await jobs.start(asset.id, ['raw/sources/large.txt'], 'user-1');

        expect(queued.status).toBe('queued');
        expect((await jobs.cancel(asset.id, queued.jobId)).status).toBe('cancelled');
        expect((await jobs.cancel(asset.id, queued.jobId)).status).toBe('cancelled');
        expect((await jobs.cancel(asset.id, running.jobId)).progress.stage).toBe('cancelling');

        expect((await waitForJob(jobs, asset.id, running.jobId)).status).toBe('cancelled');
        expect((await jobs.get(asset.id, queued.jobId)).status).toBe('cancelled');
    });

    it('uses the configured OCR registry and keeps citations anchored to the original source', async () => {
        const originalFetch = global.fetch;
        global.fetch = jest.fn(async () =>
            new Response(JSON.stringify({ text: 'OCR recognized invoice total' }), {
                status: 200,
                headers: { 'content-type': 'application/json' },
            }),
        ) as typeof fetch;
        const config = {
            getSettings: jest.fn(async () => ({
                ocr: {
                    defaultBackend: 'test-ocr',
                    backends: [
                        {
                            name: 'test-ocr',
                            type: 'custom',
                            enabled: true,
                            baseUrl: 'https://ocr.example.test',
                            endpoint: '/recognize',
                            requestFormat: 'json-base64',
                            outputFormat: 'text',
                            model: 'fixture-v1',
                        },
                    ],
                },
            })),
        } as unknown as ConfigService;
        try {
            const { asset, assets, ingestion } = createHarness(config);
            await assets.updateBlobBinary(asset.id, 'raw/sources/invoice.png', Buffer.from([1, 2, 3]), 'Add', 'main');

            const result = await ingestion.reindex(asset.id);
            const source = result.manifest.sources[0];

            expect(source).toMatchObject({
                path: 'raw/sources/invoice.png',
                status: 'indexed',
                extractionMethod: 'ocr',
                ocrBackend: 'test-ocr',
                ocrModel: 'fixture-v1',
            });
            expect(await assets.getBlobContent(asset.id, source.extractedTextPath ?? '')).toContain('invoice total');
        } finally {
            global.fetch = originalFetch;
        }
    });

    it('redacts secrets from audit metadata', async () => {
        const { asset, audit } = createHarness();
        await audit.append(asset.id, {
            action: 'config.update',
            actorId: 'user-1',
            metadata: { apiKey: 'secret-value', nested: { authorization: 'Bearer secret' }, model: 'safe' },
        });

        expect((await audit.list(asset.id))[0].metadata).toEqual({
            apiKey: '[REDACTED]',
            nested: { authorization: '[REDACTED]' },
            model: 'safe',
        });
    });

    it('migrates legacy knowledge bodies out of metadata idempotently and preserves rename reads', async () => {
        const { asset, assets } = createHarness();
        const content = '---\ntype: Note\ntitle: Migrated\n---\n\nBody\n';
        asset.updateMetadata({
            blobContents: { 'wiki/migrated.md': content },
            blobEncodings: { 'wiki/migrated.md': 'utf8' },
            blobs: [
                {
                    id: 'legacy',
                    assetId: asset.id,
                    path: 'wiki/migrated.md',
                    size: Buffer.byteLength(content),
                    contentSha: 'legacy',
                    isBinary: false,
                },
            ],
        });

        const first = await assets.migrateKnowledgeStorage(asset.id);
        const second = await assets.migrateKnowledgeStorage(asset.id);
        await assets.renameBlob(asset.id, 'wiki/migrated.md', 'wiki/renamed.md', 'Rename', 'main');

        expect(first).toMatchObject({ supported: true, migratedPaths: ['wiki/migrated.md'] });
        expect(first.metadataBytesAfter).toBeLessThan(first.metadataBytesBefore);
        expect(second.migratedPaths).toEqual([]);
        expect(asset.metadata?.blobContents).toEqual({});
        expect(await assets.getBlobContent(asset.id, 'wiki/renamed.md')).toBe(content);
        await expect(assets.getBlobContent(asset.id, 'wiki/migrated.md')).rejects.toThrow();
    });

    it('keeps a 1000-page knowledge fixture out of metadata after migration', async () => {
        const { asset, assets } = createHarness();
        const blobContents = Object.fromEntries(
            Array.from({ length: 1_000 }, (_, index) => [
                `wiki/scale/page-${index}.md`,
                `---\ntype: Note\ntitle: Page ${index}\n---\n\n${'body '.repeat(40)}${index}\n`,
            ]),
        );
        asset.updateMetadata({
            blobContents,
            blobs: Object.entries(blobContents).map(([path, content], index) => ({
                id: `page-${index}`,
                assetId: asset.id,
                path,
                size: Buffer.byteLength(content),
                contentSha: `page-${index}`,
                isBinary: false,
            })),
        });

        const result = await assets.migrateKnowledgeStorage(asset.id);

        expect(result.migratedPaths).toHaveLength(1_000);
        expect(result.metadataBytesAfter).toBeLessThan(result.metadataBytesBefore / 100);
        expect(await assets.getBlobContent(asset.id, 'wiki/scale/page-999.md')).toContain('Page 999');
    });
});
