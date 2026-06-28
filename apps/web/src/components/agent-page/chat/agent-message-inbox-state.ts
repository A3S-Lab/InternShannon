import type { AgentMessage } from "../../../lib/types";

export type AgentMessageExecuteAction = "remove" | "show_manual" | "keep";

export interface AgentMessageExecuteActionInput {
  sent: boolean;
  autoExecute: boolean;
}

export interface AgentMessageExecuteFeedbackInput {
  executing: boolean;
  executionError?: string | null;
}

export interface AgentMessageExecuteFeedback {
  tone: "info" | "error";
  title: string;
  message: string;
  role: "status" | "alert";
  ariaLive: "polite" | "assertive";
}

const UNKNOWN_AGENT_MESSAGE_SOURCE_ID = "unknown";

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function nonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function normalizeAgentMessageBoolean(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value !== "string") return false;
  return value.trim().toLowerCase() === "true";
}

export function normalizeAgentInboxMessages(value: unknown): AgentMessage[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!isRecord(item)) return [];
    const messageId = nonEmptyString(item.messageId) ?? nonEmptyString(item.message_id);
    const content = nonEmptyString(item.content) ?? nonEmptyString(item.text) ?? nonEmptyString(item.message);
    if (!messageId || !content) return [];

    const message: AgentMessage = {
      messageId,
      fromSessionId:
        nonEmptyString(item.fromSessionId) ?? nonEmptyString(item.from_session_id) ?? UNKNOWN_AGENT_MESSAGE_SOURCE_ID,
      topic: nonEmptyString(item.topic) ?? "Agent 消息",
      content,
      autoExecute: normalizeAgentMessageBoolean(item.autoExecute ?? item.auto_execute),
    };

    const executionError = nonEmptyString(item.executionError ?? item.execution_error);
    if (executionError) {
      message.executionError = executionError;
    }

    return [message];
  });
}

export function formatAgentMessageSourceLabel(fromSessionId: string): string {
  const sourceId = nonEmptyString(fromSessionId);
  if (!sourceId || sourceId === UNKNOWN_AGENT_MESSAGE_SOURCE_ID) return "未知会话";
  return `${sourceId.slice(0, 8)}…`;
}

export function resolveAgentMessageExecuteAction(input: AgentMessageExecuteActionInput): AgentMessageExecuteAction {
  if (input.sent) return "remove";
  return input.autoExecute ? "show_manual" : "keep";
}

export function formatAgentMessageExecuteError(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim()) return error.message.trim();
  if (typeof error === "string" && error.trim()) return error.trim();
  if (typeof error === "object" && error && "message" in error) {
    const message = String((error as { message?: unknown }).message ?? "").trim();
    if (message) return message;
  }
  return fallback;
}

export function resolveAgentMessageExecuteFeedback(
  input: AgentMessageExecuteFeedbackInput,
): AgentMessageExecuteFeedback | null {
  if (input.executing) {
    return {
      tone: "info",
      title: "正在发送",
      message: "正在把这条 Agent 消息发送到当前会话。",
      role: "status",
      ariaLive: "polite",
    };
  }

  const message = input.executionError?.trim();
  if (!message) return null;
  return {
    tone: "error",
    title: "执行失败",
    message,
    role: "alert",
    ariaLive: "assertive",
  };
}
