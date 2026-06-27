import { Inject, Injectable, Logger } from '@nestjs/common';
import {
    IUserMemoryRepository,
    ListUserMemoriesOptions,
    RecordUserMemoryInput,
    USER_MEMORY_REPOSITORY,
    UserMemoryRecord,
} from '../domain/repositories/user-memory.repository.interface';

/**
 * Kernel memory base service.
 *
 * `record` is the fire-and-forget TAP wired into the kernel stream pipeline: when a `memory_stored` /
 * `memory_recalled` / `memory_cleared` event passes through the runner it persists one row here. It MUST
 * be exactly as safe as {@link CognitionRecallService} — additive, non-blocking, fail-silent: it never
 * throws into the caller and never returns a rejecting promise (callers do not / must not await it), so a
 * persistence failure can never disturb the live agent stream sent to the browser. A no-op when migration
 * 099 hasn't been applied yet (driver-mirror resilience).
 *
 * `listForUser` is the read path behind GET /kernel/me/memories and returns an empty base when migration
 * 099 is absent so Xiaoan hydration stays non-blocking in older driver mirrors.
 */
@Injectable()
export class UserMemoryService {
    private readonly logger = new Logger(UserMemoryService.name);

    constructor(
        @Inject(USER_MEMORY_REPOSITORY)
        private readonly repository: IUserMemoryRepository,
    ) {}

    /**
     * Fire-and-forget persist of one memory event. Returns void (no awaitable result) — the whole body is
     * wrapped so neither a synchronous throw nor a rejected repository promise can ever escape. Safe to
     * call directly inside the hot stream loop.
     */
    record(input: RecordUserMemoryInput): void {
        if (!input.userId) return;
        try {
            void this.repository.record(input).catch(error => this.swallow(error));
        } catch (error) {
            // Defensive: a synchronous throw before the promise is even created (should not happen, but a
            // misbehaving repo binding must still not break the stream).
            this.swallow(error);
        }
    }

    /** A single user's memories, newest-first, with optional layer/action filters + total. */
    async listForUser(
        userId: string,
        options: ListUserMemoriesOptions,
    ): Promise<{ items: UserMemoryRecord[]; total: number }> {
        try {
            return await this.repository.listForUser(userId, options);
        } catch (error) {
            if (this.isMissingSchema(error)) return { items: [], total: 0 };
            throw error;
        }
    }

    /** Log + swallow. Missing-schema (migration 099 not applied) is a silent no-op. */
    private swallow(error: unknown): void {
        if (this.isMissingSchema(error)) return;
        this.logger.warn(
            `User-memory record failed (swallowed): ${error instanceof Error ? error.message : String(error)}`,
        );
    }

    /** True when the user_memories table doesn't exist yet — record no-ops (driver-mirror resilience). */
    private isMissingSchema(error: unknown): boolean {
        const code = typeof error === 'object' && error ? (error as { code?: unknown }).code : undefined;
        const message = error instanceof Error ? error.message : String(error);
        const normalized = message.toLowerCase();
        return (
            code === '42P01' ||
            /(?:relation|table)\s+["']?user_memories["']?\s+does not exist/.test(normalized) ||
            /no such table:\s*user_memories/.test(normalized)
        );
    }
}
