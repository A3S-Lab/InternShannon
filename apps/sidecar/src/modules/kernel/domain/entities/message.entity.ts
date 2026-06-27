import { Entity } from '@/shared/domain/entity';

/**
 * Message Role
 */
export type MessageRole = 'user' | 'assistant' | 'system';

/**
 * Message Entity
 * Represents a message in a session
 */
export class Message extends Entity<string> {
    constructor(
        id: string,
        public readonly sessionId: string,
        public readonly role: MessageRole,
        public readonly content: string,
        public readonly metadata: Record<string, unknown> = {},
        public readonly createdAt: Date = new Date(),
    ) {
        super(id);
    }
}
