import { createHash } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import {
    IKernelMessageRunService,
    KERNEL_MESSAGE_RUN_SERVICE,
} from '@/modules/kernel/domain/services/kernel-message-run.service.interface';
import { KERNEL_SERVICE, type IKernelService } from '@/modules/kernel/domain/services/kernel-service.interface';
import type { Session } from '@/modules/kernel/domain/entities/session.entity';
import type { WechatChannelMessage } from '../domain';

const WECHAT_SOURCE = 'wechat-channel';
const WECHAT_USER_PREFIX = 'wechat:';

@Injectable()
export class WechatAgentBridgeService {
    private readonly logger = new Logger(WechatAgentBridgeService.name);
    private readonly sessionCache = new Map<string, string>();

    constructor(
        @Inject(KERNEL_SERVICE) private readonly kernelService: IKernelService,
        @Inject(KERNEL_MESSAGE_RUN_SERVICE)
        private readonly messageRuns: IKernelMessageRunService,
    ) {}

    async runDefaultAgent(message: WechatChannelMessage): Promise<string> {
        const content = message.content.trim();
        if (!content) {
            return '收到消息，但没有识别到可处理的文本内容。';
        }

        const session = await this.resolveSession(message);
        const replyParts: string[] = [];
        let errorMessage = '';

        await this.messageRuns.run({
            sessionId: session.id,
            content,
            emit: event => {
                this.logger.debug(`WeChat agent event: ${JSON.stringify(event).slice(0, 200)}`);
                const textDelta = this.extractTextDelta(event);
                if (textDelta) {
                    replyParts.push(textDelta);
                    return;
                }
                const finalText = this.extractAssistantText(event);
                if (finalText) {
                    replyParts.length = 0;
                    replyParts.push(finalText);
                    return;
                }
                const error = this.extractError(event);
                if (error) {
                    errorMessage = error;
                }
            },
        });

        const reply = replyParts.join('').trim();
        if (reply) return reply;

        const fallback = await this.readLatestAssistantText(session.id);
        if (fallback) return fallback;

        if (errorMessage) {
            this.logger.warn(`WeChat agent run failed: ${errorMessage}`);
            return `执行失败：${errorMessage}`;
        }
        return '本轮智能体没有返回可发送的文本内容。';
    }

    private async readLatestAssistantText(sessionId: string): Promise<string | null> {
        try {
            const messages = await this.kernelService.getSessionMessages(sessionId, 10, 0);
            for (let i = messages.length - 1; i >= 0; i--) {
                const msg = messages[i];
                if (msg.role === 'assistant' && typeof msg.content === 'string' && msg.content.trim()) {
                    return msg.content.trim();
                }
            }
            return null;
        } catch (error) {
            this.logger.debug(`Failed to read assistant text fallback: ${error instanceof Error ? error.message : error}`);
            return null;
        }
    }

    private async resolveSession(message: WechatChannelMessage): Promise<Session> {
        const cacheKey = this.conversationHash(message);
        const cachedSessionId = this.sessionCache.get(cacheKey);
        if (cachedSessionId) {
            const cached = await this.kernelService.getSession(cachedSessionId);
            if (cached) return cached;
            this.sessionCache.delete(cacheKey);
        }

        const userId = `${WECHAT_USER_PREFIX}${cacheKey}`;
        const existing = (await this.kernelService.getUserSessions(userId)).find(
            s => s.metadata?.integration === WECHAT_SOURCE && s.metadata?.externalConversationHash === cacheKey,
        );
        if (existing) {
            this.sessionCache.set(cacheKey, existing.id);
            return existing;
        }

        const session = await this.kernelService.createSession(
            undefined,
            userId,
            `微信对话 ${cacheKey.slice(0, 8)}`,
            undefined,
            {
                integration: WECHAT_SOURCE,
                externalPlatform: 'wechat',
                externalChatType: message.isGroup ? 'group' : 'p2p',
                externalConversationHash: cacheKey,
            },
        );
        this.sessionCache.set(cacheKey, session.id);
        return session;
    }

    private conversationHash(message: WechatChannelMessage): string {
        const key = message.isGroup
            ? `group:${message.groupId || 'unknown'}:${message.fromUser}`
            : `p2p:${message.fromUser}`;
        return createHash('sha256').update(key).digest('hex').slice(0, 32);
    }

    private extractTextDelta(event: unknown): string {
        if (!this.isRecord(event)) return '';
        if (event.type !== 'stream_event' || !this.isRecord(event.event)) return '';
        return event.event.type === 'text_delta' && typeof event.event.text === 'string' ? event.event.text : '';
    }

    private extractAssistantText(event: unknown): string {
        if (!this.isRecord(event) || event.type !== 'assistant' || !this.isRecord(event.message)) return '';
        const content = event.message.content;
        if (!Array.isArray(content)) return '';
        return content
            .map(block => this.isRecord(block) && block.type === 'text' && typeof block.text === 'string' ? block.text : '')
            .join('')
            .trim();
    }

    private extractError(event: unknown): string {
        if (!this.isRecord(event)) return '';
        if (event.type === 'error' && typeof event.message === 'string') return event.message;
        if (event.status === 'failed' && typeof event.detail === 'string') return event.detail;
        return '';
    }

    private isRecord(value: unknown): value is Record<string, unknown> {
        return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
    }
}
