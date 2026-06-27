import { Message } from '../entities/message.entity';

export const MESSAGE_REPOSITORY = Symbol('MESSAGE_REPOSITORY');

/**
 * Message Repository Interface
 */
export interface IMessageRepository {
    findById(id: string): Promise<Message | null>;
    findAll(): Promise<Message[]>;
    save(message: Message): Promise<void>;
    delete(id: string): Promise<void>;
    findBySessionId(sessionId: string): Promise<Message[]>;
    findBySessionIdOrdered(sessionId: string, limit?: number, offset?: number): Promise<Message[]>;
    findLatestBySessionIdAndRole(sessionId: string, role: Message['role']): Promise<Message | null>;
    /** Delete every message of the session in one statement; returns rows removed. */
    deleteBySessionId(sessionId: string): Promise<number>;
}
