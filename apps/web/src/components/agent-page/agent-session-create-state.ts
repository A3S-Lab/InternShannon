import type { AgentProfile } from "../../lib/agent-profile.types.ts";

type AgentSessionCreateAgent = Pick<AgentProfile, "defaultPermissionMode">;

export interface AgentSessionCreateOptionsInput {
  agentId: string;
  agent?: AgentSessionCreateAgent | null;
  apiUrl?: string;
  optimisticPlaceholder?: boolean;
}

export interface AgentSessionCreateOptions {
  agentId: string;
  followDefaultModel?: boolean;
  permissionMode?: string;
  apiUrl?: string;
  optimisticPlaceholder?: boolean;
}

export function buildAgentSessionCreateOptions(
  input: AgentSessionCreateOptionsInput,
): AgentSessionCreateOptions {
  const options: AgentSessionCreateOptions = {
    agentId: input.agentId,
  };
  const normalizedAgentId = input.agentId.trim();
  if (normalizedAgentId === "default" || normalizedAgentId === "super-admin") {
    options.followDefaultModel = true;
  }
  const permissionMode = input.agent?.defaultPermissionMode?.trim();
  if (permissionMode) {
    options.permissionMode = permissionMode;
  }
  if (input.apiUrl?.trim()) {
    options.apiUrl = input.apiUrl;
  }
  if (input.optimisticPlaceholder) {
    options.optimisticPlaceholder = true;
  }
  return options;
}

export function shouldInitializeAgentDefaultsAfterCreate(apiUrl?: string): boolean {
  return !apiUrl?.trim();
}

export function formatAgentSessionCreateError(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message;
  if (typeof error === "string" && error.trim()) return error;
  if (typeof error === "object" && error && "message" in error) {
    const message = String((error as { message?: unknown }).message ?? "").trim();
    if (message) return message;
  }
  return "创建会话失败，请检查本地服务连接";
}
