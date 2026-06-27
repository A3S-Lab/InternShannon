import type { AgentEvent, MessageObject } from '@a3s-lab/code';
import { normalizeStreamEvent, parseAgentEventData } from './kernel-stream-event-normalizer';

export function mapAgentEvent(eventType: string, event: AgentEvent): Record<string, unknown> | null {
    if (eventType === 'done') return null;

    const data = parseAgentEventData(event);
    const normalizedEvent = normalizeStreamEvent(eventType, event, data);
    if (normalizedEvent) {
        return {
            type: 'stream_event',
            event: normalizedEvent,
        };
    }
    switch (eventType) {
        case 'error':
            return {
                type: 'error',
                message: (event.error as string) || 'Unknown error',
            };
        default:
            return null;
    }
}

export function extractAssistantTextFromHistory(history: MessageObject[]): string {
    for (let index = history.length - 1; index >= 0; index--) {
        const message = history[index];
        if (message?.role !== 'assistant') continue;
        const text = Array.isArray(message.content)
            ? message.content.map(assistantTextBlock).join('')
            : typeof message.content === 'string'
              ? message.content
              : '';
        if (text.trim()) {
            return text.trim();
        }
    }
    return '';
}

function assistantTextBlock(block: unknown): string {
    if (!block || typeof block !== 'object') return '';
    const record = block as Record<string, unknown>;
    if (record.type !== 'text' && record.type !== undefined && record.type !== null) return '';
    if (typeof record.text === 'string') return record.text;
    if (typeof record.content === 'string') return record.content;
    return '';
}
