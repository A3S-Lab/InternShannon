import { useReactive } from "ahooks";
import { CircleAlert, Loader2, MessageCirclePlus, PanelLeft, Plus, RefreshCw, Settings } from "lucide-react";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { useSnapshot } from "valtio";
import AgentChat from "@/components/agent-page/agent-chat";
import {
  buildAgentSessionCreateOptions,
  formatAgentSessionCreateError,
} from "@/components/agent-page/agent-session-create-state";
import { AgentSessionSidebar } from "@/components/agent-page/agent-session-sidebar";
import {
  useAgentSessionBootstrap,
  useEffectiveAgentWorkspace,
} from "@/components/agent-page/use-agent-session-bootstrap";
import { ErrorBoundary } from "@/components/custom/error-boundary";
import { Button } from "@/components/ui/button";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { DEFAULT_AGENT_ID, getAgentById } from "@/lib/builtins";
import { createAgentSession, refreshSessionsInBackground } from "@/lib/session-bootstrap";
import { defaultSessionTitle } from "@/lib/session-title";
import { initializeAgentDefaults } from "@/lib/workspace-utils";
import agentModel from "@/models/agent.model";
import agentRegistryModel from "@/models/agent-registry.model";
import {
  type AgentPageBackgroundSyncNotice,
  resolveAgentPageBackgroundSyncNotice,
  resolveAgentPageBootstrapSurface,
  resolveAgentPageSession,
} from "./agent-page-session-state";

const COMPACT_AGENT_BREAKPOINT = 768;

function useCompactAgentViewport() {
  const [compact, setCompact] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.innerWidth < COMPACT_AGENT_BREAKPOINT;
  });

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (typeof window.matchMedia !== "function") {
      const onResize = () => setCompact(window.innerWidth < COMPACT_AGENT_BREAKPOINT);
      window.addEventListener("resize", onResize);
      onResize();
      return () => window.removeEventListener("resize", onResize);
    }

    const media = window.matchMedia(`(max-width: ${COMPACT_AGENT_BREAKPOINT - 1}px)`);
    const onChange = () => setCompact(media.matches);
    if (typeof media.addEventListener === "function") {
      media.addEventListener("change", onChange);
    } else {
      media.addListener(onChange);
    }
    onChange();
    return () => {
      if (typeof media.removeEventListener === "function") {
        media.removeEventListener("change", onChange);
      } else {
        media.removeListener(onChange);
      }
    };
  }, []);

  return compact;
}

function LoadingFallback() {
  return (
    <div className="flex h-full items-center justify-center bg-[#f7f9fc]">
      <div className="flex items-center gap-2 rounded-full border border-border-light bg-white px-3 py-2 text-xs text-muted-foreground shadow-sm">
        <Loader2 className="size-4 animate-spin text-primary" />
        正在恢复InternShannon会话
      </div>
    </div>
  );
}

function EmptyAgentWorkspace(props: {
  creating: boolean;
  createError: string | null;
  onCreateSession: () => void;
  onOpenSettings: () => void;
}) {
  return (
    <div className="flex h-full min-h-0 items-center justify-center bg-[#f7f9fc] px-6 py-8">
      <div className="flex w-full max-w-[520px] flex-col items-center text-center">
        <div className="flex size-12 items-center justify-center rounded-[14px] border border-primary/10 bg-primary/[0.08] text-primary">
          <MessageCirclePlus className="size-6" />
        </div>
        <h1 className="mt-4 text-lg font-semibold text-foreground">开始一段InternShannon会话</h1>
        <p className="mt-2 max-w-[420px] text-sm leading-6 text-muted-foreground">
          新会话会连接本地 sidecar，并使用当前工作区与默认智能体配置。
        </p>
        {props.createError ? (
          <p className="mt-3 max-w-[440px] rounded-[8px] border border-red-500/10 bg-red-500/[0.04] px-3 py-2 text-xs leading-5 text-red-700">
            {props.createError}
          </p>
        ) : null}
        <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
          <Button type="button" onClick={props.onCreateSession} disabled={props.creating}>
            {props.creating ? <Loader2 className="size-4 animate-spin" /> : <MessageCirclePlus className="size-4" />}
            新建会话
          </Button>
          <Button type="button" variant="outline" onClick={props.onOpenSettings}>
            <Settings className="size-4" />
            检查配置
          </Button>
        </div>
      </div>
    </div>
  );
}

function BootstrapErrorWorkspace(props: {
  error: string;
  retrying: boolean;
  onRetry: () => void;
  onOpenSettings: () => void;
}) {
  return (
    <div className="flex h-full min-h-0 items-center justify-center bg-[#f7f9fc] px-6 py-8">
      <div className="flex w-full max-w-[560px] flex-col items-center text-center">
        <div className="flex size-12 items-center justify-center rounded-[14px] border border-red-500/10 bg-red-500/[0.08] text-red-600">
          <CircleAlert className="size-6" />
        </div>
        <h1 className="mt-4 text-lg font-semibold text-foreground">会话恢复失败</h1>
        <p className="mt-2 max-w-[440px] text-sm leading-6 text-muted-foreground">
          未能从本地 sidecar 加载InternShannon会话。可以重试恢复，或检查当前工作区与智能体配置。
        </p>
        <p className="mt-3 max-w-[440px] rounded-[8px] border border-red-500/10 bg-red-500/[0.04] px-3 py-2 text-xs leading-5 text-red-700">
          {props.error}
        </p>
        <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
          <Button type="button" onClick={props.onRetry} disabled={props.retrying}>
            {props.retrying ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
            重试恢复
          </Button>
          <Button type="button" variant="outline" onClick={props.onOpenSettings}>
            <Settings className="size-4" />
            检查配置
          </Button>
        </div>
      </div>
    </div>
  );
}

function BackgroundSyncNotice(props: {
  notice: AgentPageBackgroundSyncNotice | null;
  refreshing: boolean;
  onRetry: () => void;
}) {
  if (!props.notice) return null;

  return (
    <div
      aria-live={props.notice.ariaLive}
      className="flex shrink-0 items-start gap-2 border-b border-amber-500/20 bg-amber-50 px-3 py-2 text-amber-950"
    >
      <CircleAlert className="mt-0.5 size-4 shrink-0 text-amber-600" />
      <div className="min-w-0 flex-1">
        <p className="text-xs font-semibold">{props.notice.title}</p>
        <p className="mt-0.5 break-words text-xs leading-5 text-amber-800">{props.notice.description}</p>
      </div>
      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={props.onRetry}
        disabled={props.refreshing}
        className="shrink-0 border-amber-500/25 bg-white/80 text-amber-950 hover:bg-white"
      >
        {props.refreshing ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
        {props.notice.actionLabel}
      </Button>
    </div>
  );
}

function MobileAgentToolbar(props: {
  sessionTitle: string;
  creating: boolean;
  onOpenSessions: () => void;
  onCreateSession: () => void;
}) {
  return (
    <div className="flex h-11 shrink-0 items-center gap-2 border-b border-border-light bg-white px-2">
      <button
        type="button"
        onClick={props.onOpenSessions}
        className="flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        title="会话列表"
        aria-label="会话列表"
      >
        <PanelLeft className="size-4" />
      </button>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-foreground">{props.sessionTitle}</p>
      </div>
      <button
        type="button"
        onClick={props.onCreateSession}
        disabled={props.creating}
        className="flex size-8 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
        title="新会话"
        aria-label="新会话"
      >
        {props.creating ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
      </button>
    </div>
  );
}

export default function AgentPage() {
  const { currentSessionId, sdkSessions, sessionNames } = useSnapshot(agentModel.state);
  const {
    ready,
    error: bootstrapError,
    refreshing: bootstrapRefreshing,
    retry: retryBootstrap,
  } = useAgentSessionBootstrap();
  const navigate = useNavigate();
  const compact = useCompactAgentViewport();
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const ui = useReactive({
    creating: false,
    createError: null as string | null,
  });

  const primaryAgentSessions = useMemo(
    () =>
      sdkSessions.filter(
        (session) =>
          agentRegistryModel.resolveSessionAgentId(session.sessionId, session.agentId ?? null) === DEFAULT_AGENT_ID,
      ),
    [sdkSessions],
  );

  const sessionResolution = useMemo(
    () =>
      resolveAgentPageSession({
        bootstrapReady: ready,
        currentSessionId,
        sessions: primaryAgentSessions,
      }),
    [currentSessionId, primaryAgentSessions, ready],
  );
  const bootstrapSurface = useMemo(
    () =>
      resolveAgentPageBootstrapSurface({
        bootstrapReady: ready,
        bootstrapError,
        sessionCount: primaryAgentSessions.length,
      }),
    [bootstrapError, primaryAgentSessions.length, ready],
  );
  const backgroundSyncNotice = useMemo(
    () =>
      resolveAgentPageBackgroundSyncNotice({
        bootstrapReady: ready,
        bootstrapError,
        sessionCount: primaryAgentSessions.length,
        refreshing: bootstrapRefreshing,
      }),
    [bootstrapError, bootstrapRefreshing, primaryAgentSessions.length, ready],
  );
  const { activeSessionId, activeSession, isRestoringSessions, suggestedCurrentSessionId } = sessionResolution;
  const activeSessionTitle = activeSession
    ? sessionNames[activeSession.sessionId] || activeSession.name || defaultSessionTitle(activeSession.sessionId)
    : isRestoringSessions
      ? "正在恢复"
      : "InternShannon";

  useEffect(() => {
    if (!ready) return;
    if (suggestedCurrentSessionId === currentSessionId) return;
    agentModel.setCurrentSession(suggestedCurrentSessionId);
  }, [currentSessionId, ready, suggestedCurrentSessionId]);

  const effectiveCwd = useEffectiveAgentWorkspace(activeSessionId, sdkSessions, {
    superAdminFallback: true,
  });

  const handleOpenSettings = useCallback(() => navigate("/agent/default/config"), [navigate]);

  const handleCreateSession = useCallback(async () => {
    if (ui.creating) return;
    ui.creating = true;
    ui.createError = null;
    try {
      const agent =
        agentRegistryModel.getAllAgents().find((item) => item.id === DEFAULT_AGENT_ID) ??
        getAgentById(DEFAULT_AGENT_ID);
      const result = await createAgentSession(
        buildAgentSessionCreateOptions({
          agentId: DEFAULT_AGENT_ID,
          agent,
          optimisticPlaceholder: true,
        }),
      );
      await initializeAgentDefaults(result.sessionId, DEFAULT_AGENT_ID);
      agentModel.setCurrentSession(result.sessionId);
      agentModel.clearUnread(result.sessionId);
      await refreshSessionsInBackground(undefined, {
        preserveExistingOnEmpty: true,
      });
      toast.success("会话创建成功");
    } catch (error) {
      const message = formatAgentSessionCreateError(error);
      ui.createError = message;
      toast.error(message);
    } finally {
      ui.creating = false;
    }
  }, [ui]);

  const renderWorkspace = (options?: { showHeader?: boolean }) =>
    bootstrapSurface === "error" ? (
      <BootstrapErrorWorkspace
        error={bootstrapError ?? "加载会话失败，请检查本地服务连接"}
        retrying={bootstrapRefreshing}
        onRetry={retryBootstrap}
        onOpenSettings={handleOpenSettings}
      />
    ) : isRestoringSessions ? (
      <LoadingFallback />
    ) : activeSessionId ? (
      <div className="flex h-full min-h-0 flex-col bg-[#f7f9fc]">
        <BackgroundSyncNotice notice={backgroundSyncNotice} refreshing={bootstrapRefreshing} onRetry={retryBootstrap} />
        <div className="min-h-0 flex-1 overflow-hidden">
          <Suspense fallback={<LoadingFallback />}>
            <AgentChat
              key={activeSessionId}
              sessionId={activeSessionId}
              cwd={effectiveCwd}
              showSessionManagement={false}
              showHeader={options?.showHeader}
            />
          </Suspense>
        </div>
      </div>
    ) : (
      <EmptyAgentWorkspace
        creating={ui.creating}
        createError={ui.createError}
        onCreateSession={handleCreateSession}
        onOpenSettings={handleOpenSettings}
      />
    );

  if (isRestoringSessions) {
    return (
      <ErrorBoundary>
        <LoadingFallback />
      </ErrorBoundary>
    );
  }

  if (compact) {
    return (
      <ErrorBoundary>
        <div className="flex h-full min-h-0 w-full min-w-0 flex-col overflow-hidden bg-white">
          <Sheet open={mobileSidebarOpen} onOpenChange={setMobileSidebarOpen}>
            <SheetContent side="left" className="w-[min(320px,calc(100vw-44px))] max-w-none p-0 [&>button]:right-12">
              <SheetTitle className="sr-only">InternShannon会话列表</SheetTitle>
              <SheetDescription className="sr-only">查看、切换和管理InternShannon会话。</SheetDescription>
              <Suspense fallback={<LoadingFallback />}>
                <AgentSessionSidebar
                  currentSessionId={activeSessionId}
                  onSessionChange={(sessionId) => {
                    agentModel.setCurrentSession(sessionId);
                    setMobileSidebarOpen(false);
                  }}
                  optimisticPlaceholder
                />
              </Suspense>
            </SheetContent>
          </Sheet>
          <MobileAgentToolbar
            sessionTitle={activeSessionTitle}
            creating={ui.creating}
            onOpenSessions={() => setMobileSidebarOpen(true)}
            onCreateSession={handleCreateSession}
          />
          <div className="min-h-0 min-w-0 flex-1 overflow-hidden">{renderWorkspace({ showHeader: false })}</div>
        </div>
      </ErrorBoundary>
    );
  }

  return (
    <ErrorBoundary>
      <ResizablePanelGroup direction="horizontal" className="h-full w-full">
        <ResizablePanel defaultSize={22} minSize={16} maxSize={30}>
          <Suspense fallback={<LoadingFallback />}>
            <AgentSessionSidebar
              currentSessionId={activeSessionId}
              onSessionChange={(sessionId) => agentModel.setCurrentSession(sessionId)}
              optimisticPlaceholder
            />
          </Suspense>
        </ResizablePanel>
        <ResizableHandle aria-label="调整会话列表宽度" withHandle />
        <ResizablePanel defaultSize={78} minSize={62}>
          {renderWorkspace()}
        </ResizablePanel>
      </ResizablePanelGroup>
    </ErrorBoundary>
  );
}
