import { useReactive } from "ahooks";
import dayjs from "dayjs";
import { ArrowDown, Circle, CircleAlert, Copy, Loader2, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Virtuoso, type VirtuosoHandle } from "react-virtuoso";
import { toast } from "sonner";
import { subscribe, useSnapshot } from "valtio";
import { ErrorBoundary } from "@/components/custom/error-boundary";
import { ToolConfirmationDialog } from "@/components/custom/tool-confirmation-dialog";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
/**
 * Agent Chat — main chat component.
 * Split into focused sub-components under ./chat/.
 */
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { connectSession, sendToSession } from "@/hooks/use-agent-ws";
import { agentApi } from "@/lib/agent-api";
import { buildAgentRuntimeConfig } from "@/lib/agent-runtime-config";
import { readStorage, readUserStorage } from "@/lib/browser-storage";
import { writeClipboardText } from "@/lib/clipboard";
import { AppError } from "@/lib/error";
import { addAuthorizationPolicy, recordAuthorizationDecision } from "@/lib/hitl-auth";
import { allowsLocalWorkspacePaths, hasTauriCore } from "@/lib/runtime-environment";
import { handleMissingSession, relaunchSessionAndRebind } from "@/lib/session-bootstrap";
import { getSessionRuntimeDefaults } from "@/lib/session-runtime-defaults";
import type { ToolConfirmationResponse } from "@/lib/socket-types";
import type { AgentChatMessage } from "@/lib/types";
import { cn } from "@/lib/utils";
import agentModel from "@/models/agent.model";
import agentRegistryModel from "@/models/agent-registry.model";
import settingsModel, { getSessionRoutingModel } from "@/models/settings.model";
import { AgentSessionIdProvider } from "./agent-session-context";
import { AgentAssistPanel } from "./chat/agent-assist-panel";
import { shouldFocusAgentInputFromSlashShortcut } from "./chat/agent-chat-input-focus-state";
import {
  resolveAgentChatHiddenNewMessageCount,
  resolveAgentChatMessageListRenderMode,
  resolveAgentChatScrollButtonPresentation,
  resolveAgentChatStreamingUiState,
} from "./chat/agent-chat-scroll-state";
import {
  resolveChatSearchNavigation,
  resolveChatSearchState,
  shouldOpenChatSearchFromShortcut,
} from "./chat/agent-chat-search-state";
import { resolveAgentChatSessionRuntimeState } from "./chat/agent-chat-session-state";
import { resolveClearSessionDeliveryState } from "./chat/agent-clear-session-state";
import { AgentInput, type AgentInputRef } from "./chat/agent-input";
import type {
  AgentInputFooterActionError,
  AgentInputInterruptResult,
  AgentInputSendResult,
} from "./chat/agent-input-send-state";
import { resolveAgentMessageRetryState } from "./chat/agent-message-retry-state";
import { resolveAgentSlashCommandDispatchAction } from "./chat/agent-slash-command-state";
import { ChatHeader } from "./chat/chat-header";
import { AgentMessageInbox, AuthStatusBanner, ConnectionStatusBanner, EmptyChat } from "./chat/chat-panels";
import MessageItem, { DateSeparator } from "./chat/message-item";
import {
  formatSessionRelaunchError,
  resolveSessionRelaunchFeedback,
  shouldRelaunchSessionBeforeSend,
} from "./chat/session-relaunch-state";
import { SessionStatusBar } from "./chat/session-status-bar";
import { StreamingDisplay } from "./chat/streaming-display";
import {
  formatToolConfirmationDeliveryError,
  resolveToolConfirmationDeliveryAction,
  resolveToolConfirmationDialogDeliveryError,
} from "./chat/tool-confirmation-state";
import type { RichMessage } from "./chat/types";
import { chatMessageToRich, normalizeAgentChatMessages } from "./chat/types";

function isStreamDebugEnabled(): boolean {
  return readStorage("internshannon-stream-debug") === "true";
}

function buildAttachmentsFromImages(
  images?: { mediaType: string; data: string }[],
): { uploadId: string; fileName: string; mimeType?: string; size?: number }[] | undefined {
  if (!images?.length) return undefined;
  const attachments: { uploadId: string; fileName: string; mimeType?: string; size?: number }[] = [];
  for (const img of images) {
    if (img.mediaType.startsWith("image/")) continue;
    const decoded = atob(img.data.replace(/^data:[^;]+;base64,/, ""));
    const fileNameMatch = decoded.match(/^# (.+)\n/);
    const fileName = fileNameMatch?.[1] || `file-${Date.now()}`;
    attachments.push({
      uploadId: `local-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      fileName,
      mimeType: img.mediaType || undefined,
      size: decoded.length,
    });
  }
  return attachments.length > 0 ? attachments : undefined;
}

async function pickNativeDirectory(defaultPath?: string): Promise<string | null> {
  if (!hasTauriCore()) return null;
  const { open } = await import("@tauri-apps/plugin-dialog");
  const targetDir = await open({
    directory: true,
    multiple: false,
    defaultPath,
  });
  return typeof targetDir === "string" ? targetDir : null;
}

async function writeNativeWorkspaceFile(path: string, content: string): Promise<void> {
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke<void>("workspace_write_file", { path, content });
}

function downloadTextFile(filename: string, content: string, type = "application/json") {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.rel = "noopener";
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

async function speakTextInNativeRuntime(text: string): Promise<void> {
  if (!hasTauriCore()) return;
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("voice_tts_speak", { text });
}

// ---------------------------------------------------------------------------
// Text selection floating toolbar
// ---------------------------------------------------------------------------

function SelectionToolbar() {
  const state = useReactive({
    visible: false,
    position: { x: 0, y: 0 },
    selectedText: "",
  });
  const toolbarRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let pendingSelection = false;

    const handleMouseUp = () => {
      pendingSelection = true;
      // Delay to let browser finalize selection
      setTimeout(() => {
        if (!pendingSelection) return;
        const selection = window.getSelection();
        const text = selection?.toString().trim() ?? "";
        if (text.length > 0) {
          const range = selection?.getRangeAt(0);
          const rect = range?.getBoundingClientRect();
          if (rect) {
            state.selectedText = text;
            state.position = {
              x: rect.left + rect.width / 2,
              y: rect.top - 8,
            };
            state.visible = true;
          }
        } else {
          state.visible = false;
        }
        pendingSelection = false;
      }, 10);
    };

    const handleMouseDown = () => {
      pendingSelection = false;
      state.visible = false;
    };

    const handleSelectionChange = () => {
      const selection = window.getSelection();
      if (!selection || selection.isCollapsed) {
        state.visible = false;
      }
    };

    document.addEventListener("mouseup", handleMouseUp);
    document.addEventListener("mousedown", handleMouseDown);
    document.addEventListener("selectionchange", handleSelectionChange);
    return () => {
      document.removeEventListener("mouseup", handleMouseUp);
      document.removeEventListener("mousedown", handleMouseDown);
      document.removeEventListener("selectionchange", handleSelectionChange);
    };
  }, [state]);

  const handleCopy = useCallback(async () => {
    if (!state.selectedText) return;
    await writeClipboardText(state.selectedText);
    toast.success("已复制到剪贴板");
    state.visible = false;
  }, [state]);

  if (!state.visible) return null;

  return (
    <div
      ref={toolbarRef}
      className="fixed z-[100] flex items-center gap-0.5 rounded-[8px] border border-black/10 bg-background/95 px-1.5 py-1 shadow-[0_12px_16px_-4px_rgba(36,36,36,0.08)] backdrop-blur-md"
      style={{
        left: `${state.position.x}px`,
        top: `${state.position.y}px`,
        transform: "translate(-50%, -100%)",
      }}
    >
      <button
        type="button"
        onClick={handleCopy}
        className="flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground transition-colors"
        title="复制"
      >
        <Copy className="size-3.5" />
      </button>
    </div>
  );
}

async function waitForSessionConnection(sessionId: string, timeoutMs = 1500): Promise<boolean> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (agentModel.state.connectionStatus[sessionId] === "connected") {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 80));
  }
  return agentModel.state.connectionStatus[sessionId] === "connected";
}

type SessionOutgoingMessage = Parameters<typeof sendToSession>[1];

async function sendSessionMessageWithRetry(
  sessionId: string,
  message: SessionOutgoingMessage,
  timeoutMs = 1000,
): Promise<boolean> {
  let sent = sendToSession(sessionId, message);
  if (sent) return true;

  connectSession(sessionId);
  if (await waitForSessionConnection(sessionId, timeoutMs)) {
    sent = sendToSession(sessionId, message);
  }
  return sent;
}

async function sendToolConfirmationResponseWithRetry(
  sessionId: string,
  response: ToolConfirmationResponse,
): Promise<boolean> {
  return sendSessionMessageWithRetry(sessionId, {
    type: "tool_confirmation_response",
    ...response,
  });
}

function resetLocalConversationAfterClear(sessionId: string) {
  agentModel.setMessages(sessionId, []);
  agentModel.setStreaming(sessionId, null);
  agentModel.setBypassTurn(sessionId, false);
  agentModel.setBypassConversations(sessionId, []);
  agentModel.setPlanningState(sessionId, null);
  agentModel.clearToolProgress(sessionId);
  agentModel.clearCompletedTools(sessionId);
  agentModel.clearToolConfirmationRequest(sessionId);
  agentModel.clearAgentMessages(sessionId);
  agentModel.setAuthStatus(sessionId, null);
  agentModel.setLatestAssetProposal(sessionId, null);
  agentModel.setVoiceInputActive(sessionId, false);
  agentModel.setLastAssistantText(sessionId, "");
  agentModel.setStreamPerfHint(sessionId, null);
  agentModel.clearRuntimeTimeline(sessionId);
  agentModel.setSessionStatus(sessionId, "idle");
}

function isBypassMessage(msg: RichMessage): boolean {
  return msg.role === "assistant" && (msg.source as string | undefined) === "command:/btw";
}

function getMessageText(msg: RichMessage): string {
  return msg.blocks
    .filter((block): block is Extract<(typeof msg.blocks)[number], { type: "text" }> => block.type === "text")
    .map((block) => block.content)
    .join("\n\n");
}

function isBypassPromptMessage(msg: RichMessage): boolean {
  return msg.role === "user" && getMessageText(msg).trim().startsWith("/btw");
}

function matchesSearch(msg: RichMessage, searchQuery: string): boolean {
  if (!searchQuery.trim()) return true;
  const q = searchQuery.toLowerCase();
  for (const block of msg.blocks) {
    if (block.type === "text" && block.content.toLowerCase().includes(q)) return true;
    if (
      block.type === "tool_call" &&
      (block.tool.toLowerCase().includes(q) ||
        block.input.toLowerCase().includes(q) ||
        block.output?.toLowerCase().includes(q))
    )
      return true;
  }
  return false;
}

function formatTranscriptBlock(block: RichMessage["blocks"][number], index: number): string[] {
  const label = `${index + 1}.`;
  switch (block.type) {
    case "text":
      return [`${label} TEXT`, block.content.trim()];
    case "tool_call": {
      // Format tool input - show (empty) for null/undefined/empty, otherwise show the content
      const inputStr = block.input;
      const isEmptyInput = !inputStr || inputStr === "{}" || inputStr === "[]" || inputStr === "(empty)";
      return [
        `${label} TOOL ${block.tool}${
          block.durationMs ? ` (${block.durationMs}ms)` : ""
        }${block.isError ? " [error]" : ""}`,
        `INPUT:\n${isEmptyInput ? "(empty)" : inputStr}`,
        ...(block.output ? [`OUTPUT:\n${block.output}`] : []),
        ...(block.filePath ? [`FILE: ${block.filePath}`] : []),
        ...(block.before ? [`BEFORE:\n${block.before}`] : []),
        ...(block.after ? [`AFTER:\n${block.after}`] : []),
      ];
    }
    default:
      return [`${label} UNKNOWN_BLOCK`];
  }
}

function formatTranscriptMessage(msg: RichMessage, index: number): string {
  const header = [
    `[${index + 1}] ${msg.role.toUpperCase()} | ${dayjs(msg.timestamp).format("YYYY-MM-DD HH:mm:ss")}`,
    ...(msg.source ? [`SOURCE: ${msg.source}`] : []),
    ...(msg.model ? [`MODEL: ${msg.model}`] : []),
    ...(msg.stopReason ? [`STOP_REASON: ${msg.stopReason}`] : []),
    ...(msg.meta?.provider ? [`PROVIDER: ${msg.meta.provider}`] : []),
    ...(msg.meta?.requestModel ? [`REQUEST_MODEL: ${msg.meta.requestModel}`] : []),
    ...(msg.meta?.responseModel ? [`RESPONSE_MODEL: ${msg.meta.responseModel}`] : []),
    ...(msg.durationMs != null ? [`DURATION_MS: ${msg.durationMs}`] : []),
    ...(msg.usage?.total_tokens != null ? [`TOTAL_TOKENS: ${msg.usage.total_tokens}`] : []),
  ];

  const blockSections = msg.blocks
    .flatMap((block, blockIndex) => formatTranscriptBlock(block, blockIndex))
    .filter((line) => line.trim().length > 0);

  return [...header, "", ...blockSections].join("\n");
}

function buildConversationTranscript({
  sessionId,
  cwd,
  messages,
  bypassTurns,
  streamingText,
  streamingSegments,
}: {
  sessionId: string;
  cwd?: string;
  messages: readonly RichMessage[];
  bypassTurns: ReadonlyArray<{
    id: string;
    question: string;
    answer: string;
    timestamp: number;
  }>;
  streamingText?: string;
  streamingSegments?: readonly import("@/models/agent.model").StreamingSegment[];
}): string {
  const sections = [
    "# 书小安 Conversation Transcript",
    `SESSION_ID: ${sessionId}`,
    ...(cwd ? [`WORKSPACE: ${cwd}`] : []),
    `EXPORTED_AT: ${dayjs().format("YYYY-MM-DD HH:mm:ss")}`,
    "",
    "## Main Timeline",
  ];

  if (messages.length === 0) {
    sections.push("(empty)");
  } else {
    sections.push(messages.map((message, index) => formatTranscriptMessage(message, index)).join("\n\n---\n\n"));
  }

  if (bypassTurns.length > 0) {
    sections.push("", "## Bypass Conversations");
    sections.push(
      bypassTurns
        .map(
          (turn, index) =>
            `[${index + 1}] ${dayjs(turn.timestamp).format(
              "YYYY-MM-DD HH:mm:ss",
            )}\nQUESTION:\n${turn.question || "(empty)"}\n\nANSWER:\n${turn.answer || "(pending)"}`,
        )
        .join("\n\n---\n\n"),
    );
  }

  const hasStreamingSegments = (streamingSegments || []).length > 0;
  const inProgressLines = [
    ...(!hasStreamingSegments && streamingText?.trim() ? [`TEXT:\n${streamingText.trim()}`] : []),
    ...(hasStreamingSegments
      ? [
          `SEGMENTS:\n${(streamingSegments || [])
            .map((segment, index) => {
              if (segment.type === "text") {
                return `${index + 1}. TEXT\n${segment.content}`;
              }
              if (segment.type === "tool_progress") {
                return `${index + 1}. TOOL_PROGRESS ${segment.progress.toolName} (${Math.round(
                  segment.progress.elapsedTimeSeconds,
                )}s)\nINPUT:\n${segment.progress.input || "(empty)"}${
                  segment.progress.output ? `\n\nOUTPUT:\n${segment.progress.output}` : ""
                }`;
              }
              return `${index + 1}. TOOL ${segment.call.toolName}${
                segment.call.is_error ? " [error]" : ""
              }\nINPUT:\n${segment.call.input || "(empty)"}\n\nOUTPUT:\n${segment.call.output || "(empty)"}`;
            })
            .join("\n\n")}`,
        ]
      : []),
  ];

  if (inProgressLines.length > 0) {
    sections.push("", "## In Progress", ...inProgressLines);
  }

  return `${sections.join("\n")}\n`;
}

function buildSessionExportPayload({
  sessionId,
  cwd,
  agent,
  sessionState,
  processInfo,
  messages,
  bypassTurns,
  streamingText,
  streamingSegments,
}: {
  sessionId: string;
  cwd?: string;
  agent: ReturnType<typeof agentRegistryModel.getSessionAgent> | null;
  sessionState?: unknown;
  processInfo?: unknown;
  messages: readonly AgentChatMessage[];
  bypassTurns: ReadonlyArray<{
    id: string;
    question: string;
    answer: string;
    timestamp: number;
  }>;
  streamingText?: string;
  streamingSegments?: readonly import("@/models/agent.model").StreamingSegment[];
}) {
  return {
    exported_at: new Date().toISOString(),
    sessionId: sessionId,
    workspace: cwd ?? null,
    agent: agent
      ? {
          id: agent.id,
          name: agent.name,
          description: agent.description,
          tags: agent.tags ?? [],
        }
      : null,
    session: processInfo ?? null,
    session_state: sessionState ?? null,
    messages,
    bypass_conversations: bypassTurns,
    streaming_text: streamingText ?? null,
    streaming_segments: streamingSegments ?? [],
  };
}

export default function AgentChat({
  apiUrl,
  sessionId,
  cwd,
  onSessionChange,
  disableMention = false,
  disableWhisper,
  disableSlash,
  inputVariant = "default",
  readOnly = false,
  showStatusBar = true,
  statusBarOptions,
  messageLayout = "default",
  showSessionManagement = true,
  starterPrompts,
  onWorkspaceOpen,
  focusMessageId,
  focusMessageRequest = 0,
  showHeader = true,
  onSend,
  onBeforeSend,
  onInterrupt,
  filterMessage,
  mapMessage,
  streamingTransformText,
}: {
  apiUrl?: string;
  sessionId: string;
  cwd?: string;
  onSessionChange?: (id: string) => void;
  disableMention?: boolean;
  disableWhisper?: boolean;
  disableSlash?: boolean;
  inputVariant?: "default";
  readOnly?: boolean;
  showStatusBar?: boolean;
  statusBarOptions?: {
    showModelSwitcher?: boolean;
  };
  messageLayout?: "default" | "compact-left";
  showSessionManagement?: boolean;
  /** 空会话里展示的「示例提问」:点击即预填并自动发送。用于会话型智能体(InternShannon)的上手引导。 */
  starterPrompts?: readonly string[];
  /** 透传 ChatHeader:提供时「工作区」改由宿主打开(InternShannon悬浮窗内嵌视图)。 */
  onWorkspaceOpen?: () => void;
  /** 宿主触发的消息定位请求，用于从记忆时间轴回到当时对话。 */
  focusMessageId?: string;
  focusMessageRequest?: number;
  /** Hide the top ChatHeader entirely (default: true). Embedders that render
   *  their own panel header (e.g. the asset editor's docked 开发智能体 panel)
   *  pass false to avoid a duplicated header bar. */
  showHeader?: boolean;
  onSend?: (
    text: string,
    images?: { mediaType: string; data: string }[],
    options?: { mode?: "default" | "whisper" },
  ) => AgentInputSendResult | Promise<AgentInputSendResult>;
  /**
   * 发送前钩子（自由输入框路径）。在消息真正发出前 await，可用于副作用（如宿主先保存当前
   * 状态）；返回 string 则用它替换发送内容（如给消息补一段画布上下文），返回 undefined 保持原文。
   * 不影响其它 caller —— 仅当传入时生效。
   */
  onBeforeSend?: (text: string) => string | undefined | Promise<string | undefined>;
  onInterrupt?: () => AgentInputInterruptResult | Promise<AgentInputInterruptResult>;
  filterMessage?: (message: AgentChatMessage) => boolean;
  mapMessage?: (message: AgentChatMessage) => AgentChatMessage;
  streamingTransformText?: (content: string) => string;
}) {
  const {
    messages,
    connectionStatus,
    sessionStatus,
    sessions,
    sdkSessions,
    streaming,
    streamingSegments,
    bypassConversations,
    toolConfirmationRequests,
    planningStates,
  } = useSnapshot(agentModel.state);
  const { revision: agentRegistryRevision } = useSnapshot(agentRegistryModel.state);
  const rawMessages = messages[sessionId] || [];
  const safeMessages = useMemo(() => normalizeAgentChatMessages(rawMessages), [rawMessages]);
  const agent = agentRegistryModel.getSessionAgent(sessionId);
  void agentRegistryRevision;
  const isBackendLockedAgent = agent?.id === "asset";
  const processInfo = sdkSessions.find((s) => s.sessionId === sessionId);
  const currentSession = sessions[sessionId];
  const currentSessionRuntime = resolveAgentChatSessionRuntimeState(currentSession);
  const currentSessionPrompt = currentSessionRuntime.systemPrompt;
  const isRunning = sessionStatus[sessionId] === "running";
  const isCompacting = sessionStatus[sessionId] === "compacting";
  const planningState = planningStates[sessionId] ?? null;
  const hasStreamingUi = resolveAgentChatStreamingUiState({
    streamingText: streaming[sessionId],
    streamingSegmentCount: streamingSegments[sessionId]?.length || 0,
    isRunning,
    isCompacting,
  });
  const isExited = sdkSessions.find((s) => s.sessionId === sessionId)?.state === "exited";
  const state = useReactive({
    relaunching: false,
    relaunchError: null as string | null,
    searchQuery: "",
    searchFocusRequest: 0,
    showScrollBtn: false,
    hiddenNewMessageCount: 0,
    showShortcutsHelp: false,
    searchCurrentIndex: 0,
    pendingToolConfirmationRequestId: null as string | null,
    toolConfirmationDeliveryError: null as { requestId: string; message: string } | null,
    inputActionError: null as AgentInputFooterActionError | null,
    modelSwitcherFocusRequest: 0,
  });
  const searchQuery = state.searchQuery;
  const fallbackWorkspaceDir =
    cwd || (allowsLocalWorkspacePaths() ? settingsModel.state.agentDefaults.workspaceRoot : undefined) || undefined;
  const hasSession = Boolean(sessions[sessionId]);

  const richMessages = useMemo(
    () =>
      safeMessages
        .filter((m) => (filterMessage ? filterMessage(m) : true))
        .map((m) => (mapMessage ? mapMessage(m) : m))
        .map((m) => chatMessageToRich(m)),
    [filterMessage, mapMessage, safeMessages],
  );

  const displayMessages = useMemo(
    () =>
      richMessages.filter(
        (msg) => !isBypassMessage(msg) && !isBypassPromptMessage(msg) && matchesSearch(msg, searchQuery),
      ),
    [richMessages, searchQuery],
  );
  const messageListRenderMode = resolveAgentChatMessageListRenderMode({
    messageCount: displayMessages.length,
  });
  const searchState = resolveChatSearchState({
    query: searchQuery,
    matchCount: displayMessages.length,
    currentIndex: state.searchCurrentIndex,
  });
  const previousSearchQueryRef = useRef(searchQuery);
  const retryState = useMemo(
    () =>
      resolveAgentMessageRetryState({
        messages: safeMessages,
        isRunning,
        readOnly,
      }),
    [isRunning, readOnly, safeMessages],
  );

  const bypassTurns = useMemo(
    () =>
      (bypassConversations[sessionId] || []).filter((turn) => {
        if (!searchQuery.trim()) return true;
        const q = searchQuery.toLowerCase();
        return turn.question.toLowerCase().includes(q) || turn.answer.toLowerCase().includes(q);
      }),
    [bypassConversations, searchQuery, sessionId],
  );

  const copyConversationTranscript = useCallback(async () => {
    const transcript = buildConversationTranscript({
      sessionId,
      cwd,
      messages: richMessages,
      bypassTurns: bypassConversations[sessionId] || [],
      streamingText: streaming[sessionId],
      streamingSegments: streamingSegments[sessionId] || [],
    });
    try {
      await writeClipboardText(transcript);
      toast.success("完整对话流已复制");
    } catch (error) {
      console.error("Failed to copy conversation transcript:", error);
      toast.error("复制对话流失败");
    }
  }, [bypassConversations, cwd, richMessages, sessionId, streaming, streamingSegments]);

  const exportSessionJson = useCallback(async () => {
    const payload = buildSessionExportPayload({
      sessionId,
      cwd,
      agent,
      sessionState: sessions[sessionId],
      processInfo,
      messages: safeMessages,
      bypassTurns: bypassConversations[sessionId] || [],
      streamingText: streaming[sessionId],
      streamingSegments: streamingSegments[sessionId] || [],
    });
    try {
      const filename = `internshannon-session-${sessionId.slice(0, 8)}-${dayjs().format("YYYYMMDD-HHmmss")}.json`;
      const content = JSON.stringify(payload, null, 2);
      if (hasTauriCore()) {
        const targetDir = await pickNativeDirectory(cwd);
        if (!targetDir) return;
        const path = `${targetDir.replace(/\/+$/, "")}/${filename}`;
        await writeNativeWorkspaceFile(path, content);
        toast.success("会话 JSON 已导出");
        return;
      }
      downloadTextFile(filename, content);
      toast.success("会话 JSON 已下载");
    } catch (error) {
      console.error("Failed to export session JSON:", error);
      toast.error("导出会话 JSON 失败");
    }
  }, [bypassConversations, cwd, agent, processInfo, safeMessages, sessionId, sessions, streaming, streamingSegments]);

  const virtuosoRef = useRef<VirtuosoHandle>(null);
  const inputRef = useRef<AgentInputRef>(null);
  // true = user intentionally scrolled up, stop auto-follow
  const userScrolledUpRef = useRef(false);
  const scrollerElRef = useRef<HTMLElement | null>(null);
  const messageCountSessionRef = useRef(sessionId);
  const previousMessageCountRef = useRef(richMessages.length);
  const [highlightedMessageId, setHighlightedMessageId] = useState<string | null>(null);

  const isNearBottom = useCallback((el: HTMLElement, threshold = 72) => {
    return el.scrollHeight - el.scrollTop - el.clientHeight <= threshold;
  }, []);

  // Scroll to bottom using the active message scroller.
  const scrollToBottom = useCallback((behavior: "smooth" | "auto" = "auto") => {
    const scroller = scrollerElRef.current;
    if (scroller) {
      scroller.scrollTo({ top: scroller.scrollHeight, behavior });
    }
    virtuosoRef.current?.scrollToIndex({
      index: "LAST",
      align: "end",
      behavior,
    });
  }, []);

  const initialBottomSessionRef = useRef<string | null>(null);
  useEffect(() => {
    if (initialBottomSessionRef.current === sessionId) return;
    if (displayMessages.length === 0 && !hasStreamingUi) return;

    initialBottomSessionRef.current = sessionId;
    userScrolledUpRef.current = false;
    state.showScrollBtn = false;
    state.hiddenNewMessageCount = 0;
    messageCountSessionRef.current = sessionId;
    previousMessageCountRef.current = richMessages.length;

    const frame = window.requestAnimationFrame(() => scrollToBottom("auto"));
    const timer = window.setTimeout(() => scrollToBottom("auto"), 120);
    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(timer);
    };
  }, [displayMessages.length, hasStreamingUi, richMessages.length, scrollToBottom, sessionId, state]);

  // Connect WebSocket on mount + clear unread
  useEffect(() => {
    connectSession(sessionId);
    agentModel.clearUnread(sessionId);
  }, [sessionId]);

  // Refresh runtime prompt on chat mount so the active session picks up
  // the agent's latest configured knowledge bases and skills.
  useEffect(() => {
    if (connectionStatus[sessionId] !== "connected") return;
    if (isBackendLockedAgent) return;
    let cancelled = false;

    async function syncRuntimePrompt() {
      if (currentSessionPrompt) {
        sendToSession(sessionId, {
          type: "set_systemPrompt",
          systemPrompt: currentSessionPrompt,
        });
        return;
      }
      const agent = agentRegistryModel.getSessionAgent(sessionId);
      if (!agent) return;
      const runtimeConfig = await buildAgentRuntimeConfig(agent, {
        includeWorkspaceSkills: !apiUrl,
      });
      if (cancelled || !runtimeConfig.systemPrompt) return;
      sendToSession(sessionId, {
        type: "set_systemPrompt",
        systemPrompt: runtimeConfig.systemPrompt,
      });
    }

    syncRuntimePrompt().catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [apiUrl, connectionStatus, currentSessionPrompt, isBackendLockedAgent, sessionId]);

  // Auto-scroll when new messages arrive
  useEffect(() => {
    const isNewSession = messageCountSessionRef.current !== sessionId;
    const previousMessageCount = isNewSession ? richMessages.length : previousMessageCountRef.current;
    messageCountSessionRef.current = sessionId;
    previousMessageCountRef.current = richMessages.length;

    agentModel.clearUnread(sessionId);
    state.hiddenNewMessageCount = isNewSession
      ? 0
      : resolveAgentChatHiddenNewMessageCount({
          previousMessageCount,
          nextMessageCount: richMessages.length,
          currentHiddenNewMessageCount: state.hiddenNewMessageCount,
          userScrolledUp: userScrolledUpRef.current,
        });
    if (!userScrolledUpRef.current) {
      scrollToBottom("smooth");
    }
  }, [richMessages.length, sessionId, scrollToBottom, state]);

  // Subscribe to asset_proposal SSE — the asset (development) agent emits one
  // every time it presents a structured plan for user confirmation. We:
  //   1. Cache the latest proposal in the model so other components (e.g.
  //      AssetCreationWorkspacePage header) can show a "等待确认" hint.
  //   2. Show a toast so users who've scrolled up notice the card.
  //   3. Nudge the chat to bottom so the rendered card is in view.
  useEffect(() => {
    const unsubscribe = agentModel.onStreamEvent(sessionId, (event) => {
      if (event.type !== "asset_proposal") return;
      const proposal = (event as { proposal?: unknown }).proposal;
      if (!proposal || typeof proposal !== "object") return;
      const typed = proposal as {
        category: "agent" | "tool" | "skill" | "mcp" | "code";
        name: string;
        visibility: "public" | "private";
        description?: string;
        agentKind?: "tool" | "application" | "agentic";
        scaffoldTemplate?: string;
        summary?: string;
      };
      agentModel.setLatestAssetProposal(sessionId, {
        proposal: typed,
        receivedAt: Date.now(),
      });
      toast.info("智能体已生成创建方案，请确认或修改", {
        description: `${typed.category} / ${typed.name}`,
        action: {
          label: "查看",
          onClick: () => scrollToBottom("smooth"),
        },
      });
      // Always nudge to bottom so the card is in view even if user didn't
      // click the toast action (they may have scrolled away during the LLM
      // turn).
      if (!userScrolledUpRef.current) {
        scrollToBottom("smooth");
      }
    });
    return unsubscribe;
  }, [sessionId, scrollToBottom]);

  // Auto-scroll during streaming — follows both text deltas and tool call updates.
  // scrollTo MAX scrolls to the absolute bottom including the Virtuoso Footer
  // (StreamingDisplay), which scrollToIndex LAST does not reach.
  const streamingText = streaming[sessionId];
  const streamingSegsCount = (streamingSegments[sessionId] || []).length;
  // biome-ignore lint/correctness/useExhaustiveDependencies: streaming text/segment changes are intentional scroll triggers.
  useEffect(() => {
    if (hasStreamingUi && !userScrolledUpRef.current) {
      scrollToBottom("auto");
    }
  }, [hasStreamingUi, streamingSegsCount, streamingText, scrollToBottom]);

  // Scroll to bottom when entering running state (optimistic loading)
  const currentSessionStatus = sessionStatus[sessionId] ?? null;
  const prevStatusRef = useRef<string | null>(null);
  useEffect(() => {
    if (currentSessionStatus === "running" && prevStatusRef.current !== "running") {
      userScrolledUpRef.current = false;
      state.hiddenNewMessageCount = 0;
      // Multiple attempts to ensure Footer is rendered and visible
      const t1 = setTimeout(() => scrollToBottom("auto"), 50);
      const t2 = setTimeout(() => scrollToBottom("auto"), 200);
      prevStatusRef.current = currentSessionStatus;
      return () => {
        clearTimeout(t1);
        clearTimeout(t2);
      };
    }
    prevStatusRef.current = currentSessionStatus;
  }, [currentSessionStatus, scrollToBottom, state]);

  // Send user message
  const handleDefaultSend = useCallback(
    async (
      text: string,
      images?: { mediaType: string; data: string }[],
      options?: { mode?: "default" | "whisper" },
    ): Promise<boolean> => {
      state.inputActionError = null;
      const t0 = performance.now();
      let targetSessionId = sessionId;
      if (!agentModel.state.sessions[sessionId]) {
        state.inputActionError = {
          message: "当前会话仍在恢复，消息草稿已保留。请稍后重试。",
          dismissLabel: "关闭发送错误提示",
        };
        return false;
      }

      const ensureSessionConnected = async () => {
        if (agentModel.state.connectionStatus[targetSessionId] !== "connected") {
          connectSession(targetSessionId);
          await waitForSessionConnection(targetSessionId);
        }
      };

      const commandText = text.trim();
      const hasDraftPayload = commandText.length > 0 || Boolean(images?.length);
      const keepDraftInRelaunchedSession = () => {
        if (targetSessionId === sessionId || !hasDraftPayload) return;
        agentModel.prefillChatInput(targetSessionId, text, images?.length ? { images } : false);
      };
      const relaunchExitedSessionBeforeSend = async (): Promise<boolean> => {
        const processInfo = agentModel.state.sdkSessions.find((session) => session.sessionId === targetSessionId);
        if (
          !shouldRelaunchSessionBeforeSend({
            sessionState: processInfo?.state,
            hasUserMessage: hasDraftPayload,
          })
        ) {
          return true;
        }

        state.relaunching = true;
        state.relaunchError = null;
        try {
          targetSessionId = await relaunchSessionAndRebind({
            sessionId: targetSessionId,
            preferAgentId: agentRegistryModel.resolveSessionAgentId(targetSessionId),
            apiUrl,
          });
          return true;
        } catch (error) {
          const message = formatSessionRelaunchError(error);
          state.relaunchError = message;
          state.inputActionError = {
            message: `会话重启失败，消息草稿已保留：${message}`,
            dismissLabel: "关闭发送错误提示",
          };
          toast.error(message);
          return false;
        } finally {
          state.relaunching = false;
        }
      };
      const slashCommandAction = resolveAgentSlashCommandDispatchAction({
        commandText,
        hasImages: Boolean(images?.length),
        runtimeCommands: agentModel.state.sessions[targetSessionId]?.slashCommands,
        showStatusBar,
        showModelSwitcher: statusBarOptions?.showModelSwitcher !== false,
      });
      if (slashCommandAction.kind !== "none") {
        if (slashCommandAction.kind === "clear-session") {
          // 进行中禁止清空:/clear 会清掉消息并重置后端会话,在生成中途执行会留下半截状态。
          if (isRunning) {
            toast.error("对话进行中,请等待完成或先停止再清空。");
            return false;
          }
          await ensureSessionConnected();
          const deliveryState = resolveClearSessionDeliveryState({
            sent: await sendSessionMessageWithRetry(targetSessionId, { type: "clear_session" }),
          });
          if (deliveryState.action === "keep-local") {
            state.inputActionError = deliveryState.actionError;
            if (deliveryState.toastMessage) {
              toast.error(deliveryState.toastMessage);
            }
            return false;
          }
          resetLocalConversationAfterClear(targetSessionId);
          return true;
        }

        if (slashCommandAction.kind === "focus-model") {
          state.modelSwitcherFocusRequest += 1;
          toast.info(slashCommandAction.toastMessage);
          return true;
        }

        if (slashCommandAction.kind === "show-help") {
          state.showShortcutsHelp = true;
          toast.info(slashCommandAction.toastMessage);
          return true;
        }

        state.inputActionError = slashCommandAction.actionError;
        toast.info(slashCommandAction.toastMessage);
        return false;
      }

      if (!(await relaunchExitedSessionBeforeSend())) {
        return false;
      }
      await ensureSessionConnected();

      const isBypassTurn = options?.mode === "whisper";
      const bypassTurnId = isBypassTurn ? `btw-${Date.now()}` : null;
      agentModel.setBypassTurn(targetSessionId, isBypassTurn);
      if (isBypassTurn && bypassTurnId) {
        agentModel.addBypassConversation(targetSessionId, {
          id: bypassTurnId,
          question: text.trim(),
          answer: "",
          timestamp: Date.now(),
        });
      }
      // Show loading immediately — don't wait for configure round-trip
      agentModel.setSessionStatus(targetSessionId, "running");
      // Normal turns use the main streaming UI; /btw is rendered separately.
      if (!isBypassTurn) {
        agentModel.setStreaming(targetSessionId, "");
        agentModel.setPlanningState(targetSessionId, null);
      } else {
        agentModel.setStreaming(targetSessionId, null);
      }
      agentModel.clearCompletedTools(targetSessionId);

      const sessionModel = agentModel.state.sessions[targetSessionId]?.model;
      const followDefaultModel = agentModel.state.sessions[targetSessionId]?.followDefaultModel;
      const routed = getSessionRoutingModel(sessionModel, followDefaultModel);
      const modelId = routed.modelId;
      const providerName = routed.providerName;
      const runtimeDefaults = getSessionRuntimeDefaults(agent);
      const permissionMode = agentModel.state.sessions[targetSessionId]?.permissionMode;
      const permissionPlanningPatch =
        permissionMode === "plan" ? { planningMode: "enabled" as const, goalTracking: true } : {};
      if (permissionMode || Object.keys(runtimeDefaults).length > 0) {
        const fullModel = providerName && modelId ? `${providerName}/${modelId}` : modelId;
        try {
          const tCfg0 = performance.now();
          const result = await agentApi.configureSession(
            targetSessionId,
            {
              ...runtimeDefaults,
              permissionMode: permissionMode || undefined,
              ...permissionPlanningPatch,
              model: fullModel || undefined,
            },
            apiUrl,
          );
          if (result?.model) {
            agentModel.updateSession(targetSessionId, { model: result.model });
          }
          if (isStreamDebugEnabled()) {
            console.info(`[stream:${targetSessionId}] configureSession latency`, {
              ms: Math.round(performance.now() - tCfg0),
              provider: providerName,
              model: fullModel,
            });
          }
        } catch (e) {
          if (e instanceof AppError && e.code === 404) {
            await handleMissingSession({
              sessionId: targetSessionId,
              preferAgentId: agentRegistryModel.resolveSessionAgentId(targetSessionId),
              apiUrl,
            });
            agentModel.setBypassTurn(targetSessionId, false);
            agentModel.setSessionStatus(targetSessionId, "idle");
            agentModel.setStreaming(targetSessionId, null);
            if (bypassTurnId) {
              agentModel.removeBypassConversation(targetSessionId, bypassTurnId);
            }
            keepDraftInRelaunchedSession();
            return false;
          }
          console.warn("Failed to configure session before send", e);
        }
      }
      let sent = isBypassTurn
        ? sendToSession(targetSessionId, {
            type: "btw_message",
            content: text,
          })
        : sendToSession(targetSessionId, {
            type: "user_message",
            content: text,
            images,
            attachments: buildAttachmentsFromImages(images),
            model: providerName && modelId ? `${providerName}/${modelId}` : modelId,
          });
      let optimisticUserMessageAdded = false;
      const appendOptimisticUserMessage = () => {
        if (optimisticUserMessageAdded || isBypassTurn) return;
        agentModel.appendMessage(targetSessionId, {
          // 唯一 id:Date.now() 毫秒级在连发时会撞键(导致重复渲染/列表错乱),叠加随机后缀去重。
          id: `user-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          role: "user",
          content: text,
          timestamp: Date.now(),
          images,
        });
        optimisticUserMessageAdded = true;
      };
      // Optimistically add user message to chat (backend doesn't echo user_message)
      if (sent) {
        appendOptimisticUserMessage();
      }
      if (!sent) {
        connectSession(targetSessionId);
        const reconnected = await waitForSessionConnection(targetSessionId);
        if (reconnected) {
          sent = isBypassTurn
            ? sendToSession(targetSessionId, {
                type: "btw_message",
                content: text,
              })
            : sendToSession(targetSessionId, {
                type: "user_message",
                content: text,
                images,
                attachments: buildAttachmentsFromImages(images),
                model: providerName && modelId ? `${providerName}/${modelId}` : modelId,
              });
          if (sent) {
            appendOptimisticUserMessage();
          }
        }
      }
      if (!sent) {
        // WS not connected — revert optimistic state and notify user
        agentModel.setBypassTurn(targetSessionId, false);
        agentModel.setSessionStatus(targetSessionId, "idle");
        agentModel.setStreaming(targetSessionId, null);
        if (bypassTurnId) {
          agentModel.removeBypassConversation(targetSessionId, bypassTurnId);
        }
        console.warn(`[stream:${targetSessionId}] sendToSession failed — WS not connected`);
        state.inputActionError = {
          message: "发送消息失败，草稿已保留。请检查本地服务连接后重试。",
          dismissLabel: "关闭发送错误提示",
        };
        keepDraftInRelaunchedSession();
        toast.error("发送消息失败，请检查网络连接");
        return false;
      }
      if (isStreamDebugEnabled()) {
        console.info(`[stream:${targetSessionId}] sendToSession`, {
          sent,
          totalMs: Math.round(performance.now() - t0),
        });
      }
      return true;
    },
    [agent, apiUrl, isRunning, sessionId, state, showStatusBar, statusBarOptions?.showModelSwitcher],
  );

  const handleInputSend = useCallback(
    async (
      text: string,
      images?: { mediaType: string; data: string }[],
      options?: { mode?: "default" | "whisper" },
    ) => {
      // 发送前钩子：先 await 宿主副作用（如保存当前画布），再据返回值决定是否替换发送内容。
      // 钩子抛错不阻断发送（按原文发出），避免宿主副作用失败把用户消息卡死。
      let outgoing = text;
      if (onBeforeSend) {
        try {
          const transformed = await onBeforeSend(text);
          if (typeof transformed === "string") outgoing = transformed;
        } catch (error) {
          console.error("onBeforeSend hook failed; sending original text", error);
        }
      }

      const sendResult = await (onSend ?? handleDefaultSend)(outgoing, images, options);
      return sendResult;
    },
    [handleDefaultSend, onBeforeSend, onSend],
  );

  // Retry: resend the main user turn that produced the latest assistant response.
  const handleRetry = useCallback(() => {
    if (readOnly) return;
    if (isRunning) return;
    if (!retryState.userMessageId) return;
    const retryUserMessage = safeMessages.find((m) => m.id === retryState.userMessageId);
    if (retryUserMessage) {
      void (onSend ?? handleDefaultSend)(retryUserMessage.content, retryUserMessage.images);
    }
  }, [handleDefaultSend, isRunning, onSend, readOnly, retryState.userMessageId, safeMessages]);

  const handleRelaunchFromBanner = useCallback(async () => {
    if (state.relaunching) return;
    state.relaunching = true;
    state.relaunchError = null;
    try {
      await relaunchSessionAndRebind({
        sessionId,
        preferAgentId: agentRegistryModel.resolveSessionAgentId(sessionId),
        apiUrl,
      });
    } catch (error) {
      const message = formatSessionRelaunchError(error);
      state.relaunchError = message;
      toast.error(message);
    } finally {
      state.relaunching = false;
    }
  }, [apiUrl, sessionId, state]);

  const settleInterruptedLocally = useCallback(() => {
    agentModel.flushStreamingToMessage(sessionId);
    agentModel.setBypassTurn(sessionId, false);
    agentModel.setStreaming(sessionId, null);
    agentModel.setPlanningState(sessionId, null);
    agentModel.clearToolProgress(sessionId);
    agentModel.clearCompletedTools(sessionId);
    agentModel.setSessionStatus(sessionId, "idle");
  }, [sessionId]);

  const handleDefaultInterrupt = useCallback(async (): Promise<AgentInputInterruptResult> => {
    state.inputActionError = null;
    let sent = sendToSession(sessionId, { type: "interrupt" });
    if (!sent) {
      connectSession(sessionId);
      const reconnected = await waitForSessionConnection(sessionId, 1000);
      if (reconnected) {
        sent = sendToSession(sessionId, { type: "interrupt" });
      }
    }

    if (sent) {
      toast.info("已请求中断当前任务");
      return true;
    }

    settleInterruptedLocally();
    state.inputActionError = {
      message: "中断请求未送达。本地界面已停止等待，后台任务可能仍在运行，请在连接恢复后确认。",
      dismissLabel: "关闭中断错误提示",
    };
    toast.error("中断请求未送达，请检查本地服务连接");
    return false;
  }, [sessionId, settleInterruptedLocally, state]);

  const handleInterrupt = useCallback(async (): Promise<AgentInputInterruptResult> => {
    state.inputActionError = null;
    try {
      if (onInterrupt) {
        return await onInterrupt();
      }
      return await handleDefaultInterrupt();
    } catch (error) {
      state.inputActionError = {
        message: `中断请求失败：${error instanceof Error ? error.message : String(error)}`,
        dismissLabel: "关闭中断错误提示",
      };
      toast.error("中断请求失败");
      return false;
    }
  }, [handleDefaultInterrupt, onInterrupt, state]);

  // Handle tool confirmation
  const handleToolConfirmation = useCallback(
    async (scope: "once" | "task" | "session") => {
      const request = toolConfirmationRequests[sessionId];
      if (!request) {
        console.warn(`[HITL] No confirmation request found for session ${sessionId}`);
        return;
      }
      if (state.pendingToolConfirmationRequestId === request.requestId) return;
      state.pendingToolConfirmationRequestId = request.requestId;
      state.toolConfirmationDeliveryError = null;

      console.log(`[HITL] User approved tool ${request.toolName} with scope ${scope}`);

      const response: ToolConfirmationResponse = {
        requestId: request.requestId,
        approved: true,
        scope,
        toolName: request.toolName,
      };

      try {
        const sent = await sendToolConfirmationResponseWithRetry(sessionId, response);
        console.log(`[HITL] Confirmation response sent: ${sent}`, response);
        if (resolveToolConfirmationDeliveryAction({ sent }) === "keep") {
          const message = "授权响应发送失败，请检查本地服务连接后重试";
          state.toolConfirmationDeliveryError = { requestId: request.requestId, message };
          toast.error(message);
          return;
        }

        if (scope !== "once") {
          addAuthorizationPolicy(request.toolName, scope, sessionId);
        }
        recordAuthorizationDecision(request.requestId, request.toolName, {
          approved: true,
          scope,
          automatic: false,
        });
        state.toolConfirmationDeliveryError = null;
        agentModel.clearToolConfirmationRequest(sessionId);
      } catch (error) {
        const message = formatToolConfirmationDeliveryError(error, "授权响应发送失败，请检查本地服务连接后重试");
        state.toolConfirmationDeliveryError = { requestId: request.requestId, message };
        toast.error(message);
      } finally {
        if (state.pendingToolConfirmationRequestId === request.requestId) {
          state.pendingToolConfirmationRequestId = null;
        }
      }
    },
    [sessionId, state, toolConfirmationRequests],
  );

  const handleToolDeny = useCallback(() => {
    const request = toolConfirmationRequests[sessionId];
    if (!request) {
      console.warn(`[HITL] No confirmation request found for session ${sessionId}`);
      return;
    }
    if (state.pendingToolConfirmationRequestId === request.requestId) return;
    state.pendingToolConfirmationRequestId = request.requestId;
    state.toolConfirmationDeliveryError = null;

    console.log(`[HITL] User denied tool ${request.toolName}`);

    const response: ToolConfirmationResponse = {
      requestId: request.requestId,
      approved: false,
    };

    void sendToolConfirmationResponseWithRetry(sessionId, response)
      .then((sent) => {
        console.log(`[HITL] Denial response sent: ${sent}`, response);
        if (resolveToolConfirmationDeliveryAction({ sent }) === "keep") {
          const message = "拒绝响应发送失败，请检查本地服务连接后重试";
          state.toolConfirmationDeliveryError = { requestId: request.requestId, message };
          toast.error(message);
          return;
        }

        recordAuthorizationDecision(request.requestId, request.toolName, {
          approved: false,
          automatic: false,
        });
        state.toolConfirmationDeliveryError = null;
        agentModel.clearToolConfirmationRequest(sessionId);
      })
      .catch((error) => {
        const message = formatToolConfirmationDeliveryError(error, "拒绝响应发送失败，请检查本地服务连接后重试");
        state.toolConfirmationDeliveryError = { requestId: request.requestId, message };
        toast.error(message);
      })
      .finally(() => {
        if (state.pendingToolConfirmationRequestId === request.requestId) {
          state.pendingToolConfirmationRequestId = null;
        }
      });
  }, [sessionId, state, toolConfirmationRequests]);

  // Render item with date separator
  const renderItem = useCallback(
    (index: number, msg: RichMessage) => {
      const prev = index > 0 ? displayMessages[index - 1] : null;
      const msgDate = dayjs(msg.timestamp);
      const isValidDate = msgDate.isAfter("2000-01-01");
      const showDate = isValidDate && (!prev || !msgDate.isSame(dayjs(prev.timestamp), "day"));
      return (
        <div
          data-agent-message-id={msg.id}
          className={cn(
            "min-w-0 rounded-[10px] transition-[background-color,box-shadow] duration-300",
            highlightedMessageId === msg.id ? "bg-primary/[0.06] shadow-[inset_0_0_0_1px_hsl(var(--primary)_/_0.22)]" : "",
          )}
        >
          {showDate && <DateSeparator timestamp={msg.timestamp} />}
          <MessageItem
            msg={msg}
            sessionId={sessionId}
            onRetry={msg.id === retryState.assistantMessageId ? handleRetry : undefined}
            layout={messageLayout}
          />
        </div>
      );
    },
    [displayMessages, handleRetry, highlightedMessageId, messageLayout, retryState.assistantMessageId, sessionId],
  );

  // Virtuoso atBottom tracking — detect user scroll intent
  const handleAtBottom = useCallback(
    (atBottom: boolean) => {
      if (atBottom) {
        userScrolledUpRef.current = false;
        state.hiddenNewMessageCount = 0;
      }
      state.showScrollBtn = !atBottom;
    },
    [state],
  );

  // Virtuoso scroller ref — detect upward scroll
  const handleScrollerRef = useCallback(
    (scroller: HTMLElement | Window | null) => {
      if (!scroller || scroller === window) return;
      const el = scroller as HTMLElement;
      scrollerElRef.current = el;
      if ((el as HTMLElement & { __scrollBound?: boolean }).__scrollBound) return;
      (el as HTMLElement & { __scrollBound?: boolean }).__scrollBound = true;
      let lastScrollTop = el.scrollTop;
      el.addEventListener(
        "scroll",
        () => {
          const scrolledUp = el.scrollTop < lastScrollTop - 5;
          if (scrolledUp && !isNearBottom(el)) {
            userScrolledUpRef.current = true;
          } else if (isNearBottom(el)) {
            userScrolledUpRef.current = false;
          }
          lastScrollTop = el.scrollTop;
        },
        { passive: true },
      );
    },
    [isNearBottom],
  );

  const forceScrollToBottom = useCallback(() => {
    userScrolledUpRef.current = false;
    state.hiddenNewMessageCount = 0;
    state.showScrollBtn = false;
    const scroller = scrollerElRef.current;
    if (scroller) {
      scroller.scrollTo({ top: scroller.scrollHeight, behavior: "smooth" });
    }
    virtuosoRef.current?.scrollToIndex({
      index: "LAST",
      align: "end",
      behavior: "smooth",
    });
  }, [state]);

  const scrollToSearchMatch = useCallback((index: number) => {
    virtuosoRef.current?.scrollToIndex({
      index,
      align: "center",
      behavior: "smooth",
    });
  }, []);

  useEffect(() => {
    if (!focusMessageId || focusMessageRequest <= 0) return undefined;
    if (searchQuery.trim()) {
      state.searchQuery = "";
      return undefined;
    }
    const index = displayMessages.findIndex((message) => message.id === focusMessageId);
    if (index < 0) return undefined;
    userScrolledUpRef.current = false;
    state.hiddenNewMessageCount = 0;
    state.showScrollBtn = false;
    setHighlightedMessageId(focusMessageId);

    const frame = window.requestAnimationFrame(() => {
      if (messageListRenderMode === "virtual") {
        virtuosoRef.current?.scrollToIndex({
          index,
          align: "center",
          behavior: "smooth",
        });
        return;
      }
      const scroller = scrollerElRef.current;
      const target = scroller
        ? Array.from(scroller.querySelectorAll<HTMLElement>("[data-agent-message-id]")).find(
            (element) => element.dataset.agentMessageId === focusMessageId,
          )
        : null;
      target?.scrollIntoView({ block: "center", behavior: "smooth" });
    });
    const timer = window.setTimeout(() => {
      setHighlightedMessageId((current) => (current === focusMessageId ? null : current));
    }, 2400);
    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(timer);
    };
  }, [displayMessages, focusMessageId, focusMessageRequest, messageListRenderMode, searchQuery, state]);

  const goToPrevSearchMatch = useCallback(() => {
    if (!searchState.hasMatches || searchState.matchCount == null) return;
    const newIndex = resolveChatSearchNavigation({
      direction: "previous",
      matchCount: searchState.matchCount,
      currentIndex: searchState.currentIndex,
    });
    state.searchCurrentIndex = newIndex;
    scrollToSearchMatch(newIndex);
  }, [scrollToSearchMatch, searchState.currentIndex, searchState.hasMatches, searchState.matchCount, state]);

  const goToNextSearchMatch = useCallback(() => {
    if (!searchState.hasMatches || searchState.matchCount == null) return;
    const newIndex = resolveChatSearchNavigation({
      direction: "next",
      matchCount: searchState.matchCount,
      currentIndex: searchState.currentIndex,
    });
    state.searchCurrentIndex = newIndex;
    scrollToSearchMatch(newIndex);
  }, [scrollToSearchMatch, searchState.currentIndex, searchState.hasMatches, searchState.matchCount, state]);

  const handleStreamingContentResize = useCallback(() => {
    const el = scrollerElRef.current;
    if (!el || userScrolledUpRef.current || !isNearBottom(el, 120)) return;
    scrollToBottom("auto");
  }, [isNearBottom, scrollToBottom]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: message and streaming changes are intentional scroll triggers.
  useEffect(() => {
    const el = scrollerElRef.current;
    if (!el || !hasStreamingUi || userScrolledUpRef.current) return;
    if (!isNearBottom(el)) return;
    scrollToBottom("auto");
  }, [displayMessages.length, hasStreamingUi, isNearBottom, scrollToBottom, streamingSegsCount, streamingText]);

  // Footer component — StreamingDisplay inside Virtuoso's scroll container
  const virtuosoComponents = useMemo(
    () => ({
      Footer: () => (
        <ErrorBoundary>
          <StreamingDisplay
            sessionId={sessionId}
            layout={messageLayout}
            transformText={streamingTransformText}
            onContentResize={handleStreamingContentResize}
          />
          <div aria-hidden="true" className="h-3" />
        </ErrorBoundary>
      ),
    }),
    [handleStreamingContentResize, messageLayout, sessionId, streamingTransformText],
  );

  useEffect(() => {
    const queryChanged = previousSearchQueryRef.current !== searchQuery;
    previousSearchQueryRef.current = searchQuery;
    const nextIndex = queryChanged ? 0 : searchState.currentIndex;
    if (state.searchCurrentIndex !== nextIndex) {
      state.searchCurrentIndex = nextIndex;
    }
  }, [searchQuery, searchState.currentIndex, state]);
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (shouldOpenChatSearchFromShortcut(e)) {
        e.preventDefault();
        state.searchFocusRequest += 1;
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key === "End") {
        e.preventDefault();
        forceScrollToBottom();
      }
      const target = e.target instanceof HTMLElement ? e.target : null;
      const isEditableTarget = Boolean(
        target &&
          (target.tagName === "INPUT" ||
            target.tagName === "TEXTAREA" ||
            target.tagName === "SELECT" ||
            target.isContentEditable),
      );
      if (
        shouldFocusAgentInputFromSlashShortcut({
          key: e.key,
          code: e.code,
          metaKey: e.metaKey,
          ctrlKey: e.ctrlKey,
          altKey: e.altKey,
          shiftKey: e.shiftKey,
          isComposing: e.isComposing,
          targetTagName: target?.tagName,
          targetRole: target?.getAttribute("role"),
          targetIsContentEditable: target?.isContentEditable,
          targetInsideDialog: Boolean(target?.closest('[role="dialog"]')),
          readOnly,
          disableSlash,
          hasInput: Boolean(inputRef.current),
        })
      ) {
        e.preventDefault();
        inputRef.current?.focusSlashCommand();
        return;
      }
      // Show shortcuts help on ?
      if (e.key === "?" && !e.metaKey && !e.ctrlKey && !e.altKey) {
        if (!isEditableTarget) {
          e.preventDefault();
          state.showShortcutsHelp = true;
        }
      }
      // Search match navigation
      if (searchState.hasMatches) {
        if (e.key === "Enter" && !e.shiftKey && !e.metaKey && !e.ctrlKey) {
          if (!isEditableTarget) {
            e.preventDefault();
            goToNextSearchMatch();
          }
        }
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [disableSlash, forceScrollToBottom, goToNextSearchMatch, readOnly, searchState.hasMatches, state]);

  // TTS auto-play: speak when a new assistant message completes
  const lastSpokenTextRef = useRef<string>("");
  useEffect(() => {
    const unsub = subscribe(agentModel.state, () => {
      const text = agentModel.state.lastAssistantText[sessionId];
      if (!text || text === lastSpokenTextRef.current) return;
      lastSpokenTextRef.current = text;

      const ttsEnabled = readUserStorage("internshannon-tts-enabled") === "true";
      const voiceActive = agentModel.state.voiceInputActive[sessionId];

      if (ttsEnabled || voiceActive) {
        speakTextInNativeRuntime(text).catch((e: unknown) => {
          console.warn("TTS auto-play failed:", e);
        });
        // Clear voice input flag after speaking
        if (voiceActive) {
          agentModel.setVoiceInputActive(sessionId, false);
        }
      }
    });
    return unsub;
  }, [sessionId]);

  if (!hasSession) {
    return <div className="flex h-full items-center justify-center text-sm text-muted-foreground">正在恢复会话…</div>;
  }

  const relaunchFeedback = resolveSessionRelaunchFeedback({
    relaunching: state.relaunching,
    relaunchError: state.relaunchError,
  });
  const scrollButtonPresentation = resolveAgentChatScrollButtonPresentation({
    hiddenNewMessageCount: state.hiddenNewMessageCount,
  });

  return (
    <AgentSessionIdProvider sessionId={sessionId}>
      <div className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden overflow-x-hidden bg-white font-sans text-foreground">
        <SelectionToolbar />
        <Dialog
          open={state.showShortcutsHelp}
          onOpenChange={(v) => {
            state.showShortcutsHelp = v;
          }}
        >
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>键盘快捷键</DialogTitle>
            </DialogHeader>
            <div className="space-y-3 text-sm">
              <div className="grid grid-cols-[auto_1fr] items-center gap-x-6 gap-y-2">
                <kbd className="rounded-md border border-border bg-muted px-2 py-1 text-xs font-medium shadow-sm">
                  ?
                </kbd>
                <span className="text-foreground/80">显示快捷键面板</span>
                <kbd className="rounded-md border border-border bg-muted px-2 py-1 text-xs font-medium shadow-sm">
                  /
                </kbd>
                <span className="text-foreground/80">聚焦输入并打开命令</span>
                <kbd className="rounded-md border border-border bg-muted px-2 py-1 text-xs font-medium shadow-sm">
                  Ctrl/⌘ + Enter
                </kbd>
                <span className="text-foreground/80">发送消息</span>
                <kbd className="rounded-md border border-border bg-muted px-2 py-1 text-xs font-medium shadow-sm">
                  Ctrl/⌘ + F
                </kbd>
                <span className="text-foreground/80">搜索聊天记录</span>
                <kbd className="rounded-md border border-border bg-muted px-2 py-1 text-xs font-medium shadow-sm">
                  Ctrl/⌘ + End
                </kbd>
                <span className="text-foreground/80">滚动到底部</span>
                <kbd className="rounded-md border border-border bg-muted px-2 py-1 text-xs font-medium shadow-sm">
                  ↑ / ↓
                </kbd>
                <span className="text-foreground/80">浏览输入历史</span>
                <kbd className="rounded-md border border-border bg-muted px-2 py-1 text-xs font-medium shadow-sm">
                  Enter
                </kbd>
                <span className="text-foreground/80">搜索时跳至下一匹配</span>
              </div>
            </div>
          </DialogContent>
        </Dialog>
        <ResizablePanelGroup direction="vertical" className="min-h-0 flex-1 overflow-hidden">
          <ResizablePanel className="flex flex-col overflow-hidden">
            {showHeader ? (
              <ChatHeader
                apiUrl={apiUrl}
                sessionId={sessionId}
                searchQuery={searchQuery}
                searchFocusRequest={state.searchFocusRequest}
                onSearchChange={(v) => {
                  state.searchQuery = v;
                }}
                onSessionChange={onSessionChange}
                cwd={cwd}
                onCopyTranscript={copyConversationTranscript}
                onExportSessionJson={exportSessionJson}
                searchMatchCount={searchState.matchCount}
                searchCurrentIndex={searchState.currentIndex}
                onSearchPrev={goToPrevSearchMatch}
                onSearchNext={goToNextSearchMatch}
                showSessionManagement={showSessionManagement}
                onWorkspaceOpen={onWorkspaceOpen}
              />
            ) : null}
            {isExited && !readOnly && (
              <div className="shrink-0 border-b border-border-light bg-white px-3 py-1.5 text-xs text-foreground/80">
                <div className="flex items-center gap-2">
                  <Circle className="size-2 shrink-0 fill-muted-foreground/40 text-muted-foreground/40" />
                  <span>会话已退出</span>
                  <button
                    type="button"
                    className="ml-auto flex items-center gap-1 rounded-full bg-[#181e25] px-3 py-1 text-xs font-medium text-white transition-colors hover:bg-[#181e25]/85 disabled:cursor-not-allowed disabled:opacity-50"
                    onClick={() => {
                      void handleRelaunchFromBanner();
                    }}
                    disabled={state.relaunching}
                  >
                    {state.relaunching ? <Loader2 className="size-3 animate-spin" /> : <RefreshCw className="size-3" />}
                    {state.relaunching ? "重启中" : "重启"}
                  </button>
                </div>
                {relaunchFeedback ? (
                  <div
                    role={relaunchFeedback.role}
                    aria-live={relaunchFeedback.ariaLive}
                    className={`mt-1.5 flex items-start gap-1.5 rounded-[6px] border px-2 py-1.5 text-[11px] leading-4 ${
                      relaunchFeedback.tone === "error"
                        ? "border-red-500/10 bg-red-500/[0.04] text-red-700"
                        : "border-primary/10 bg-primary/[0.05] text-primary"
                    }`}
                  >
                    {relaunchFeedback.tone === "error" ? (
                      <CircleAlert className="mt-0.5 size-3 shrink-0" />
                    ) : (
                      <Loader2 className="mt-0.5 size-3 shrink-0 animate-spin" />
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="font-medium">{relaunchFeedback.title}</p>
                      <p className="mt-0.5 break-words">{relaunchFeedback.message}</p>
                    </div>
                  </div>
                ) : null}
              </div>
            )}
            <div
              className="relative min-h-0 min-w-0 flex-1 overflow-x-hidden bg-[#f7f9fc]"
              role="log"
              aria-live="polite"
              aria-label="Chat messages"
            >
              {displayMessages.length === 0 && !searchState.active && !isRunning && !hasStreamingUi ? (
                <EmptyChat sessionId={sessionId} disableMention={disableMention} starterPrompts={starterPrompts} />
              ) : displayMessages.length === 0 && searchState.active && !hasStreamingUi ? (
                <div className="flex h-full items-center justify-center text-sm text-foreground/80">没有匹配的消息</div>
              ) : messageListRenderMode === "static" ? (
                <ErrorBoundary>
                  <div
                    ref={(el) => handleScrollerRef(el)}
                    className="relative h-full min-w-0 overflow-x-hidden overflow-y-auto"
                  >
                    <div className="min-h-full min-w-0 py-3">
                      {displayMessages.map((msg, index) => (
                        <div key={msg.id} className="min-w-0">
                          {renderItem(index, msg)}
                        </div>
                      ))}
                      <ErrorBoundary>
                        <StreamingDisplay
                          sessionId={sessionId}
                          layout={messageLayout}
                          transformText={streamingTransformText}
                          onContentResize={handleStreamingContentResize}
                        />
                        <div aria-hidden="true" className="h-3" />
                      </ErrorBoundary>
                    </div>
                    {state.showScrollBtn && displayMessages.length > 0 ? (
                      <button
                        type="button"
                        onClick={forceScrollToBottom}
                        aria-label={scrollButtonPresentation.ariaLabel}
                        className="absolute bottom-4 right-4 z-20 inline-flex items-center gap-1.5 rounded-full border border-primary/30 bg-white px-3 py-2 text-xs font-medium text-primary shadow-[rgba(44,30,116,0.16)_0px_0px_15px] transition-colors hover:border-primary hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/40"
                      >
                        <ArrowDown className="size-3.5" />
                        {scrollButtonPresentation.label}
                      </button>
                    ) : null}
                  </div>
                </ErrorBoundary>
              ) : (
                <ErrorBoundary>
                  <div className="relative h-full min-w-0 overflow-x-hidden">
                    <Virtuoso
                      ref={virtuosoRef}
                      scrollerRef={handleScrollerRef}
                      className="h-full min-w-0 overflow-x-hidden"
                      data={displayMessages}
                      itemContent={renderItem}
                      initialTopMostItemIndex={displayMessages.length > 0 ? displayMessages.length - 1 : 0}
                      followOutput={(isAtBottom) => {
                        if (!userScrolledUpRef.current) return "smooth";
                        return isAtBottom ? "smooth" : false;
                      }}
                      atBottomStateChange={handleAtBottom}
                      atBottomThreshold={30}
                      components={virtuosoComponents}
                    />
                    {state.showScrollBtn && displayMessages.length > 0 ? (
                      <button
                        type="button"
                        onClick={forceScrollToBottom}
                        aria-label={scrollButtonPresentation.ariaLabel}
                        className="absolute bottom-4 right-4 z-20 inline-flex items-center gap-1.5 rounded-full border border-primary/30 bg-white px-3 py-2 text-xs font-medium text-primary shadow-[rgba(44,30,116,0.16)_0px_0px_15px] transition-colors hover:border-primary hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/40"
                      >
                        <ArrowDown className="size-3.5" />
                        {scrollButtonPresentation.label}
                      </button>
                    ) : null}
                  </div>
                </ErrorBoundary>
              )}
            </div>
            <AuthStatusBanner sessionId={sessionId} />
            <ConnectionStatusBanner sessionId={sessionId} />
            <AgentMessageInbox sessionId={sessionId} apiUrl={apiUrl} />
          </ResizablePanel>
          {!readOnly ? (
            <>
              <ResizableHandle aria-label="调整消息输入区高度" withHandle />
              <AgentAssistPanel planningState={planningState} bypassTurns={bypassTurns} />
              <ResizablePanel
                defaultSize={10}
                minSize={7}
                maxSize={18}
                className="flex min-h-0 flex-col overflow-hidden"
              >
                <ErrorBoundary>
                  <AgentInput
                    ref={inputRef}
                    apiUrl={apiUrl}
                    sessionId={sessionId}
                    disabled={isRunning}
                    onSend={handleInputSend}
                    onInterrupt={handleInterrupt}
                    inputActionError={state.inputActionError}
                    onDismissInputActionError={() => {
                      state.inputActionError = null;
                    }}
                    showStatusBar={false}
                    disableMention={disableMention}
                    disableWhisper={disableWhisper}
                    disableSlash={disableSlash}
                    variant={inputVariant}
                    workspaceDir={fallbackWorkspaceDir}
                  />
                </ErrorBoundary>
              </ResizablePanel>
            </>
          ) : null}
        </ResizablePanelGroup>
        {showStatusBar ? (
          <SessionStatusBar
            apiUrl={apiUrl}
            sessionId={sessionId}
            showModelSwitcher={statusBarOptions?.showModelSwitcher}
            modelSwitcherFocusRequest={state.modelSwitcherFocusRequest}
          />
        ) : null}
        <ToolConfirmationDialog
          request={toolConfirmationRequests[sessionId] || null}
          pending={state.pendingToolConfirmationRequestId === toolConfirmationRequests[sessionId]?.requestId}
          deliveryError={resolveToolConfirmationDialogDeliveryError({
            requestId: toolConfirmationRequests[sessionId]?.requestId,
            deliveryError: state.toolConfirmationDeliveryError,
          })}
          onConfirm={handleToolConfirmation}
          onDeny={handleToolDeny}
        />
      </div>
    </AgentSessionIdProvider>
  );
}
