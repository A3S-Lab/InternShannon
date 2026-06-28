export type ExternalSkillImportStatusKind = "idle" | "importing" | "success" | "error" | "rejected";

export type ExternalSkillImportStatus =
  | { kind: "idle" }
  | {
      kind: "importing";
      targetLabel?: string;
      pendingFileCount?: number;
    }
  | {
      kind: "success";
      targetLabel?: string;
      itemCount: number;
      fileCount: number;
    }
  | {
      kind: "error" | "rejected";
      targetLabel?: string;
      message: string;
    };

export type ExternalSkillImportFeedbackTone = "info" | "success" | "error";

export interface ExternalSkillImportFeedback {
  tone: ExternalSkillImportFeedbackTone;
  role: "status" | "alert";
  ariaLive: "polite" | "assertive";
  title: string;
  description: string;
}

const MAX_ERROR_DESCRIPTION_LENGTH = 160;

function normalizedTargetLabel(targetLabel: string | null | undefined): string {
  return targetLabel?.trim() || "当前技能工作区";
}

function normalizeMessage(value: unknown): string {
  if (value instanceof Error) return value.message;
  if (typeof value === "string") return value;
  if (typeof value === "object" && value && "message" in value) {
    return String((value as { message?: unknown }).message ?? "");
  }
  return "";
}

export function formatExternalSkillImportError(
  error: unknown,
  fallback = "导入失败，请检查文件格式或稍后重试。",
): string {
  const normalized = normalizeMessage(error).replace(/\s+/g, " ").trim();
  const message = normalized || fallback;
  if (message.length <= MAX_ERROR_DESCRIPTION_LENGTH) return message;
  return `${message.slice(0, MAX_ERROR_DESCRIPTION_LENGTH - 1)}…`;
}

export function resolveExternalSkillImportFeedback(
  status: ExternalSkillImportStatus,
): ExternalSkillImportFeedback | null {
  if (status.kind === "idle") return null;

  const targetLabel = normalizedTargetLabel(status.targetLabel);

  if (status.kind === "importing") {
    const pendingCount =
      typeof status.pendingFileCount === "number" && status.pendingFileCount > 0
        ? `正在处理 ${status.pendingFileCount} 个文件，`
        : "";

    return {
      tone: "info",
      role: "status",
      ariaLive: "polite",
      title: "正在导入技能",
      description: `${pendingCount}导入完成后会自动刷新${targetLabel}。`,
    };
  }

  if (status.kind === "success") {
    return {
      tone: "success",
      role: "status",
      ariaLive: "polite",
      title: "导入完成",
      description: `已导入 ${status.itemCount} 个技能，包含 ${status.fileCount} 个文件。`,
    };
  }

  if (status.kind === "rejected") {
    return {
      tone: "error",
      role: "alert",
      ariaLive: "assertive",
      title: "无法导入",
      description: status.message.trim() || "当前技能工作区不可写，请切换目录或权限后重试。",
    };
  }

  return {
    tone: "error",
    role: "alert",
    ariaLive: "assertive",
    title: "导入失败",
    description: status.message.trim() || "请重新选择 ZIP、Markdown 或文本技能文件。",
  };
}
