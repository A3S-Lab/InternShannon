import { Inject, Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { ASSET_SERVICE, type IAssetService } from '../domain/services/asset.service.interface';
import { KNOWLEDGE_INDEX_ROOT } from './knowledge-ingestion.service';

export const KNOWLEDGE_AUDIT_PATH = `${KNOWLEDGE_INDEX_ROOT}/audit.json`;

export interface KnowledgeAuditEntry {
    id: string;
    action: string;
    target?: string | null;
    fromTarget?: string | null;
    actorId?: string | null;
    actorName?: string | null;
    at: string;
    commitSha?: string | null;
    metadata?: Record<string, unknown>;
}

@Injectable()
export class KnowledgeAuditService {
    constructor(@Inject(ASSET_SERVICE) private readonly assets: IAssetService) {}

    async append(
        assetId: string,
        input: Omit<KnowledgeAuditEntry, 'id' | 'at'> & { id?: string; at?: string },
    ): Promise<KnowledgeAuditEntry> {
        const at = input.at || new Date().toISOString();
        const entry: KnowledgeAuditEntry = {
            id:
                input.id ||
                createHash('sha1')
                    .update(`${assetId}:${input.action}:${input.target || ''}:${input.actorId || ''}:${at}`)
                    .digest('hex'),
            action: input.action,
            target: input.target ?? null,
            fromTarget: input.fromTarget ?? null,
            actorId: input.actorId ?? null,
            actorName: input.actorName ?? input.actorId ?? null,
            at,
            commitSha: input.commitSha ?? null,
            metadata: this.redactMetadata(input.metadata),
        };
        const current = await this.readPersisted(assetId);
        const entries = [entry, ...current.filter(item => item.id !== entry.id)].slice(0, 1_000);
        await this.assets.updateBlob(
            assetId,
            KNOWLEDGE_AUDIT_PATH,
            `${JSON.stringify(entries, null, 2)}\n`,
            `Record knowledge audit ${input.action}`,
            'main',
        );
        return entry;
    }

    async list(assetId: string, requestedLimit = 100): Promise<KnowledgeAuditEntry[]> {
        const persisted = await this.readPersisted(assetId);
        const asset = await this.assets.getAsset(assetId);
        const legacy = Array.isArray(asset?.metadata?.knowledgeCurationAudit)
            ? asset.metadata.knowledgeCurationAudit.flatMap(item => this.parseEntry(item))
            : [];
        const byId = new Map<string, KnowledgeAuditEntry>();
        for (const entry of [...persisted, ...legacy]) byId.set(entry.id, entry);
        return Array.from(byId.values())
            .sort((left, right) => right.at.localeCompare(left.at))
            .slice(0, Math.max(1, Math.min(1_000, Number(requestedLimit) || 100)));
    }

    private async readPersisted(assetId: string): Promise<KnowledgeAuditEntry[]> {
        const content = await this.assets.getBlobContent(assetId, KNOWLEDGE_AUDIT_PATH).catch(() => null);
        if (!content) return [];
        try {
            const parsed = JSON.parse(content) as unknown;
            return Array.isArray(parsed) ? parsed.flatMap(item => this.parseEntry(item)) : [];
        } catch {
            return [];
        }
    }

    private parseEntry(value: unknown): KnowledgeAuditEntry[] {
        if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
        const row = value as Record<string, unknown>;
        if (typeof row.id !== 'string' || typeof row.action !== 'string' || typeof row.at !== 'string') return [];
        return [
            {
                id: row.id,
                action: row.action,
                target: typeof row.target === 'string' ? row.target : null,
                fromTarget: typeof row.fromTarget === 'string' ? row.fromTarget : null,
                actorId: typeof row.actorId === 'string' ? row.actorId : null,
                actorName: typeof row.actorName === 'string' ? row.actorName : null,
                at: row.at,
                commitSha: typeof row.commitSha === 'string' ? row.commitSha : null,
                metadata:
                    row.metadata && typeof row.metadata === 'object' && !Array.isArray(row.metadata)
                        ? this.redactMetadata(row.metadata as Record<string, unknown>)
                        : undefined,
            },
        ];
    }

    private redactMetadata(metadata?: Record<string, unknown>): Record<string, unknown> | undefined {
        if (!metadata) return undefined;
        const result: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(metadata)) {
            if (/api[-_]?key|authorization|password|secret|token/i.test(key)) {
                result[key] = '[REDACTED]';
            } else if (value && typeof value === 'object' && !Array.isArray(value)) {
                result[key] = this.redactMetadata(value as Record<string, unknown>);
            } else {
                result[key] = value;
            }
        }
        return result;
    }
}
