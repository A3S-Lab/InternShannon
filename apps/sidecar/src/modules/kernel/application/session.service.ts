import { Injectable } from '@nestjs/common';
import { Session } from '../domain/entities/session.entity';

const SESSION_METADATA_KEYS = [
    'model',
    'followDefaultModel',
    'permissionMode',
    'systemPrompt',
    'role',
    'guidelines',
    'responseStyle',
    'extra',
    'skills',
    'skillDirs',
    'mcpServers',
    'builtinSkills',
    'enforceActiveSkillToolRestrictions',
    'planningMode',
    'goalTracking',
    'maxToolRounds',
    'maxParseRetries',
    'circuitBreakerThreshold',
    'continuationEnabled',
    'maxContinuationTurns',
    'autoCompact',
    'autoCompactThreshold',
    'autoExecute',
    'temperature',
    'thinkingBudget',
    'searchConfig',
    'workerAgents',
    'inlineSkills',
    'autoDelegation',
    'autoParallel',
    'maxParallelTasks',
    'artifactStoreLimits',
    'retentionLimits',
    'toolTimeoutMs',
    'queueTimeoutMs',
    'maxExecutionTimeMs',
    'streamStallWarningMs',
    'streamStallHardMs',
    'toolInputStreamStallHardMs',
    'streamStallActiveToolHardMs',
    'maxConsecutiveToolErrors',
    'maxStreamRetries',
    'assetId',
    'assetName',
    'assetCategory',
    'assetVisibility',
    'agentPhase',
    'developmentStage',
    'titleSource',
    'titleSeedMessageId',
    'singleAssetSession',
    'purpose',
    'source',
    'operation',
    'operationMode',
    'boardId',
    'requirementId',
    'diagnosisReportId',
    'publishTarget',
    'upgradeRunningReleases',
    'visibility',
    'ownerType',
    'ownerId',
    'creationRequestId',
    'sourceCaseId',
    'initialPrompt',
    'agentKind',
    'taskWorkbench',
] as const;

export type SessionMetadataKey = (typeof SESSION_METADATA_KEYS)[number];

/**
 * Fields that, when present in legacy DB rows, must NEVER leave the server in
 * HTTP responses. The set is empty in the current code path (apiKey/baseUrl are
 * no longer accepted at write time), but the redaction is retained so any
 * historical row that still has them gets scrubbed on the way out.
 */
const SENSITIVE_LEGACY_METADATA_KEYS = new Set<string>(['apiKey', 'baseUrl']);

/** Redact known credential-bearing fields inside nested config objects. */
function redactNestedCredentials(key: string, value: unknown): unknown {
    if (key === 'mcpServers' && Array.isArray(value)) {
        return value.map(entry => {
            if (!entry || typeof entry !== 'object') return entry;
            const record = entry as Record<string, unknown>;
            const result: Record<string, unknown> = { ...record };
            if (record.env && typeof record.env === 'object') {
                result.env = Object.fromEntries(
                    Object.entries(record.env as Record<string, unknown>).map(([k]) => [k, '[REDACTED]']),
                );
            }
            if (record.headers && typeof record.headers === 'object') {
                result.headers = Object.fromEntries(
                    Object.entries(record.headers as Record<string, unknown>).map(([k]) => [k, '[REDACTED]']),
                );
            }
            return result;
        });
    }
    if (key === 'searchConfig' && value && typeof value === 'object') {
        const record = value as Record<string, unknown>;
        const result: Record<string, unknown> = { ...record };
        if (typeof record.proxy === 'string' && record.proxy) {
            result.proxy = '[REDACTED]';
        }
        if (Array.isArray(record.proxyPool) && record.proxyPool.length > 0) {
            result.proxyPool = record.proxyPool.map(() => '[REDACTED]');
        }
        return result;
    }
    return value;
}

@Injectable()
export class SessionService {
    readonly sessionMetadataKeys = SESSION_METADATA_KEYS;

    pickSessionMetadata(metadata?: Record<string, unknown>): Record<string, unknown> | undefined {
        if (!metadata) return undefined;
        const picked: Record<string, unknown> = {};
        for (const key of SESSION_METADATA_KEYS) {
            if (metadata[key] !== undefined) {
                picked[key] = metadata[key];
            }
        }
        return Object.keys(picked).length > 0 ? picked : undefined;
    }

    /**
     * Whitelisted session metadata for HTTP responses. Filters down to
     * SESSION_METADATA_KEYS only (so legacy `apiKey`/`baseUrl` entries from older
     * rows are dropped) and redacts auth tokens / proxy URLs inside nested
     * config objects. Use this — NOT `pickSessionMetadata` — anywhere the result
     * will be serialised to a client.
     */
    pickPublicSessionMetadata(metadata?: Record<string, unknown>): Record<string, unknown> | undefined {
        if (!metadata) return undefined;
        const picked: Record<string, unknown> = {};
        for (const key of SESSION_METADATA_KEYS) {
            if (metadata[key] === undefined) continue;
            if (SENSITIVE_LEGACY_METADATA_KEYS.has(key)) continue;
            picked[key] = redactNestedCredentials(key, metadata[key]);
        }
        return Object.keys(picked).length > 0 ? picked : undefined;
    }

    stringMeta(session: Session, key: string): string | undefined {
        const value = session.metadata?.[key];
        return typeof value === 'string' && value.trim() ? value : undefined;
    }

    booleanMeta(session: Session, key: string): boolean | undefined {
        const value = session.metadata?.[key];
        return typeof value === 'boolean' ? value : undefined;
    }
}
