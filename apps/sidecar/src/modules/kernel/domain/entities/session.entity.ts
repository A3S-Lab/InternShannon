import { AggregateRoot } from '@/shared/domain/aggregate-root';
import { SessionStatus } from '../value-objects/session-status.vo';

/**
 * Session Entity - Aggregate Root
 * Represents an agent session with message history
 */
export class Session extends AggregateRoot<string> {
    constructor(
        id: string,
        public readonly agentId: string | undefined,
        public readonly userId: string,
        public readonly title: string,
        public readonly cwd: string,
        public readonly status: SessionStatus,
        public readonly createdAt: Date,
        public readonly updatedAt: Date,
        public readonly metadata: Record<string, unknown> = {},
    ) {
        super(id);
    }
}
