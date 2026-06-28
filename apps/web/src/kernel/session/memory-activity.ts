import type { AgentRuntimeTimelineEvent } from "@/lib/types";

export function normalizeMemoryActivity(
  event: Record<string, unknown>,
  options: { baseId?: string; timestamp: number },
): AgentRuntimeTimelineEvent | null {
  const type = event.type;
  if (type !== "memory_stored" && type !== "memory_recalled" && type !== "memory_cleared") return null;

  const memory = isRecord(event.memory) ? event.memory : {};
  const action = type === "memory_stored" ? "记忆已写入" : type === "memory_recalled" ? "记忆已召回" : "记忆已清空";
  const memoryType = normalizeFirstNonEmptyString(
    event.memoryType,
    event.memory_type,
    event.typeLabel,
    event.type_label,
    event.layer,
    memory.memoryType,
    memory.memory_type,
    memory.typeLabel,
    memory.type_label,
    memory.type,
    memory.kind,
    memory.layer,
  );
  const resultCount =
    normalizeFirstFiniteNumber(event.resultCount, event.result_count, memory.resultCount, memory.result_count) ??
    (type === "memory_recalled"
      ? normalizeArrayLength(event.memories) ?? normalizeArrayLength(memory.memories)
      : undefined);
  const displayDetail =
    normalizeNonEmptyString(event.detail) ??
    normalizeNonEmptyString(event.content) ??
    normalizeNonEmptyString(event.summary) ??
    normalizeNonEmptyString(event.text) ??
    normalizeNonEmptyString(event.message) ??
    normalizeNonEmptyString(event.memory) ??
    normalizeNonEmptyString(event.value) ??
    normalizeNonEmptyString(memory.detail) ??
    normalizeNonEmptyString(memory.content) ??
    normalizeNonEmptyString(memory.summary) ??
    normalizeNonEmptyString(memory.text) ??
    normalizeNonEmptyString(memory.message) ??
    normalizeNonEmptyString(memory.label) ??
    normalizeNonEmptyString(memory.title) ??
    normalizeNonEmptyString(memory.name) ??
    normalizeNonEmptyString(memory.value) ??
    (type === "memory_stored"
      ? normalizeNonEmptyString(event.key) ??
        normalizeNonEmptyString(event.memoryKey) ??
        normalizeNonEmptyString(event.memory_key) ??
        normalizeNonEmptyString(memory.key) ??
        normalizeNonEmptyString(memory.memoryKey) ??
        normalizeNonEmptyString(memory.memory_key)
      : undefined);

  return {
    id: options.baseId || `${type}:${options.timestamp}`,
    kind: "main_agent",
    status: "completed",
    phase: type,
    label: memoryType ? `${action}（${memoryType}）` : action,
    detail: displayDetail ?? (resultCount !== undefined ? `结果数：${resultCount}` : undefined),
    source: "记忆系统",
    timestamp: options.timestamp,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeArrayLength(value: unknown): number | undefined {
  return Array.isArray(value) ? value.length : undefined;
}

function normalizeFiniteNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function normalizeFirstFiniteNumber(...values: unknown[]): number | undefined {
  for (const value of values) {
    const normalized = normalizeFiniteNumber(value);
    if (normalized !== undefined) return normalized;
  }
  return undefined;
}

function normalizeNonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function normalizeFirstNonEmptyString(...values: unknown[]): string | undefined {
  for (const value of values) {
    const normalized = normalizeNonEmptyString(value);
    if (normalized) return normalized;
  }
  return undefined;
}
