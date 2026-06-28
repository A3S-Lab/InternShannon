import { proxy } from "valtio";
import {
  onUserStorageScopeChange,
  readUserJsonStorage,
  readUserStorage,
  removeUserStorage,
  writeUserJsonStorage,
  writeUserStorage,
} from "@/lib/browser-storage";
import { allowsLocalWorkspacePaths } from "@/lib/runtime-environment";
import type { ToolConfirmationRequest } from "@/lib/socket-types";
import type {
  AgentChatMessage,
  AgentMessage,
  AgentPlanningState,
  AgentProcessInfo,
  AgentRuntimeTimelineEvent,
  AgentSessionState,
  ContentBlock,
} from "@/lib/types";
import { exposeWorkspacePath as exposeRuntimeWorkspacePath } from "@/lib/workspace-path";
import { normalizePersistedSdkSessions, normalizePersistedSessionNames } from "./agent-session-persistence";

export interface ToolProgress {
  toolUseId: string;
  toolName: string;
  elapsedTimeSeconds: number;
  /** Tool input summary (e.g. file path, command) */
  input?: string;
  /** Streaming tool output (when available) */
  output?: string;
}

/** A completed tool call shown during streaming */
export interface CompletedToolCall {
  toolUseId: string;
  toolName: string;
  input: string;
  output: string;
  is_error: boolean;
  before?: string;
  after?: string;
  filePath?: string;
  durationMs?: number;
}

/** One ordered segment in a streaming response: either a text run or a completed tool call */
export type StreamingSegment =
  | { type: "text"; content: string; seq: number }
  | { type: "tool_progress"; progress: ToolProgress; seq: number }
  | { type: "tool"; call: CompletedToolCall; seq: number };

export interface AuthStatus {
  isAuthenticating: boolean;
  output: string[];
  error?: string;
}

export type StreamSlowStage = "frontend_send" | "model_first_token" | "tool_exec" | "unknown";

export interface StreamPerfHint {
  turn_id: number;
  slow_stage: StreamSlowStage;
  to_first_delta_ms?: number;
  to_result_ms?: number;
  updatedAt: number;
}

export interface BypassConversationTurn {
  id: string;
  question: string;
  answer: string;
  timestamp: number;
}

export interface AgentChatInputPrefillImage {
  mediaType: string;
  data: string;
  name?: string | null;
}

export interface AgentChatInputPrefill {
  text: string;
  autoSend?: boolean;
  images?: AgentChatInputPrefillImage[];
}

export type AgentChatInputPrefillOptions =
  | boolean
  | {
      autoSend?: boolean;
      images?: readonly AgentChatInputPrefillImage[];
    };

interface AgentStoreState {
  // Sessions
  sessions: Record<string, AgentSessionState>;
  sdkSessions: AgentProcessInfo[];
  hiddenInternalSessions: Record<string, true>;
  currentSessionId: string | null;

  // Messages
  messages: Record<string, AgentChatMessage[]>;
  streaming: Record<string, string>;
  streamingStartedAt: Record<string, number>;

  /** Current turn is an ephemeral /btw side query and should not write into main streaming UI. */
  bypassTurns: Record<string, boolean>;

  // Agent-to-agent messages (pending confirm-mode messages)
  agentMessages: Record<string, AgentMessage[]>;

  // Active tool progress per session
  activeToolProgress: Record<string, ToolProgress | null>;
  activeToolProgressById: Record<string, Record<string, ToolProgress>>;

  // Completed tool calls during current streaming (cleared on new generation)
  completedTools: Record<string, CompletedToolCall[]>;

  // Ordered interleaved segments for correct streaming render order
  streamingSegments: Record<string, StreamingSegment[]>;

  // Auth status per session (OAuth flow)
  authStatus: Record<string, AuthStatus | null>;

  // Tool confirmation requests per session
  toolConfirmationRequests: Record<string, ToolConfirmationRequest | null>;

  // Connection
  connectionStatus: Record<string, "connecting" | "connected" | "disconnected">;
  cliConnected: Record<string, boolean>;
  sessionStatus: Record<string, "idle" | "running" | "compacting" | null>;

  // UI
  sessionNames: Record<string, string>;
  /** Unread message count per session (for sidebar badges) */
  unreadCounts: Record<string, number>;

  /**
   * Pending chat-input prefill request, indexed by sessionId. Set by components
   * like AssetProposalCard ("自然语言创建" 流程的确认卡片) to push text into the
   * AgentInput for the corresponding session and optionally auto-submit it.
   * AgentInput consumes it via useEffect: applies the text, optionally triggers
   * handleSubmit, then clears the slot.
   */
  pendingChatPrefill: Record<string, AgentChatInputPrefill | null>;

  /**
   * Latest `asset_proposal` SSE payload from the asset development agent,
   * indexed by sessionId. Fed by AgentChat's stream subscription. Other
   * components (e.g. AssetCreationWorkspacePage header) can read this to
   * surface "等待用户确认" affordances without re-subscribing to SSE.
   */
  latestAssetProposal: Record<
    string,
    {
      proposal: {
        category: "agent" | "tool" | "skill" | "mcp" | "code";
        name: string;
        visibility: "public" | "private";
        description?: string;
        agentKind?: "tool" | "application" | "agentic";
        scaffoldTemplate?: string;
        summary?: string;
      };
      receivedAt: number;
    } | null
  >;

  // TTS
  /** Whether last user input was via voice (per session) */
  voiceInputActive: Record<string, boolean>;
  /** Text of the latest completed assistant response (per session) */
  lastAssistantText: Record<string, string>;

  /** Last inferred perf bottleneck for current/last turn */
  streamPerfHint: Record<string, StreamPerfHint | null>;

  /** Dedicated /btw side conversations, independent from main timeline rendering */
  bypassConversations: Record<string, BypassConversationTurn[]>;

  /** Cumulative token usage per session (updated via usage_update events). */
  sessionTokenUsage: Record<string, number>;
  /** Files attached to sessions. */
  sessionFiles: Record<string, Array<{ uploadId: string; fileName: string; mimeType?: string }>>;

  /** Recent backend runtime telemetry across main agent, tools and subagents. */
  runtimeTimeline: Record<string, AgentRuntimeTimelineEvent[]>;

  /** SDK planning-mode task list and execution progress per session. */
  planningStates: Record<string, AgentPlanningState | null>;
}

const STORAGE_KEY_SESSION = "internshannon-agent-current-session";
const STORAGE_KEY_NAMES = "internshannon-agent-session-names";
const STORAGE_KEY_SDK_SESSIONS = "internshannon-agent-sdk-sessions-v1";
const STORAGE_KEY_HIDDEN_INTERNAL_SESSIONS = "internshannon-hidden-internal-sessions";
const STORAGE_KEY_ASSISTANT_BLOCKS = "internshannon-agent-assistant-blocks-v1";

type PersistedAssistantBlocks = Record<string, Record<string, ContentBlock[]>>;

function loadHiddenInternalSessions(): Record<string, true> {
  try {
    const sessionIds = readUserJsonStorage<string[]>(STORAGE_KEY_HIDDEN_INTERNAL_SESSIONS, []);
    return Object.fromEntries(sessionIds.map((id) => [id, true]));
  } catch {
    return {};
  }
}

function persistHiddenInternalSessions() {
  writeUserJsonStorage(STORAGE_KEY_HIDDEN_INTERNAL_SESSIONS, Object.keys(state.hiddenInternalSessions));
}

function loadSdkSessions(): AgentProcessInfo[] {
  try {
    return normalizePersistedSdkSessions(readUserJsonStorage<unknown>(STORAGE_KEY_SDK_SESSIONS, []), {
      exposeWorkspacePath,
    });
  } catch {
    return [];
  }
}

function exposeWorkspacePath(path: string | null | undefined): string {
  return exposeRuntimeWorkspacePath(path, { allowLocal: allowsLocalWorkspacePaths() });
}

function sanitizeSdkSession(session: AgentProcessInfo): AgentProcessInfo {
  return {
    ...session,
    cwd: exposeWorkspacePath(session.cwd),
  };
}

function persistSdkSessions(sessions: AgentProcessInfo[]) {
  writeUserJsonStorage(STORAGE_KEY_SDK_SESSIONS, sessions.map(sanitizeSdkSession));
}

function sessionStateFromProcess(session: AgentProcessInfo): AgentSessionState {
  return {
    sessionId: session.sessionId,
    agentId: session.agentId ?? null,
    model: session.model || "",
    followDefaultModel: session.followDefaultModel ?? !session.model,
    cwd: exposeWorkspacePath(session.cwd),
    tools: [],
    permissionMode: session.permissionMode || "default",
    mcpServers: [],
    agents: [],
    slashCommands: [],
    skills: [],
    totalCostUsd: 0,
    numTurns: 0,
    contextUsedPercent: 0,
    isCompacting: false,
    totalLinesAdded: 0,
    totalLinesRemoved: 0,
  };
}

const initialSdkSessions = loadSdkSessions();

function loadPersistedAssistantBlocks(): PersistedAssistantBlocks {
  try {
    const parsed = readUserJsonStorage<PersistedAssistantBlocks>(STORAGE_KEY_ASSISTANT_BLOCKS, {});
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

const persistedAssistantBlocks = loadPersistedAssistantBlocks();
type StreamEventListener = (event: Record<string, unknown>) => void;
const streamEventListeners = new Map<string, Set<StreamEventListener>>();

function persistAssistantBlocks() {
  writeUserJsonStorage(STORAGE_KEY_ASSISTANT_BLOCKS, persistedAssistantBlocks);
}

function cacheAssistantBlocks(sessionId: string, msg: AgentChatMessage) {
  if (msg.role !== "assistant" || !msg.contentBlocks?.length) return;
  if (!persistedAssistantBlocks[sessionId]) {
    persistedAssistantBlocks[sessionId] = {};
  }
  persistedAssistantBlocks[sessionId][msg.id] = msg.contentBlocks;
}

function rebuildAssistantBlocksForSession(sessionId: string, msgs: AgentChatMessage[]) {
  const next: Record<string, ContentBlock[]> = {};
  for (const msg of msgs) {
    if (msg.role === "assistant" && msg.contentBlocks?.length) {
      next[msg.id] = msg.contentBlocks;
    }
  }
  if (Object.keys(next).length > 0) {
    persistedAssistantBlocks[sessionId] = next;
  } else {
    delete persistedAssistantBlocks[sessionId];
  }
}

function parseToolInputObject(rawInput: string): Record<string, unknown> {
  if (!rawInput) return {};
  try {
    const parsed = JSON.parse(rawInput);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : { __raw: rawInput };
  } catch {
    return { __raw: rawInput };
  }
}

const state = proxy<AgentStoreState>({
  sessions: Object.fromEntries(
    initialSdkSessions.map((session) => [session.sessionId, sessionStateFromProcess(session)]),
  ),
  sdkSessions: initialSdkSessions,
  hiddenInternalSessions: loadHiddenInternalSessions(),
  currentSessionId: readUserStorage(STORAGE_KEY_SESSION),
  messages: {},
  streaming: {},
  streamingStartedAt: {},
  bypassTurns: {},
  agentMessages: {},
  activeToolProgress: {},
  activeToolProgressById: {},
  completedTools: {},
  streamingSegments: {},
  authStatus: {},
  toolConfirmationRequests: {},
  connectionStatus: {},
  cliConnected: {},
  sessionStatus: {},
  sessionNames: normalizePersistedSessionNames(readUserJsonStorage<unknown>(STORAGE_KEY_NAMES, {})),
  unreadCounts: {},
  pendingChatPrefill: {},
  latestAssetProposal: {},
  voiceInputActive: {},
  lastAssistantText: {},
  streamPerfHint: {},
  bypassConversations: {},
  sessionTokenUsage: {},
  sessionFiles: {},
  runtimeTimeline: {},
  planningStates: {},
});

function replacePersistedAssistantBlocks(next: PersistedAssistantBlocks) {
  for (const sessionId of Object.keys(persistedAssistantBlocks)) {
    delete persistedAssistantBlocks[sessionId];
  }
  Object.assign(persistedAssistantBlocks, next);
}

function reloadUserScopedAgentState() {
  const nextSdkSessions = loadSdkSessions();
  replacePersistedAssistantBlocks(loadPersistedAssistantBlocks());
  streamEventListeners.clear();

  state.sessions = Object.fromEntries(
    nextSdkSessions.map((session) => [session.sessionId, sessionStateFromProcess(session)]),
  );
  state.sdkSessions = nextSdkSessions;
  state.hiddenInternalSessions = loadHiddenInternalSessions();
  state.currentSessionId = readUserStorage(STORAGE_KEY_SESSION);
  state.messages = {};
  state.streaming = {};
  state.streamingStartedAt = {};
  state.bypassTurns = {};
  state.agentMessages = {};
  state.activeToolProgress = {};
  state.activeToolProgressById = {};
  state.completedTools = {};
  state.streamingSegments = {};
  state.authStatus = {};
  state.toolConfirmationRequests = {};
  state.connectionStatus = {};
  state.cliConnected = {};
  state.sessionStatus = {};
  state.sessionNames = normalizePersistedSessionNames(readUserJsonStorage<unknown>(STORAGE_KEY_NAMES, {}));
  state.unreadCounts = {};
  state.voiceInputActive = {};
  state.lastAssistantText = {};
  state.streamPerfHint = {};
  state.bypassConversations = {};
  state.sessionTokenUsage = {};
  state.sessionFiles = {};
  state.runtimeTimeline = {};
  state.planningStates = {};
}

const actions = {
  // --- Sessions ---
  setCurrentSession(id: string | null) {
    state.currentSessionId = id;
    if (id) {
      writeUserStorage(STORAGE_KEY_SESSION, id);
    } else {
      removeUserStorage(STORAGE_KEY_SESSION);
    }
  },

  addSession(session: AgentSessionState) {
    const existing = state.sessions[session.sessionId];
    state.sessions[session.sessionId] = {
      ...session,
      cwd: exposeWorkspacePath(session.cwd),
      assetId: session.assetId ?? existing?.assetId,
      agentPhase: session.agentPhase ?? existing?.agentPhase,
    };
  },

  updateSession(sessionId: string, updates: Partial<AgentSessionState>) {
    const existing = state.sessions[sessionId];
    if (existing) {
      Object.assign(existing, "cwd" in updates ? { ...updates, cwd: exposeWorkspacePath(updates.cwd) } : updates);
    }
  },

  onStreamEvent(sessionId: string, listener: StreamEventListener) {
    const listeners = streamEventListeners.get(sessionId) ?? new Set<StreamEventListener>();
    listeners.add(listener);
    streamEventListeners.set(sessionId, listeners);
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) {
        streamEventListeners.delete(sessionId);
      }
    };
  },

  emitStreamEvent(sessionId: string, event: Record<string, unknown>) {
    const listeners = streamEventListeners.get(sessionId);
    if (!listeners) return;
    for (const listener of Array.from(listeners)) {
      listener(event);
    }
  },

  setSessionTokenUsage(sessionId: string, totalTokens: number) {
    state.sessionTokenUsage[sessionId] = totalTokens;
  },

  setSessionAssetId(sessionId: string, assetId: string) {
    const existing = state.sessions[sessionId];
    if (existing) {
      existing.assetId = assetId;
    }
  },

  addSessionFile(sessionId: string, file: { uploadId: string; fileName: string; mimeType?: string }) {
    const files = state.sessionFiles[sessionId] || [];
    if (!files.some((f) => f.uploadId === file.uploadId)) {
      state.sessionFiles[sessionId] = [...files, file];
    }
  },

  addRuntimeTimelineEvent(sessionId: string, event: AgentRuntimeTimelineEvent) {
    const current = state.runtimeTimeline[sessionId] || [];
    const existingIndex = current.findIndex((item) => item.id === event.id);
    const next =
      existingIndex >= 0 ? current.map((item, index) => (index === existingIndex ? event : item)) : [...current, event];
    state.runtimeTimeline[sessionId] = next.slice(-24);
  },

  clearRuntimeTimeline(sessionId: string) {
    delete state.runtimeTimeline[sessionId];
  },

  setPlanningState(sessionId: string, planningState: AgentPlanningState | null) {
    if (!planningState) {
      delete state.planningStates[sessionId];
      return;
    }
    state.planningStates[sessionId] = planningState;
  },

  removeSession(sessionId: string) {
    delete state.sessions[sessionId];
    delete state.messages[sessionId];
    delete persistedAssistantBlocks[sessionId];
    delete state.streaming[sessionId];
    delete state.streamingStartedAt[sessionId];
    delete state.bypassTurns[sessionId];
    delete state.agentMessages[sessionId];
    delete state.activeToolProgress[sessionId];
    delete state.activeToolProgressById[sessionId];
    delete state.authStatus[sessionId];
    delete state.connectionStatus[sessionId];
    delete state.cliConnected[sessionId];
    delete state.sessionStatus[sessionId];
    delete state.sessionNames[sessionId];
    delete state.pendingChatPrefill[sessionId];
    delete state.latestAssetProposal[sessionId];
    delete state.voiceInputActive[sessionId];
    delete state.lastAssistantText[sessionId];
    delete state.streamPerfHint[sessionId];
    delete state.bypassConversations[sessionId];
    delete state.completedTools[sessionId];
    delete state.streamingSegments[sessionId];
    delete state.hiddenInternalSessions[sessionId];
    delete state.sessionTokenUsage[sessionId];
    delete state.sessionFiles[sessionId];
    delete state.runtimeTimeline[sessionId];
    delete state.planningStates[sessionId];
    streamEventListeners.delete(sessionId);
    state.sdkSessions = state.sdkSessions.filter((session) => session.sessionId !== sessionId);
    persistHiddenInternalSessions();
    persistSdkSessions(state.sdkSessions as AgentProcessInfo[]);
    persistAssistantBlocks();
    writeUserJsonStorage(STORAGE_KEY_NAMES, state.sessionNames);
    if (state.currentSessionId === sessionId) {
      state.currentSessionId = null;
      removeUserStorage(STORAGE_KEY_SESSION);
    }
  },

  setSdkSessions(sessions: AgentProcessInfo[]) {
    state.sdkSessions = sessions
      .map(sanitizeSdkSession)
      .filter((session) => !state.hiddenInternalSessions[session.sessionId])
      .sort((a, b) => b.createdAt - a.createdAt || b.sessionId.localeCompare(a.sessionId));
    persistSdkSessions(state.sdkSessions as AgentProcessInfo[]);
  },

  upsertSdkSession(session: AgentProcessInfo) {
    if (state.hiddenInternalSessions[session.sessionId]) {
      state.sdkSessions = state.sdkSessions.filter((item) => item.sessionId !== session.sessionId);
      return;
    }
    const next = state.sdkSessions.filter((item) => item.sessionId !== session.sessionId);
    next.push(sanitizeSdkSession(session));
    next.sort((a, b) => b.createdAt - a.createdAt);
    state.sdkSessions = next;
    persistSdkSessions(next);
  },

  markInternalSession(sessionId: string) {
    state.hiddenInternalSessions[sessionId] = true;
    state.sdkSessions = state.sdkSessions.filter((s) => s.sessionId !== sessionId);
    persistSdkSessions(state.sdkSessions as AgentProcessInfo[]);
    persistHiddenInternalSessions();
  },

  unmarkInternalSession(sessionId: string) {
    delete state.hiddenInternalSessions[sessionId];
    persistHiddenInternalSessions();
  },

  isInternalSession(sessionId: string) {
    return !!state.hiddenInternalSessions[sessionId];
  },

  // --- Messages ---
  appendMessage(sessionId: string, msg: AgentChatMessage) {
    if (!state.messages[sessionId]) {
      state.messages[sessionId] = [];
    }
    state.messages[sessionId].push(msg);
    cacheAssistantBlocks(sessionId, msg);
    persistAssistantBlocks();
  },

  setMessages(sessionId: string, msgs: AgentChatMessage[]) {
    state.messages[sessionId] = msgs;
    rebuildAssistantBlocksForSession(sessionId, msgs);
    persistAssistantBlocks();
  },

  upsertMessage(sessionId: string, msg: AgentChatMessage) {
    const current = state.messages[sessionId] || [];
    const index = current.findIndex((item) => item.id === msg.id);
    if (index >= 0) {
      // Immutable update: build new array with replaced element
      const next = [...current];
      next[index] = msg;
      state.messages[sessionId] = next;
      cacheAssistantBlocks(sessionId, msg);
      persistAssistantBlocks();
      return;
    }
    state.messages[sessionId] = [...current, msg];
    cacheAssistantBlocks(sessionId, msg);
    persistAssistantBlocks();
  },

  setStreaming(sessionId: string, text: string | null) {
    if (text === null) {
      delete state.streaming[sessionId];
      delete state.streamingStartedAt[sessionId];
    } else {
      state.streaming[sessionId] = text;
    }
  },

  setStreamingStartedAt(sessionId: string, ts: number) {
    state.streamingStartedAt[sessionId] = ts;
  },

  setBypassTurn(sessionId: string, enabled: boolean) {
    if (enabled) {
      state.bypassTurns[sessionId] = true;
      return;
    }
    delete state.bypassTurns[sessionId];
  },

  // --- Connection ---
  setConnectionStatus(sessionId: string, status: "connecting" | "connected" | "disconnected") {
    state.connectionStatus[sessionId] = status;
  },

  setCliConnected(sessionId: string, connected: boolean) {
    state.cliConnected[sessionId] = connected;
  },

  setSessionStatus(sessionId: string, status: "idle" | "running" | "compacting" | null) {
    state.sessionStatus[sessionId] = status;
  },

  // --- Names ---
  setSessionName(sessionId: string, name: string) {
    state.sessionNames[sessionId] = name;
    writeUserJsonStorage(STORAGE_KEY_NAMES, state.sessionNames);
  },

  // --- Unread ---
  incrementUnread(sessionId: string, count = 1) {
    state.unreadCounts[sessionId] = (state.unreadCounts[sessionId] || 0) + count;
  },

  clearUnread(sessionId: string) {
    delete state.unreadCounts[sessionId];
  },

  // --- Agent-to-agent messages ---
  addAgentMessage(sessionId: string, msg: AgentMessage) {
    if (!state.agentMessages[sessionId]) {
      state.agentMessages[sessionId] = [];
    }
    state.agentMessages[sessionId].push(msg);
  },

  removeAgentMessage(sessionId: string, messageId: string) {
    if (state.agentMessages[sessionId]) {
      state.agentMessages[sessionId] = state.agentMessages[sessionId].filter((m) => m.messageId !== messageId);
    }
  },

  updateAgentMessage(sessionId: string, messageId: string, updates: Partial<AgentMessage>) {
    const msg = state.agentMessages[sessionId]?.find((item) => item.messageId === messageId);
    if (!msg) return;
    Object.assign(msg, updates);
  },

  clearAgentMessages(sessionId: string) {
    delete state.agentMessages[sessionId];
  },

  // --- Tool progress ---
  setToolProgress(sessionId: string, progress: ToolProgress | null) {
    state.activeToolProgress[sessionId] = progress;
  },

  upsertToolProgress(sessionId: string, progress: ToolProgress) {
    if (!state.activeToolProgressById[sessionId]) {
      state.activeToolProgressById[sessionId] = {};
    }
    const key = progress.toolUseId || `__name__:${progress.toolName}`;
    state.activeToolProgressById[sessionId][key] = progress;
    state.activeToolProgress[sessionId] = progress;
  },

  getToolProgress(sessionId: string, toolUseId?: string | null, toolName?: string | null): ToolProgress | null {
    const map = state.activeToolProgressById[sessionId];
    if (!map) return null;
    if (toolUseId) {
      return map[toolUseId] ?? null;
    }
    if (toolName) {
      const matches = Object.values(map).filter((progress) => progress.toolName === toolName);
      return matches.length === 1 ? matches[0] : null;
    }
    return state.activeToolProgress[sessionId] ?? null;
  },

  removeToolProgress(sessionId: string, toolUseId?: string | null) {
    if (toolUseId && state.activeToolProgressById[sessionId]) {
      delete state.activeToolProgressById[sessionId][toolUseId];
      if (Object.keys(state.activeToolProgressById[sessionId]).length === 0) {
        delete state.activeToolProgressById[sessionId];
      }
    } else {
      delete state.activeToolProgressById[sessionId];
    }

    const remaining = state.activeToolProgressById[sessionId]
      ? Object.values(state.activeToolProgressById[sessionId])
      : [];
    state.activeToolProgress[sessionId] = remaining.length > 0 ? remaining[remaining.length - 1] : null;
  },

  clearToolProgress(sessionId: string) {
    delete state.activeToolProgressById[sessionId];
    state.activeToolProgress[sessionId] = null;
  },

  addCompletedTool(sessionId: string, tool: CompletedToolCall) {
    if (!state.completedTools[sessionId]) {
      state.completedTools[sessionId] = [];
    }
    state.completedTools[sessionId].push(tool);
  },

  clearCompletedTools(sessionId: string) {
    delete state.completedTools[sessionId];
    delete state.streamingSegments[sessionId];
  },

  /**
   * Flush accumulated streaming segments into a persisted assistant message.
   * Called when streaming ends (completes naturally or is interrupted).
   * Returns the flushed message, or null if nothing to flush.
   */
  flushStreamingToMessage(sessionId: string): AgentChatMessage | null {
    const segments = state.streamingSegments[sessionId];
    if (!segments || segments.length === 0) return null;

    const contentBlocks: ContentBlock[] = [];
    const textParts: string[] = [];

    for (const seg of segments) {
      if (seg.type === "text") {
        textParts.push(seg.content);
      } else if (seg.type === "tool") {
        // Flush any pending text first
        if (textParts.length > 0) {
          contentBlocks.push({
            type: "text",
            text: textParts.join(""),
          });
          textParts.length = 0;
        }
        // Convert CompletedToolCall → tool_use + tool_result blocks
        contentBlocks.push({
          type: "tool_use",
          id: seg.call.toolUseId,
          name: seg.call.toolName,
          input: parseToolInputObject(seg.call.input),
        });
        contentBlocks.push({
          type: "tool_result",
          toolUseId: seg.call.toolUseId,
          content: seg.call.output ?? "",
          isError: seg.call.is_error,
          before: seg.call.before,
          after: seg.call.after,
          filePath: seg.call.filePath,
        });
      }
      // tool_progress segments are transient — skip
    }

    // Flush remaining text
    if (textParts.length > 0) {
      contentBlocks.push({ type: "text", text: textParts.join("") });
    }

    if (contentBlocks.length === 0) return null;

    // Clear streaming state first so appendMessage doesn't try to use it
    delete state.streamingSegments[sessionId];

    const flushedMsg: AgentChatMessage = {
      id: `${Date.now()}-flush`,
      role: "assistant",
      content: "",
      contentBlocks,
      timestamp: Date.now(),
    };

    if (!state.messages[sessionId]) {
      state.messages[sessionId] = [];
    }
    state.messages[sessionId].push(flushedMsg);
    cacheAssistantBlocks(sessionId, flushedMsg);
    persistAssistantBlocks();

    return flushedMsg;
  },

  /** Append text to the last text segment, or push a new one */
  appendStreamingText(sessionId: string, text: string, seq: number) {
    if (!text) return;
    if (!state.streamingSegments[sessionId]) {
      state.streamingSegments[sessionId] = [];
    }
    const segs = state.streamingSegments[sessionId];

    // Find existing text segment
    const existingTextIdx = segs.findIndex((s) => s.type === "text");
    const last = segs[segs.length - 1];

    // If new text starts with existing text content, replace/update the existing segment
    if (existingTextIdx !== -1) {
      const existing = segs[existingTextIdx] as {
        type: "text";
        content: string;
        seq: number;
      };
      if (text.startsWith(existing.content) || existing.content.startsWith(text)) {
        // If new text is a superset (longer) of existing, replace it
        if (text.length >= existing.content.length) {
          existing.content = text;
          existing.seq = seq;
        } else {
          existing.seq = seq;
        }
        state.streamingSegments[sessionId] = [...segs];
        return;
      }
    }

    // Normal append: if consecutive seq, merge with last text segment
    if (last?.type === "text" && last.seq + 1 === seq) {
      last.content += text;
      last.seq = seq;
    } else {
      segs.push({ type: "text", content: text, seq });
    }
    state.streamingSegments[sessionId] = [...segs];
    // (debug instrumentation removed)
  },

  findToolProgressSegmentIndex(
    segs: StreamingSegment[],
    progress: Pick<ToolProgress, "toolUseId" | "toolName">,
  ): number {
    if (progress.toolUseId) {
      return segs.findIndex((seg) => seg.type === "tool_progress" && seg.progress.toolUseId === progress.toolUseId);
    }
    const sameName = segs
      .map((seg, idx) => (seg.type === "tool_progress" && seg.progress.toolName === progress.toolName ? idx : -1))
      .filter((idx) => idx >= 0);
    return sameName.length === 1 ? sameName[0] : -1;
  },

  findCompletedToolSegmentIndex(
    segs: StreamingSegment[],
    call: Pick<CompletedToolCall, "toolUseId" | "toolName">,
  ): number {
    if (call.toolUseId) {
      return segs.findIndex((seg) => seg.type === "tool" && seg.call.toolUseId === call.toolUseId);
    }
    const sameName = segs
      .map((seg, idx) => (seg.type === "tool" && seg.call.toolName === call.toolName ? idx : -1))
      .filter((idx) => idx >= 0);
    return sameName.length === 1 ? sameName[0] : -1;
  },

  /** Upsert active tool progress segment, preserving arrival order */
  upsertStreamingToolProgressSegment(sessionId: string, progress: ToolProgress, seq: number) {
    if (!state.streamingSegments[sessionId]) {
      state.streamingSegments[sessionId] = [];
    }
    const segs = state.streamingSegments[sessionId];
    const completedIdx = actions.findCompletedToolSegmentIndex(segs, progress);
    if (completedIdx >= 0) {
      return;
    }
    const idx = actions.findToolProgressSegmentIndex(segs, progress);
    if (idx >= 0) {
      segs[idx] = { type: "tool_progress", progress, seq: segs[idx].seq };
    } else {
      segs.push({ type: "tool_progress", progress, seq });
    }
  },

  /** Replace active tool progress segment with completed tool segment in-place */
  replaceStreamingToolProgressWithCompleted(
    sessionId: string,
    toolUseId: string,
    call: CompletedToolCall,
    seq: number,
  ) {
    if (!state.streamingSegments[sessionId]) {
      state.streamingSegments[sessionId] = [];
    }
    const segs = state.streamingSegments[sessionId];
    const existingCompletedIdx = actions.findCompletedToolSegmentIndex(segs, call);
    if (existingCompletedIdx >= 0) {
      segs[existingCompletedIdx] = {
        type: "tool",
        call,
        seq: segs[existingCompletedIdx].seq,
      };
      for (let i = segs.length - 1; i >= 0; i--) {
        const segment = segs[i];
        if (
          i !== existingCompletedIdx &&
          segment?.type === "tool_progress" &&
          segment.progress.toolUseId === toolUseId
        ) {
          segs.splice(i, 1);
        }
      }
      return;
    }
    const idx = actions.findToolProgressSegmentIndex(segs, {
      toolUseId: toolUseId,
      toolName: call.toolName,
    });
    if (idx >= 0) {
      segs[idx] = { type: "tool", call, seq: segs[idx].seq };
      for (let i = segs.length - 1; i >= 0; i--) {
        const segment = segs[i];
        if (
          i !== idx &&
          segment?.type === "tool_progress" &&
          (segment.progress.toolUseId === toolUseId || segment.progress.toolName === call.toolName)
        ) {
          segs.splice(i, 1);
        }
      }
      return;
    }
    segs.push({ type: "tool", call, seq });
  },

  // --- Auth status ---
  setAuthStatus(sessionId: string, status: AuthStatus | null) {
    state.authStatus[sessionId] = status;
  },

  // --- Tool confirmation ---
  setToolConfirmationRequest(sessionId: string, request: ToolConfirmationRequest | null) {
    state.toolConfirmationRequests[sessionId] = request;
  },

  clearToolConfirmationRequest(sessionId: string) {
    state.toolConfirmationRequests[sessionId] = null;
  },

  // --- Chat input prefill (e.g. from AssetProposalCard "确认 / 修改 / 取消") ---
  prefillChatInput(sessionId: string, text: string, options: AgentChatInputPrefillOptions = false) {
    const autoSend = typeof options === "boolean" ? options : options.autoSend === true;
    const images: AgentChatInputPrefillImage[] = [];
    if (typeof options !== "boolean") {
      for (const image of options.images ?? []) {
        const mediaType = image.mediaType.trim();
        if (!mediaType || !image.data.trim()) continue;
        const nextImage: AgentChatInputPrefillImage = {
          mediaType,
          data: image.data,
        };
        if (image.name !== undefined) {
          nextImage.name = image.name;
        }
        images.push(nextImage);
      }
    }

    state.pendingChatPrefill[sessionId] = images.length > 0 ? { text, autoSend, images } : { text, autoSend };
  },

  consumeChatPrefill(sessionId: string) {
    delete state.pendingChatPrefill[sessionId];
  },

  // --- Asset development agent: latest proposal awaiting user confirmation ---
  setLatestAssetProposal(sessionId: string, payload: AgentStoreState["latestAssetProposal"][string]) {
    if (!payload) {
      delete state.latestAssetProposal[sessionId];
      return;
    }
    state.latestAssetProposal[sessionId] = payload;
  },

  // --- TTS / Voice input tracking ---
  setVoiceInputActive(sessionId: string, active: boolean) {
    state.voiceInputActive[sessionId] = active;
  },

  setLastAssistantText(sessionId: string, text: string) {
    state.lastAssistantText[sessionId] = text;
  },

  setStreamPerfHint(sessionId: string, hint: StreamPerfHint | null) {
    state.streamPerfHint[sessionId] = hint;
  },

  setBypassConversations(sessionId: string, turns: BypassConversationTurn[]) {
    state.bypassConversations[sessionId] = [...turns];
  },

  addBypassConversation(sessionId: string, turn: BypassConversationTurn) {
    const turns = state.bypassConversations[sessionId] || [];
    state.bypassConversations[sessionId] = [...turns, turn];
  },

  updateBypassConversation(sessionId: string, turnId: string, updates: Partial<BypassConversationTurn>) {
    const turns = state.bypassConversations[sessionId];
    if (!turns) return;
    state.bypassConversations[sessionId] = turns.map((turn) => (turn.id === turnId ? { ...turn, ...updates } : turn));
  },

  removeBypassConversation(sessionId: string, turnId: string) {
    const turns = state.bypassConversations[sessionId];
    if (!turns) return;
    state.bypassConversations[sessionId] = turns.filter((turn) => turn.id !== turnId);
  },

  getPersistedAssistantBlocks(sessionId: string): Record<string, ContentBlock[]> {
    return persistedAssistantBlocks[sessionId] || {};
  },

};

onUserStorageScopeChange(reloadUserScopedAgentState);

export default { state, ...actions };
