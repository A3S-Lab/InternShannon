import type { AgentMessage } from "../../lib/types";
import type { ToolConfirmationRequest } from "../../lib/socket-types";
import type { AuthStatus, ToolProgress } from "../../models/agent.model";

const UNKNOWN_AGENT_MESSAGE_SOURCE_ID = "unknown";

export function normalizeSocketText(value: unknown, fallback = ""): string {
  const text = stringifySocketText(value);
  return text.trim() ? text : fallback;
}

export function normalizeSocketOptionalText(value: unknown): string | undefined {
  const text = normalizeSocketText(value);
  return text.trim() ? text : undefined;
}

export function normalizeSocketBoolean(value: unknown, fallback = false): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value !== "string") return fallback;
  const normalized = value.trim().toLowerCase();
  if (["true", "yes", "1"].includes(normalized)) return true;
  if (["false", "no", "0"].includes(normalized)) return false;
  return fallback;
}

export function normalizeSocketTimestamp(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value > 0 && value < 1e12 ? value * 1000 : value;
  }
  if (typeof value === "string" && value.trim()) {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) {
      return numeric > 0 && numeric < 1e12 ? numeric * 1000 : numeric;
    }
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

export function normalizeAgentMessageSocketPayload(value: unknown, fallbackId: string): AgentMessage | null {
  if (!isRecord(value)) return null;
  const content = normalizeSocketFirstText(value.content, value.text, value.message);
  if (!content) return null;

  const message: AgentMessage = {
    messageId: normalizeSocketIdentifier(value.messageId ?? value.message_id, fallbackId),
    fromSessionId: normalizeSocketIdentifier(
      value.fromSessionId ?? value.from_session_id,
      UNKNOWN_AGENT_MESSAGE_SOURCE_ID,
    ),
    topic: normalizeSocketText(value.topic, "Agent 消息"),
    content,
    autoExecute: normalizeSocketBoolean(value.autoExecute ?? value.auto_execute),
  };

  const executionError = normalizeSocketOptionalText(value.executionError ?? value.execution_error);
  if (executionError) {
    message.executionError = executionError;
  }

  return message;
}

export function normalizeToolConfirmationSocketPayload(
  value: unknown,
  fallbackSessionId: string,
  fallbackRequestId: string,
): ToolConfirmationRequest | null {
  if (!isRecord(value)) return null;
  const toolName = normalizeSocketFirstText(value.toolName, value.tool_name, value.name, value.tool) || "tool";

  return {
    requestId: normalizeSocketFirstIdentifier([value.requestId, value.request_id], fallbackRequestId),
    sessionId: normalizeSocketFirstIdentifier([value.sessionId, value.session_id], fallbackSessionId),
    toolName,
    toolInput: normalizeSocketFirstRecord(value.toolInput, value.tool_input, value.input),
    timestamp: normalizeSocketTimestamp(value.timestamp, Date.now()),
  };
}

export function normalizeAuthStatusSocketPayload(value: unknown): AuthStatus | null {
  if (!isRecord(value)) return null;
  return {
    isAuthenticating: normalizeSocketBoolean(value.isAuthenticating ?? value.is_authenticating),
    output: normalizeSocketFirstTextArray(value.output, value.outputs, value.logs),
    error: normalizeSocketOptionalText(value.error),
  };
}

export function normalizeToolProgressSocketPayload(value: unknown): (ToolProgress & { seq?: number }) | null {
  if (!isRecord(value)) return null;
  const toolName = normalizeSocketFirstText(value.toolName, value.tool_name, value.name, value.tool);
  if (!toolName) return null;

  const progress: ToolProgress & { seq?: number } = {
    toolUseId: normalizeSocketFirstText(
      value.toolUseId,
      value.tool_use_id,
      value.toolId,
      value.tool_id,
      value.toolCallId,
      value.tool_call_id,
      value.id,
    ),
    toolName,
    elapsedTimeSeconds: normalizeSocketElapsedTimeSeconds(value),
  };

  const input = normalizeSocketFirstOptionalText(value.input, value.toolInput, value.tool_input);
  const output = normalizeSocketFirstOptionalText(value.output, value.toolOutput, value.tool_output, value.result);
  const seq = normalizeSocketOptionalInteger(value.seq);
  if (input !== undefined) progress.input = input;
  if (output !== undefined) progress.output = output;
  if (seq !== undefined) progress.seq = seq;

  return progress;
}

function stringifySocketText(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "";
  if (typeof value === "boolean" || typeof value === "bigint") return String(value);
  if (value == null) return "";
  if (isRecord(value)) {
    const nestedMessage = normalizeNestedMessageText(value);
    if (nestedMessage) return nestedMessage;
  }
  try {
    return JSON.stringify(value, null, 2) ?? "";
  } catch {
    return String(value);
  }
}

function normalizeNestedMessageText(value: Record<string, unknown>): string | null {
  const message = value.message ?? value.error ?? value.reason ?? value.detail;
  return typeof message === "string" && message.trim() ? message : null;
}

function normalizeSocketIdentifier(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback;
  const trimmed = value.trim();
  return trimmed ? trimmed : fallback;
}

function normalizeSocketFirstIdentifier(values: unknown[], fallback: string): string {
  for (const value of values) {
    const normalized = normalizeSocketIdentifier(value, "");
    if (normalized) return normalized;
  }
  return fallback;
}

function normalizeSocketFirstText(...values: unknown[]): string {
  for (const value of values) {
    const text = normalizeSocketText(value).trim();
    if (text) return text;
  }
  return "";
}

function normalizeSocketFirstOptionalText(...values: unknown[]): string | undefined {
  const text = normalizeSocketFirstText(...values);
  return text || undefined;
}

function normalizeSocketTextArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((item) => {
      const text = normalizeSocketText(item).trim();
      return text ? [text] : [];
    });
  }
  const text = normalizeSocketText(value).trim();
  return text ? [text] : [];
}

function normalizeSocketFirstTextArray(...values: unknown[]): string[] {
  for (const value of values) {
    const texts = normalizeSocketTextArray(value);
    if (texts.length > 0) return texts;
  }
  return [];
}

function normalizeSocketFiniteNumber(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function normalizeSocketElapsedTimeSeconds(value: Record<string, unknown>): number {
  const seconds = normalizeSocketFirstFiniteNumber([value.elapsedTimeSeconds, value.elapsed_time_seconds]);
  if (Number.isFinite(seconds)) return seconds;
  const milliseconds = normalizeSocketFirstFiniteNumber([value.elapsedMs, value.elapsed_ms]);
  return Number.isFinite(milliseconds) ? milliseconds / 1_000 : 0;
}

function normalizeSocketFirstFiniteNumber(values: unknown[]): number {
  for (const value of values) {
    const normalized = normalizeSocketFiniteNumber(value, Number.NaN);
    if (Number.isFinite(normalized)) return normalized;
  }
  return Number.NaN;
}

function normalizeSocketOptionalInteger(value: unknown): number | undefined {
  const parsed = normalizeSocketFiniteNumber(value, Number.NaN);
  return Number.isFinite(parsed) ? Math.max(1, Math.floor(parsed)) : undefined;
}

function normalizeSocketFirstRecord(...values: unknown[]): Record<string, unknown> {
  for (const value of values) {
    if (value == null) continue;
    if (typeof value === "string" && !value.trim()) continue;
    return normalizeSocketRecord(value);
  }
  return {};
}

function normalizeSocketRecord(value: unknown): Record<string, unknown> {
  if (isRecord(value)) return value;
  if (value == null) return {};
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return {};
    try {
      const parsed = JSON.parse(trimmed);
      if (isRecord(parsed)) return parsed;
      return { __display: parsed };
    } catch {
      return { __display: value };
    }
  }
  if (Array.isArray(value)) return { __display: value };
  return { __display: value };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
