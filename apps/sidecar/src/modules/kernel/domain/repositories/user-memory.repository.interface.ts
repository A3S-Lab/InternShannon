/** The three SDK memory layers a kernel memory belongs to. */
export type UserMemoryLayer = 'resource' | 'artifact' | 'insight';

/** Which memory event produced a row. */
export type UserMemoryAction = 'stored' | 'recalled' | 'cleared';

/** A single persisted kernel memory event (one row of `user_memories`). */
export interface UserMemoryRecord {
    id: string;
    userId: string;
    sessionId: string | null;
    layer: UserMemoryLayer;
    action: UserMemoryAction;
    content: string | null;
    memoryId: string | null;
    metadata: Record<string, unknown>;
    createdAt: Date;
    updatedAt: Date | null;
}

/** Input for persisting one memory event. `memoryId` is the dedup key when present. */
export interface RecordUserMemoryInput {
    userId: string;
    sessionId?: string | null;
    layer: UserMemoryLayer;
    action: UserMemoryAction;
    content?: string | null;
    memoryId?: string | null;
    metadata?: Record<string, unknown>;
}

/** Filters / paging for listing a single user's memories. */
export interface ListUserMemoriesOptions {
    limit: number;
    offset: number;
    layer?: UserMemoryLayer;
    action?: UserMemoryAction;
}

export interface IUserMemoryRepository {
    /**
     * Insert one memory event. Idempotent: ON CONFLICT(user_id, memory_id, action) DO NOTHING, so a
     * re-seen (user, memory, action) is a no-op. Returns true when a new row was inserted, false when the
     * event was a duplicate.
     */
    record(input: RecordUserMemoryInput): Promise<boolean>;

    /** A single user's non-deleted memories, newest-first, with optional layer/action filters + total. */
    listForUser(
        userId: string,
        options: ListUserMemoriesOptions,
    ): Promise<{ items: UserMemoryRecord[]; total: number }>;
}

export const USER_MEMORY_REPOSITORY = Symbol('USER_MEMORY_REPOSITORY');
