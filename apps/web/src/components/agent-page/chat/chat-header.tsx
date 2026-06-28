import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  Circle,
  Copy,
  ExternalLink,
  FolderOpen,
  Loader2,
  MessageSquare,
  MoreHorizontal,
  Pencil,
  Plus,
  Search,
  Trash2,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { connectSession, disconnectSession } from "@/hooks/use-agent-ws";
import { agentApi } from "@/lib/agent-api";
import { allowsLocalWorkspacePaths } from "@/lib/runtime-environment";
import { destroySessionAndRefresh, refreshSessionsInBackground } from "@/lib/session-bootstrap";
import { defaultSessionTitle } from "@/lib/session-title";
import { timeAgo } from "@/lib/time";
import { cn } from "@/lib/utils";
import { exposeWorkspacePath } from "@/lib/workspace-path";
import agentModel from "@/models/agent.model";
import agentRegistryModel from "@/models/agent-registry.model";
// import CreateSessionDialog from "../create-session-dialog"; // 已移除：直接使用默认配置创建会话
import { AgentAvatar } from "../agent-avatar";
import {
  buildAgentSessionCreateOptions,
  shouldInitializeAgentDefaultsAfterCreate,
} from "../agent-session-create-state";
import {
  resolveFirstSelectableSessionId,
  resolveSessionDeleteTarget,
  resolveSessionPickerSearchKeyAction,
  resolveSessionSidebarActions,
  resolveSessionSidebarStatus,
  type SessionSidebarStatusTone,
  sessionDisplayName,
  sessionSearchHaystack,
} from "../agent-session-sidebar-state";
import { WorkspaceFileManagerDialog } from "../workspace-file-manager-dialog";
import { resolveChatSearchInputKeyAction } from "./agent-chat-search-state";

export function ChatHeader({
  apiUrl,
  sessionId,
  searchQuery,
  searchFocusRequest = 0,
  onSearchChange,
  onSessionChange,
  viewMode,
  onViewModeChange,
  cwd,
  onCopyTranscript,
  onExportSessionJson,
  searchMatchCount,
  searchCurrentIndex,
  onSearchPrev,
  onSearchNext,
  showSessionManagement = true,
  onWorkspaceOpen,
}: {
  apiUrl?: string;
  sessionId: string;
  searchQuery?: string;
  searchFocusRequest?: number;
  onSearchChange?: (q: string) => void;
  onSessionChange?: (id: string) => void;
  viewMode?: "chat" | "workspace";
  onViewModeChange?: (mode: "chat" | "workspace") => void;
  cwd?: string;
  onCopyTranscript?: () => void | Promise<void>;
  onExportSessionJson?: () => void | Promise<void>;
  searchMatchCount?: number;
  searchCurrentIndex?: number;
  onSearchPrev?: () => void;
  onSearchNext?: () => void;
  showSessionManagement?: boolean;
  /** 提供时,「工作区」按钮交由宿主处理(如InternShannon悬浮窗内嵌打开),不再弹本地 Dialog。 */
  onWorkspaceOpen?: () => void;
}) {
  const { sdkSessions, sessions, sessionNames, sessionStatus, connectionStatus } = useSnapshot(agentModel.state);
  const currentSession = sdkSessions.find((s) => s.sessionId === sessionId);
  const runtimeSession = sessions[sessionId];
  const agent = agentRegistryModel.getSessionAgent(sessionId);
  const agentId = agentRegistryModel.resolveSessionAgentId(sessionId, currentSession?.agentId ?? null);
  const [searchOpen, setSearchOpen] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const previousSearchFocusRequestRef = useRef(searchFocusRequest);
  const [editingName, setEditingName] = useState(false);
  const [nameInput, setNameInput] = useState("");
  const [sessionPickerOpen, setSessionPickerOpen] = useState(false);
  const [sessionFilter, setSessionFilter] = useState("");
  const [sessionActionId, setSessionActionId] = useState<string | null>(null);
  const [deleteSessionId, setDeleteSessionId] = useState<string | null>(null);
  const [workspaceManagerOpen, setWorkspaceManagerOpen] = useState(false);
  const displayedName = sessionNames[sessionId] || currentSession?.name || defaultSessionTitle(sessionId);
  // 已移除：不再需要弹窗状态
  // const [createOpen, setCreateOpen] = useState(false);
  // const [createDefaults, setCreateDefaults] = useState<...>(undefined);

  const isExited = currentSession?.state === "exited";
  const activeStatus = sessionStatus[sessionId];
  const activeConnection = connectionStatus[sessionId];
  const workspacePath = exposeWorkspacePath(cwd || runtimeSession?.cwd || currentSession?.cwd || "", {
    allowLocal: allowsLocalWorkspacePaths(),
  });
  const activeStatusPresentation = resolveSessionSidebarStatus({
    sessionState: currentSession?.state,
    sessionStatus: activeStatus,
    connectionStatus: activeConnection,
  });
  const statusText = activeStatusPresentation.label;

  const agentSessions = useMemo(() => {
    return [...sdkSessions]
      .filter((s) => agentRegistryModel.resolveSessionAgentId(s.sessionId, s.agentId ?? null) === agentId)
      .sort((a, b) => b.createdAt - a.createdAt);
  }, [sdkSessions, agentId]);

  const filteredAgentSessions = useMemo(() => {
    const query = sessionFilter.trim().toLowerCase();
    if (!query) return agentSessions;
    return agentSessions.filter((session) => {
      const status = resolveSessionSidebarStatus({
        sessionState: session.state,
        sessionStatus: sessionStatus[session.sessionId],
        connectionStatus: connectionStatus[session.sessionId],
      });
      return sessionSearchHaystack({
        session,
        sessionNames,
        statusLabel: status.label,
      }).includes(query);
    });
  }, [agentSessions, connectionStatus, sessionFilter, sessionNames, sessionStatus]);

  const sessionSummary = useMemo(
    () => ({
      total: agentSessions.length,
      active: agentSessions.filter((item) => item.state !== "exited").length,
    }),
    [agentSessions],
  );
  const firstSelectableFilteredSessionId = useMemo(
    () => resolveFirstSelectableSessionId(filteredAgentSessions),
    [filteredAgentSessions],
  );
  const deleteTarget = useMemo(
    () =>
      resolveSessionDeleteTarget({
        sessionId: deleteSessionId,
        sessions: agentSessions,
        sessionNames,
      }),
    [agentSessions, deleteSessionId, sessionNames],
  );
  const previousDeleteTargetRef = useRef<typeof deleteTarget>(null);
  if (deleteTarget) {
    previousDeleteTargetRef.current = deleteTarget;
  }
  const visibleDeleteTarget = deleteTarget ?? previousDeleteTargetRef.current;

  const handleRename = () => {
    setNameInput(displayedName);
    setEditingName(true);
  };

  const commitRename = () => {
    const name = nameInput.trim();
    if (name) {
      agentModel.setSessionName(sessionId, name);
      agentApi.updateSession(sessionId, { name }, apiUrl).catch(() => {});
    }
    setEditingName(false);
  };

  const handleCreated = (sid: string) => {
    connectSession(sid);
    agentModel.setCurrentSession(sid);
    agentModel.clearUnread(sid);
    setSessionPickerOpen(false);
    onSessionChange?.(sid);
  };

  const handleSelectSession = (targetSessionId: string) => {
    connectSession(targetSessionId);
    agentModel.setCurrentSession(targetSessionId);
    agentModel.clearUnread(targetSessionId);
    onSessionChange?.(targetSessionId);
    setSessionPickerOpen(false);
  };

  const handleDeleteSession = async (targetSessionId: string) => {
    setSessionActionId(targetSessionId);
    try {
      if (targetSessionId === sessionId) {
        const nextSessionId = await destroySessionAndRefresh({
          sessionId: targetSessionId,
          preferAgentId: agentId,
          apiUrl,
        });
        if (nextSessionId) {
          onSessionChange?.(nextSessionId);
        }
      } else {
        await agentApi.deleteSession(targetSessionId, apiUrl);
        disconnectSession(targetSessionId);
        agentRegistryModel.removeSessionAgent(targetSessionId);
        agentModel.removeSession(targetSessionId);
        await refreshSessionsInBackground(apiUrl, { preserveExistingOnEmpty: true });
      }
      toast.success("会话已删除");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "删除会话失败");
    } finally {
      setSessionActionId(null);
    }
  };

  const handleConfirmDeleteSession = async () => {
    const targetSessionId = deleteTarget?.sessionId;
    setDeleteSessionId(null);
    if (!targetSessionId) return;
    await handleDeleteSession(targetSessionId);
  };

  const handleCreateSession = async () => {
    setSessionPickerOpen(false);

    try {
      const { createAgentSession } = await import("@/lib/session-bootstrap");
      const result = await createAgentSession(
        buildAgentSessionCreateOptions({
          agentId,
          agent,
          apiUrl,
        }),
      );
      if (shouldInitializeAgentDefaultsAfterCreate(apiUrl)) {
        const { initializeAgentDefaults } = await import("@/lib/workspace-utils");
        await initializeAgentDefaults(result.sessionId, agentId);
      }
      handleCreated(result.sessionId);
      toast.success("会话创建成功");
    } catch (error) {
      console.error("Failed to create session:", error);
      toast.error(error instanceof Error ? error.message : "创建会话失败");
    }
  };

  const toggleSearch = () => {
    if (searchOpen) {
      onSearchChange?.("");
      setSearchOpen(false);
      return;
    }
    setSearchOpen(true);
  };

  useEffect(() => {
    if (searchFocusRequest <= previousSearchFocusRequestRef.current) return;
    previousSearchFocusRequestRef.current = searchFocusRequest;
    setSearchOpen(true);

    const frame = window.requestAnimationFrame(() => {
      searchInputRef.current?.focus();
      searchInputRef.current?.select();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [searchFocusRequest]);

  const handleOpenFolder = async () => {
    if (!workspacePath) {
      toast.error("当前会话没有工作目录");
      return;
    }
    if (onWorkspaceOpen) {
      onWorkspaceOpen();
      return;
    }
    setWorkspaceManagerOpen(true);
  };

  const formatSessionTimestamp = (raw: number) => {
    const ts = raw > 0 && raw < 1e12 ? raw * 1000 : raw;
    return ts > 0 ? timeAgo(ts) : "未知时间";
  };

  const statusToneClass = (tone: SessionSidebarStatusTone) => {
    if (tone === "ended") return "text-muted-foreground/40";
    if (tone === "running") return "text-primary";
    if (tone === "connecting") return "text-amber-500";
    if (tone === "disconnected") return "text-red-500";
    return "text-green-500";
  };

  const statusBadgeClass = (tone: SessionSidebarStatusTone) => {
    if (tone === "ended") return "bg-muted px-2 py-1 text-[10px] text-foreground/80";
    if (tone === "running") return "bg-primary/10 text-primary";
    if (tone === "connecting") return "bg-amber-500/10 text-amber-700";
    if (tone === "disconnected") return "bg-red-500/10 text-red-600";
    return "bg-[#e8ffea] text-emerald-700";
  };

  return (
    <div className="border-b border-border-light bg-white shadow-[rgba(0,0,0,0.06)_0px_3px_6px]">
      {searchOpen ? (
        <div className="flex items-center gap-2 px-3 py-2">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              ref={searchInputRef}
              className="h-8 rounded-full border-border-light bg-muted/40 pl-9 text-sm text-foreground focus-visible:border-primary/30 focus-visible:bg-white focus-visible:ring-primary/20"
              placeholder="搜索聊天记录…"
              value={searchQuery ?? ""}
              onChange={(e) => onSearchChange?.(e.target.value)}
              onKeyDown={(event) => {
                const action = resolveChatSearchInputKeyAction({
                  key: event.key,
                  metaKey: event.metaKey,
                  ctrlKey: event.ctrlKey,
                  altKey: event.altKey,
                  shiftKey: event.shiftKey,
                  isComposing: event.nativeEvent.isComposing,
                  hasMatches: Boolean(searchQuery && searchMatchCount != null && searchMatchCount > 0),
                });
                if (!action) return;
                event.preventDefault();
                if (action === "close") {
                  onSearchChange?.("");
                  setSearchOpen(false);
                  return;
                }
                if (action === "previous") {
                  onSearchPrev?.();
                  return;
                }
                onSearchNext?.();
              }}
              autoFocus
            />
          </div>
          {searchQuery && searchMatchCount != null && searchMatchCount > 0 ? (
            <>
              <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                {(searchCurrentIndex ?? 0) + 1}/{searchMatchCount}
              </span>
              <button
                type="button"
                onClick={onSearchPrev}
                className="flex size-8 items-center justify-center rounded-full text-foreground/80 transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/40"
                title="上一个匹配"
                aria-label="上一个匹配"
              >
                <ArrowUp className="size-4" />
              </button>
              <button
                type="button"
                onClick={onSearchNext}
                className="flex size-8 items-center justify-center rounded-full text-foreground/80 transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/40"
                title="下一个匹配"
                aria-label="下一个匹配"
              >
                <ArrowDown className="size-4" />
              </button>
            </>
          ) : searchQuery && searchMatchCount === 0 ? (
            <span className="shrink-0 text-xs text-muted-foreground">无匹配</span>
          ) : null}
          <button
            type="button"
            className="shrink-0 rounded-full px-3 py-1 text-sm text-foreground/80 transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/40"
            onClick={toggleSearch}
          >
            取消
          </button>
        </div>
      ) : (
        <div className="flex items-center gap-2.5 px-3 py-2">
          <div className="flex min-w-0 flex-1 items-center gap-2">
            {showSessionManagement && (
              <AgentAvatar
                agent={agent}
                className="size-8 shrink-0 rounded-[16px] ring-1 ring-border-light shadow-[rgba(0,0,0,0.08)_0px_4px_6px]"
              />
            )}
            {editingName ? (
              <input
                type="text"
                value={nameInput}
                onChange={(e) => setNameInput(e.target.value)}
                onBlur={commitRename}
                onKeyDown={(e) => {
                  if (e.key === "Enter") commitRename();
                  else if (e.key === "Escape") setEditingName(false);
                }}
                className="min-w-0 flex-1 rounded-full border border-border-light bg-muted/40 px-3 py-1 text-sm text-foreground outline-none focus:border-primary/30 focus:ring-1 focus:ring-primary/20"
              />
            ) : showSessionManagement ? (
              <Popover open={sessionPickerOpen} onOpenChange={setSessionPickerOpen}>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    className="flex max-w-[min(30vw,320px)] min-w-0 items-center gap-1 rounded-full px-2.5 py-1 text-sm font-medium text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/40"
                  >
                    <span className="truncate">
                      {sessionNames[sessionId] || currentSession?.name || defaultSessionTitle(sessionId)}
                    </span>
                    <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
                  </button>
                </PopoverTrigger>
                <PopoverContent
                  align="start"
                  className="w-[25rem] overflow-hidden rounded-[12px] border border-black/8 bg-[linear-gradient(180deg,rgba(255,255,255,0.98),rgba(248,250,252,0.96))] p-0 shadow-[0_12px_16px_-4px_rgba(36,36,36,0.08)] backdrop-blur-xl dark:border-white/10 dark:bg-[linear-gradient(180deg,rgba(24,24,27,0.98),rgba(17,24,39,0.96))]"
                >
                  <div className="border-b border-black/6 bg-[linear-gradient(135deg,hsl(var(--primary)_/_0.08),rgba(15,23,42,0.02))] px-4 py-4 dark:border-white/8 dark:bg-[linear-gradient(135deg,hsl(var(--primary)_/_0.16),rgba(255,255,255,0.02))]">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-foreground/92">会话</p>
                        <p className="mt-1.5 text-[11px] leading-5 text-muted-foreground/80">
                          和这个智能体的聊天都会保留在这里
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={handleCreateSession}
                        className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md bg-primary px-2.5 text-xs font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary/90"
                      >
                        <Plus className="size-3.5" />
                        新会话
                      </button>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <span className="inline-flex items-center gap-1 rounded-full border border-border/60 bg-background/75 px-2.5 py-1 text-[10px] text-muted-foreground shadow-sm">
                        <span className="font-medium text-foreground/85">{sessionSummary.total}</span>
                        总会话
                      </span>
                      <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/15 bg-emerald-500/8 px-2.5 py-1 text-[10px] text-emerald-700 dark:text-emerald-300">
                        <span className="font-medium">{sessionSummary.active}</span>
                        活跃
                      </span>
                    </div>
                    <div className="relative mt-3">
                      <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3 -translate-y-1/2 text-muted-foreground" />
                      <Input
                        value={sessionFilter}
                        onChange={(event) => setSessionFilter(event.target.value)}
                        onKeyDown={(event) => {
                          const action = resolveSessionPickerSearchKeyAction({
                            key: event.key,
                            metaKey: event.metaKey,
                            ctrlKey: event.ctrlKey,
                            altKey: event.altKey,
                            shiftKey: event.shiftKey,
                            isComposing: event.nativeEvent.isComposing,
                            hasSelectableSession: Boolean(firstSelectableFilteredSessionId),
                          });
                          if (!action) return;
                          event.preventDefault();
                          if (action === "close") {
                            setSessionFilter("");
                            setSessionPickerOpen(false);
                            return;
                          }
                          if (firstSelectableFilteredSessionId) {
                            handleSelectSession(firstSelectableFilteredSessionId);
                          }
                        }}
                        placeholder="搜索聊天"
                        className="h-8 rounded-lg border-white/40 bg-background/80 pl-8 text-xs shadow-sm focus-visible:border-primary/25 focus-visible:ring-primary/20 focus-visible:bg-background dark:border-white/10 dark:bg-white/[0.04]"
                      />
                    </div>
                  </div>
                  <ScrollArea className="max-h-[24rem] bg-[linear-gradient(180deg,rgba(248,250,252,0.68),rgba(255,255,255,0.92))] dark:bg-[linear-gradient(180deg,rgba(255,255,255,0.01),rgba(255,255,255,0.03))]">
                    <div className="space-y-2 p-2.5">
                      {filteredAgentSessions.length === 0 && (
                        <div className="flex min-h-[140px] flex-col items-center justify-center rounded-lg border border-dashed border-border/70 bg-background/70 px-4 text-center shadow-[inset_0_1px_0_rgba(255,255,255,0.35)] dark:bg-white/[0.02]">
                          <p className="text-xs font-medium text-foreground/88">
                            {agentSessions.length === 0 ? "暂无会话记录" : "没有匹配的会话"}
                          </p>
                          <p className="mt-1 text-[11px] leading-5 text-muted-foreground">
                            {agentSessions.length === 0
                              ? "为这个智能体创建一个新会话后，会在这里统一管理。"
                              : "换个关键词试试。"}
                          </p>
                        </div>
                      )}
                      {filteredAgentSessions.map((s) => {
                        const name = sessionDisplayName(s, sessionNames);
                        const isActive = s.sessionId === sessionId;
                        const isBusy = sessionActionId === s.sessionId;
                        const itemStatus = resolveSessionSidebarStatus({
                          sessionState: s.state,
                          sessionStatus: sessionStatus[s.sessionId],
                          connectionStatus: connectionStatus[s.sessionId],
                        });
                        const actions = resolveSessionSidebarActions(s);
                        return (
                          <div
                            key={s.sessionId}
                            className={cn(
                              "group rounded-[12px] border px-3 py-3 shadow-[0_4px_6px_rgba(0,0,0,0.08)] transition-all",
                              isActive
                                ? "border-primary/20 bg-[linear-gradient(135deg,hsl(var(--primary)_/_0.12),hsl(var(--primary)_/_0.04))] text-primary"
                                : "border-black/6 bg-background/78 text-foreground hover:border-primary/12 hover:bg-background dark:border-white/8 dark:bg-white/[0.03]",
                            )}
                          >
                            <div className="flex items-start gap-2.5">
                              <button
                                type="button"
                                className="min-w-0 flex-1 text-left disabled:cursor-not-allowed disabled:opacity-75"
                                onClick={() => handleSelectSession(s.sessionId)}
                                disabled={!actions.canSelect}
                                title={actions.disabledReason}
                              >
                                <div className="flex items-center gap-2">
                                  <span className="truncate text-sm font-medium text-foreground/92">{name}</span>
                                  {isActive && (
                                    <span className="rounded-full bg-primary px-1.5 py-0.5 text-[9px] font-medium text-primary-foreground">
                                      当前
                                    </span>
                                  )}
                                  {itemStatus.tone === "ended" && (
                                    <span className="rounded-full border border-border/60 bg-muted/40 px-1.5 py-0.5 text-[9px] text-muted-foreground">
                                      已退出
                                    </span>
                                  )}
                                </div>
                                <div className="mt-1.5 flex items-center gap-1.5">
                                  <Circle
                                    className={cn("size-1.5 shrink-0 fill-current", statusToneClass(itemStatus.tone))}
                                  />
                                  <span className="text-[10px] font-medium text-muted-foreground/75">
                                    {itemStatus.label} · {formatSessionTimestamp(s.createdAt)}
                                  </span>
                                </div>
                              </button>
                              <div className="flex shrink-0 flex-col items-center gap-1 rounded-xl bg-muted/35 p-1 opacity-100 shadow-[inset_0_1px_0_rgba(255,255,255,0.35)] sm:opacity-0 sm:transition-opacity sm:group-hover:opacity-100 dark:bg-white/[0.03]">
                                <button
                                  type="button"
                                  className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive disabled:opacity-50"
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    setDeleteSessionId(s.sessionId);
                                    setSessionPickerOpen(false);
                                  }}
                                  disabled={isBusy || !actions.canDelete}
                                  title={actions.disabledReason ?? "删除会话"}
                                >
                                  {isBusy ? <Loader2 className="size-3 animate-spin" /> : <Trash2 className="size-3" />}
                                </button>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </ScrollArea>
                </PopoverContent>
              </Popover>
            ) : (
              <div className="flex min-w-0 max-w-[min(36vw,420px)] items-center px-1">
                <span className="truncate text-sm font-medium text-foreground">{displayedName}</span>
              </div>
            )}
            {showSessionManagement && !editingName && (
              <button
                type="button"
                title="重命名会话"
                onClick={handleRename}
                aria-label="重命名会话"
                className="flex size-7 shrink-0 items-center justify-center rounded-full text-foreground/80 transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/40"
              >
                <Pencil className="size-3" />
              </button>
            )}
            {isExited && (
              <span className={cn("shrink-0 rounded-full", statusBadgeClass(activeStatusPresentation.tone))}>
                {statusText}
              </span>
            )}
            {!isExited && (
              <span
                className={cn(
                  "hidden shrink-0 rounded-full px-2 py-1 text-[10px] md:inline-flex",
                  statusBadgeClass(activeStatusPresentation.tone),
                )}
              >
                {statusText}
              </span>
            )}
          </div>

          {viewMode && onViewModeChange && (
            <div className="shrink-0 rounded-full bg-muted p-1">
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => onViewModeChange("chat")}
                  className={cn(
                    "flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium transition-colors",
                    viewMode === "chat"
                      ? "bg-white text-foreground shadow-[rgba(0,0,0,0.08)_0px_4px_6px]"
                      : "text-foreground/80 hover:bg-white/70 hover:text-foreground",
                  )}
                >
                  <MessageSquare className="size-4" />
                  会话
                </button>
                <button
                  type="button"
                  onClick={() => onViewModeChange("workspace")}
                  className={cn(
                    "flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium transition-colors",
                    viewMode === "workspace"
                      ? "bg-white text-foreground shadow-[rgba(0,0,0,0.08)_0px_4px_6px]"
                      : "text-foreground/80 hover:bg-white/70 hover:text-foreground",
                  )}
                >
                  <FolderOpen className="size-4" />
                  工作区
                </button>
              </div>
            </div>
          )}

          <div className="flex shrink-0 items-center gap-1">
            {workspacePath &&
              (onWorkspaceOpen ? (
                // InternShannon悬浮窗:用文字按钮(图标按钮太隐蔽,用户找不到工作区入口)。
                <button
                  type="button"
                  className="flex shrink-0 items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-foreground/[0.04] hover:text-foreground"
                  aria-label="打开工作区"
                  title={`打开工作区\n${workspacePath}`}
                  onClick={handleOpenFolder}
                >
                  <FolderOpen className="size-4" />
                  工作区
                </button>
              ) : (
                <button
                  type="button"
                  className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-foreground/[0.04] hover:text-foreground"
                  aria-label={`打开工作区文件管理器: ${workspacePath}`}
                  title={`打开工作区文件管理器\n${workspacePath}`}
                  onClick={handleOpenFolder}
                >
                  <FolderOpen className="size-4" />
                </button>
              ))}
            <button
              type="button"
              className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-foreground/[0.04] hover:text-foreground"
              aria-label="搜索消息"
              onClick={toggleSearch}
            >
              <Search className="size-4" />
            </button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-foreground/[0.04] hover:text-foreground"
                  aria-label="记录操作"
                >
                  <MoreHorizontal className="size-4" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-40">
                {onCopyTranscript && (
                  <DropdownMenuItem className="cursor-pointer gap-2 text-xs" onClick={() => void onCopyTranscript()}>
                    <Copy className="size-3.5" />
                    复制会话记录
                  </DropdownMenuItem>
                )}
                {onCopyTranscript && onExportSessionJson && <DropdownMenuSeparator />}
                {onExportSessionJson && (
                  <DropdownMenuItem className="cursor-pointer gap-2 text-xs" onClick={() => void onExportSessionJson()}>
                    <ExternalLink className="size-3.5" />
                    导出原始数据
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      )}
      {workspacePath && (
        <WorkspaceFileManagerDialog
          open={workspaceManagerOpen}
          onOpenChange={setWorkspaceManagerOpen}
          rootPath={workspacePath}
        />
      )}
      <AlertDialog open={!!deleteSessionId} onOpenChange={(open) => !open && setDeleteSessionId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除会话</AlertDialogTitle>
            <AlertDialogDescription>
              确定删除「{visibleDeleteTarget?.name ?? "该会话"}」吗？聊天记录和运行状态会从本地列表中移除。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => void handleConfirmDeleteSession()}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
