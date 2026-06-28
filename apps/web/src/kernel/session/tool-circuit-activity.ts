import type { AgentRuntimeTimelineEvent } from "@/lib/types";

export function normalizeToolCircuitActivity(
  event: Record<string, unknown>,
  options: { baseId?: string; timestamp: number },
): AgentRuntimeTimelineEvent {
  const toolName =
    normalizeFirstNonEmptyString(event.toolName, event.tool_name) ??
    normalizeFirstNonEmptyString(event.toolId, event.tool_id) ??
    "工具";
  const consecutive = normalizeFirstFiniteNumber(event.consecutiveFailures, event.consecutive_failures);
  const detail =
    consecutive !== undefined
      ? `${toolName} 连续失败 ${consecutive} 次，运行时已熔断本轮以避免空转`
      : `${toolName} 反复失败，运行时已熔断本轮以避免空转`;

  return {
    id: options.baseId || `tool_circuit_open:${toolName}:${options.timestamp}`,
    kind: "tool",
    status: "failed",
    phase: "circuit_open",
    label: `工具熔断：${toolName}`,
    detail,
    source: "工具运行器",
    toolName,
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
