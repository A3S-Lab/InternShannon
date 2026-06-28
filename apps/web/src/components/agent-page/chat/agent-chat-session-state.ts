export interface AgentChatSessionRuntimeState {
  systemPrompt?: string;
}

export function resolveAgentChatSessionRuntimeState(session: unknown): AgentChatSessionRuntimeState {
  const record = isRecord(session) ? session : {};
  return {
    systemPrompt: normalizePrompt(record.systemPrompt ?? record.system_prompt),
  };
}

function normalizePrompt(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const prompt = value.trim();
  return prompt || undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
