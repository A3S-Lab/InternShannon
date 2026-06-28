export interface AgentChatHiddenNewMessageCountInput {
  previousMessageCount: number;
  nextMessageCount: number;
  currentHiddenNewMessageCount: number;
  userScrolledUp: boolean;
}

export interface AgentChatScrollButtonPresentationInput {
  hiddenNewMessageCount: number;
}

export interface AgentChatScrollButtonPresentation {
  label: string;
  ariaLabel: string;
}

export const AGENT_CHAT_STATIC_MESSAGE_LIMIT = 200;

export type AgentChatMessageListRenderMode = "static" | "virtual";

export interface AgentChatMessageListRenderModeInput {
  messageCount: number;
}

export interface AgentChatStreamingUiStateInput {
  streamingText?: string | null;
  streamingSegmentCount: number;
  isRunning: boolean;
  isCompacting: boolean;
}

export function resolveAgentChatHiddenNewMessageCount(input: AgentChatHiddenNewMessageCountInput): number {
  if (!input.userScrolledUp) return 0;

  const previousMessageCount = normalizeCount(input.previousMessageCount);
  const nextMessageCount = normalizeCount(input.nextMessageCount);
  const currentHiddenNewMessageCount = normalizeCount(input.currentHiddenNewMessageCount);

  if (nextMessageCount <= previousMessageCount) {
    return Math.min(currentHiddenNewMessageCount, nextMessageCount);
  }

  return currentHiddenNewMessageCount + nextMessageCount - previousMessageCount;
}

export function resolveAgentChatScrollButtonPresentation(
  input: AgentChatScrollButtonPresentationInput,
): AgentChatScrollButtonPresentation {
  const hiddenNewMessageCount = normalizeCount(input.hiddenNewMessageCount);
  if (hiddenNewMessageCount === 0) {
    return {
      label: "最新消息",
      ariaLabel: "滚动到最新消息",
    };
  }

  const displayCount = hiddenNewMessageCount > 99 ? "99+" : String(hiddenNewMessageCount);
  return {
    label: `${displayCount} 条新消息`,
    ariaLabel: `滚动到最新消息，${displayCount} 条新消息`,
  };
}

export function resolveAgentChatMessageListRenderMode(
  input: AgentChatMessageListRenderModeInput,
): AgentChatMessageListRenderMode {
  return normalizeCount(input.messageCount) <= AGENT_CHAT_STATIC_MESSAGE_LIMIT ? "static" : "virtual";
}

export function resolveAgentChatStreamingUiState(input: AgentChatStreamingUiStateInput): boolean {
  if (input.isRunning || input.isCompacting) return true;
  if (normalizeCount(input.streamingSegmentCount) > 0) return true;
  return typeof input.streamingText === "string" && input.streamingText.trim().length > 0;
}

function normalizeCount(count: number): number {
  if (!Number.isFinite(count) || count <= 0) return 0;
  return Math.floor(count);
}
