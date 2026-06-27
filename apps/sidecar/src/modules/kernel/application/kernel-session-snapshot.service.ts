import { Inject, Injectable } from '@nestjs/common';
import { Message } from '../domain/entities/message.entity';
import { type IKernelService, KERNEL_SERVICE } from '../domain/services/kernel-service.interface';
import type { AssistantContentBlock } from './session-runtime.types';

export interface KernelSessionSnapshot {
    session: KernelSessionSnapshotSummary;
    messages: KernelSessionHistoryMessage[];
}

export interface KernelSessionSnapshotSummary {
    id: string;
    agentId?: string;
    title: string;
    status: string;
    cwd: string;
    model?: string;
    followDefaultModel?: boolean;
    permissionMode?: string;
    assetId?: string;
    agentPhase?: string;
    createdAt: number;
    updatedAt: number;
}

export type KernelSessionHistoryMessage =
    | {
          type: 'user_message';
          id: string;
          content: string;
          timestamp: number;
      }
    | {
          type: 'assistant';
          parentToolUseId: null;
          message: {
              id: string;
              role: 'assistant';
              model: string;
              content: AssistantContentBlock[];
              stopReason: string | null;
              durationMs: number | null;
              meta: null;
              usage: { totalTokens: number } | null;
          };
          timestamp: number;
      }
    | {
          type: 'result';
          data: {
              is_error: true;
              result: string;
          };
          timestamp: number;
      };

@Injectable()
export class KernelSessionSnapshotService {
    constructor(
        @Inject(KERNEL_SERVICE)
        private readonly kernelService: IKernelService,
    ) {}

    async getSnapshot(sessionId: string): Promise<KernelSessionSnapshot | null> {
        const session = await this.kernelService.getSession(sessionId);
        if (!session) {
            return null;
        }

        const messages = await this.kernelService.getSessionMessages(sessionId);
        const summary: KernelSessionSnapshotSummary = {
            id: session.id,
            agentId: session.agentId,
            title: session.title,
            status: session.status,
            cwd: session.cwd,
            createdAt: session.createdAt.getTime(),
            updatedAt: session.updatedAt.getTime(),
        };
        this.assignIfDefined(summary, 'model', this.stringMeta(session.metadata, 'model'));
        this.assignIfDefined(summary, 'followDefaultModel', this.booleanMeta(session.metadata, 'followDefaultModel'));
        this.assignIfDefined(summary, 'permissionMode', this.stringMeta(session.metadata, 'permissionMode'));
        this.assignIfDefined(summary, 'assetId', this.stringMeta(session.metadata, 'assetId'));
        this.assignIfDefined(summary, 'agentPhase', this.stringMeta(session.metadata, 'agentPhase'));

        return {
            session: summary,
            messages: messages.map(m => this.toHistoryMessage(m)).filter(Boolean) as KernelSessionHistoryMessage[],
        };
    }

    private toHistoryMessage(message: Message): KernelSessionHistoryMessage | null {
        const timestamp = message.createdAt.getTime();
        if (message.role === 'system') {
            return null;
        }

        if (message.role === 'user') {
            return {
                type: 'user_message',
                id: message.id,
                content: message.content,
                timestamp,
            };
        }

        if (message.role === 'assistant') {
            const contentBlocks = this.assistantContentBlocksFromMetadata(message);
            return {
                type: 'assistant',
                parentToolUseId: null,
                message: {
                    id: message.id,
                    role: 'assistant',
                    model: typeof message.metadata.model === 'string' ? message.metadata.model : '',
                    content: contentBlocks.length > 0 ? contentBlocks : [{ type: 'text', text: message.content }],
                    stopReason:
                        this.nonEmptyString(message.metadata.stopReason ?? message.metadata.stop_reason) ?? null,
                    durationMs: this.normalizeFiniteNumber(message.metadata.durationMs ?? message.metadata.duration_ms) ?? null,
                    meta: null,
                    usage: this.normalizeUsage(message.metadata),
                },
                timestamp,
            };
        }

        return {
            type: 'result',
            data: {
                is_error: true,
                result: message.content,
            },
            timestamp,
        };
    }

    private assistantContentBlocksFromMetadata(message: Message): AssistantContentBlock[] {
        const blocks = message.metadata?.contentBlocks ?? message.metadata?.content_blocks;
        if (!Array.isArray(blocks)) return [];
        const repaired: AssistantContentBlock[] = [];
        let lastToolUseId: string | null = null;

        for (const [index, block] of blocks.entries()) {
            if (!block || typeof block !== 'object') continue;
            const record = block as Record<string, unknown>;
            if (record.type === 'text' || record.type === undefined || record.type === null) {
                const text =
                    this.nonEmptyString(record.text) ??
                    this.nonEmptyString(record.content) ??
                    this.nonEmptyString(record.message);
                if (text) repaired.push({ type: 'text', text });
                continue;
            }

            if (record.type === 'tool_use') {
                const id =
                    this.nonEmptyTrimmedString(record.id) ??
                    this.nonEmptyTrimmedString(record.toolUseId) ??
                    this.nonEmptyTrimmedString(record.tool_use_id) ??
                    this.nonEmptyTrimmedString(record.toolCallId) ??
                    this.nonEmptyTrimmedString(record.tool_call_id) ??
                    `tool-${index}`;
                lastToolUseId = id;
                repaired.push({
                    type: 'tool_use',
                    id,
                    name: this.nonEmptyTrimmedString(record.name) ?? 'tool',
                    input: this.normalizeFirstToolInput(record.input, record.toolInput, record.tool_input),
                });
                continue;
            }

            if (record.type === 'tool_result') {
                const toolResult: Extract<AssistantContentBlock, { type: 'tool_result' }> = {
                    type: 'tool_result',
                    toolUseId:
                        this.nonEmptyTrimmedString(record.toolUseId) ??
                        this.nonEmptyTrimmedString(record.tool_use_id) ??
                        this.nonEmptyTrimmedString(record.toolCallId) ??
                        this.nonEmptyTrimmedString(record.tool_call_id) ??
                        lastToolUseId ??
                        `tool-${index}`,
                    content: this.normalizeFirstToolResultContent(
                        record.content,
                        record.output,
                        record.toolOutput,
                        record.tool_output,
                        record.result,
                    ),
                    isError: this.normalizeBoolean(record.isError ?? record.is_error),
                };
                const before = this.optionalString(record.before);
                const after = this.optionalString(record.after);
                const filePath = this.optionalString(record.filePath ?? record.file_path);
                if (before !== undefined) toolResult.before = before;
                if (after !== undefined) toolResult.after = after;
                if (filePath !== undefined) toolResult.filePath = filePath;
                repaired.push(toolResult);
            }
        }

        return repaired;
    }

    private nonEmptyString(value: unknown): string | undefined {
        return typeof value === 'string' && value.trim() ? value : undefined;
    }

    private nonEmptyTrimmedString(value: unknown): string | undefined {
        if (typeof value !== 'string') return undefined;
        const trimmed = value.trim();
        return trimmed ? trimmed : undefined;
    }

    private optionalString(value: unknown): string | undefined {
        return typeof value === 'string' ? value : undefined;
    }

    private normalizeBoolean(value: unknown): boolean | undefined {
        if (typeof value === 'boolean') return value;
        if (typeof value !== 'string') return undefined;
        const normalized = value.trim().toLowerCase();
        if (['true', 'yes', '1'].includes(normalized)) return true;
        if (['false', 'no', '0'].includes(normalized)) return false;
        return undefined;
    }

    private normalizeFiniteNumber(value: unknown): number | undefined {
        if (typeof value === 'number' && Number.isFinite(value)) return value;
        if (typeof value !== 'string') return undefined;
        const trimmed = value.trim();
        if (!trimmed) return undefined;
        const parsed = Number(trimmed);
        return Number.isFinite(parsed) ? parsed : undefined;
    }

    private normalizeUsage(metadata: Record<string, unknown>): { totalTokens: number } | null {
        const totalTokens = this.normalizeFiniteNumber(metadata.totalTokens ?? metadata.total_tokens);
        return totalTokens === undefined ? null : { totalTokens };
    }

    private normalizeToolInput(value: unknown): Record<string, unknown> {
        if (value == null) return {};
        if (typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
        if (Array.isArray(value)) return { __display: JSON.stringify(value, null, 2) };
        if (typeof value === 'string') return value.trim() ? { __display: value } : {};
        return { __display: String(value) };
    }

    private normalizeFirstToolInput(...values: unknown[]): Record<string, unknown> {
        for (const value of values) {
            const input = this.normalizeToolInput(value);
            if (Object.keys(input).length > 0) return input;
        }
        return {};
    }

    private normalizeToolResultContent(value: unknown): string {
        if (typeof value === 'string') return value;
        if (Array.isArray(value)) return this.normalizeToolResultContentBlocks(value);
        if (value == null) return '';
        try {
            return JSON.stringify(value, null, 2) ?? '';
        } catch {
            return String(value);
        }
    }

    private normalizeToolResultContentBlocks(blocks: unknown[]): string {
        const text = blocks
            .map(block => {
                if (!block || typeof block !== 'object') return '';
                const record = block as Record<string, unknown>;
                if (record.type === 'text' || record.type === undefined || record.type === null) {
                    return (
                        this.nonEmptyString(record.text) ??
                        this.nonEmptyString(record.content) ??
                        this.nonEmptyString(record.message) ??
                        ''
                    );
                }
                if (record.type === 'tool_result') {
                    return this.normalizeFirstToolResultContent(
                        record.content,
                        record.output,
                        record.toolOutput,
                        record.tool_output,
                        record.result,
                    );
                }
                return '';
            })
            .filter(content => content.trim())
            .join('\n');
        if (text) return text;
        try {
            return JSON.stringify(blocks, null, 2) ?? '';
        } catch {
            return String(blocks);
        }
    }

    private normalizeFirstToolResultContent(...values: unknown[]): string {
        for (const value of values) {
            const content = this.normalizeToolResultContent(value);
            if (content.trim()) return content;
        }
        return '';
    }

    private stringMeta(metadata: Record<string, unknown> | undefined, key: string): string | undefined {
        const value = metadata?.[key];
        return typeof value === 'string' && value.trim() ? value : undefined;
    }

    private booleanMeta(metadata: Record<string, unknown> | undefined, key: string): boolean | undefined {
        const value = metadata?.[key];
        return typeof value === 'boolean' ? value : undefined;
    }

    private assignIfDefined<K extends keyof KernelSessionSnapshotSummary>(
        summary: KernelSessionSnapshotSummary,
        key: K,
        value: KernelSessionSnapshotSummary[K] | undefined,
    ): void {
        if (value !== undefined) {
            summary[key] = value;
        }
    }
}
