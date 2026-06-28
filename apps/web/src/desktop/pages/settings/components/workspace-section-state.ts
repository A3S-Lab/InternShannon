export type WorkspaceSaveStatusKind = "idle" | "saving" | "saved" | "error";

export interface WorkspaceSaveStatus {
  kind: WorkspaceSaveStatusKind;
  message?: string | null;
}

export interface WorkspaceSaveFeedback {
  tone: "info" | "success" | "warning" | "error";
  title: string;
  description: string;
  role: "status" | "alert";
  ariaLive: "polite" | "assertive";
}

export interface WorkspaceSaveButtonState {
  label: string;
  ariaLabel: string;
  disabled: boolean;
}

const MAX_WORKSPACE_SAVE_ERROR_LENGTH = 160;

export function formatWorkspaceSaveErrorMessage(error: unknown): string {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : typeof error === "object" && error && "message" in error
          ? String((error as { message?: unknown }).message ?? "")
          : "";
  const normalized = message.replace(/\s+/g, " ").trim();
  if (!normalized) return "保存失败，请确认本地后端已启动后重试。";
  if (normalized.length <= MAX_WORKSPACE_SAVE_ERROR_LENGTH) return normalized;
  return `${normalized.slice(0, MAX_WORKSPACE_SAVE_ERROR_LENGTH - 1)}…`;
}

export function resolveWorkspaceSaveFeedback(status: WorkspaceSaveStatus): WorkspaceSaveFeedback | null {
  switch (status.kind) {
    case "saving":
      return {
        tone: "info",
        title: "正在保存工作区配置",
        description: "正在同步到本地后端。",
        role: "status",
        ariaLive: "polite",
      };
    case "saved":
      return {
        tone: "success",
        title: "工作区配置已保存",
        description: "新的工作区根目录会用于后续新建会话和技能目录。",
        role: "status",
        ariaLive: "polite",
      };
    case "error":
      return {
        tone: "error",
        title: "工作区配置保存失败",
        description: formatWorkspaceSaveErrorMessage(status.message),
        role: "alert",
        ariaLive: "assertive",
      };
    default:
      return null;
  }
}

export function resolveWorkspaceRootValidationFeedback(
  workspaceRoot: string | null | undefined,
): WorkspaceSaveFeedback | null {
  if (workspaceRoot?.trim()) return null;

  return {
    tone: "warning",
    title: "需要工作区根目录",
    description: "请输入或选择一个工作区目录后再保存。",
    role: "status",
    ariaLive: "polite",
  };
}

export function resolveWorkspaceSaveButton(
  status: WorkspaceSaveStatus,
  options?: { workspaceRoot?: string | null },
): WorkspaceSaveButtonState {
  if (status.kind === "saving") {
    return {
      label: "保存中",
      ariaLabel: "正在保存工作区配置",
      disabled: true,
    };
  }

  if (options && !options.workspaceRoot?.trim()) {
    return {
      label: "保存",
      ariaLabel: "请输入工作区根目录后保存",
      disabled: true,
    };
  }

  return {
    label: "保存",
    ariaLabel: "保存工作区配置",
    disabled: false,
  };
}
