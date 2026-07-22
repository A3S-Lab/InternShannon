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
  const localizedReason = localizeToolErrorReason(reason, toolName);
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
    detail:
      consecutive !== undefined && consecutive > 1
        ? `${localizedReason.detail}（同工具连续失败 ${consecutive} 次）`
        : localizedReason.detail,
    diagnosticDetail: localizedReason.diagnosticDetail,
    source: "工具运行器",
    toolUseId,
    toolName,
    elapsedMs: durationMs,
    timestamp: options.timestamp,
  };
}

function localizeToolErrorReason(reason: string, toolName?: string): { detail: string; diagnosticDetail?: string } {
  if (/[^\x00-\x7F]/.test(reason)) return { detail: reason };
  const normalized = reason.toLowerCase();
  let detail: string;
  if (/permission denied|not permitted|access denied/.test(normalized)) {
    detail = "操作被拒绝：权限不足";
  } else if (/no (?:search )?results?|web search returned no results/.test(normalized)) {
    detail = "未找到搜索结果，请调整关键词或稍后重试";
  } else if (/timed? out|timeout/.test(normalized)) {
    detail = toolName === "web_search" ? "搜索服务响应超时，请检查网络或搜索引擎设置" : "工具响应超时，请稍后重试";
  } else if (/econnrefused|connection refused|failed to fetch|network error/.test(normalized)) {
    detail = "连接失败，请检查网络或服务配置";
  } else if (/browser binary|lightpanda|chrome executable/.test(normalized)) {
    detail = "搜索浏览器不可用，请先在搜索设置中安装或配置浏览器";
  } else if (/exited with (?:code|status)/.test(normalized)) {
    const code = reason.match(/(?:code|status)\s+([^\s]+)/i)?.[1];
    detail = `命令执行失败${code ? `（退出码 ${code}）` : ""}`;
  } else {
    detail = "工具执行失败，请展开查看诊断详情";
  }
  return { detail, diagnosticDetail: reason };
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
