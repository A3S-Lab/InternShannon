export type AiSettingsSyncStatusKind = "idle" | "syncing" | "synced" | "error";

export interface AiSettingsSyncStatus {
  kind: AiSettingsSyncStatusKind;
  message?: string | null;
}

export interface AiSettingsSyncFeedback {
  tone: "info" | "success" | "error";
  title: string;
  description: string;
  role: "status" | "alert";
  ariaLive: "polite" | "assertive";
}

export interface AiSettingsProviderSnapshot {
  name: string;
  models: Array<{
    id: string;
    name?: string | null;
  }>;
}

export interface AiDefaultModelFeedback {
  tone: "success" | "warning" | "error";
  title: string;
  description: string;
  role: "status" | "alert";
  ariaLive: "polite" | "assertive";
}

const MAX_AI_SETTINGS_SYNC_ERROR_LENGTH = 160;

export function formatAiSettingsSyncError(error: unknown): string {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : typeof error === "object" && error && "message" in error
          ? String((error as { message?: unknown }).message ?? "")
          : "";
  const normalized = message.replace(/\s+/g, " ").trim();
  if (!normalized) return "AI 配置保存失败，请确认本地后端已启动后重试。";
  if (normalized.length <= MAX_AI_SETTINGS_SYNC_ERROR_LENGTH) return normalized;
  return `${normalized.slice(0, MAX_AI_SETTINGS_SYNC_ERROR_LENGTH - 1)}…`;
}

export function resolveAiSettingsSyncFeedback(status: AiSettingsSyncStatus): AiSettingsSyncFeedback | null {
  switch (status.kind) {
    case "syncing":
      return {
        tone: "info",
        title: "正在保存 AI 配置",
        description: "正在同步模型提供商和默认模型设置。",
        role: "status",
        ariaLive: "polite",
      };
    case "synced":
      return {
        tone: "success",
        title: "AI 配置已保存",
        description: "新建 Agent 会话会使用最新的模型提供商和默认模型设置。",
        role: "status",
        ariaLive: "polite",
      };
    case "error":
      return {
        tone: "error",
        title: "AI 配置保存失败",
        description: formatAiSettingsSyncError(status.message),
        role: "alert",
        ariaLive: "assertive",
      };
    default:
      return null;
  }
}

export function resolveAiDefaultModelFeedback(input: {
  providers: AiSettingsProviderSnapshot[];
  defaultProvider: string | null | undefined;
  defaultModel: string | null | undefined;
}): AiDefaultModelFeedback {
  if (input.providers.length === 0) {
    return {
      tone: "warning",
      title: "还没有可用的模型提供商",
      description: "请先添加 Provider 和模型，新建 Agent 会话才有默认模型可用。",
      role: "status",
      ariaLive: "polite",
    };
  }

  const defaultProvider = input.defaultProvider?.trim() || "";
  if (!defaultProvider) {
    return {
      tone: "warning",
      title: "尚未设置默认 Provider",
      description: "请选择一个默认 Provider，新建 Agent 会话会优先使用它。",
      role: "status",
      ariaLive: "polite",
    };
  }

  const provider = input.providers.find((item) => item.name === defaultProvider);
  if (!provider) {
    return {
      tone: "error",
      title: "默认 Provider 不存在",
      description: `当前默认 Provider "${defaultProvider}" 不在配置列表中，请重新选择。`,
      role: "alert",
      ariaLive: "assertive",
    };
  }

  if (provider.models.length === 0) {
    return {
      tone: "warning",
      title: "默认 Provider 还没有模型",
      description: `请先为 ${provider.name} 添加至少一个模型。`,
      role: "status",
      ariaLive: "polite",
    };
  }

  const defaultModel = input.defaultModel?.trim() || "";
  if (!defaultModel) {
    return {
      tone: "warning",
      title: "尚未设置默认模型",
      description: `请选择 ${provider.name} 下的一个模型作为新会话默认模型。`,
      role: "status",
      ariaLive: "polite",
    };
  }

  const model = provider.models.find((item) => item.id === defaultModel);
  if (!model) {
    return {
      tone: "error",
      title: "默认模型不在当前 Provider 中",
      description: `当前默认模型 "${defaultModel}" 不属于 ${provider.name}，请重新选择。`,
      role: "alert",
      ariaLive: "assertive",
    };
  }

  return {
    tone: "success",
    title: "默认模型可用于新会话",
    description: `新建 Agent 会话将使用 ${provider.name} / ${model.name || model.id}。`,
    role: "status",
    ariaLive: "polite",
  };
}
