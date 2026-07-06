import type { AgentRuntimeTimelineEvent } from "@/lib/types";

export function normalizeStreamStalledActivity(
  event: Record<string, unknown>,
  options: { baseId?: string; timestamp: number },
): AgentRuntimeTimelineEvent {
  const stalledMs = normalizeFirstFiniteNumber(event.stalledMs, event.stalled_ms);
  const type = normalizeFirstNonEmptyString(event.type);
  const activeToolPhase = normalizeFirstNonEmptyString(event.activeToolPhase, event.active_tool_phase);
  const isToolInputWaiting = type === "tool_input_stream_waiting" || activeToolPhase === "tool_input_streaming";
  const activeToolId =
    normalizeFirstNonEmptyString(event.activeToolId, event.active_tool_id) ??
    normalizeFirstNonEmptyString(event.toolId, event.tool_id);
  const activeToolCount =
    normalizeFirstFiniteNumber(event.activeToolCount, event.active_tool_count) ??
    (activeToolId || isToolInputWaiting ? 1 : 0);
  const seconds = stalledMs !== undefined ? Math.round(stalledMs / 1000) : undefined;
  const idPrefix = isToolInputWaiting ? "tool_input_stream_waiting" : "stream_stalled";
  const stalledLabel =
    isToolInputWaiting
      ? seconds !== undefined
        ? `工具参数生成等待中 ${seconds}s`
        : "工具参数生成等待中"
      : activeToolCount > 0
      ? seconds !== undefined
        ? `工具执行已无响应 ${seconds}s`
        : "工具执行可能已无响应"
      : seconds !== undefined
        ? `模型响应等待中 ${seconds}s`
        : "模型响应等待中";

  return {
    id: options.baseId || `${idPrefix}:${activeToolId ?? "n/a"}:${options.timestamp}`,
    kind: activeToolCount > 0 || isToolInputWaiting ? "tool" : "main_agent",
    status: "waiting",
    phase: isToolInputWaiting ? "tool_input_streaming" : "stalled",
    label: stalledLabel,
    detail: isToolInputWaiting
      ? activeToolId
        ? `模型仍在生成工具 ${activeToolId} 的参数`
        : "模型仍在生成工具参数，工具尚未开始执行"
      : activeToolId
        ? `仍在等待工具 ${activeToolId} 返回结果`
        : "模型暂未返回新事件，正在等待…",
    source: "运行时看门狗",
    toolUseId: activeToolId,
    elapsedMs: stalledMs,
    activeToolCount,
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
