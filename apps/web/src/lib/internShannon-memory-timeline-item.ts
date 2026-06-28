import type { AgentChatMessage } from "./types.ts";
import {
  resolveInternShannonMemoryConversationRef,
  type InternShannonMemoryConversationRef,
} from "./internShannon-memory-timeline-conversation.ts";
import type {
  InternShannonMemoryAction,
  InternShannonMemoryLayer,
  InternShannonMemoryTimelineItem,
} from "./internShannon-memory-timeline-record.ts";

export interface InternShannonMemoryTimelineEventInput {
  sessionId: string;
  sessionName?: string;
  event: Record<string, unknown>;
  messages?: readonly AgentChatMessage[];
  now?: number;
}

export const INTERNSHANNON_MEMORY_LAYER_DEFINITIONS: Record<
  InternShannonMemoryLayer,
  { label: string; shortLabel: string; description: string }
> = {
  resource: {
    label: "资源层",
    shortLabel: "资源",
    description: "来自对话、文件和工作区的原始线索。",
  },
  artifact: {
    label: "产物层",
    shortLabel: "产物",
    description: "由资源沉淀出的结构化事实、对象和偏好。",
  },
  insight: {
    label: "洞察层",
    shortLabel: "洞察",
    description: "跨会话综合出的长期目标、习惯和判断。",
  },
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function optionalNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string" || !value.trim()) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function optionalArrayLength(value: unknown): number | undefined {
  return Array.isArray(value) ? value.length : undefined;
}

function truncateText(value: string, maxLength: number): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength - 1)}…` : normalized;
}

function stringifyCompact(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (!value) return "";
  try {
    return JSON.stringify(value);
  } catch {
    return "";
  }
}

function firstText(record: Record<string, unknown>, keys: readonly string[]): string | undefined {
  for (const key of keys) {
    const value = record[key];
    const direct = optionalString(value);
    if (direct) return direct;
    if (Array.isArray(value)) {
      const joined = value.map(stringifyCompact).filter(Boolean).join("；");
      if (joined.trim()) return joined.trim();
    }
    if (isRecord(value)) {
      const nested = firstText(value, ["content", "text", "summary", "detail", "message", "value", "label", "title", "name"]);
      if (nested) return nested;
    }
  }
  return undefined;
}

function eventAction(type: unknown): InternShannonMemoryAction | null {
  if (type === "memory_stored") return "stored";
  if (type === "memory_recalled") return "recalled";
  if (type === "memory_cleared") return "cleared";
  return null;
}

export function resolveInternShannonMemoryLayer(memoryType?: string): InternShannonMemoryLayer {
  const normalized = memoryType?.trim().toLowerCase() ?? "";
  if (
    normalized.includes("insight") ||
    normalized.includes("synthesis") ||
    normalized.includes("preference") ||
    normalized.includes("profile") ||
    normalized.includes("long") ||
    normalized.includes("洞察") ||
    normalized.includes("长期") ||
    normalized.includes("偏好")
  ) {
    return "insight";
  }
  if (
    normalized.includes("artifact") ||
    normalized.includes("fact") ||
    normalized.includes("structured") ||
    normalized.includes("semantic") ||
    normalized.includes("episodic") ||
    normalized.includes("产物") ||
    normalized.includes("事实") ||
    normalized.includes("结构")
  ) {
    return "artifact";
  }
  return "resource";
}

function resolveMemoryResultCount(event: Record<string, unknown>): number | undefined {
  const memory = isRecord(event.memory) ? event.memory : {};
  return (
    optionalNumber(event.resultCount) ??
    optionalNumber(event.result_count) ??
    optionalNumber(memory.resultCount) ??
    optionalNumber(memory.result_count) ??
    optionalArrayLength(event.memories) ??
    optionalArrayLength(memory.memories)
  );
}

function resolveMemoryId(event: Record<string, unknown>): string | undefined {
  const memory = isRecord(event.memory) ? event.memory : {};
  return (
    optionalString(event.memoryId) ??
    optionalString(event.memory_id) ??
    optionalString(event.memoryKey) ??
    optionalString(event.memory_key) ??
    optionalString(event.key) ??
    optionalString(memory.memoryId) ??
    optionalString(memory.memory_id) ??
    optionalString(memory.memoryKey) ??
    optionalString(memory.memory_key) ??
    optionalString(memory.key) ??
    optionalString(memory.id)
  );
}

function resolveMemoryType(event: Record<string, unknown>): string | undefined {
  const memory = isRecord(event.memory) ? event.memory : {};
  return (
    optionalString(event.memoryType) ??
    optionalString(event.memory_type) ??
    optionalString(event.typeLabel) ??
    optionalString(event.type_label) ??
    optionalString(event.layer) ??
    optionalString(memory.memoryType) ??
    optionalString(memory.memory_type) ??
    optionalString(memory.typeLabel) ??
    optionalString(memory.type_label) ??
    optionalString(memory.type) ??
    optionalString(memory.kind) ??
    optionalString(memory.layer)
  );
}

function resolveMemoryImportance(event: Record<string, unknown>): number | undefined {
  const memory = isRecord(event.memory) ? event.memory : {};
  return optionalNumber(event.importance) ?? optionalNumber(memory.importance);
}

function resolveMemoryRelevance(event: Record<string, unknown>): number | undefined {
  const memory = isRecord(event.memory) ? event.memory : {};
  return optionalNumber(event.relevance) ?? optionalNumber(memory.relevance);
}

function extractMemoryContent(event: Record<string, unknown>, action: InternShannonMemoryAction): string {
  const direct = firstText(event, [
    "content",
    "summary",
    "text",
    "detail",
    "message",
    "memory",
    "value",
    ...(action === "stored" ? ["key", "memoryKey", "memory_key", "memoryId", "memory_id"] : []),
  ]);
  if (direct) return truncateText(direct, 360);

  const resultCount = resolveMemoryResultCount(event);
  if (action === "recalled" && resultCount !== undefined) return `召回了 ${resultCount} 条相关记忆`;
  if (action === "recalled") return "召回了一条相关记忆";
  if (action === "cleared") return "清理了一条记忆";
  return "记录了一条记忆要点";
}

function nextItemId(timestamp: number): string {
  const random =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2, 10);
  return `internShannon-memory-${timestamp}-${random}`;
}

export function createInternShannonMemoryTimelineItem(input: InternShannonMemoryTimelineEventInput): InternShannonMemoryTimelineItem | null {
  const action = eventAction(input.event.type);
  if (!action) return null;
  const timestamp = input.now ?? optionalNumber(input.event.timestamp) ?? Date.now();
  const sessionId = input.sessionId.trim();
  const memoryType = resolveMemoryType(input.event);
  const content = extractMemoryContent(input.event, action);
  return {
    id: nextItemId(timestamp),
    sessionId,
    memoryId: resolveMemoryId(input.event),
    memoryType,
    layer: resolveInternShannonMemoryLayer(memoryType),
    action,
    content,
    originalContent: content,
    importance: resolveMemoryImportance(input.event),
    relevance: resolveMemoryRelevance(input.event),
    resultCount: resolveMemoryResultCount(input.event),
    conversation: resolveInternShannonMemoryConversationRef({
      sessionId,
      sessionName: input.sessionName,
      messages: input.messages,
      timestamp,
    }),
    createdAt: timestamp,
  };
}

export type { InternShannonMemoryConversationRef };
