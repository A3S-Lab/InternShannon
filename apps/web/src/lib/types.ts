// Agent session state (mirrors Rust AgentSessionState)
export interface AgentSessionState {
  sessionId: string;
  agentId?: string | null;
  model: string;
  systemPrompt?: string;
  followDefaultModel?: boolean;
  cwd: string;
  tools: string[];
  permissionMode: string;
  mcpServers: { name: string; status: string }[];
  agents: string[];
  slashCommands: string[];
  skills: string[];
  skillDetails?: Array<{
    name: string;
    description?: string;
    kind?: string;
  }>;
  toolDefinitions?: unknown;
  totalCostUsd: number;
  numTurns: number;
  contextUsedPercent: number;
  isCompacting: boolean;
  totalLinesAdded: number;
  totalLinesRemoved: number;
  assetId?: string;
  agentPhase?: string;
  // Token usage (optional — populated when backend sends usage data)
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  lastRunStatus?: "succeeded" | "incomplete" | "failed" | "cancelled";
  lastStopReason?: string | null;
  lastRunRetryable?: boolean;
  lastRunDurationMs?: number;
  lastRunTotalTokens?: number;
  lastRunToolCalls?: number;
  lastRunOpenPlanTasks?: number;
}

export type AgentRuntimeEventKind = "main_agent" | "tool" | "subagent";

export interface AgentRuntimeTimelineEvent {
  id: string;
  kind: AgentRuntimeEventKind;
  status: string;
  phase: string;
  label: string;
  detail?: string;
  source?: string;
  toolUseId?: string;
  toolName?: string;
  elapsedMs?: number;
  activeToolCount?: number;
  timestamp: number;
}

// Canonical planning task status set is shared with the kernel via the
// @a3s-lab/agent-planning package. Re-export under the web-facing name so
// existing imports of `AgentPlanningTaskStatus` keep working.
import type { PlanningTaskStatus as AgentPlanningTaskStatus } from "@a3s-lab/agent-planning";
export type { AgentPlanningTaskStatus };

export interface AgentPlanningTask {
  id: string;
  title: string;
  description?: string;
  status: AgentPlanningTaskStatus;
  phase?: string;
  priority?: string;
  startedAt?: string | number;
  completedAt?: string | number;
  note?: string;
  reason?: string;
  parentId?: string;
  updatedAt: number;
}

export interface AgentPlanningState {
  phase: "idle" | "planning" | "running" | "completed";
  tasks: AgentPlanningTask[];
  currentTaskId?: string;
  reason?: string;
  turn?: number;
  updatedAt: number;
}

export interface KernelSessionSnapshot {
  id: string;
  agentId?: string | null;
  title?: string;
  status?: string;
  cwd?: string;
  model?: string;
  followDefaultModel?: boolean;
  permissionMode?: string;
  assetId?: string;
  agentPhase?: string;
  createdAt?: string | number;
  updatedAt?: string | number;
}

// Agent process info (mirrors Rust AgentProcessInfo)
export interface AgentProcessInfo {
  sessionId: string;
  agentId?: string | null;
  pid?: number;
  state: "starting" | "connected" | "running" | "exited" | "creating";
  exitCode?: number | null;
  model?: string;
  followDefaultModel?: boolean;
  permissionMode?: string;
  cwd: string;
  createdAt: number;
  cliSessionId?: string;
  name?: string;
  assetId?: string;
  agentPhase?: string;
  metadata?: Record<string, unknown>;
}

// Agent info returned by sidecar endpoints.
export interface AgentInfo {
  id: string;
  name: string;
  description: string;
  tags: string[];
  version?: string | null;
}

// Content blocks emitted by the local a3s-code runtime
export type ContentBlock =
  | { type: "text"; text: string }
  | {
      type: "tool_use";
      id: string;
      name: string;
      input: Record<string, unknown>;
    }
  | {
      type: "tool_result";
      toolUseId: string;
      content: string | ContentBlock[];
      isError?: boolean;
      before?: string;
      after?: string;
      filePath?: string;
    }
  | { type: "thinking"; thinking: string; budgetTokens?: number };

// Chat message displayed in the UI
export interface AgentChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  contentBlocks?: ContentBlock[];
  images?: { mediaType: string; data: string }[];
  timestamp: number;
  parentToolUseId?: string | null;
  model?: string;
  stopReason?: string | null;
  durationMs?: number;
  meta?: {
    provider?: string;
    requestModel?: string;
    requestUrl?: string;
    responseId?: string;
    responseModel?: string;
    responseObject?: string;
    firstTokenMs?: number;
    durationMs?: number;
  };
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    cacheReadTokens?: number;
    cacheWriteTokens?: number;
    totalTokens?: number;
  };
  /** Where this message originated from (app, dingtalk, feishu, wecom) */
  source?: string;
}

// Incoming agent-to-agent message notification
export interface AgentMessage {
  messageId: string;
  fromSessionId: string;
  topic: string;
  content: string;
  autoExecute: boolean;
  executionError?: string;
}

// Server -> Browser messages
export type BrowserIncomingMessage =
  | { type: "session_init"; session: AgentSessionState | KernelSessionSnapshot }
  | { type: "session_update"; session: Partial<AgentSessionState> }
  | {
      type: "session_status";
      data: {
        sessionId: string;
        workspace?: string;
        storageWorkspace?: string;
        runtimeWorkspace?: string;
        agentId?: string | null;
        toolNames?: string[];
        toolDefinitions?: unknown;
        skills?: Array<
          | string
          | {
              name?: string;
              description?: string;
              kind?: string;
            }
        >;
        commands?: string[];
        mcpStatus?: Array<{
          name: string;
          connected?: boolean;
          toolCount?: number;
          error?: string;
        }>;
        initWarning?: string | null;
      };
    }
  | {
      type: "assistant";
      message: {
        id: string;
        role: string;
        model: string;
        content: ContentBlock[];
        stopReason: string | null;
        durationMs?: number | null;
        meta?: {
          provider?: string;
          requestModel?: string;
          requestUrl?: string;
          responseId?: string;
          responseModel?: string;
          responseObject?: string;
          firstTokenMs?: number;
          durationMs?: number;
        } | null;
        usage?: {
          inputTokens?: number;
          outputTokens?: number;
          cacheReadTokens?: number;
          cacheWriteTokens?: number;
          totalTokens?: number;
        } | null;
      };
      parentToolUseId: string | null;
    }
  | {
      type: "stream_event";
      event: Record<string, unknown> & {
        type?: string;
        question?: string;
        answer?: string;
        summary?: string;
        questions?: string[];
        totalTokens?: number;
        status?: string;
        phase?: string;
        label?: string;
        detail?: string;
        source?: string;
        rationale?: string;
        actionKind?: string;
        anchor?: string;
        tasks?: AgentPlanningTask[];
        step?: Partial<AgentPlanningTask> | Record<string, unknown>;
        turn?: number;
      };
      parentToolUseId: string | null;
    }
  | { type: "result"; data: Record<string, unknown> }
  | { type: "cancelled"; cancelled: boolean }
  | {
      type: "tool_progress";
      toolUseId: string;
      toolName: string;
      elapsedTimeSeconds: number;
      seq?: number;
    }
  | { type: "tool_use_summary"; summary: string; toolUseIds: string[] }
  | { type: "status_change"; status: string | null }
  | {
      type: "auth_status";
      isAuthenticating: boolean;
      output: string[];
      error?: string;
    }
  | {
      type: "error";
      message: string;
      code?: string | null;
      details?: Record<string, unknown> | null;
    }
  | { type: "cli_connected" }
  | { type: "cli_disconnected" }
  | { type: "user_message"; id?: string; content: string; timestamp: number }
  | { type: "message_history"; messages: BrowserIncomingMessage[] }
  | { type: "session_name_update"; name: string }
  | {
      type: "agent_message";
      messageId: string;
      fromSessionId: string;
      topic: string;
      content: string;
      autoExecute: boolean;
    }
  | {
      type: "command_response";
      command: string;
      text: string;
      stateChanged: boolean;
    }
  | {
      type: "asset_binding";
      assetId?: string;
      timestamp?: number;
    }
  | {
      type: "asset_agent_lock_violation";
      lockedAssetId?: string;
      attemptedAssetId?: string;
      message?: string;
      timestamp?: number;
    }
  | {
      type: "file_attached";
      uploadId?: string;
      fileName?: string;
      mimeType?: string;
    };

// Browser -> Server messages
export type BrowserOutgoingMessage =
  | {
      type: "user_message";
      content: string;
      sessionId?: string;
      images?: { mediaType: string; data: string }[];
      attachments?: { uploadId: string; fileName: string; mimeType?: string; size?: number }[];
      model?: string;
      apiKey?: string;
      baseUrl?: string;
    }
  | {
      type: "btw" | "btw_message";
      content: string;
    }
  | { type: "interrupt" | "cancel" }
  | { type: "session_status" }
  | { type: "clear_session" }
  | { type: "set_model"; model: string }
  | { type: "set_permissionMode"; mode: string }
  | { type: "set_systemPrompt"; systemPrompt: string }
  | {
      type: "tool_confirmation_response";
      requestId: string;
      approved: boolean;
      scope?: "once" | "task" | "session";
      toolName?: string;
    }
  | { type: "send_agent_message"; target: string; content: string; topic?: string; autoExecute?: boolean }
  | { type: "set_autoExecute"; enabled: boolean };
