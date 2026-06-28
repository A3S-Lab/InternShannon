import type { AgentRuntimeTimelineEvent } from "@/lib/types";

export function normalizeToolErrorActivity(
  event: Record<string, unknown>,
  options: { baseId?: string; timestamp: number },
): AgentRuntimeTimelineEvent {
  const toolName = normalizeFirstNonEmptyString(event.toolName, event.tool_name);
  const toolUseId = normalizeFirstNonEmptyString(event.toolId, event.tool_id, event.toolUseId, event.tool_use_id);
  const reason =
    normalizeNonEmptyString(event.reason) ??
    normalizeNonEmptyString(event.message) ??
    normalizeNonEmptyString(event.detail) ??
    "工具执行失败";
  const durationMs = normalizeFirstFiniteNumber(event.durationMs, event.duration_ms);
  const consecutive = normalizeFirstFiniteNumber(event.consecutiveFailures, event.consecutive_failures);
  const labelTool = toolName ?? "工具";
  const seconds = durationMs !== undefined ? Math.round(durationMs / 1000) : undefined;
  const labelSuffix = seconds !== undefined ? ` （${seconds}s 后失败）` : "";

  return {
    id: options.baseId || `tool_error:${toolUseId ?? labelTool}:${options.timestamp}`,
    kind: "tool",
    status: "failed",
    phase: "tool_error",
    label: `工具失败：${labelTool}${labelSuffix}`,
    detail: consecutive !== undefined && consecutive > 1 ? `${reason}（同工具连续失败 ${consecutive} 次）` : reason,
    source: "工具运行器",
    toolUseId,
    toolName,
    elapsedMs: durationMs,
    timestamp: options.timestamp,
  };
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

function normalizeFirstNonEmptyString(...values: unknown[]): string | undefined {
  for (const value of values) {
    const normalized = normalizeNonEmptyString(value);
    if (normalized) return normalized;
  }
  return undefined;
}
