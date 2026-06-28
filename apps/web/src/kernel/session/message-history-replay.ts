import type { AgentChatMessage } from "@/lib/types";

export function shouldApplyMessageHistoryReplay(input: {
  existingMessages: readonly AgentChatMessage[];
  replayMessages: readonly AgentChatMessage[];
}): boolean {
  if (input.replayMessages.length > 0) return true;
  return input.existingMessages.length === 0;
}
