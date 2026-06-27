import { Inject, Injectable, Logger } from '@nestjs/common';
import { Message } from '../domain/entities/message.entity';
import { type IMessageRepository, MESSAGE_REPOSITORY } from '../domain/repositories/message.repository.interface';
import type { AssistantContentBlock } from './session-runtime.types';

export interface RecordKernelUserMessageInput {
    sessionId: string;
    content: string;
    images?: { mediaType: string; data: string }[];
}

export interface RecordKernelAssistantMessageInput {
    id?: string;
    sessionId: string;
    content: string;
    contentBlocks: AssistantContentBlock[];
    totalTokens?: number;
    source?: string;
}

export interface KernelRuntimeHistoryMessage {
    role: 'user' | 'assistant';
    content: Array<{ type: 'text'; text: string }>;
}

const MAX_MODEL_CONTEXT_HISTORY_TEXT_BYTES = 24 * 1024;
const MODEL_CONTEXT_HISTORY_TAIL_BYTES = 8 * 1024;

@Injectable()
export class KernelConversationLogService {
    private readonly logger = new Logger(KernelConversationLogService.name);

    constructor(
        @Inject(MESSAGE_REPOSITORY)
        private readonly messageRepository: IMessageRepository,
    ) {}

    async recordUserMessage(input: RecordKernelUserMessageInput): Promise<Message> {
        const message = new Message(
            this.messageId('msg'),
            input.sessionId,
            'user',
            input.content,
            input.images ? { images: input.images } : {},
            new Date(),
        );

        await this.saveWithoutInterruptingRun(message);
        return message;
    }

    async recordAssistantMessage(input: RecordKernelAssistantMessageInput): Promise<Message> {
        const content = input.content.trim() ? input.content : this.textFromContentBlocks(input.contentBlocks);
        const message = new Message(
            input.id || this.messageId('msg'),
            input.sessionId,
            'assistant',
            content,
            {
                totalTokens: input.totalTokens,
                source: input.source || 'a3s-code',
                contentBlocks: input.contentBlocks.length > 0 ? input.contentBlocks : undefined,
            },
            new Date(),
        );

        await this.saveWithoutInterruptingRun(message);
        return message;
    }

    async listRuntimeHistory(
        sessionId: string,
        options: { excludeMessageId?: string; limit?: number } = {},
    ): Promise<KernelRuntimeHistoryMessage[]> {
        const limit = options.limit ?? 40;
        try {
            const messages = await this.orderedSessionMessages(sessionId);
            return messages
                .flatMap(message => {
                    if (message.id === options.excludeMessageId) return [];
                    if (message.role !== 'user' && message.role !== 'assistant') return [];
                    const source = typeof message.metadata?.source === 'string' ? message.metadata.source : '';
                    if (source.startsWith('command:')) return [];
                    const content = this.historyMessageContent(message);
                    return content
                        ? [
                              {
                                  role: message.role as 'user' | 'assistant',
                                  content: [{ type: 'text' as const, text: content }],
                              },
                          ]
                        : [];
                })
                .slice(-limit);
        } catch (error) {
            this.logger.warn(`Failed to read runtime history for ${sessionId}: ${error}`);
            return [];
        }
    }

    async clearSessionMessages(sessionId: string): Promise<number> {
        try {
            return await this.messageRepository.deleteBySessionId(sessionId);
        } catch (error) {
            this.logger.warn(`Failed to clear messages for ${sessionId}: ${error}`);
            return 0;
        }
    }

    private async orderedSessionMessages(sessionId: string): Promise<Message[]> {
        try {
            return await this.messageRepository.findBySessionIdOrdered(sessionId);
        } catch {
            return await this.messageRepository.findBySessionId(sessionId);
        }
    }

    private async saveWithoutInterruptingRun(message: Message): Promise<void> {
        try {
            await this.messageRepository.save(message);
        } catch (error) {
            this.logger.warn(`Failed to persist ${message.role} message for ${message.sessionId}: ${error}`);
        }
    }

    private messageId(prefix: string): string {
        return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    }

    private historyMessageContent(message: Message): string {
        const direct = message.content.trim();
        const content =
            direct ||
            (message.role === 'assistant'
                ? this.textFromContentBlocks(message.metadata?.contentBlocks ?? message.metadata?.content_blocks)
                : '');
        return this.boundModelContextHistoryContent(content, message);
    }

    private textFromContentBlocks(value: unknown): string {
        if (!Array.isArray(value)) return '';

        return value
            .flatMap(block => {
                if (!block || typeof block !== 'object' || Array.isArray(block)) return [];
                const record = block as Record<string, unknown>;
                if (record.type !== 'text' && record.type !== undefined && record.type !== null) return [];
                const text =
                    this.nonEmptyString(record.text) ??
                    this.nonEmptyString(record.content) ??
                    this.nonEmptyString(record.message);
                return text ? [text] : [];
            })
            .join('\n\n')
            .trim();
    }

    private nonEmptyString(value: unknown): string | undefined {
        return typeof value === 'string' && value.trim() ? value : undefined;
    }

    private boundModelContextHistoryContent(content: string, message: Message): string {
        const originalBytes = Buffer.byteLength(content, 'utf8');
        if (originalBytes <= MAX_MODEL_CONTEXT_HISTORY_TEXT_BYTES) return content;

        const artifactUri = `kernel-message://${message.sessionId}/${message.id}`;
        const notice = `\n\n[Runtime history/tool output truncated before model context: originalBytes=${originalBytes}; artifactUri=${artifactUri}; kept=head+tail]\n\n`;
        const noticeBytes = Buffer.byteLength(notice, 'utf8');
        const contentBudget = Math.max(0, MAX_MODEL_CONTEXT_HISTORY_TEXT_BYTES - noticeBytes);
        const tailBudget = Math.min(MODEL_CONTEXT_HISTORY_TAIL_BYTES, Math.floor(contentBudget / 2));
        const headBudget = Math.max(0, contentBudget - tailBudget);
        return `${this.takeUtf8Prefix(content, headBudget)}${notice}${this.takeUtf8Suffix(content, tailBudget)}`.trim();
    }

    private takeUtf8Prefix(text: string, maxBytes: number): string {
        if (maxBytes <= 0) return '';
        if (Buffer.byteLength(text, 'utf8') <= maxBytes) return text;
        let low = 0;
        let high = text.length;
        while (low < high) {
            const mid = Math.ceil((low + high) / 2);
            if (Buffer.byteLength(text.slice(0, mid), 'utf8') <= maxBytes) {
                low = mid;
            } else {
                high = mid - 1;
            }
        }
        return text.slice(0, low);
    }

    private takeUtf8Suffix(text: string, maxBytes: number): string {
        if (maxBytes <= 0) return '';
        if (Buffer.byteLength(text, 'utf8') <= maxBytes) return text;
        let low = 0;
        let high = text.length;
        while (low < high) {
            const mid = Math.ceil((low + high) / 2);
            if (Buffer.byteLength(text.slice(text.length - mid), 'utf8') <= maxBytes) {
                low = mid;
            } else {
                high = mid - 1;
            }
        }
        return text.slice(text.length - low);
    }
}
