import type { AgentChatMessage } from "./types.ts";

export interface InternShannonMemoryConversationRef {
  sessionId: string;
  sessionName?: string;
  messageId?: string;
  role?: AgentChatMessage["role"];
  preview?: string;
  timestamp?: number;
}

export interface ResolveInternShannonMemoryConversationRefInput {
  sessionId: string;
  sessionName?: string;
  messages?: readonly AgentChatMessage[];
  timestamp: number;
}

function truncateText(value: string, maxLength: number): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength - 1)}…` : normalized;
}

function textBlockPreview(value: unknown): string | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const block = value as Record<string, unknown>;
  if (block.type !== "text" && block.type !== undefined && block.type !== null) return undefined;
  for (const key of ["text", "content", "message"]) {
    const text = block[key];
    if (typeof text === "string" && text.trim()) return text.trim();
  }
  return undefined;
}

function messagePreview(message: AgentChatMessage): string {
  if (message.content.trim()) return truncateText(message.content, 120);
  const blockText = message.contentBlocks
    ?.map(textBlockPreview)
    .filter((text): text is string => Boolean(text))
    .join("\n");
  if (blockText?.trim()) return truncateText(blockText, 120);
  if (message.images?.length) return `包含 ${message.images.length} 张图片`;
  return "这条消息没有文本内容";
}

export function resolveInternShannonMemoryConversationRef({
  sessionId,
  sessionName,
  messages,
  timestamp,
}: ResolveInternShannonMemoryConversationRefInput): InternShannonMemoryConversationRef {
  const normalizedSessionName = sessionName?.trim() || undefined;
  const safeMessages = (messages ?? [])
    .map((message, index) => ({ message, index }))
    .filter(({ message }) => Number.isFinite(message.timestamp))
    .sort((left, right) => left.message.timestamp - right.message.timestamp || left.index - right.index);
  const pastCandidates = safeMessages.filter(({ message }) => message.timestamp <= timestamp);
  const futureFallbackCandidates = safeMessages.filter(
    ({ message }) => message.timestamp > timestamp && message.timestamp <= timestamp + 10_000,
  );
  const pastMessages = pastCandidates.map(({ message }) => message);
  const futureFallbackMessages = futureFallbackCandidates.map(({ message }) => message);
  const message =
    [...pastMessages].reverse().find((item) => item.role === "user") ??
    futureFallbackMessages.find((item) => item.role === "user") ??
    pastMessages[pastMessages.length - 1] ??
    futureFallbackMessages[0];
  return {
    sessionId,
    sessionName: normalizedSessionName,
    messageId: message?.id,
    role: message?.role,
    preview: message ? messagePreview(message) : undefined,
    timestamp: message?.timestamp,
  };
}
