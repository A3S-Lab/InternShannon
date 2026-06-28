import type { InternShannonMemoryConversationRef } from "./internShannon-memory-timeline-conversation.ts";

export type InternShannonMemoryLayer = "resource" | "artifact" | "insight";
export type InternShannonMemoryAction = "stored" | "recalled" | "cleared";

/**
 * Where a timeline entry came from:
 * - `local` (default): a live localStorage event recorded by this browser during a run — editable/deletable.
 * - `server`: hydrated from the durable, user-scoped kernel memory base (cross-device, prior sessions) —
 *   read-only, since no edit/delete endpoint exists for server memories.
 */
export type InternShannonMemoryOrigin = "local" | "server";

export interface InternShannonMemoryTimelineItem {
  id: string;
  sessionId: string;
  memoryId?: string;
  memoryType?: string;
  layer: InternShannonMemoryLayer;
  action: InternShannonMemoryAction;
  content: string;
  originalContent: string;
  importance?: number;
  relevance?: number;
  resultCount?: number;
  conversation: InternShannonMemoryConversationRef;
  createdAt: number;
  updatedAt?: number;
  deletedAt?: number;
  /** Provenance. Absent on legacy local entries → treated as `local`. */
  origin?: InternShannonMemoryOrigin;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isMemoryConversationRef(value: unknown): value is InternShannonMemoryConversationRef {
  if (!isRecord(value)) return false;
  return typeof value.sessionId === "string";
}

export function isInternShannonMemoryTimelineItem(value: unknown): value is InternShannonMemoryTimelineItem {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const item = value as Partial<InternShannonMemoryTimelineItem>;
  return (
    typeof item.id === "string" &&
    typeof item.sessionId === "string" &&
    (item.layer === "resource" || item.layer === "artifact" || item.layer === "insight") &&
    (item.action === "stored" || item.action === "recalled" || item.action === "cleared") &&
    typeof item.content === "string" &&
    typeof item.originalContent === "string" &&
    typeof item.createdAt === "number" &&
    isMemoryConversationRef(item.conversation)
  );
}

function optionalTimestamp(record: Record<string, unknown>, ...keys: string[]): number | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim()) {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return undefined;
}

function optionalString(record: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

function optionalNumber(record: Record<string, unknown>, ...keys: string[]): number | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim()) {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return undefined;
}

function normalizeInternShannonMemoryConversationRef(value: unknown): Record<string, unknown> | undefined {
  if (!isRecord(value)) return undefined;
  const {
    sessionId: _sessionId,
    sessionName: _sessionName,
    messageId: _messageId,
    timestamp: _timestamp,
    session_id: _sessionIdAlias,
    session_name: _sessionNameAlias,
    message_id: _messageIdAlias,
    ...rest
  } = value;
  const conversation = { ...rest };
  const sessionId = optionalString(value, "sessionId", "session_id");
  const sessionName = optionalString(value, "sessionName", "session_name");
  const messageId = optionalString(value, "messageId", "message_id");
  const timestamp = optionalTimestamp(value, "timestamp");
  if (sessionId !== undefined) conversation.sessionId = sessionId;
  if (sessionName !== undefined) conversation.sessionName = sessionName;
  if (messageId !== undefined) conversation.messageId = messageId;
  if (timestamp !== undefined) conversation.timestamp = timestamp;
  return conversation;
}

function normalizeInternShannonMemoryTimelineItem(value: unknown): InternShannonMemoryTimelineItem | null {
  if (!isRecord(value)) return null;
  const conversation = normalizeInternShannonMemoryConversationRef(value.conversation);
  const candidate = {
    ...value,
    sessionId: optionalString(value, "sessionId", "session_id") ?? conversation?.sessionId,
    createdAt: optionalTimestamp(value, "createdAt", "created_at"),
    memoryId: optionalString(value, "memoryId", "memory_id", "memoryKey", "memory_key"),
    memoryType: optionalString(value, "memoryType", "memory_type", "typeLabel", "type_label"),
    originalContent:
      optionalString(value, "originalContent", "original_content") ??
      (typeof value.content === "string" ? value.content : undefined),
    importance: optionalNumber(value, "importance"),
    relevance: optionalNumber(value, "relevance"),
    resultCount: optionalNumber(value, "resultCount", "result_count"),
    conversation,
  };
  if (!isInternShannonMemoryTimelineItem(candidate)) return null;
  const record = candidate as Record<string, unknown>;
  return {
    ...candidate,
    updatedAt: optionalTimestamp(record, "updatedAt", "updated_at"),
    deletedAt: optionalTimestamp(record, "deletedAt", "deleted_at"),
  };
}

export function normalizeInternShannonMemoryTimelineItems(value: unknown): InternShannonMemoryTimelineItem[] {
  return (Array.isArray(value) ? value : [])
    .map(normalizeInternShannonMemoryTimelineItem)
    .filter((item): item is InternShannonMemoryTimelineItem => Boolean(item))
    .sort((left, right) => right.createdAt - left.createdAt);
}
