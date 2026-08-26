import { Inject, Injectable, Logger } from "@nestjs/common";
import { isPublicKnowledgeSourcePath } from "@/modules/assets/domain/knowledge/knowledge-source-path.policy";
import { Message } from "../domain/entities/message.entity";
import { type IMessageRepository, MESSAGE_REPOSITORY } from "../domain/repositories/message.repository.interface";
import {
    extractKnowledgeConversationObservation,
    isKnowledgeConversationObservation,
    type KnowledgeConversationObservation,
} from "./knowledge-conversation-observation";
import { isKnowledgeContinuationState, type KnowledgeContinuationState } from "./knowledge-retrieval-coverage";
import type { KnowledgeSourceLocator, KnowledgeSourceReference } from "./knowledge-source-reference";
import type { AssistantContentBlock } from "./session-runtime.types";

export interface RecordKernelUserMessageInput {
    sessionId: string;
    content: string;
    images?: { mediaType: string; data: string }[];
}

export interface RecordKernelAssistantMessageInput {
    id?: string;
    /** Immutable id of the user message/run that produced this assistant turn. */
    parentRunId?: string;
    sessionId: string;
    content: string;
    contentBlocks: AssistantContentBlock[];
    totalTokens?: number;
    source?: string;
    knowledgeSources?: KnowledgeSourceReference[];
    knowledgeSourceProtocolVersion?: 1;
    knowledgeContinuation?: KnowledgeContinuationState;
    trustedKnowledgeContext?: boolean;
}

export interface KernelRuntimeHistoryMessage {
    role: "user" | "assistant";
    content: Array<{ type: "text"; text: string }>;
}

/**
 * Application-owned history used only to resolve personal-knowledge follow-ups.
 * Assistant prose is deliberately omitted: only persisted, structurally
 * verified source locators may seed a later query.
 */
export interface KernelKnowledgeQueryHistoryMessage {
    role: "user" | "assistant";
    content: string;
    knowledgeSources?: KnowledgeSourceReference[];
}

export interface KernelKnowledgeQueryHistoryWindow {
    messages: KernelKnowledgeQueryHistoryMessage[];
    /** Trusted source cards omitted before the bounded message tail. */
    omittedTrustedKnowledgeSources: number;
}

const MAX_MODEL_CONTEXT_HISTORY_TEXT_BYTES = 24 * 1024;
const MODEL_CONTEXT_HISTORY_TAIL_BYTES = 8 * 1024;

export function isSafeKnowledgeQueryLocator(value: unknown): value is string {
    if (typeof value !== "string") return false;
    const normalized = value.normalize("NFKC").trim();
    if (
        !normalized ||
        normalized.length > 160 ||
        /[\p{Cc}\p{Co}]/u.test(normalized) ||
        /(?:^|[\s([{'"`])(?:asset|file|https?):(?:\/\/|\\\\)/iu.test(normalized) ||
        /^(?:\/|~[\\/]|[A-Za-z]:[\\/]|\\\\)/u.test(normalized) ||
        /(?:^|[\\/])\.\.(?:[\\/]|$)/u.test(normalized) ||
        /%2e(?:%2e|\.)|\.(?:%2e)/iu.test(normalized) ||
        /[\p{L}\p{N}._%+-]+@[\p{L}\p{N}.-]+\.[\p{L}]{2,}/iu.test(normalized) ||
        /\bbearer\s+[A-Za-z0-9._~+/-]{6,}/iu.test(normalized) ||
        /\bsk-[A-Za-z0-9_-]{8,}\b/iu.test(normalized) ||
        /\b(?:api[_. -]?key|secret|token|credential|password|passwd|authorization)\s*[:=]\s*\S{4,}/iu.test(
            normalized,
        ) ||
        /\b(?:api[_.-]?key|secret|token|credential)[_.:-][A-Za-z0-9_~+./=-]{8,}\b/iu.test(normalized) ||
        /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/u.test(normalized)
    ) {
        return false;
    }
    return true;
}

@Injectable()
export class KernelConversationLogService {
    private readonly logger = new Logger(KernelConversationLogService.name);

    constructor(
        @Inject(MESSAGE_REPOSITORY)
        private readonly messageRepository: IMessageRepository,
    ) {}

    async recordUserMessage(input: RecordKernelUserMessageInput): Promise<Message> {
        const id = this.messageId("msg");
        const createdAt = new Date();
        const knowledgeObservation = extractKnowledgeConversationObservation({
            turnId: id,
            content: input.content,
            recordedAt: createdAt,
        });
        const message = new Message(
            id,
            input.sessionId,
            "user",
            input.content,
            {
                ...(input.images ? { images: input.images } : {}),
                ...(knowledgeObservation ? { knowledgeObservation } : {}),
            },
            createdAt,
        );

        await this.saveWithoutInterruptingRun(message);
        return message;
    }

    async recordAssistantMessage(input: RecordKernelAssistantMessageInput): Promise<Message> {
        const content = input.content.trim() ? input.content : this.textFromContentBlocks(input.contentBlocks);
        const message = new Message(
            input.id || this.messageId("msg"),
            input.sessionId,
            "assistant",
            content,
            {
                parentRunId: input.parentRunId,
                totalTokens: input.totalTokens,
                source: input.source || "a3s-code",
                contentBlocks: input.contentBlocks.length > 0 ? input.contentBlocks : undefined,
                knowledgeSources: input.knowledgeSources?.length ? input.knowledgeSources : undefined,
                knowledgeSourceProtocolVersion: input.knowledgeSourceProtocolVersion,
                knowledgeContinuation: input.knowledgeContinuation,
                trustedKnowledgeContext: input.trustedKnowledgeContext === true ? true : undefined,
            },
            new Date(),
        );

        await this.saveWithoutInterruptingRun(message);
        return message;
    }

    async latestKnowledgeContinuation(sessionId: string): Promise<KnowledgeContinuationState | undefined> {
        try {
            const messages = await this.orderedSessionMessages(sessionId);
            for (let index = messages.length - 1; index >= 0; index -= 1) {
                const message = messages[index];
                if (message?.role !== "assistant") continue;
                const value = message.metadata?.knowledgeContinuation;
                // A continuation belongs only to the immediately preceding
                // assistant turn. Do not resurrect an older, unrelated partial
                // retrieval after later conversation has moved on.
                return isKnowledgeContinuationState(value) ? value : undefined;
            }
        } catch (error) {
            this.logger.warn(`Failed to read knowledge continuation for ${sessionId}: ${error}`);
        }
        return undefined;
    }

    /**
     * Whether a completed assistant turn in this persisted session received
     * verified personal-knowledge evidence. This is a scope hint for deciding
     * whether a later ordinary follow-up needs fresh grounding; persisted
     * assistant prose is never returned or trusted as evidence itself.
     */
    async hasTrustedKnowledgeContext(sessionId: string): Promise<boolean> {
        try {
            const messages = await this.orderedSessionMessages(sessionId);
            return messages.some((message) => {
                if (message?.role !== "assistant") return false;
                if (message.metadata?.trustedKnowledgeContext === true) return true;
                if (message.metadata?.knowledgeSourceProtocolVersion !== 1) return false;
                const sources = message.metadata?.knowledgeSources;
                return Array.isArray(sources) && sources.some((source) => this.isPersistedKnowledgeSource(source));
            });
        } catch (error) {
            this.logger.warn(`Failed to read trusted knowledge context for ${sessionId}: ${error}`);
            return false;
        }
    }

    async latestKnowledgeObservations(sessionId: string, limit = 12): Promise<KnowledgeConversationObservation[]> {
        try {
            const messages = await this.orderedSessionMessages(sessionId);
            return messages
                .flatMap((message) => {
                    const observation = message.metadata?.knowledgeObservation;
                    return isKnowledgeConversationObservation(observation) ? [observation] : [];
                })
                .slice(-Math.max(1, Math.min(32, limit)));
        } catch (error) {
            this.logger.warn(`Failed to read knowledge observations for ${sessionId}: ${error}`);
            return [];
        }
    }

    async listRuntimeHistory(
        sessionId: string,
        options: { excludeMessageId?: string; limit?: number } = {},
    ): Promise<KernelRuntimeHistoryMessage[]> {
        const limit = options.limit ?? 40;
        try {
            const messages = await this.orderedSessionMessages(sessionId);
            return messages
                .flatMap((message) => {
                    if (message.id === options.excludeMessageId) return [];
                    if (message.role !== "user" && message.role !== "assistant") return [];
                    const source = typeof message.metadata?.source === "string" ? message.metadata.source : "";
                    if (source.startsWith("command:")) return [];
                    const content = this.historyMessageContent(message);
                    return content
                        ? [
                              {
                                  role: message.role as "user" | "assistant",
                                  content: [{ type: "text" as const, text: content }],
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

    async listKnowledgeQueryHistory(
        sessionId: string,
        options: { excludeMessageId?: string; limit?: number } = {},
    ): Promise<KernelKnowledgeQueryHistoryMessage[]> {
        return (await this.listKnowledgeQueryHistoryWindow(sessionId, options)).messages;
    }

    async listKnowledgeQueryHistoryWindow(
        sessionId: string,
        options: { excludeMessageId?: string; limit?: number } = {},
    ): Promise<KernelKnowledgeQueryHistoryWindow> {
        const limit = options.limit ?? 40;
        try {
            const messages = await this.orderedSessionMessages(sessionId);
            const eligible = messages.flatMap((message): KernelKnowledgeQueryHistoryMessage[] => {
                if (message.id === options.excludeMessageId) return [];
                if (message.role === "user") {
                    const source = typeof message.metadata?.source === "string" ? message.metadata.source : "";
                    if (source.startsWith("command:")) return [];
                    const content = this.historyMessageContent(message);
                    return content ? [{ role: "user" as const, content }] : [];
                }
                if (
                    message.role !== "assistant" ||
                    message.metadata?.knowledgeSourceProtocolVersion !== 1 ||
                    !Array.isArray(message.metadata.knowledgeSources)
                ) {
                    return [];
                }
                const knowledgeSources = message.metadata.knowledgeSources.flatMap((source) => {
                    const persisted = this.persistedKnowledgeSource(source);
                    // A revision-pinned read of an entire source is trusted
                    // evidence even when it has no row/section locator. Keep
                    // it for an explicit bounded history review so the
                    // runner can revalidate that source at its current
                    // revision. Search/catalog cards without locators do not
                    // prove file contents and must not become read duties.
                    return persisted && (persisted.locators.length > 0 || persisted.evidence === "read")
                        ? [persisted]
                        : [];
                });
                return knowledgeSources.length > 0
                    ? [{ role: "assistant" as const, content: "", knowledgeSources }]
                    : [];
            });
            const boundedLimit = Math.max(1, Math.min(64, limit));
            const omitted = eligible.slice(0, Math.max(0, eligible.length - boundedLimit));
            return {
                messages: eligible.slice(-boundedLimit),
                omittedTrustedKnowledgeSources: omitted.reduce(
                    (count, message) => count + (message.knowledgeSources?.length ?? 0),
                    0,
                ),
            };
        } catch (error) {
            this.logger.warn(`Failed to read knowledge query history for ${sessionId}: ${error}`);
            return { messages: [], omittedTrustedKnowledgeSources: 0 };
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
            (message.role === "assistant"
                ? this.textFromContentBlocks(message.metadata?.contentBlocks ?? message.metadata?.content_blocks)
                : "");
        return this.boundModelContextHistoryContent(content, message);
    }

    private textFromContentBlocks(value: unknown): string {
        if (!Array.isArray(value)) return "";

        return value
            .flatMap((block) => {
                if (!block || typeof block !== "object" || Array.isArray(block)) return [];
                const record = block as Record<string, unknown>;
                if (record.type !== "text" && record.type !== undefined && record.type !== null) return [];
                const text =
                    this.nonEmptyString(record.text) ??
                    this.nonEmptyString(record.content) ??
                    this.nonEmptyString(record.message);
                return text ? [text] : [];
            })
            .join("\n\n")
            .trim();
    }

    private nonEmptyString(value: unknown): string | undefined {
        return typeof value === "string" && value.trim() ? value : undefined;
    }

    private isPersistedKnowledgeSource(value: unknown): boolean {
        return this.persistedKnowledgeSource(value) !== undefined;
    }

    private persistedKnowledgeSource(value: unknown): KnowledgeSourceReference | undefined {
        if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
        const source = value as Record<string, unknown>;
        const ref = typeof source.ref === "string" ? source.ref.trim() : "";
        const assetId = typeof source.assetId === "string" ? source.assetId.trim() : "";
        const relativePath = this.normalizedPersistedSourcePath(source.relativePath);
        const title = typeof source.title === "string" ? source.title.trim() : "";
        const resource = typeof source.resource === "string" ? source.resource.trim() : "";
        if (
            source.protocolVersion !== 1 ||
            !/^K\d{1,3}$/u.test(ref) ||
            !/^[A-Za-z0-9][A-Za-z0-9._-]{0,239}$/u.test(assetId) ||
            !relativePath ||
            !title ||
            title.length > 240 ||
            /[\p{Cc}\p{Co}]/u.test(title) ||
            resource !== `asset://${assetId}/${relativePath}` ||
            (source.evidence !== "read" && source.evidence !== "search" && source.evidence !== "catalog") ||
            !Array.isArray(source.locators) ||
            source.locators.length > 32 ||
            (source.evidence === "catalog" && source.locators.length > 0)
        ) {
            return undefined;
        }
        const locators: KnowledgeSourceLocator[] = source.locators.flatMap((value): KnowledgeSourceLocator[] => {
            if (!value || typeof value !== "object" || Array.isArray(value)) return [];
            const locator = value as Record<string, unknown>;
            const kind = locator.kind;
            const locatorValue = typeof locator.value === "string" ? locator.value.trim() : "";
            const label = typeof locator.label === "string" ? locator.label.trim() : undefined;
            const sourceChunkMatch = /^source:(.+)#\d+$/u.exec(locatorValue.normalize("NFKC"));
            if (
                (kind !== "record" && kind !== "section" && kind !== "chunk") ||
                !isSafeKnowledgeQueryLocator(locatorValue) ||
                // A source chunk address is never a CSV/table record ID. When
                // persisted as a chunk it must remain bound to this exact
                // public source path; otherwise future history revalidation
                // could turn transport provenance into a fabricated row.
                (sourceChunkMatch !== null &&
                    (kind !== "chunk" || sourceChunkMatch[1]?.normalize("NFC") !== relativePath)) ||
                (label !== undefined && (!label || label.length > 80 || /[\p{Cc}\p{Co}]/u.test(label)))
            ) {
                return [];
            }
            const safeKind: KnowledgeSourceLocator["kind"] = kind;
            return [
                {
                    kind: safeKind,
                    value: locatorValue,
                    ...(label ? { label } : {}),
                },
            ];
        });
        if (locators.length !== source.locators.length) return undefined;
        return {
            protocolVersion: 1,
            ref,
            assetId,
            relativePath,
            title,
            resource,
            evidence: source.evidence,
            locators,
        };
    }

    private normalizedPersistedSourcePath(value: unknown): string | undefined {
        if (typeof value !== "string") return undefined;
        const trimmed = value.trim();
        const normalized = trimmed.normalize("NFC").replace(/\\/gu, "/");
        if (
            !normalized ||
            normalized !== trimmed ||
            normalized.length > 1_024 ||
            /[\p{Cc}\p{Co}]/u.test(normalized) ||
            /[:?#]/u.test(normalized) ||
            /%2e|%2f|%5c/iu.test(normalized) ||
            !isPublicKnowledgeSourcePath(normalized)
        ) {
            return undefined;
        }
        return normalized;
    }

    private boundModelContextHistoryContent(content: string, message: Message): string {
        const originalBytes = Buffer.byteLength(content, "utf8");
        if (originalBytes <= MAX_MODEL_CONTEXT_HISTORY_TEXT_BYTES) return content;

        const artifactUri = `kernel-message://${message.sessionId}/${message.id}`;
        const notice = `\n\n[Runtime history/tool output truncated before model context: originalBytes=${originalBytes}; artifactUri=${artifactUri}; kept=head+tail]\n\n`;
        const noticeBytes = Buffer.byteLength(notice, "utf8");
        const contentBudget = Math.max(0, MAX_MODEL_CONTEXT_HISTORY_TEXT_BYTES - noticeBytes);
        const tailBudget = Math.min(MODEL_CONTEXT_HISTORY_TAIL_BYTES, Math.floor(contentBudget / 2));
        const headBudget = Math.max(0, contentBudget - tailBudget);
        return `${this.takeUtf8Prefix(content, headBudget)}${notice}${this.takeUtf8Suffix(content, tailBudget)}`.trim();
    }

    private takeUtf8Prefix(text: string, maxBytes: number): string {
        if (maxBytes <= 0) return "";
        if (Buffer.byteLength(text, "utf8") <= maxBytes) return text;
        let low = 0;
        let high = text.length;
        while (low < high) {
            const mid = Math.ceil((low + high) / 2);
            if (Buffer.byteLength(text.slice(0, mid), "utf8") <= maxBytes) {
                low = mid;
            } else {
                high = mid - 1;
            }
        }
        return text.slice(0, low);
    }

    private takeUtf8Suffix(text: string, maxBytes: number): string {
        if (maxBytes <= 0) return "";
        if (Buffer.byteLength(text, "utf8") <= maxBytes) return text;
        let low = 0;
        let high = text.length;
        while (low < high) {
            const mid = Math.ceil((low + high) / 2);
            if (Buffer.byteLength(text.slice(text.length - mid), "utf8") <= maxBytes) {
                low = mid;
            } else {
                high = mid - 1;
            }
        }
        return text.slice(text.length - low);
    }
}
