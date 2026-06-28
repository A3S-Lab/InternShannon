export type SessionStatusBarConnection = "connecting" | "connected" | "disconnected";

export type MainAgentStatusTone = "idle" | "running" | "connecting" | "disconnected";

export interface MainAgentStatusInput {
  connection?: SessionStatusBarConnection | string;
  status?: string | null;
  activeToolCount: number;
}

export interface MainAgentStatusPresentation {
  label: string;
  tone: MainAgentStatusTone;
}

export type SessionStatusBarActionErrorKind = "model" | "execution-mode";

export const SESSION_PERMISSION_MODES = ["default", "acceptEdits", "plan", "auto", "readOnly"] as const;

export type SessionPermissionMode = (typeof SESSION_PERMISSION_MODES)[number];

export interface SessionStatusBarActionErrorState {
  kind: SessionStatusBarActionErrorKind;
  message: string;
}

export interface SessionStatusBarActionErrorPresentation {
  title: string;
  message: string;
  dismissLabel: string;
}

export interface ModelSwitcherFocusStateInput {
  request: number;
  previousRequest: number;
  showModelSwitcher: boolean;
  hasFocusableModelSwitcher: boolean;
}

export interface ModelSwitcherFocusState {
  shouldFocus: boolean;
  shouldHighlight: boolean;
}

export function resolveMainAgentStatusPresentation(input: MainAgentStatusInput): MainAgentStatusPresentation {
  if (input.connection === "connecting") {
    return { label: "连接中", tone: "connecting" };
  }
  if (input.connection === "disconnected") {
    return { label: "连接已断开", tone: "disconnected" };
  }
  if (input.connection && input.connection !== "connected") {
    return { label: "连接异常", tone: "disconnected" };
  }
  if (input.connection !== "connected") {
    return { label: "等待连接", tone: "connecting" };
  }
  if (input.status === "compacting") {
    return { label: "压缩上下文", tone: "running" };
  }
  if (input.status === "running" && input.activeToolCount > 0) {
    return {
      label: `${input.activeToolCount} 个工具执行中`,
      tone: "running",
    };
  }
  if (input.status === "running") {
    return { label: "模型生成中", tone: "running" };
  }
  return { label: "空闲", tone: "idle" };
}

export function resolveModelSwitcherFocusState(input: ModelSwitcherFocusStateInput): ModelSwitcherFocusState {
  const hasNewRequest = input.request > input.previousRequest;
  if (!hasNewRequest || !input.showModelSwitcher) {
    return {
      shouldFocus: false,
      shouldHighlight: false,
    };
  }

  return {
    shouldFocus: input.hasFocusableModelSwitcher,
    shouldHighlight: true,
  };
}

export function resolveSessionPermissionMode(value: unknown): SessionPermissionMode {
  return SESSION_PERMISSION_MODES.includes(value as SessionPermissionMode)
    ? (value as SessionPermissionMode)
    : "default";
}

export function resolveSessionModelDisplayText(value: unknown): string {
  if (typeof value !== "string") return "默认模型";
  const model = value.trim();
  return model || "默认模型";
}

export function resolveSessionStatusBarActionError(
  error?: SessionStatusBarActionErrorState | null,
): SessionStatusBarActionErrorPresentation | null {
  if (!error) return null;
  const message = error.message.trim();
  if (!message) return null;
  const title = error.kind === "model" ? "模型设置失败" : "执行模式设置失败";
  return {
    title,
    message,
    dismissLabel: `关闭${title}提示`,
  };
}

export function formatSessionStatusBarActionError(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message.trim();
  }
  if (typeof error === "string" && error.trim()) {
    return error.trim();
  }
  if (typeof error === "object" && error && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string" && message.trim()) {
      return message.trim();
    }
  }
  return fallback;
}
