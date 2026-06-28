import { Injectable, Logger } from '@nestjs/common';
import * as fs from 'fs';
import { desktopJsonFilePath } from '@/shared/infrastructure/desktop/desktop-paths';
import { Message, type MessageRole } from '@/modules/kernel/domain/entities/message.entity';
import type { IMessageRepository } from '@/modules/kernel/domain/repositories/message.repository.interface';

interface MessagesData {
    [sessionId: string]: Message[];
}

type MessageRecord = {
    id?: string;
    _id?: string;
    sessionId?: string;
    role?: MessageRole;
    content?: string;
    metadata?: Record<string, unknown>;
    createdAt?: string | Date;
};

@Injectable()
export class DesktopMessageRepository implements IMessageRepository {
    private readonly logger = new Logger(DesktopMessageRepository.name);
    private readonly messagesPath: string;
    private messagesCache: MessagesData = {};
    private loaded = false;

    constructor() {
        this.messagesPath = desktopJsonFilePath('messages.json', this.logger);
    }

    private async loadMessages(): Promise<MessagesData> {
        if (this.loaded) {
            return this.messagesCache;
        }

        try {
            if (fs.existsSync(this.messagesPath)) {
                const content = fs.readFileSync(this.messagesPath, 'utf-8');
                const raw = JSON.parse(content) as unknown;
                this.messagesCache = this.deserializeMessages(raw);
                const count = Object.values(this.messagesCache).reduce((sum, msgs) => sum + msgs.length, 0);
                this.logger.debug(`Loaded ${count} messages from file`);
            }
        } catch (e) {
            this.logger.warn(`Failed to load messages: ${e}`);
            this.messagesCache = {};
        }

        this.loaded = true;
        return this.messagesCache;
    }

    private deserializeMessages(raw: unknown): MessagesData {
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
            this.logger.warn('Ignoring malformed messages file root');
            return {};
        }

        const entries: Array<[string, Message[]]> = [];
        for (const [sessionId, records] of Object.entries(raw)) {
            if (!Array.isArray(records)) {
                this.logger.warn(`Ignoring malformed message bucket for session ${sessionId}`);
                continue;
            }

            entries.push([
                sessionId,
                records
                    .map(record => this.toMessage(sessionId, record))
                    .filter((message): message is Message => Boolean(message)),
            ]);
        }

        return Object.fromEntries(entries);
    }

    private async saveMessages(): Promise<void> {
        try {
            const raw = Object.fromEntries(
                Object.entries(this.messagesCache).map(([sessionId, messages]) => [
                    sessionId,
                    messages.map(message => this.toRecord(message)),
                ]),
            );
            fs.writeFileSync(this.messagesPath, JSON.stringify(raw, null, 2), 'utf-8');
            const count = Object.values(this.messagesCache).reduce((sum, msgs) => sum + msgs.length, 0);
            this.logger.debug(`Saved ${count} messages to file`);
        } catch (e) {
            this.logger.error(`Failed to save messages: ${e}`);
            throw e;
        }
    }

    async findById(id: string): Promise<Message | null> {
        const messages = await this.loadMessages();
        for (const sessionMessages of Object.values(messages)) {
            const found = sessionMessages.find(m => m.id === id);
            if (found) return found;
        }
        return null;
    }

    async findAll(): Promise<Message[]> {
        const messages = await this.loadMessages();
        return Object.values(messages).flat();
    }

    async save(message: Message): Promise<void> {
        const messages = await this.loadMessages();
        const sessionMessages = messages[message.sessionId] || [];
        const index = sessionMessages.findIndex(m => m.id === message.id);
        if (index >= 0) {
            sessionMessages[index] = message;
        } else {
            sessionMessages.push(message);
        }
        messages[message.sessionId] = sessionMessages;
        await this.saveMessages();
    }

    async delete(id: string): Promise<void> {
        const messages = await this.loadMessages();
        for (const sessionId of Object.keys(messages)) {
            messages[sessionId] = messages[sessionId].filter(m => m.id !== id);
        }
        await this.saveMessages();
    }

    async findBySessionId(sessionId: string): Promise<Message[]> {
        const messages = await this.loadMessages();
        return [...(messages[sessionId] || [])].sort((a, b) => {
            const byTime = a.createdAt.getTime() - b.createdAt.getTime();
            return byTime || a.id.localeCompare(b.id);
        });
    }

    async findLatestBySessionIdAndRole(sessionId: string, role: Message['role']): Promise<Message | null> {
        const ordered = await this.findBySessionId(sessionId);
        for (let i = ordered.length - 1; i >= 0; i -= 1) {
            if (ordered[i]?.role === role) return ordered[i] ?? null;
        }
        return null;
    }

    async deleteBySessionId(sessionId: string): Promise<number> {
        const messages = await this.loadMessages();
        const count = messages[sessionId]?.length ?? 0;
        if (count > 0) {
            delete messages[sessionId];
            await this.saveMessages();
        }
        return count;
    }

    async findBySessionIdOrdered(sessionId: string, limit?: number, offset?: number): Promise<Message[]> {
        const ordered = await this.findBySessionId(sessionId);
        const offsetVal = typeof offset === 'number' && Number.isFinite(offset) && offset > 0 ? offset : 0;
        const limitVal = typeof limit === 'number' && Number.isFinite(limit) && limit >= 0
            ? limit
            : ordered.length;
        return ordered.slice(offsetVal, offsetVal + limitVal);
    }

    private toMessage(sessionId: string, record: unknown): Message | null {
        if (!record || typeof record !== 'object' || Array.isArray(record)) return null;
        const messageRecord = record as MessageRecord;
        const id = this.nonEmptyString(messageRecord.id) || this.nonEmptyString(messageRecord._id);
        const role = this.normalizeRole(messageRecord.role);
        if (!id || !role) return null;
        return new Message(
            id,
            this.nonEmptyString(messageRecord.sessionId) || sessionId,
            role,
            typeof messageRecord.content === 'string' ? messageRecord.content : '',
            this.normalizeMetadata(messageRecord.metadata),
            this.normalizeDate(messageRecord.createdAt),
        );
    }

    private nonEmptyString(value: unknown): string | undefined {
        return typeof value === 'string' && value.trim() ? value : undefined;
    }

    private normalizeRole(value: unknown): MessageRole | undefined {
        return value === 'user' || value === 'assistant' || value === 'system' ? value : undefined;
    }

    private normalizeDate(value: unknown): Date {
        if (typeof value !== 'string' && !(value instanceof Date)) return new Date();
        const date = new Date(value);
        return Number.isFinite(date.getTime()) ? date : new Date();
    }

    private normalizeMetadata(value: unknown): Record<string, unknown> {
        return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
    }

    private toRecord(message: Message): MessageRecord {
        return {
            id: message.id,
            sessionId: message.sessionId,
            role: message.role,
            content: message.content,
            metadata: message.metadata,
            createdAt: message.createdAt.toISOString(),
        };
    }
}
