export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
  streaming?: boolean;
  toolCalls?: ToolCall[];
}

export interface ToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
  output?: string;
  isError?: boolean;
  durationMs?: number;
}

export interface ChatSession {
  sessionId: string;
  agentId?: string;
  agentName?: string;
  agentAvatar?: Record<string, unknown>;
  status?: 'idle' | 'running' | 'error';
  messages: ChatMessage[];
}

export interface AgentChatProps {
  session: ChatSession;
  onSendMessage: (content: string) => void;
  onInterrupt?: () => void;
  className?: string;
}
