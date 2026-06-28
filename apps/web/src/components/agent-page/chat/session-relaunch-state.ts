export interface SessionRelaunchFeedbackInput {
  relaunching: boolean;
  relaunchError?: string | null;
}

export interface SessionRelaunchFeedback {
  tone: "info" | "error";
  title: string;
  message: string;
  role: "status" | "alert";
  ariaLive: "polite" | "assertive";
}

export function shouldRelaunchSessionBeforeSend(input: {
  sessionState?: string | null;
  hasUserMessage: boolean;
}): boolean {
  return input.sessionState === "exited" && input.hasUserMessage;
}

export function formatSessionRelaunchError(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message.trim();
  if (typeof error === "string" && error.trim()) return error.trim();
  if (typeof error === "object" && error && "message" in error) {
    const message = String((error as { message?: unknown }).message ?? "").trim();
    if (message) return message;
  }
  return "会话重启失败，请检查本地服务连接后重试。";
}

export function resolveSessionRelaunchFeedback(input: SessionRelaunchFeedbackInput): SessionRelaunchFeedback | null {
  if (input.relaunching) {
    return {
      tone: "info",
      title: "正在重启会话",
      message: "正在重新连接本地 sidecar，并恢复这个会话。",
      role: "status",
      ariaLive: "polite",
    };
  }

  const message = input.relaunchError?.trim();
  if (!message) return null;
  return {
    tone: "error",
    title: "会话重启失败",
    message,
    role: "alert",
    ariaLive: "assertive",
  };
}
