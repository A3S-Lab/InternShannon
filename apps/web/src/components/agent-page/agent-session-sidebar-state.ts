import { defaultSessionTitle } from "../../lib/session-title.ts";
import type { AgentProcessInfo } from "../../lib/types.ts";
import { stripLeakedInternalReasoning } from "./chat/chat-text-sanitize.ts";

type SessionNameMap = Readonly<Record<string, string | undefined>>;
export type SessionSidebarStatusTone = "active" | "running" | "creating" | "connecting" | "disconnected" | "ended";

export interface SessionSidebarStatusInput {
  sessionState?: string | null;
  sessionStatus?: string | null;
  connectionStatus?: string | null;
}

export interface SessionSidebarStatusPresentation {
  label: string;
  tone: SessionSidebarStatusTone;
}

export interface SessionSidebarActionAvailability {
  canSelect: boolean;
  canRename: boolean;
  canDelete: boolean;
  disabledReason?: string;
}

export interface SessionSidebarCreateErrorPresentation {
  title: string;
  message: string;
  retryLabel: string;
}

export interface SessionSidebarRenameErrorState {
  sessionId: string;
  message: string;
}

export interface SessionSidebarRenameErrorPresentation {
  sessionId: string;
  title: string;
  message: string;
}

export interface SessionSidebarDeleteErrorState {
  sessionId: string;
  message: string;
}

export interface SessionSidebarDeleteErrorPresentation {
  sessionId: string;
  title: string;
  message: string;
}

export type SessionPickerSearchKeyAction = "select-first" | "close" | null;

export interface SessionPickerSearchKeyActionInput {
  key: string;
  metaKey?: boolean;
  ctrlKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
  isComposing?: boolean;
  hasSelectableSession: boolean;
}

export interface SessionSidebarEmptyStateInput {
  totalSessions: number;
  query: string;
}

export interface SessionSidebarEmptyStatePresentation {
  title: string;
  description: string;
  showClearSearch: boolean;
  clearSearchLabel: string;
  createLabel: string;
}

type SessionPreviewRole = "user" | "assistant" | "system";

export const EMPTY_SESSION_PREVIEW = "发送消息开始对话";

type SessionPreviewContentBlock = {
  readonly type?: unknown;
  readonly text?: unknown;
  readonly content?: unknown;
  readonly message?: unknown;
  readonly name?: unknown;
  readonly isError?: unknown;
  readonly is_error?: unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function normalizeRole(value: unknown): SessionPreviewRole | null {
  return value === "user" || value === "assistant" || value === "system" ? value : null;
}

function nonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  return value.trim() ? value : null;
}

function normalizeBoolean(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value;
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().toLowerCase();
  if (normalized === "true" || normalized === "yes" || normalized === "1") return true;
  if (normalized === "false" || normalized === "no" || normalized === "0") return false;
  return undefined;
}

export function compactSessionPreviewText(text: string, maxLength = 72): string {
  const cleaned = stripLeakedInternalReasoning(text).replace(/\s+/g, " ").trim();
  if (!cleaned) return "";
  return cleaned.length > maxLength ? `${cleaned.slice(0, maxLength - 1)}...` : cleaned;
}

function contentBlockPreview(blocks: unknown): string {
  if (!Array.isArray(blocks) || blocks.length === 0) return "";
  const normalizedBlocks = blocks.filter(isRecord) as SessionPreviewContentBlock[];
  const text = normalizedBlocks
    .filter((block) => block.type === "text" || block.type === undefined || block.type === null)
    .map((block) => nonEmptyString(block.text) ?? nonEmptyString(block.content) ?? nonEmptyString(block.message) ?? "")
    .filter(Boolean)
    .join(" ");
  if (text.trim()) return text;

  const toolUse = normalizedBlocks.find((block) => block.type === "tool_use");
  if (toolUse) return `调用工具 ${nonEmptyString(toolUse.name) ?? "tool"}`;

  const toolResult = normalizedBlocks.find((block) => block.type === "tool_result");
  if (toolResult) {
    const isError = normalizeBoolean(toolResult.isError ?? toolResult.is_error) === true;
    return isError ? "工具执行失败" : "工具执行完成";
  }
  return "";
}

function previewTextFromValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return contentBlockPreview(value);
  if (!isRecord(value)) return "";
  if (value.type === "text") {
    return nonEmptyString(value.text) ?? nonEmptyString(value.content) ?? nonEmptyString(value.message) ?? "";
  }
  if (Array.isArray(value.content)) return contentBlockPreview(value.content);
  return nonEmptyString(value.text) ?? nonEmptyString(value.content) ?? nonEmptyString(value.message) ?? "";
}

export function resolveSessionMessagePreview(message: unknown): string {
  if (!isRecord(message)) return "";
  const role = normalizeRole(message.role);
  if (!role || role === "system") return "";

  const rawText =
    previewTextFromValue(message.content) || contentBlockPreview(message.contentBlocks ?? message.content_blocks);
  const text = compactSessionPreviewText(rawText);
  if (!text) return "";
  if (role === "user") return `你: ${text}`;
  if (role === "assistant") return `书小安: ${text}`;
  return text;
}

export function resolveLatestSessionMessagePreview(messages: readonly unknown[] | null | undefined): string {
  if (!Array.isArray(messages)) return "";
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const preview = resolveSessionMessagePreview(messages[index]);
    if (preview) return preview;
  }
  return "";
}

export function resolveSessionSidebarPreview(messages: readonly unknown[] | null | undefined): string {
  return resolveLatestSessionMessagePreview(messages) || EMPTY_SESSION_PREVIEW;
}

export function sessionDisplayName(
  session: Pick<AgentProcessInfo, "sessionId" | "name">,
  sessionNames: SessionNameMap,
): string {
  return sessionNames[session.sessionId] || session.name || defaultSessionTitle(session.sessionId);
}

export function resolveSessionDeleteTarget(input: {
  sessionId: string | null;
  sessions: readonly Readonly<AgentProcessInfo>[];
  sessionNames: SessionNameMap;
}): { sessionId: string; name: string } | null {
  if (!input.sessionId) return null;
  const session = input.sessions.find((item) => item.sessionId === input.sessionId);
  if (!session) return null;
  return {
    sessionId: session.sessionId,
    name: sessionDisplayName(session, input.sessionNames),
  };
}

export function nextSessionSearchQueryAfterCreate(query: string): string {
  return query.trim() ? "" : query;
}

export function resolveSessionSidebarEmptyState(
  input: SessionSidebarEmptyStateInput,
): SessionSidebarEmptyStatePresentation {
  const query = input.query.trim();
  if (input.totalSessions > 0 && query) {
    return {
      title: "没有匹配的会话",
      description: `未找到包含“${query}”的会话。`,
      showClearSearch: true,
      clearSearchLabel: "清空搜索",
      createLabel: "新会话",
    };
  }

  return {
    title: "暂无会话",
    description: "新建一段会话后，书小安会在这里保留最近的上下文。",
    showClearSearch: false,
    clearSearchLabel: "清空搜索",
    createLabel: "新会话",
  };
}

export function resolveSessionSidebarCreateError(
  error: string | null | undefined,
): SessionSidebarCreateErrorPresentation | null {
  const message = error?.trim();
  if (!message) return null;
  return {
    title: "新会话创建失败",
    message,
    retryLabel: "重试",
  };
}

export function formatSessionSidebarActionError(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim()) return error.message;
  if (typeof error === "string" && error.trim()) return error;
  if (typeof error === "object" && error && "message" in error) {
    const message = String((error as { message?: unknown }).message ?? "").trim();
    if (message) return message;
  }
  return fallback;
}

export function resolveSessionSidebarRenameError(
  error: SessionSidebarRenameErrorState | null | undefined,
): SessionSidebarRenameErrorPresentation | null {
  const message = error?.message.trim();
  if (!error?.sessionId || !message) return null;
  return {
    sessionId: error.sessionId,
    title: "重命名失败",
    message,
  };
}

export function resolveSessionSidebarDeleteError(
  error: SessionSidebarDeleteErrorState | null | undefined,
): SessionSidebarDeleteErrorPresentation | null {
  const message = error?.message.trim();
  if (!error?.sessionId || !message) return null;
  return {
    sessionId: error.sessionId,
    title: "删除失败",
    message,
  };
}

export function resolveSessionSidebarActions(
  session: Pick<AgentProcessInfo, "state">,
): SessionSidebarActionAvailability {
  if (session.state === "creating") {
    return {
      canSelect: false,
      canRename: false,
      canDelete: false,
      disabledReason: "会话创建完成后可操作",
    };
  }

  return {
    canSelect: true,
    canRename: true,
    canDelete: true,
  };
}

export function resolveFirstSelectableSessionId(
  sessions: readonly Pick<AgentProcessInfo, "sessionId" | "state">[],
): string | null {
  const firstSelectable = sessions.find((session) => resolveSessionSidebarActions(session).canSelect);
  return firstSelectable?.sessionId ?? null;
}

export function resolveSessionPickerSearchKeyAction(
  input: SessionPickerSearchKeyActionInput,
): SessionPickerSearchKeyAction {
  if (input.isComposing) return null;
  if (input.key === "Escape" && !input.metaKey && !input.ctrlKey && !input.altKey && !input.shiftKey) {
    return "close";
  }
  if (input.key !== "Enter") return null;
  if (input.metaKey || input.ctrlKey || input.altKey || input.shiftKey) return null;
  return input.hasSelectableSession ? "select-first" : null;
}

export function resolveSessionSidebarStatus(input: SessionSidebarStatusInput): SessionSidebarStatusPresentation {
  if (input.sessionState === "creating") {
    return { label: "正在创建...", tone: "creating" };
  }
  if (input.sessionState === "exited") {
    return { label: "已结束", tone: "ended" };
  }
  if (input.sessionStatus === "running") {
    return { label: "正在回复", tone: "running" };
  }
  if (input.sessionStatus === "compacting") {
    return { label: "正在整理上下文", tone: "running" };
  }
  if (input.connectionStatus === "connecting") {
    return { label: "连接中", tone: "connecting" };
  }
  if (input.connectionStatus && input.connectionStatus !== "connected") {
    return { label: "连接已断开", tone: "disconnected" };
  }
  return { label: "在线", tone: "active" };
}

export function sessionSearchHaystack(input: {
  session: Pick<AgentProcessInfo, "sessionId" | "name" | "cwd" | "state">;
  sessionNames: SessionNameMap;
  statusLabel: string;
}): string {
  return [
    sessionDisplayName(input.session, input.sessionNames),
    input.session.sessionId,
    input.session.cwd || "",
    input.session.state || "",
    input.statusLabel,
  ]
    .join(" ")
    .toLowerCase();
}
