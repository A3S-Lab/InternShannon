export interface AgentMessageRetryMessage {
  id: string;
  role: string;
  content?: string | null;
  source?: string | null;
}

export interface AgentMessageRetryStateInput {
  messages: readonly AgentMessageRetryMessage[];
  isRunning: boolean;
  readOnly: boolean;
}

export interface AgentMessageRetryState {
  assistantMessageId: string | null;
  userMessageId: string | null;
}

function isBypassPromptMessage(message: AgentMessageRetryMessage): boolean {
  return message.role === "user" && (message.content ?? "").trim().startsWith("/btw");
}

function isMainUserMessage(message: AgentMessageRetryMessage): boolean {
  return message.role === "user" && !isBypassPromptMessage(message) && message.source !== "command:/btw";
}

function isMainAssistantMessage(message: AgentMessageRetryMessage): boolean {
  return message.role === "assistant" && message.source !== "command:/btw";
}

export function resolveAgentMessageRetryState(input: AgentMessageRetryStateInput): AgentMessageRetryState {
  if (input.readOnly || input.isRunning) {
    return {
      assistantMessageId: null,
      userMessageId: null,
    };
  }

  let assistantMessageId: string | null = null;
  for (let index = input.messages.length - 1; index >= 0; index -= 1) {
    const message = input.messages[index];
    if (!message) continue;

    if (!assistantMessageId && isMainAssistantMessage(message)) {
      assistantMessageId = message.id;
      continue;
    }

    if (isMainUserMessage(message)) {
      return assistantMessageId
        ? {
            assistantMessageId,
            userMessageId: message.id,
          }
        : {
            assistantMessageId: null,
            userMessageId: null,
          };
    }
  }

  return {
    assistantMessageId: null,
    userMessageId: null,
  };
}
