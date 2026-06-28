import type {
    RecordUserMemoryInput,
    UserMemoryAction,
    UserMemoryLayer,
} from '../domain/repositories/user-memory.repository.interface';

/**
 * Map a NORMALIZED memory stream event (the shape produced by `normalizeStreamEvent` for
 * memory_stored / memory_recalled / memory_cleared) into a `RecordUserMemoryInput`.
 *
 * The layer derivation mirrors the frontend's `resolveInternShannonMemoryLayer`
 * (apps/web/src/lib/internShannon-memory-timeline-item.ts) so the server-persisted `layer` matches exactly what
 * the timeline UI shows. Returns null for any non-memory event so the runner tap is a cheap no-op on the
 * vast majority of stream frames.
 */

const MEMORY_ACTION_BY_TYPE: Record<string, UserMemoryAction> = {
    memory_stored: 'stored',
    memory_recalled: 'recalled',
    memory_cleared: 'cleared',
};

export function memoryActionForEventType(type: unknown): UserMemoryAction | null {
    return typeof type === 'string' && type in MEMORY_ACTION_BY_TYPE ? MEMORY_ACTION_BY_TYPE[type] : null;
}

/** Derive the SDK memory layer from a free-form memoryType string (mirrors the frontend). */
export function resolveUserMemoryLayer(memoryType?: string | null): UserMemoryLayer {
    const normalized = (memoryType ?? '').trim().toLowerCase();
    if (
        normalized.includes('insight') ||
        normalized.includes('synthesis') ||
        normalized.includes('preference') ||
        normalized.includes('profile') ||
        normalized.includes('long') ||
        normalized.includes('洞察') ||
        normalized.includes('长期') ||
        normalized.includes('偏好')
    ) {
        return 'insight';
    }
    if (
        normalized.includes('artifact') ||
        normalized.includes('fact') ||
        normalized.includes('structured') ||
        normalized.includes('semantic') ||
        normalized.includes('episodic') ||
        normalized.includes('产物') ||
        normalized.includes('事实') ||
        normalized.includes('结构')
    ) {
        return 'artifact';
    }
    return 'resource';
}

function optionalString(value: unknown): string | undefined {
    return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function optionalNumber(value: unknown): number | undefined {
    return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/**
 * Build a `RecordUserMemoryInput` from a normalized memory event, or null if the event is not a memory
 * event. `userId` / `sessionId` come from the active session — never from the (browser-facing) event.
 */
export function toUserMemoryRecordInput(
    normalizedEvent: Record<string, unknown> | null | undefined,
    context: { userId: string; sessionId: string },
): RecordUserMemoryInput | null {
    if (!normalizedEvent) return null;
    const action = memoryActionForEventType(normalizedEvent.type);
    if (!action) return null;

    const memoryType = optionalString(normalizedEvent.memoryType);
    const metadata: Record<string, unknown> = {};
    if (memoryType) metadata.memoryType = memoryType;
    const importance = optionalNumber(normalizedEvent.importance);
    if (importance !== undefined) metadata.importance = importance;
    const relevance = optionalNumber(normalizedEvent.relevance);
    if (relevance !== undefined) metadata.relevance = relevance;
    const resultCount = optionalNumber(normalizedEvent.resultCount);
    if (resultCount !== undefined) metadata.resultCount = resultCount;

    return {
        userId: context.userId,
        sessionId: context.sessionId,
        layer: resolveUserMemoryLayer(memoryType),
        action,
        content: optionalString(normalizedEvent.content) ?? null,
        memoryId: optionalString(normalizedEvent.memoryId) ?? null,
        metadata,
    };
}
