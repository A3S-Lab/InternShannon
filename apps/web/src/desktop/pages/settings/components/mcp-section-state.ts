export type McpServerSaveKind = "create" | "update" | "rename";
export type McpServerRowActionKind = "toggle" | "remove";
export type McpServerTransportKind = "stdio" | "http";

export interface McpServerSavePlanInput {
  editingName?: string | null;
  nextName: string;
}

export interface McpServerSavePlan {
  kind: McpServerSaveKind;
  nextName: string;
  previousName?: string;
  removePreviousAfterUpsert: boolean;
  successMessage: string;
}

export interface McpServerRowActionRef {
  serverName: string;
  kind: McpServerRowActionKind;
}

export interface McpServerRowActionFeedback {
  title: string;
  description: string;
  role: "alert";
  ariaLive: "assertive";
}

export interface McpServerFormValidationInput {
  name: string;
  transport: McpServerTransportKind;
  command: string;
  url: string;
}

export interface McpServerFormValidation {
  canSave: boolean;
  title: string;
  description: string;
  saveButtonAriaLabel: string;
}

export function resolveMcpServerSavePlan(input: McpServerSavePlanInput): McpServerSavePlan {
  const nextName = input.nextName.trim();
  const previousName = input.editingName?.trim();

  if (!previousName) {
    return {
      kind: "create",
      nextName,
      removePreviousAfterUpsert: false,
      successMessage: `MCP 服务 ${nextName} 已添加`,
    };
  }

  if (previousName === nextName) {
    return {
      kind: "update",
      nextName,
      previousName,
      removePreviousAfterUpsert: false,
      successMessage: `MCP 服务 ${nextName} 已更新`,
    };
  }

  return {
    kind: "rename",
    nextName,
    previousName,
    removePreviousAfterUpsert: true,
    successMessage: `MCP 服务 ${previousName} 已重命名为 ${nextName}`,
  };
}

export function formatMcpActionError(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message.trim();
  if (typeof error === "string" && error.trim()) return error.trim();
  if (typeof error === "object" && error && "message" in error) {
    const message = String((error as { message?: unknown }).message ?? "").trim();
    if (message) return message;
  }
  return "MCP 服务操作失败，请确认本地后端已启动后重试。";
}

export function resolveMcpServerFormValidation(input: McpServerFormValidationInput): McpServerFormValidation {
  const missingName = !input.name.trim();
  const missingCommand = input.transport === "stdio" && !input.command.trim();
  const missingUrl = input.transport === "http" && !input.url.trim();

  if (missingName && missingCommand) {
    return {
      canSave: false,
      title: "还不能添加 stdio MCP 服务",
      description: "请输入服务名和 Command。",
      saveButtonAriaLabel: "请输入 MCP 服务名和 Command 后保存",
    };
  }

  if (missingName && missingUrl) {
    return {
      canSave: false,
      title: "还不能添加 HTTP MCP 服务",
      description: "请输入服务名和 URL。",
      saveButtonAriaLabel: "请输入 MCP 服务名和 URL 后保存",
    };
  }

  if (missingName) {
    return {
      canSave: false,
      title: "需要服务名",
      description: "请输入一个用于识别该 MCP 服务的名称。",
      saveButtonAriaLabel: "请输入 MCP 服务名后保存",
    };
  }

  if (missingCommand) {
    return {
      canSave: false,
      title: "需要 Command",
      description: "stdio 服务需要一个可执行命令，例如 npx 或本地二进制路径。",
      saveButtonAriaLabel: "请输入 stdio MCP Command 后保存",
    };
  }

  if (missingUrl) {
    return {
      canSave: false,
      title: "需要 URL",
      description: "HTTP 服务需要一个可访问的 MCP endpoint URL。",
      saveButtonAriaLabel: "请输入 HTTP MCP URL 后保存",
    };
  }

  return {
    canSave: true,
    title: "MCP 服务配置可以保存",
    description: "保存后会同步到本地后端并刷新服务状态。",
    saveButtonAriaLabel: "保存 MCP 服务配置",
  };
}

export function isMcpServerRowActionPending(
  pending: McpServerRowActionRef | null | undefined,
  serverName: string,
  kind?: McpServerRowActionKind,
): boolean {
  if (!pending || pending.serverName !== serverName) return false;
  return kind ? pending.kind === kind : true;
}

export function resolveMcpServerRowActionFeedback(
  error: McpServerRowActionRef & { message?: unknown },
  serverName: string,
): McpServerRowActionFeedback | null {
  if (error.serverName !== serverName) return null;
  const actionName = error.kind === "remove" ? "移除" : "更新";
  return {
    title: `${actionName} MCP 服务失败`,
    description: formatMcpActionError(error.message),
    role: "alert",
    ariaLive: "assertive",
  };
}
