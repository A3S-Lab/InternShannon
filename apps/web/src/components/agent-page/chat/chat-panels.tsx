import { useReactive } from "ahooks";
import { ChevronDown, ChevronRight, CircleAlert, Loader2, MessageSquare, Send, WifiOff, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { toast } from "sonner";
import { useSnapshot } from "valtio";
import { connectSession, sendToSession } from "@/hooks/use-agent-ws";
import { agentApi } from "@/lib/agent-api";
import { AppError } from "@/lib/error";
import { handleMissingSession } from "@/lib/session-bootstrap";
import { getSessionRuntimeDefaults } from "@/lib/session-runtime-defaults";
import { cn } from "@/lib/utils";
import agentModel from "@/models/agent.model";
import agentRegistryModel from "@/models/agent-registry.model";
import { getSessionRoutingModel } from "@/models/settings.model";
import { AgentAvatar } from "../agent-avatar";
import {
  formatAgentMessageSourceLabel,
  formatAgentMessageExecuteError,
  normalizeAgentInboxMessages,
  resolveAgentMessageExecuteAction,
  resolveAgentMessageExecuteFeedback,
} from "./agent-message-inbox-state";

// =============================================================================
// AuthStatusBanner
// =============================================================================

export function AuthStatusBanner({ sessionId }: { sessionId: string }) {
  const { authStatus } = useSnapshot(agentModel.state);
  const status = authStatus[sessionId];
  const state = useReactive({
    expanded: false,
  });

  if (!status?.isAuthenticating) return null;

  return (
    <div className="mx-4 mb-3 rounded-[16px] border border-primary/30 bg-white px-4 py-3 text-xs shadow-[rgba(0,0,0,0.08)_0px_4px_6px]">
      <div className="flex items-center gap-2">
        <Loader2 className="size-3.5 shrink-0 animate-spin text-primary" />
        <span className="font-medium text-primary">正在进行身份验证…</span>
        {status.output.length > 0 && (
          <button
            type="button"
            className="ml-auto rounded-full p-1 text-foreground/80 transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/40"
            onClick={() => {
              state.expanded = !state.expanded;
            }}
            aria-label={state.expanded ? "收起身份验证日志" : "展开身份验证日志"}
          >
            {state.expanded ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
          </button>
        )}
      </div>
      {status.error && <p className="mt-1 text-red-500">{status.error}</p>}
      {state.expanded && status.output.length > 0 && (
        <pre className="mt-2 overflow-x-auto whitespace-pre-wrap rounded-[13px] border border-border-light bg-muted/40 p-3 text-[10px] text-foreground/80">
          {status.output.join("\n")}
        </pre>
      )}
    </div>
  );
}

// =============================================================================
// ConnectionStatusBanner — 连接态可见化:断开/重连期间在消息区顶部常驻一条横幅,
// 让用户清楚知道「为什么没有响应」(网络掉线 vs 后端慢),而不是只弹一次 toast 后无声。
// =============================================================================

export function ConnectionStatusBanner({ sessionId }: { sessionId: string }) {
  const { connectionStatus } = useSnapshot(agentModel.state);
  const status = connectionStatus[sessionId];
  // 已连接 / 尚未发起连接(undefined)不打扰;只在「连接中 / 断开」时提示。
  if (status == null || status === "connected") return null;
  const disconnected = status === "disconnected";
  return (
    <div
      aria-live="polite"
      className={cn(
        "mx-4 mb-3 flex items-center gap-2 rounded-[14px] border px-3.5 py-2 text-xs shadow-sm",
        disconnected
          ? "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300"
          : "border-primary/30 bg-primary/[0.06] text-primary",
      )}
    >
      {disconnected ? (
        <WifiOff className="size-3.5 shrink-0" aria-hidden="true" />
      ) : (
        <Loader2 className="size-3.5 shrink-0 animate-spin" aria-hidden="true" />
      )}
      <span className="font-medium">{disconnected ? "连接已断开,正在尝试重连…" : "正在连接书小安…"}</span>
    </div>
  );
}

// =============================================================================
// AgentMessageInbox
// =============================================================================

async function waitForInboxSessionConnection(sessionId: string, timeoutMs = 1200): Promise<boolean> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (agentModel.state.connectionStatus[sessionId] === "connected") {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 80));
  }
  return agentModel.state.connectionStatus[sessionId] === "connected";
}

export function AgentMessageInbox({ apiUrl, sessionId }: { apiUrl?: string; sessionId: string }) {
  const { agentMessages } = useSnapshot(agentModel.state);
  const rawMsgs = agentMessages[sessionId] || [];
  const msgs = useMemo(() => normalizeAgentInboxMessages(rawMsgs), [rawMsgs]);
  const executingMessageIdsRef = useRef(new Set<string>());
  const state = useReactive({
    executingMessageIds: [] as string[],
  });

  const setMessageExecuting = useCallback(
    (messageId: string, executing: boolean) => {
      if (executing) {
        executingMessageIdsRef.current.add(messageId);
        state.executingMessageIds = Array.from(new Set([...state.executingMessageIds, messageId]));
        return;
      }

      executingMessageIdsRef.current.delete(messageId);
      state.executingMessageIds = state.executingMessageIds.filter((id) => id !== messageId);
    },
    [state],
  );

  // Configure LLM before sending — same logic as handleSend in agent-chat
  const configureAndSend = useCallback(
    async (content: string): Promise<boolean> => {
      if (!agentModel.state.sessions[sessionId]) return false;
      const sessionModel = agentModel.state.sessions[sessionId]?.model;
      const followDefaultModel = agentModel.state.sessions[sessionId]?.followDefaultModel;
      const routed = getSessionRoutingModel(sessionModel, followDefaultModel);
      const modelId = routed.modelId;
      const providerName = routed.providerName;
      const fullModel = providerName && modelId ? `${providerName}/${modelId}` : modelId;
      const runtimeDefaults = getSessionRuntimeDefaults(agentRegistryModel.getSessionAgent(sessionId));
      try {
        const result = await agentApi.configureSession(
          sessionId,
          {
            ...runtimeDefaults,
            model: fullModel || undefined,
          },
          apiUrl,
        );
        if (result?.model) {
          agentModel.updateSession(sessionId, { model: result.model });
        }
      } catch (e) {
        if (e instanceof AppError && e.code === 404) {
          void handleMissingSession({ sessionId, apiUrl });
          return false;
        }
        console.warn("Failed to configure session before agent message execute", e);
      }
      let sent = sendToSession(sessionId, { type: "user_message", content });
      if (!sent) {
        connectSession(sessionId);
        if (await waitForInboxSessionConnection(sessionId)) {
          sent = sendToSession(sessionId, { type: "user_message", content });
        }
      }
      if (sent) {
        agentModel.setSessionStatus(sessionId, "running");
        agentModel.setStreaming(sessionId, "");
        agentModel.appendMessage(sessionId, {
          id: `agent-msg-user-${Date.now()}`,
          role: "user",
          content,
          timestamp: Date.now(),
        });
      }
      return sent;
    },
    [apiUrl, sessionId],
  );

  const settleExecuteAttempt = useCallback(
    (messageId: string, sent: boolean, autoExecute: boolean, errorMessage?: string) => {
      setMessageExecuting(messageId, false);
      const action = resolveAgentMessageExecuteAction({ sent, autoExecute });
      if (action === "remove") {
        agentModel.removeAgentMessage(sessionId, messageId);
        return;
      }
      const message = errorMessage?.trim() || "Agent 消息未发送，请检查本地服务连接后重试。";
      if (action === "show_manual") {
        agentModel.updateAgentMessage(sessionId, messageId, { autoExecute: false, executionError: message });
        toast.error("自动执行 Agent 消息失败，已保留为待处理消息");
        return;
      }
      agentModel.updateAgentMessage(sessionId, messageId, { executionError: message });
      toast.error("执行失败，请检查本地服务连接");
    },
    [sessionId, setMessageExecuting],
  );

  const executeAgentMessage = useCallback(
    (messageId: string, content: string, autoExecute: boolean) => {
      if (executingMessageIdsRef.current.has(messageId)) return;
      setMessageExecuting(messageId, true);
      agentModel.updateAgentMessage(sessionId, messageId, { executionError: undefined });
      void configureAndSend(content)
        .then((sent) => {
          settleExecuteAttempt(
            messageId,
            sent,
            autoExecute,
            sent ? undefined : "Agent 消息未发送，请检查本地服务连接后重试。",
          );
        })
        .catch((error) => {
          console.warn("Failed to execute agent inbox message", error);
          settleExecuteAttempt(
            messageId,
            false,
            autoExecute,
            formatAgentMessageExecuteError(error, "Agent 消息未发送，请检查本地服务连接后重试。"),
          );
        });
    },
    [configureAndSend, sessionId, setMessageExecuting, settleExecuteAttempt],
  );

  // Auto-execute messages marked with autoExecute
  useEffect(() => {
    const autoMsgs = msgs.filter((m) => m.autoExecute);
    for (const msg of autoMsgs) {
      executeAgentMessage(msg.messageId, msg.content, true);
    }
  }, [msgs, executeAgentMessage]);

  // Only show non-auto messages in the inbox
  const pendingMsgs = msgs.filter((m) => !m.autoExecute);
  if (pendingMsgs.length === 0) return null;

  const handleExecute = (msg: (typeof pendingMsgs)[0]) => {
    executeAgentMessage(msg.messageId, msg.content, false);
  };

  const handleDismiss = (messageId: string) => {
    agentModel.removeAgentMessage(sessionId, messageId);
  };

  return (
    <div className="shrink-0 border-t border-border-light bg-white">
      <div className="flex items-center gap-2 border-b border-border-light px-4 py-2">
        <MessageSquare className="size-3.5 shrink-0 text-primary" />
        <span className="text-xs font-medium text-primary">收到 Agent 消息 ({pendingMsgs.length})</span>
      </div>
      <div className="max-h-36 divide-y divide-[#f2f3f5] overflow-y-auto">
        {pendingMsgs.map((msg) => {
          const isExecuting = state.executingMessageIds.includes(msg.messageId);
          const feedback = resolveAgentMessageExecuteFeedback({
            executing: isExecuting,
            executionError: msg.executionError,
          });

          return (
            <div key={msg.messageId} className="flex items-start gap-2 px-4 py-2.5">
              <div className="min-w-0 flex-1">
                <div className="mb-0.5 truncate text-[10px] text-muted-foreground">
                  来自 {formatAgentMessageSourceLabel(msg.fromSessionId)} · {msg.topic}
                </div>
                <p className="line-clamp-2 text-xs text-foreground">{msg.content}</p>
                {feedback ? (
                  <div
                    role={feedback.role}
                    aria-live={feedback.ariaLive}
                    className={`mt-2 flex items-start gap-1.5 rounded-[6px] border px-2 py-1.5 text-[10px] leading-3 ${
                      feedback.tone === "error"
                        ? "border-red-500/10 bg-red-500/[0.04] text-red-700"
                        : "border-primary/10 bg-primary/[0.05] text-primary"
                    }`}
                  >
                    {feedback.tone === "error" ? (
                      <CircleAlert className="mt-0.5 size-3 shrink-0" />
                    ) : (
                      <Loader2 className="mt-0.5 size-3 shrink-0 animate-spin" />
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="font-medium">{feedback.title}</p>
                      <p className="mt-0.5 break-words">{feedback.message}</p>
                    </div>
                  </div>
                ) : null}
              </div>
              <div className="mt-0.5 flex shrink-0 items-center gap-1.5">
                <button
                  type="button"
                  className="flex items-center gap-1 rounded-full bg-[#181e25] px-3 py-1 text-xs font-medium text-white transition-colors hover:bg-[#181e25]/85 disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/40"
                  onClick={() => handleExecute(msg)}
                  disabled={isExecuting}
                >
                  {isExecuting ? <Loader2 className="size-3 animate-spin" /> : <Send className="size-3" />}
                  {isExecuting ? "执行中" : "执行"}
                </button>
                <button
                  type="button"
                  className="flex size-6 items-center justify-center rounded-full text-foreground/80 transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/40"
                  onClick={() => handleDismiss(msg.messageId)}
                  aria-label="忽略"
                >
                  <X className="size-3" />
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// =============================================================================
// EmptyChat
// =============================================================================

export function EmptyChat({
  sessionId,
  disableMention,
  starterPrompts,
}: {
  sessionId: string;
  disableMention?: boolean;
  /** 可选:空会话里展示的「示例提问」,点击即预填并自动发送。用于InternShannon等会话型智能体的上手引导。 */
  starterPrompts?: readonly string[];
}) {
  const agent = agentRegistryModel.getSessionAgent(sessionId);
  const handleStarter = useCallback(
    (prompt: string) => agentModel.prefillChatInput(sessionId, prompt, { autoSend: true }),
    [sessionId],
  );
  return (
    <div className="flex h-full flex-col items-center justify-start overflow-y-auto px-4 pt-[12vh] text-foreground/80">
      <div className="relative flex w-full max-w-xl items-center gap-3 text-left">
        <AgentAvatar
          agent={agent}
          className="relative size-10 shrink-0 rounded-[14px] shadow-[rgba(0,0,0,0.08)_0px_4px_6px]"
        />
        <div className="relative min-w-0">
          <p className="truncate font-display text-[18px] font-semibold leading-[1.25] text-foreground">
            {agent?.name || "书小安"}
          </p>
          <p className="mt-1 max-w-xl text-sm leading-5 text-foreground/80">
            {agent?.description || "发送消息开始对话"}
          </p>
          <p className="mt-2 text-xs leading-5 text-muted-foreground">
            {disableMention ? "发送消息开始对话，/ 触发技能" : "发送消息开始对话，/ 触发技能，@ 提及工作区文件"}
          </p>
        </div>
      </div>
      {starterPrompts && starterPrompts.length > 0 ? (
        <div className="mt-5 flex w-full max-w-xl flex-col gap-1.5">
          {starterPrompts.map((prompt) => (
            <button
              key={prompt}
              type="button"
              onClick={() => handleStarter(prompt)}
              className="group flex items-center gap-2 rounded-lg border border-border-light bg-background px-3 py-2 text-left text-xs text-foreground transition-colors hover:border-primary/40 hover:bg-primary/[0.03]"
            >
              <MessageSquare
                className="size-3.5 shrink-0 text-muted-foreground transition-colors group-hover:text-primary"
                aria-hidden="true"
              />
              <span className="min-w-0 flex-1">{prompt}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
