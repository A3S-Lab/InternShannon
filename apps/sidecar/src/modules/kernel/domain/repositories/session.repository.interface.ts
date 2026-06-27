import { Session } from '../entities/session.entity';

export const SESSION_REPOSITORY = Symbol('SESSION_REPOSITORY');

/**
 * Feature-internal agent kinds whose kernel sessions are runtime/automation
 * artifacts — asset development, workflow orchestration, devops, and system
 * operations (marketplace publish / diagnose) — NOT user conversations. They
 * are excluded from the "my conversations" count/list shown on the user
 * overview. `default` / `default-agent` and custom marketplace-agent chats are
 * conversations and stay counted.
 */
export const NON_CONVERSATIONAL_AGENT_IDS = ['asset', 'orchestration', 'devops', 'system'] as const;

/**
 * Session Repository Interface
 */
export interface ISessionRepository {
    findById(id: string): Promise<Session | null>;
    findAll(): Promise<Session[]>;
    save(session: Session): Promise<void>;
    delete(id: string): Promise<void>;
    findByUserId(userId: string): Promise<Session[]>;
    /** @param conversationalOnly exclude feature-internal sessions (see NON_CONVERSATIONAL_AGENT_IDS). */
    findByUserIdPaginated(userId: string, limit: number, offset: number, conversationalOnly?: boolean): Promise<Session[]>;
    /** Total sessions owned by a user — accurate pagination total (not a page slice). conversationalOnly excludes feature-internal kinds. */
    countByUserId(userId: string, conversationalOnly?: boolean): Promise<number>;
    /** Cross-user paginated session listing; kept for desktop compatibility with old query paths. */
    findAllPaginated(limit: number, offset: number, conversationalOnly?: boolean): Promise<Session[]>;
    /** Cross-user total session count; kept for desktop compatibility with old query paths. */
    countAll(conversationalOnly?: boolean): Promise<number>;
    findByCreationRequest(userId: string, agentId: string | undefined, creationRequestId: string): Promise<Session | null>;
    findActiveByUserId(userId: string): Promise<Session | null>;
}
