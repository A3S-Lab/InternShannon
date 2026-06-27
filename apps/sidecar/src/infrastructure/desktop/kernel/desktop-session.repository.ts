import { Injectable, Logger } from '@nestjs/common';
import * as fs from 'fs';
import { desktopJsonFilePath } from '../desktop-paths';
import { Session } from '../../../modules/kernel/domain/entities/session.entity';
import {
    ISessionRepository,
    NON_CONVERSATIONAL_AGENT_IDS,
} from '../../../modules/kernel/domain/repositories/session.repository.interface';

const NON_CONVERSATIONAL_AGENT_ID_SET = new Set<string>(NON_CONVERSATIONAL_AGENT_IDS);

type SessionRecord = {
    id?: string;
    _id?: string;
    agentId?: string;
    userId?: string;
    title?: string;
    cwd?: string;
    status?: Session['status'];
    createdAt?: string | Date;
    updatedAt?: string | Date;
    metadata?: Record<string, unknown>;
};

@Injectable()
export class DesktopSessionRepository implements ISessionRepository {
    private readonly logger = new Logger(DesktopSessionRepository.name);
    private readonly sessionsPath: string;
    private sessionsCache: Map<string, Session> = new Map();
    private loaded = false;

    constructor() {
        this.sessionsPath = desktopJsonFilePath('sessions.json', this.logger);
    }

    private async loadSessions(): Promise<Map<string, Session>> {
        if (this.loaded) {
            return this.sessionsCache;
        }

        try {
            if (fs.existsSync(this.sessionsPath)) {
                const content = fs.readFileSync(this.sessionsPath, 'utf-8');
                const data = JSON.parse(content) as unknown;
                const sessions = this.deserializeSessions(data);
                this.sessionsCache = new Map(sessions.map(s => [s.id, s]));
                this.logger.debug(`Loaded ${this.sessionsCache.size} sessions from file`);
            }
        } catch (e) {
            this.logger.warn(`Failed to load sessions: ${e}`);
            this.sessionsCache = new Map();
        }

        this.loaded = true;
        return this.sessionsCache;
    }

    private deserializeSessions(data: unknown): Session[] {
        if (!Array.isArray(data)) {
            this.logger.warn('Ignoring malformed sessions file root');
            return [];
        }

        return data
            .map(record => this.toSession(record))
            .filter((session): session is Session => Boolean(session));
    }

    private async saveSessions(): Promise<void> {
        try {
            const data = Array.from(this.sessionsCache.values()).map(session => this.toRecord(session));
            fs.writeFileSync(this.sessionsPath, JSON.stringify(data, null, 2), 'utf-8');
            this.logger.debug(`Saved ${data.length} sessions to file`);
        } catch (e) {
            this.logger.error(`Failed to save sessions: ${e}`);
            throw e;
        }
    }

    async findById(id: string): Promise<Session | null> {
        const sessions = await this.loadSessions();
        return sessions.get(id) || null;
    }

    async findAll(): Promise<Session[]> {
        const sessions = await this.loadSessions();
        return Array.from(sessions.values()).sort(
            (a, b) => b.updatedAt.getTime() - a.updatedAt.getTime()
        );
    }

    async save(session: Session): Promise<void> {
        const sessions = await this.loadSessions();
        sessions.set(session.id, session);
        await this.saveSessions();
    }

    async delete(id: string): Promise<void> {
        const sessions = await this.loadSessions();
        sessions.delete(id);
        await this.saveSessions();
    }

    async findByUserId(userId: string): Promise<Session[]> {
        const sessions = await this.loadSessions();
        return Array.from(sessions.values())
            .filter(s => s.userId === userId)
            .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
    }

    async findByUserIdPaginated(
        userId: string,
        limit: number,
        offset: number,
        conversationalOnly?: boolean,
    ): Promise<Session[]> {
        const sessions = await this.loadSessions();
        return Array.from(sessions.values())
            .filter(s => s.userId === userId && (!conversationalOnly || this.isConversational(s)))
            .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
            .slice(offset, offset + limit);
    }

    async countByUserId(userId: string, conversationalOnly?: boolean): Promise<number> {
        const sessions = await this.loadSessions();
        let count = 0;
        for (const s of sessions.values()) {
            if (s.userId === userId && (!conversationalOnly || this.isConversational(s))) count++;
        }
        return count;
    }

    // Desktop sidecar is single-user; "all sessions" is just every local session.
    async findAllPaginated(limit: number, offset: number, conversationalOnly?: boolean): Promise<Session[]> {
        const sessions = await this.loadSessions();
        return Array.from(sessions.values())
            .filter(s => !conversationalOnly || this.isConversational(s))
            .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
            .slice(offset, offset + limit);
    }

    async countAll(conversationalOnly?: boolean): Promise<number> {
        const sessions = await this.loadSessions();
        if (!conversationalOnly) return sessions.size;
        let count = 0;
        for (const s of sessions.values()) if (this.isConversational(s)) count++;
        return count;
    }

    private isConversational(session: Session): boolean {
        return !session.agentId || !NON_CONVERSATIONAL_AGENT_ID_SET.has(session.agentId);
    }

    async findByCreationRequest(
        userId: string,
        agentId: string | undefined,
        creationRequestId: string,
    ): Promise<Session | null> {
        const resolvedRequestId = creationRequestId.trim();
        if (!resolvedRequestId) return null;

        const sessions = await this.loadSessions();
        return (
            Array.from(sessions.values())
                .filter(
                    session =>
                        session.userId === (userId || 'desktop-user') &&
                        (session.agentId?.trim() || 'default') === (agentId?.trim() || 'default') &&
                        this.creationRequestId(session.metadata) === resolvedRequestId,
                )
                .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())[0] || null
        );
    }

    async findActiveByUserId(userId: string): Promise<Session | null> {
        const sessions = await this.loadSessions();
        return Array.from(sessions.values())
            .filter(s => s.userId === userId && s.status === 'active')
            .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())[0] || null;
    }

    private toSession(record: unknown): Session | null {
        if (!record || typeof record !== 'object' || Array.isArray(record)) return null;
        const sessionRecord = record as SessionRecord;
        const id = this.nonEmptyString(sessionRecord.id) || this.nonEmptyString(sessionRecord._id);
        if (!id) return null;
        return new Session(
            id,
            this.nonEmptyString(sessionRecord.agentId),
            this.nonEmptyString(sessionRecord.userId) || 'desktop-user',
            this.resolveSessionTitle(id, this.nonEmptyString(sessionRecord.title)),
            this.nonEmptyString(sessionRecord.cwd) || '',
            this.normalizeStatus(sessionRecord.status),
            this.normalizeDate(sessionRecord.createdAt),
            this.normalizeDate(sessionRecord.updatedAt),
            this.normalizeMetadata(sessionRecord.metadata),
        );
    }

    private toRecord(session: Session): SessionRecord {
        return {
            id: session.id,
            agentId: session.agentId,
            userId: session.userId,
            title: session.title,
            cwd: session.cwd,
            status: session.status,
            createdAt: session.createdAt.toISOString(),
            updatedAt: session.updatedAt.toISOString(),
            metadata: session.metadata,
        };
    }

    private resolveSessionTitle(sessionId: string, title?: string): string {
        return title?.trim() || `会话 ${this.sessionShortId(sessionId)}`;
    }

    private nonEmptyString(value: unknown): string | undefined {
        return typeof value === 'string' && value.trim() ? value : undefined;
    }

    private normalizeStatus(value: unknown): Session['status'] {
        return value === 'completed' || value === 'aborted' ? value : 'active';
    }

    private normalizeDate(value: unknown): Date {
        if (typeof value !== 'string' && !(value instanceof Date)) return new Date();
        const date = new Date(value);
        return Number.isFinite(date.getTime()) ? date : new Date();
    }

    private normalizeMetadata(value: unknown): Record<string, unknown> {
        return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
    }

    private creationRequestId(metadata?: Record<string, unknown>): string | undefined {
        const value = metadata?.creationRequestId;
        return typeof value === 'string' && value.trim() ? value.trim() : undefined;
    }

    private sessionShortId(sessionId: string): string {
        const uuidPrefix = sessionId.match(/^[0-9a-f]{8}/i)?.[0];
        if (uuidPrefix) return uuidPrefix;
        const parts = sessionId.split(/[^a-zA-Z0-9]+/).filter(Boolean);
        const lastPart = parts[parts.length - 1];
        if (lastPart && lastPart.toLowerCase() !== 'session') return lastPart.slice(0, 8);
        const normalized = sessionId.replace(/[^a-zA-Z0-9]/g, '');
        return (normalized || sessionId).slice(0, 8);
    }
}
