import type { AgentSessionState } from "../../lib/types";

export interface NormalizedResultMessage {
  sessionPatch: Partial<AgentSessionState>;
  isError: boolean;
  errorContent: string;
  runStatus?: AgentSessionState["lastRunStatus"];
  stopReason?: string | null;
  retryable?: boolean;
  shouldAppendErrorMessage?: false;
}

const RESULT_NUMBER_FIELDS = [
  ["totalCostUsd", "totalCostUsd", "total_cost_usd"],
  ["numTurns", "numTurns", "num_turns"],
  ["totalLinesAdded", "totalLinesAdded", "total_lines_added"],
  ["totalLinesRemoved", "totalLinesRemoved", "total_lines_removed"],
  ["contextUsedPercent", "contextUsedPercent", "context_used_percent"],
  ["inputTokens", "inputTokens", "input_tokens"],
  ["outputTokens", "outputTokens", "output_tokens"],
  ["cacheReadTokens", "cacheReadTokens", "cache_read_tokens"],
  ["cacheWriteTokens", "cacheWriteTokens", "cache_write_tokens"],
] as const;

export function normalizeResultMessageData(value: unknown): NormalizedResultMessage {
  if (!isRecord(value)) {
    return {
      sessionPatch: {},
      isError: false,
      errorContent: "An error occurred",
    };
  }

  const sessionPatch: Partial<AgentSessionState> = {};
  for (const [field, ...keys] of RESULT_NUMBER_FIELDS) {
    const numberValue = normalizeNumberField(value, keys);
    if (numberValue !== undefined) {
      sessionPatch[field] = numberValue;
    }
  }
  const lastRunDurationMs = normalizeNumberField(value, ["durationMs", "duration_ms"]);
  const lastRunTotalTokens = normalizeNumberField(value, ["totalTokens", "total_tokens"]);
  const lastRunToolCalls = normalizeNumberField(value, ["toolCalls", "tool_calls"]);
  const lastRunActiveToolCount = normalizeNumberField(value, ["activeToolCount", "active_tool_count"]);
  const lastRunOpenPlanTasks = normalizeNumberField(value, ["openPlanTasks", "open_plan_tasks"]);
  if (lastRunDurationMs !== undefined) sessionPatch.lastRunDurationMs = lastRunDurationMs;
  if (lastRunTotalTokens !== undefined) sessionPatch.lastRunTotalTokens = lastRunTotalTokens;
  if (lastRunToolCalls !== undefined) sessionPatch.lastRunToolCalls = lastRunToolCalls;
  if (lastRunActiveToolCount !== undefined) sessionPatch.lastRunActiveToolCount = lastRunActiveToolCount;
  if (lastRunOpenPlanTasks !== undefined) sessionPatch.lastRunOpenPlanTasks = lastRunOpenPlanTasks;

  const runStatus = normalizeRunStatus(value.status ?? value.runStatus ?? value.run_status);
  if (runStatus) sessionPatch.lastRunStatus = runStatus;
  const stopReason = normalizeOptionalString(value.stopReason ?? value.stop_reason);
  if (stopReason !== undefined) sessionPatch.lastStopReason = stopReason;
  const retryable = normalizeOptionalBoolean(value.retryable);
  if (retryable !== undefined) sessionPatch.lastRunRetryable = retryable;

  const normalized: NormalizedResultMessage = {
    sessionPatch,
    isError: normalizeBoolean(value.isError ?? value.is_error),
    errorContent: normalizeFirstResultText(value.result, value.error, value.message) || "An error occurred",
  };
  if (
    runStatus === "incomplete" &&
    stopReason === "sdk_stream_ended_without_stop_reason" &&
    lastRunOpenPlanTasks === 0 &&
    (lastRunActiveToolCount === 0 || (lastRunActiveToolCount === undefined && lastRunToolCalls === 0))
  ) {
    normalized.shouldAppendErrorMessage = false;
  }
  if (runStatus) normalized.runStatus = runStatus;
  if (stopReason !== undefined) normalized.stopReason = stopReason;
  if (retryable !== undefined) normalized.retryable = retryable;
  return normalized;
}

function normalizeNumberField(record: Record<string, unknown>, keys: readonly string[]): number | undefined {
  for (const key of keys) {
    const value = normalizeFiniteNumber(record[key]);
    if (value !== undefined) return value;
  }
  return undefined;
}

function normalizeFiniteNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function normalizeBoolean(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value !== "string") return false;
  const normalized = value.trim().toLowerCase();
  return normalized === "true" || normalized === "yes" || normalized === "1";
}

function normalizeOptionalBoolean(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value;
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().toLowerCase();
  if (normalized === "true" || normalized === "yes" || normalized === "1") return true;
  if (normalized === "false" || normalized === "no" || normalized === "0") return false;
  return undefined;
}

function normalizeOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function normalizeRunStatus(value: unknown): AgentSessionState["lastRunStatus"] | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().toLowerCase();
  if (
    normalized === "succeeded" ||
    normalized === "incomplete" ||
    normalized === "failed" ||
    normalized === "cancelled"
  ) {
    return normalized;
  }
  if (normalized === "canceled") return "cancelled";
  return undefined;
}

function normalizeResultText(value: unknown): string {
  if (typeof value === "string") return value;
  if (value == null) return "";
  try {
    return JSON.stringify(value, null, 2) ?? "";
  } catch {
    return String(value);
  }
}

function normalizeFirstResultText(...values: unknown[]): string {
  for (const value of values) {
    const text = normalizeResultText(value);
    if (text.trim()) return text;
  }
  return "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
