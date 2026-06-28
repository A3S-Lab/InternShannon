import {
  Brain,
  Check,
  Circle,
  CircleAlert,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  X,
} from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { useSnapshot } from "valtio";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { connectSession, disconnectSession } from "@/hooks/use-agent-ws";
import { agentApi } from "@/lib/agent-api";
import { DEFAULT_AGENT_ID, getAgentById } from "@/lib/builtins";
import { createAgentSession, refreshSessionsInBackground } from "@/lib/session-bootstrap";
import { timeAgo } from "@/lib/time";
import type { AgentProcessInfo } from "@/lib/types";
import { cn } from "@/lib/utils";
import agentModel from "@/models/agent.model";
import agentRegistryModel from "@/models/agent-registry.model";
import { AgentAvatar } from "./agent-avatar";
import {
  buildAgentSessionCreateOptions,
  formatAgentSessionCreateError,
  shouldInitializeAgentDefaultsAfterCreate,
} from "./agent-session-create-state";
import {
  compactSessionPreviewText,
  formatSessionSidebarActionError,
  nextSessionSearchQueryAfterCreate,
  resolveSessionDeleteTarget,
  resolveSessionSidebarPreview,
  resolveSessionSidebarActions,
  resolveSessionSidebarCreateError,
  resolveSessionSidebarDeleteError,
  resolveSessionSidebarEmptyState,
  resolveSessionSidebarRenameError,
  resolveSessionSidebarStatus,
  type SessionSidebarDeleteErrorState,
  type SessionSidebarRenameErrorState,
  sessionDisplayName,
  sessionSearchHaystack,
} from "./agent-session-sidebar-state";

export interface AgentSessionSidebarProps {
  apiUrl?: string;
  configUrl?: string;
  onConfigOpen?: () => void;
  /** 弹窗(InternShannon浮窗)用:隐藏头像的「配置」入口,头像只作身份展示——浮窗内不再提供配置页。桌面整页默认 false。 */
  hideConfigEntry?: boolean;
  /** 打开「记忆」视图(InternShannon记忆时间轴)。仅在提供回调时渲染入口;不提供则隐藏(默认行为不变)。 */
  onMemoryOpen?: () => void;
  currentSessionId?: string | null;
  onSessionChange?: (id: string | null) => void;
  optimisticPlaceholder?: boolean;
}

function isPrimaryAgentSession(session: Pick<AgentProcessInfo, "sessionId" | "agentId">) {
  return agentRegistryModel.resolveSessionAgentId(session.sessionId, session.agentId ?? null) === DEFAULT_AGENT_ID;
}

function sortSessionsByRecency(sessions: readonly Readonly<AgentProcessInfo>[]) {
  return [...sessions].sort((a, b) => b.createdAt - a.createdAt || b.sessionId.localeCompare(a.sessionId));
}

function pickNextSession(sessions: readonly Readonly<AgentProcessInfo>[], excludeSessionId?: string) {
  return (
    sortSessionsByRecency(sessions)
      .filter((session) => session.sessionId !== excludeSessionId)
      .sort((a, b) => Number(b.state !== "exited") - Number(a.state !== "exited"))[0] ?? null
  );
}

function formatSessionTimestamp(raw: number) {
  const ts = raw > 0 && raw < 1e12 ? raw * 1000 : raw;
  return ts > 0 ? timeAgo(ts) : "未知时间";
}

export function AgentSessionSidebar({
  apiUrl,
  configUrl,
  onConfigOpen,
  hideConfigEntry = false,
  onMemoryOpen,
  currentSessionId,
  onSessionChange,
  optimisticPlaceholder = false,
}: AgentSessionSidebarProps) {
  const navigate = useNavigate();
  const agentSnap = useSnapshot(agentModel.state);
  const registrySnap = useSnapshot(agentRegistryModel.state);
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const [busySessionId, setBusySessionId] = useState<string | null>(null);
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
  const [deleteSessionId, setDeleteSessionId] = useState<string | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);
  const [renameError, setRenameError] = useState<SessionSidebarRenameErrorState | null>(null);
  const [deleteError, setDeleteError] = useState<SessionSidebarDeleteErrorState | null>(null);
  const [nameInput, setNameInput] = useState("");

  const agent = useMemo(() => {
    void registrySnap.revision;
    return (
      agentRegistryModel.getAllAgents().find((item) => item.id === DEFAULT_AGENT_ID) ?? getAgentById(DEFAULT_AGENT_ID)
    );
  }, [registrySnap.revision]);

  // 头像渲染收敛到共享 <AgentAvatar>:默认助手配了头像 URL → <img>,否则回退内置 nice-avatar
  // (本侧栏始终展示默认智能助手)。
  const avatarClassName = "size-9 rounded-[16px] ring-1 ring-border-light shadow-[rgba(0,0,0,0.08)_0px_4px_6px]";
  const avatarNode = agent?.avatar ? <AgentAvatar agent={agent} className={avatarClassName} /> : null;

  const sessions = useMemo(() => {
    void registrySnap.revision;
    return sortSessionsByRecency(agentSnap.sdkSessions.filter(isPrimaryAgentSession));
  }, [agentSnap.sdkSessions, registrySnap.revision]);

  const filteredSessions = useMemo(() => {
    const trimmedQuery = query.trim().toLowerCase();
    if (!trimmedQuery) return sessions;
    return sessions.filter((session) => {
      const status = resolveSessionSidebarStatus({
        sessionState: session.state,
        sessionStatus: agentSnap.sessionStatus[session.sessionId],
        connectionStatus: agentSnap.connectionStatus[session.sessionId],
      });
      const haystack = sessionSearchHaystack({
        session,
        sessionNames: agentSnap.sessionNames,
        statusLabel: status.label,
      });
      return haystack.includes(trimmedQuery);
    });
  }, [agentSnap.connectionStatus, agentSnap.sessionNames, agentSnap.sessionStatus, query, sessions]);

  const deleteTarget = useMemo(
    () =>
      resolveSessionDeleteTarget({
        sessionId: deleteSessionId,
        sessions,
        sessionNames: agentSnap.sessionNames,
      }),
    [agentSnap.sessionNames, deleteSessionId, sessions],
  );
  const previousDeleteTargetRef = useRef<typeof deleteTarget>(null);
  if (deleteTarget) {
    previousDeleteTargetRef.current = deleteTarget;
  }
  const visibleDeleteTarget = deleteTarget ?? previousDeleteTargetRef.current;

  const sessionSummary = useMemo(
    () => ({
      total: sessions.length,
      active: sessions.filter((session) => session.state !== "exited").length,
    }),
    [sessions],
  );
  const createErrorPresentation = useMemo(() => resolveSessionSidebarCreateError(createError), [createError]);
  const renameErrorPresentation = useMemo(() => resolveSessionSidebarRenameError(renameError), [renameError]);
  const deleteErrorPresentation = useMemo(() => resolveSessionSidebarDeleteError(deleteError), [deleteError]);
  const emptyStatePresentation = useMemo(
    () =>
      resolveSessionSidebarEmptyState({
        totalSessions: sessions.length,
        query,
      }),
    [query, sessions.length],
  );

  const selectSession = (sessionId: string) => {
    connectSession(sessionId);
    agentModel.setCurrentSession(sessionId);
    agentModel.clearUnread(sessionId);
    onSessionChange?.(sessionId);
  };

  const openAgentConfig = () => {
    if (onConfigOpen) {
      onConfigOpen();
      return;
    }
    navigate(configUrl ?? `/agent/${encodeURIComponent(DEFAULT_AGENT_ID)}/config`);
  };

  const handleCreateSession = async () => {
    if (creating) return;
    setCreating(true);
    setCreateError(null);
    try {
      const result = await createAgentSession(
        buildAgentSessionCreateOptions({
          agentId: DEFAULT_AGENT_ID,
          agent,
          apiUrl,
          optimisticPlaceholder,
        }),
      );
      if (shouldInitializeAgentDefaultsAfterCreate(apiUrl)) {
        const { initializeAgentDefaults } = await import("@/lib/workspace-utils");
        await initializeAgentDefaults(result.sessionId, DEFAULT_AGENT_ID);
      }
      selectSession(result.sessionId);
      setQuery((current) => nextSessionSearchQueryAfterCreate(current));
      await refreshSessionsInBackground(apiUrl, { preserveExistingOnEmpty: true });
      toast.success("会话创建成功");
    } catch (error) {
      const message = formatAgentSessionCreateError(error);
      setCreateError(message);
      toast.error(message);
    } finally {
      setCreating(false);
    }
  };

  const startRename = (session: Readonly<AgentProcessInfo>) => {
    const name = sessionDisplayName(session, agentSnap.sessionNames);
    setRenameError(null);
    setNameInput(name);
    setEditingSessionId(session.sessionId);
  };

  const commitRename = async (sessionId: string) => {
    const name = nameInput.trim();
    const session = sessions.find((item) => item.sessionId === sessionId);
    const previousName = session ? sessionDisplayName(session, agentSnap.sessionNames) : "";
    setEditingSessionId(null);
    if (!name) return;
    setRenameError(null);
    if (previousName && name === previousName) {
      setNameInput("");
      return;
    }
    agentModel.setSessionName(sessionId, name);
    try {
      await agentApi.updateSession(sessionId, { name }, apiUrl);
      setNameInput("");
    } catch (error) {
      if (previousName) {
        agentModel.setSessionName(sessionId, previousName);
      }
      const message = formatSessionSidebarActionError(error, "重命名会话失败，请检查本地服务连接");
      setRenameError({ sessionId, message });
      toast.error(message);
    }
  };

  const cancelRename = () => {
    setEditingSessionId(null);
    setNameInput("");
  };

  const handleDeleteSession = async (sessionId: string) => {
    setBusySessionId(sessionId);
    setDeleteError(null);
    try {
      const wasCurrent = currentSessionId === sessionId;
      await agentApi.deleteSession(sessionId, apiUrl);
      disconnectSession(sessionId);
      agentRegistryModel.removeSessionAgent(sessionId);
      agentModel.removeSession(sessionId);
      await refreshSessionsInBackground(apiUrl, { preserveExistingOnEmpty: true });

      if (wasCurrent) {
        const nextSession = pickNextSession(agentModel.state.sdkSessions.filter(isPrimaryAgentSession), sessionId);
        if (nextSession) {
          selectSession(nextSession.sessionId);
        } else {
          agentModel.setCurrentSession(null);
          onSessionChange?.(null);
        }
      }
      toast.success("会话已删除");
    } catch (error) {
      const message = formatSessionSidebarActionError(error, "删除会话失败，请检查本地服务连接");
      setDeleteError({ sessionId, message });
      toast.error(message);
    } finally {
      setBusySessionId(null);
    }
  };

  const handleConfirmDeleteSession = async () => {
    const sessionId = deleteTarget?.sessionId;
    setDeleteSessionId(null);
    if (!sessionId) return;
    await handleDeleteSession(sessionId);
  };

  const renderPreview = (sessionId: string) => {
    const activeTool =
      agentSnap.activeToolProgress[sessionId] ??
      Object.values(agentSnap.activeToolProgressById[sessionId] ?? {})[0] ??
      null;
    if (activeTool) return `正在执行工具: ${activeTool.toolName}`;
    if (agentSnap.sessionStatus[sessionId] === "running" && agentSnap.streaming[sessionId]) {
      return `书小安: ${compactSessionPreviewText(agentSnap.streaming[sessionId])}`;
    }
    if (agentSnap.sessionStatus[sessionId] === "running") {
      return "书小安正在处理...";
    }
    return resolveSessionSidebarPreview(agentSnap.messages[sessionId]);
  };

  const renderStatusText = (session: Readonly<AgentProcessInfo>) => {
    return resolveSessionSidebarStatus({
      sessionState: session.state,
      sessionStatus: agentSnap.sessionStatus[session.sessionId],
      connectionStatus: agentSnap.connectionStatus[session.sessionId],
    }).label;
  };

  const statusDotClass = (session: Readonly<AgentProcessInfo>) => {
    const tone = resolveSessionSidebarStatus({
      sessionState: session.state,
      sessionStatus: agentSnap.sessionStatus[session.sessionId],
      connectionStatus: agentSnap.connectionStatus[session.sessionId],
    }).tone;
    if (tone === "ended") return "text-[#a1a1aa]";
    if (tone === "running") return "text-primary";
    if (tone === "connecting") return "text-amber-500";
    if (tone === "disconnected") return "text-red-500";
    return "text-emerald-500";
  };

  return (
    <aside className="flex h-full min-h-0 flex-col border-r border-border-light bg-white">
      <div className="border-b border-border-light px-3 py-3">
        <div className="flex items-center gap-2.5">
          {avatarNode &&
            (hideConfigEntry ? (
              // 浮窗内只作身份展示:不挂配置入口(配置页已从助手弹窗移除)。
              <div className="shrink-0 rounded-[16px]">{avatarNode}</div>
            ) : (
              <button
                type="button"
                onClick={openAgentConfig}
                className="shrink-0 rounded-[16px] transition-transform hover:scale-[1.03] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/40"
                title="配置智能助手"
                aria-label="配置智能助手"
              >
                {avatarNode}
              </button>
            ))}
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-foreground">{agent?.name ?? "书小安"}</p>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              {sessionSummary.active} 活跃 / {sessionSummary.total} 总会话
            </p>
          </div>
          {onMemoryOpen ? (
            <button
              type="button"
              onClick={onMemoryOpen}
              className="flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/40"
              title="记忆"
              aria-label="记忆"
            >
              <Brain className="size-4" />
            </button>
          ) : null}
          <button
            type="button"
            onClick={handleCreateSession}
            disabled={creating}
            className="flex size-8 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
            title="新会话"
            aria-label="新会话"
          >
            {creating ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
          </button>
        </div>
        <div className="relative mt-3">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索会话"
            className="h-8 rounded-full border-border-light bg-muted/40 pl-8 text-xs text-foreground focus-visible:border-primary/30 focus-visible:bg-white focus-visible:ring-primary/20"
          />
        </div>
        {createErrorPresentation ? (
          <div role="alert" className="mt-2 rounded-[8px] border border-red-500/10 bg-red-500/[0.04] p-2 text-red-700">
            <div className="flex items-start gap-2">
              <CircleAlert className="mt-0.5 size-3.5 shrink-0 text-red-600" />
              <div className="min-w-0 flex-1">
                <p className="text-[11px] font-medium leading-4 text-red-800">{createErrorPresentation.title}</p>
                <p className="mt-0.5 break-words text-[11px] leading-4">{createErrorPresentation.message}</p>
              </div>
              <button
                type="button"
                onClick={() => setCreateError(null)}
                className="flex size-5 shrink-0 items-center justify-center rounded-md text-red-600 transition-colors hover:bg-red-500/10"
                title="关闭新会话错误提示"
                aria-label="关闭新会话错误提示"
              >
                <X className="size-3" />
              </button>
            </div>
            <button
              type="button"
              onClick={handleCreateSession}
              disabled={creating}
              className="mt-2 inline-flex h-7 items-center gap-1.5 rounded-md border border-red-500/15 bg-white px-2 text-[11px] font-medium text-red-700 transition-colors hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {creating ? <Loader2 className="size-3 animate-spin" /> : <RefreshCw className="size-3" />}
              {createErrorPresentation.retryLabel}
            </button>
          </div>
        ) : null}
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <div className="space-y-1 p-1.5">
          {filteredSessions.length === 0 ? (
            <div className="flex min-h-[180px] flex-col items-center justify-center rounded-[8px] border border-dashed border-[#d8dee8] bg-muted/40 px-4 text-center">
              <p className="text-xs font-medium text-foreground">{emptyStatePresentation.title}</p>
              <p className="mt-1 max-w-[220px] text-[11px] leading-4 text-muted-foreground">
                {emptyStatePresentation.description}
              </p>
              <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
                {emptyStatePresentation.showClearSearch ? (
                  <button
                    type="button"
                    onClick={() => setQuery("")}
                    className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border-light bg-white px-2.5 text-xs font-medium text-foreground shadow-sm transition-colors hover:border-primary/25 hover:bg-primary/5 hover:text-primary"
                  >
                    <X className="size-3.5" />
                    {emptyStatePresentation.clearSearchLabel}
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={handleCreateSession}
                  disabled={creating}
                  className="inline-flex h-8 items-center gap-1.5 rounded-md bg-primary px-2.5 text-xs font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 disabled:opacity-60"
                >
                  {creating ? <Loader2 className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />}
                  {emptyStatePresentation.createLabel}
                </button>
              </div>
            </div>
          ) : (
            filteredSessions.map((session) => {
              const name = sessionDisplayName(session, agentSnap.sessionNames);
              const isActive = session.sessionId === currentSessionId;
              const isCreating = session.state === "creating";
              const isBusy = busySessionId === session.sessionId;
              const isEditing = editingSessionId === session.sessionId;
              const sessionRenameError =
                renameErrorPresentation?.sessionId === session.sessionId ? renameErrorPresentation : null;
              const sessionDeleteError =
                deleteErrorPresentation?.sessionId === session.sessionId ? deleteErrorPresentation : null;
              const sessionActionError = sessionRenameError ?? sessionDeleteError;
              const actions = resolveSessionSidebarActions(session);
              return (
                <div
                  key={session.sessionId}
                  className={cn(
                    "group rounded-[8px] border px-2 py-1.5 transition-colors",
                    isActive
                      ? "border-primary/20 bg-primary/[0.08]"
                      : "border-transparent bg-white hover:border-border-light hover:bg-muted/40",
                  )}
                >
                  <div className="flex items-center gap-1.5">
                    <div className="min-w-0 flex-1">
                      {isEditing ? (
                        <Input
                          value={nameInput}
                          onChange={(event) => setNameInput(event.target.value)}
                          onKeyDown={(event) => {
                            if (event.key === "Enter") {
                              void commitRename(session.sessionId);
                            }
                            if (event.key === "Escape") {
                              cancelRename();
                            }
                          }}
                          className="h-7 rounded-md border-primary/30 bg-white px-2 text-xs focus-visible:ring-primary/20"
                          autoFocus
                        />
                      ) : (
                        <button
                          type="button"
                          className="w-full min-w-0 text-left disabled:cursor-not-allowed disabled:opacity-75"
                          onClick={() => selectSession(session.sessionId)}
                          disabled={!actions.canSelect}
                          title={actions.disabledReason}
                        >
                          <div className="flex min-w-0 items-center gap-1.5">
                            <span className="truncate text-[12px] font-medium leading-4 text-foreground">{name}</span>
                            {isActive && (
                              <span className="shrink-0 rounded-full bg-primary px-1.5 py-0.5 text-[8px] font-medium leading-none text-primary-foreground">
                                当前
                              </span>
                            )}
                          </div>
                          <div className="mt-0.5 flex min-w-0 items-center gap-1 text-[10px] leading-4 text-muted-foreground">
                            {isCreating ? (
                              <Loader2 className="size-2.5 shrink-0 animate-spin text-primary" />
                            ) : (
                              <Circle className={cn("size-1.5 shrink-0 fill-current", statusDotClass(session))} />
                            )}
                            <span className="shrink-0">{renderStatusText(session)}</span>
                            <span className="shrink-0">·</span>
                            <span className="shrink-0">{formatSessionTimestamp(session.createdAt)}</span>
                            <span className="min-w-0 truncate text-muted-foreground">
                              {renderPreview(session.sessionId)}
                            </span>
                          </div>
                        </button>
                      )}
                    </div>
                    {isEditing ? (
                      <div className="flex shrink-0 items-center gap-0.5">
                        <button
                          type="button"
                          className="flex size-5 items-center justify-center rounded-md text-emerald-600 hover:bg-emerald-500/10"
                          onClick={() => void commitRename(session.sessionId)}
                          title="保存名称"
                          aria-label="保存名称"
                        >
                          <Check className="size-3" />
                        </button>
                        <button
                          type="button"
                          className="flex size-5 items-center justify-center rounded-md text-muted-foreground hover:bg-muted"
                          onClick={cancelRename}
                          title="取消重命名"
                          aria-label="取消重命名"
                        >
                          <X className="size-3" />
                        </button>
                      </div>
                    ) : (
                      <div className="flex shrink-0 items-center gap-0.5 opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100">
                        <button
                          type="button"
                          className="flex size-5 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-muted-foreground"
                          onClick={() => startRename(session)}
                          disabled={!actions.canRename}
                          title={actions.disabledReason ?? "重命名会话"}
                          aria-label="重命名会话"
                        >
                          <Pencil className="size-3" />
                        </button>
                        <button
                          type="button"
                          className="flex size-5 items-center justify-center rounded-md text-muted-foreground hover:bg-destructive/10 hover:text-destructive disabled:opacity-50"
                          onClick={() => setDeleteSessionId(session.sessionId)}
                          disabled={isBusy || !actions.canDelete}
                          title={actions.disabledReason ?? "删除会话"}
                          aria-label="删除会话"
                        >
                          {isBusy ? <Loader2 className="size-3 animate-spin" /> : <Trash2 className="size-3" />}
                        </button>
                      </div>
                    )}
                  </div>
                  {sessionActionError ? (
                    <div
                      role="alert"
                      className="mt-1.5 flex items-start gap-1.5 rounded-[6px] border border-red-500/10 bg-red-500/[0.04] px-2 py-1.5 text-red-700"
                    >
                      <CircleAlert className="mt-0.5 size-3 shrink-0 text-red-600" />
                      <div className="min-w-0 flex-1">
                        <p className="text-[10px] font-medium leading-3 text-red-800">{sessionActionError.title}</p>
                        <p className="mt-0.5 break-words text-[10px] leading-3">{sessionActionError.message}</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          if (sessionRenameError) setRenameError(null);
                          if (sessionDeleteError) setDeleteError(null);
                        }}
                        className="flex size-4 shrink-0 items-center justify-center rounded text-red-600 hover:bg-red-500/10"
                        title="关闭会话操作错误提示"
                        aria-label="关闭会话操作错误提示"
                      >
                        <X className="size-2.5" />
                      </button>
                    </div>
                  ) : null}
                </div>
              );
            })
          )}
        </div>
      </ScrollArea>
      <AlertDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteSessionId(null);
        }}
      >
        <AlertDialogContent className="max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle>删除这个会话？</AlertDialogTitle>
            <AlertDialogDescription>
              「{visibleDeleteTarget?.name ?? "当前会话"}」会从书小安会话列表中移除，当前页面也会切换到下一个可用会话。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={() => void handleConfirmDeleteSession()}
            >
              删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </aside>
  );
}
