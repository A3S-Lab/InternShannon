export type SearchSaveStatusKind = "idle" | "saving" | "saved" | "error";

export interface SearchSaveStatus {
  kind: SearchSaveStatusKind;
  message?: string | null;
}

export interface SearchSaveFeedback {
  tone: "info" | "success" | "error";
  title: string;
  description: string;
  role: "status" | "alert";
  ariaLive: "polite" | "assertive";
}

export interface SearchSaveButtonState {
  label: string;
  ariaLabel: string;
  disabled: boolean;
}

export interface SearchBrowserStatusSnapshot {
  installed: boolean;
  supported?: boolean;
  path?: string | null;
  version?: string | null;
  message?: string | null;
}

export interface SearchBrowserStatusFeedback {
  tone: "info" | "success" | "warning" | "error";
  title: string;
  description: string;
  role: "status" | "alert";
  ariaLive: "polite" | "assertive";
}

const MAX_SEARCH_SAVE_ERROR_LENGTH = 160;
const MAX_SEARCH_BROWSER_ERROR_LENGTH = 180;

export function formatSearchSaveError(error: unknown): string {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : typeof error === "object" && error && "message" in error
          ? String((error as { message?: unknown }).message ?? "")
          : "";
  const normalized = message.replace(/\s+/g, " ").trim();
  if (!normalized) return "搜索配置保存失败，请确认本地后端已启动后重试。";
  if (normalized.length <= MAX_SEARCH_SAVE_ERROR_LENGTH) return normalized;
  return `${normalized.slice(0, MAX_SEARCH_SAVE_ERROR_LENGTH - 1)}…`;
}

export function formatSearchBrowserStatusError(error: unknown): string {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : typeof error === "object" && error && "message" in error
          ? String((error as { message?: unknown }).message ?? "")
          : "";
  const normalized = message.replace(/\s+/g, " ").trim();
  if (!normalized) return "浏览器检测不可用，请确认当前运行在桌面客户端中。";
  if (normalized.length <= MAX_SEARCH_BROWSER_ERROR_LENGTH) return normalized;
  return `${normalized.slice(0, MAX_SEARCH_BROWSER_ERROR_LENGTH - 1)}…`;
}

export function resolveSearchBrowserStatusFeedback(input: {
  checking: boolean;
  status: SearchBrowserStatusSnapshot | null | undefined;
  error?: string | null;
}): SearchBrowserStatusFeedback {
  if (input.checking) {
    return {
      tone: "info",
      title: "正在检测浏览器",
      description: "正在确认当前搜索后端是否可用。",
      role: "status",
      ariaLive: "polite",
    };
  }

  if (input.error?.trim()) {
    return {
      tone: "error",
      title: "浏览器检测失败",
      description: formatSearchBrowserStatusError(input.error),
      role: "alert",
      ariaLive: "assertive",
    };
  }

  const status = input.status;
  if (status?.installed && status.supported !== false) {
    return {
      tone: "success",
      title: "浏览器可用",
      description: status.message || status.version || status.path || "已检测到可用浏览器。",
      role: "status",
      ariaLive: "polite",
    };
  }

  if (status?.installed && status.supported === false) {
    return {
      tone: "warning",
      title: "浏览器版本不受支持",
      description: status.message || status.version || status.path || "当前浏览器后端已安装，但不满足搜索任务要求。",
      role: "status",
      ariaLive: "polite",
    };
  }

  return {
    tone: "warning",
    title: "浏览器未就绪",
    description: status?.message || status?.version || status?.path || "尚未检测到可用浏览器。",
    role: "status",
    ariaLive: "polite",
  };
}

export function resolveSearchSaveFeedback(status: SearchSaveStatus): SearchSaveFeedback | null {
  switch (status.kind) {
    case "saving":
      return {
        tone: "info",
        title: "正在保存搜索配置",
        description: "正在同步搜索引擎、浏览器后端和代理设置。",
        role: "status",
        ariaLive: "polite",
      };
    case "saved":
      return {
        tone: "success",
        title: "搜索配置已保存",
        description: "新的搜索设置会用于后续 Agent 搜索和浏览任务。",
        role: "status",
        ariaLive: "polite",
      };
    case "error":
      return {
        tone: "error",
        title: "搜索配置保存失败",
        description: formatSearchSaveError(status.message),
        role: "alert",
        ariaLive: "assertive",
      };
    default:
      return null;
  }
}

export function resolveSearchSaveButton(status: SearchSaveStatus): SearchSaveButtonState {
  if (status.kind === "saving") {
    return {
      label: "保存中",
      ariaLabel: "正在保存搜索配置",
      disabled: true,
    };
  }

  return {
    label: "保存搜索配置",
    ariaLabel: "保存搜索配置",
    disabled: false,
  };
}
