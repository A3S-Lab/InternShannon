import type { AgentRuntimeTimelineEvent } from "@/lib/types";

export function normalizeContextCompactActivity(
  event: Record<string, unknown>,
  options: { baseId?: string; timestamp: number },
): AgentRuntimeTimelineEvent {
  const before = normalizeFirstFiniteNumber(event.beforeMessages, event.before_messages, event.before);
  const after = normalizeFirstFiniteNumber(event.afterMessages, event.after_messages, event.after);
  const percentBefore = normalizeFirstFiniteNumber(event.percentBefore, event.percent_before);
  const summary =
    before !== undefined && after !== undefined
      ? `上下文已压缩 ${before} → ${after} 条消息`
      : percentBefore !== undefined
        ? `上下文已压缩至 ${formatPercent(percentBefore)}`
        : "上下文已自动压缩";

  return {
    id: options.baseId || `context_compacted:${options.timestamp}`,
    kind: "main_agent",
    status: "completed",
    phase: "context_compact",
    label: summary,
    detail: normalizeNonEmptyString(event.operation),
    source: "上下文管理",
    timestamp: options.timestamp,
  };
}

function formatPercent(value: number): string {
  const normalized = value > 1 ? value : value * 100;
  const rounded = Math.round(normalized * 10) / 10;
  return Number.isInteger(rounded) ? `${rounded}%` : `${rounded.toFixed(1)}%`;
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
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}
