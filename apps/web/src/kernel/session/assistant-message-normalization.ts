import type { ContentBlock } from "../../lib/types";
import {
  normalizeHistoryAssistantMessageContentBlocks,
  normalizeHistoryFiniteNumber,
  normalizeHistoryId,
  normalizeHistoryOptionalString,
  normalizeHistoryRecord,
} from "./history-message-normalization.ts";

export interface NormalizedAssistantSocketMessage {
  id: string;
  contentBlocks: ContentBlock[];
  model?: string;
  stopReason: string | null;
  durationMs?: number;
  meta?: Record<string, unknown>;
  usage?: Record<string, unknown>;
}

export function normalizeAssistantSocketMessage(
  value: unknown,
  fallbackId: string,
): NormalizedAssistantSocketMessage | null {
  const message = normalizeHistoryRecord(value);
  if (!message) return null;

  const contentBlocks = normalizeHistoryAssistantMessageContentBlocks(message);

  return {
    id: normalizeHistoryId(message.id, fallbackId),
    contentBlocks,
    model: normalizeHistoryOptionalString(message.model),
    stopReason: normalizeHistoryOptionalString(message.stopReason ?? message.stop_reason) ?? null,
    durationMs: normalizeHistoryFiniteNumber(message.durationMs ?? message.duration_ms),
    meta: normalizeHistoryRecord(message.meta) ?? undefined,
    usage: normalizeHistoryRecord(message.usage) ?? undefined,
  };
}
