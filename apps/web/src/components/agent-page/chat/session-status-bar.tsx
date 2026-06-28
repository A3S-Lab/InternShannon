import { Activity, Bot, CheckCircle2, CircleAlert, Cpu, Loader2, Radio, Sparkles, Wrench, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { useSnapshot } from "valtio";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { sendToSession } from "@/hooks/use-agent-ws";
import { agentApi } from "@/lib/agent-api";
import { AppError } from "@/lib/error";
import { handleMissingSession } from "@/lib/session-bootstrap";
import type { AgentRuntimeTimelineEvent } from "@/lib/types";
import { cn } from "@/lib/utils";
import agentModel from "@/models/agent.model";
import settingsModel, { getSessionRoutingModel, normalizeLegacyModelRef } from "@/models/settings.model";
import { PlanningStatusSummary } from "./planning-status-summary";
import { resolveStatusBarModelValue } from "./session-model-selection";
import { EXECUTION_MODE_SELECT_LABEL, SESSION_MODEL_SELECT_LABEL } from "./session-status-bar-accessibility";
import {
  formatSessionStatusBarActionError,
  type MainAgentStatusTone,
  resolveMainAgentStatusPresentation,
  resolveModelSwitcherFocusState,
  resolveSessionModelDisplayText,
  resolveSessionPermissionMode,
  resolveSessionStatusBarActionError,
  type SessionStatusBarActionErrorState,
} from "./session-status-bar-state";

const EXECUTION_MODE_OPTIONS = [
  {
    value: "default",
    label: "默认模式",
    description: "正常执行任务，适合日常修改和调试。",
  },
  {
    value: "plan",
    label: "规划模式",
    description: "优先分析和规划，只允许读取、浏览、搜索。",
  },
  {
    value: "auto",
    label: "自动执行",
    description: "直接执行可用工具，适合可信工作区。",
  },
] as const;

function mainAgentDotClass(tone: MainAgentStatusTone) {
  if (tone === "disconnected") return "bg-red-500 shadow-[0_0_0_4px_rgba(239,68,68,0.10)]";
  if (tone === "connecting") return "bg-amber-400 shadow-[0_0_0_4px_rgba(245,158,11,0.12)]";
  if (tone === "running") return "bg-primary shadow-[0_0_0_4px_rgba(20,86,240,0.10)]";
  return "bg-emerald-500 shadow-[0_0_0_4px_rgba(16,185,129,0.10)]";
}

function stageClass(state: "active" | "done" | "idle") {
  if (state === "active") return "border-primary bg-primary text-white shadow-[0_0_0_4px_rgba(20,86,240,0.10)]";
  if (state === "done")
    return "border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400";
  return "border-border-light bg-muted/40 text-muted-foreground";
}

function stageLineClass(state: "active" | "done" | "idle") {
  if (state === "active") return "bg-primary/10";
  if (state === "done") return "bg-emerald-200 dark:bg-emerald-900/50";
  return "bg-[#f2f3f5]";
}

function formatElapsed(seconds?: number) {
  if (typeof seconds !== "number" || !Number.isFinite(seconds)) return "";
  if (seconds < 60) return `${Math.max(0, Math.round(seconds))}s`;
  return `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`;
}

function slowStageLabel(stage?: string) {
  if (stage === "frontend_send") return "前端发送";
  if (stage === "model_first_token") return "模型首 token";
  if (stage === "tool_exec") return "工具执行";
  return "未知阶段";
}

function formatElapsedMs(ms?: number) {
  if (typeof ms !== "number" || !Number.isFinite(ms)) return "";
  if (ms < 1000) return `${Math.max(0, Math.round(ms))}ms`;
  return formatElapsed(ms / 1000);
}

function isLiveRuntimeStatus(status?: string) {
  return status === "queued" || status === "running" || status === "waiting";
}

function runtimeKindLabel(kind: AgentRuntimeTimelineEvent["kind"]) {
  if (kind === "main_agent") return "主智能体";
  if (kind === "tool") return "工具";
  if (kind === "subagent") return "子智能体";
  return "运行事件";
}

function runtimeDotClass(event: AgentRuntimeTimelineEvent) {
  if (event.status === "failed") return "bg-red-500";
  if (event.status === "completed" || event.status === "ready") return "bg-emerald-500";
  if (event.status === "waiting") return "bg-amber-400";
  return "bg-primary";
}

function runtimeRowClass(event: AgentRuntimeTimelineEvent) {
  if (event.status === "failed") return "border-red-100 bg-red-50/70 dark:bg-red-950/70";
  if (event.status === "waiting") return "border-amber-100 bg-amber-50/70 dark:bg-amber-950/70";
  if (event.status === "completed" || event.status === "ready")
    return "border-emerald-100 bg-emerald-50/70 dark:bg-emerald-950/70";
  return "border-border-light bg-white";
}

export function SessionStatusBar({
  apiUrl,
  sessionId,
  readonlyCwd,
  showModelSwitcher = true,
  modelSwitcherFocusRequest = 0,
}: {
  apiUrl?: string;
  sessionId: string;
  readonlyCwd?: boolean;
  showModelSwitcher?: boolean;
  modelSwitcherFocusRequest?: number;
}) {
  const {
    sessions,
    connectionStatus,
    sessionStatus,
    activeToolProgress,
    activeToolProgressById,
    completedTools,
    streamPerfHint,
    runtimeTimeline,
    planningStates,
  } = useSnapshot(agentModel.state);
  const settingsSnap = useSnapshot(settingsModel.state);
  const session = sessions[sessionId];
  const [switchingModel, setSwitchingModel] = useState(false);
  const [actionError, setActionError] = useState<SessionStatusBarActionErrorState | null>(null);
  const [modelSwitcherHighlighted, setModelSwitcherHighlighted] = useState(false);
  const modelSwitcherTriggerRef = useRef<HTMLButtonElement>(null);
  const previousModelSwitcherFocusRequestRef = useRef(modelSwitcherFocusRequest);
  const actionErrorPresentation = useMemo(() => resolveSessionStatusBarActionError(actionError), [actionError]);
  const connection = connectionStatus[sessionId];
  const runtimeStatus = sessionStatus[sessionId];
  const activeTools = Object.values(activeToolProgressById[sessionId] ?? {});
  const latestTool = activeTools[activeTools.length - 1] ?? activeToolProgress[sessionId] ?? null;
  const recentCompletedTools = (completedTools[sessionId] ?? []).slice(-3).reverse();
  const perfHint = streamPerfHint[sessionId];
  const runtimeEvents = runtimeTimeline[sessionId] ?? [];
  const planningState = planningStates[sessionId] ?? null;
  const latestMainRuntimeEvent = [...runtimeEvents].reverse().find((event) => event.kind === "main_agent");
  const latestToolRuntimeEvent = [...runtimeEvents].reverse().find((event) => event.kind === "tool");
  const latestToolRuntimeEventsByKey = new Map<string, AgentRuntimeTimelineEvent>();
  for (const event of runtimeEvents) {
    if (event.kind !== "tool") continue;
    latestToolRuntimeEventsByKey.set(event.toolUseId || event.toolName || event.id, event);
  }
  const activeRuntimeToolEvents = Array.from(latestToolRuntimeEventsByKey.values())
    .filter((event) => isLiveRuntimeStatus(event.status))
    .slice(-3);
  const recentRuntimeEvents = runtimeEvents.slice(-8).reverse();
  const mainStatus = resolveMainAgentStatusPresentation({
    connection,
    status: runtimeStatus,
    activeToolCount: activeTools.length,
  });
  const runtimeButtonLabel =
    latestMainRuntimeEvent && isLiveRuntimeStatus(latestMainRuntimeEvent.status)
      ? latestMainRuntimeEvent.label
      : mainStatus.label;
  const mainRuntimeDotClass = latestMainRuntimeEvent
    ? runtimeDotClass(latestMainRuntimeEvent)
    : mainAgentDotClass(mainStatus.tone);
  const runtimeDisplayButtonLabel = runtimeButtonLabel;
  const mainStages: Array<{ label: string; state: "active" | "done" | "idle" }> = [
    {
      label: "连接",
      state: connection === "connected" ? "done" : connection === "connecting" ? "active" : "idle",
    },
    {
      label: "任务",
      state:
        runtimeStatus === "running" ||
        runtimeStatus === "compacting" ||
        isLiveRuntimeStatus(latestMainRuntimeEvent?.status)
          ? "active"
          : connection === "connected"
            ? "done"
            : "idle",
    },
    {
      label: "工具",
      state:
        activeTools.length > 0 || activeRuntimeToolEvents.length > 0
          ? "active"
          : recentCompletedTools.length > 0 || latestToolRuntimeEvent?.status === "completed"
            ? "done"
            : "idle",
    },
    {
      label: "输出",
      state:
        latestMainRuntimeEvent?.phase === "model_output" || latestMainRuntimeEvent?.phase === "finalize"
          ? "active"
          : runtimeStatus === "running" && activeTools.length === 0
            ? "active"
            : runtimeStatus === "idle"
              ? "done"
              : "idle",
    },
  ];
  const availableModels = useMemo(() => {
    return settingsSnap.providers.flatMap((provider) =>
      provider.models.map((model) => ({
        value: provider.name ? `${provider.name}/${model.id}` : model.id,
        label: model.name || model.id,
        providerName: provider.name,
        modelId: model.id,
      })),
    );
  }, [settingsSnap.providers]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: getSessionRoutingModel reads settingsModel runtime defaults.
  const currentModelValue = useMemo(() => {
    const rawModel = normalizeLegacyModelRef(session?.model);
    return resolveStatusBarModelValue({
      availableModels,
      sessionModel: rawModel,
      followDefaultModel: session?.followDefaultModel,
      routedModel: getSessionRoutingModel(rawModel, session?.followDefaultModel),
    });
  }, [
    availableModels,
    session?.followDefaultModel,
    session?.model,
    settingsSnap.defaultModel,
    settingsSnap.defaultProvider,
  ]);

  const modelOptions = useMemo(() => {
    if (!currentModelValue || availableModels.some((item) => item.value === currentModelValue)) {
      return availableModels;
    }
    return [
      {
        value: currentModelValue,
        label: currentModelValue,
        providerName: "",
        modelId: currentModelValue,
      },
      ...availableModels,
    ];
  }, [availableModels, currentModelValue]);
  const hasFocusableModelSwitcher = Boolean(session && availableModels.length > 0 && !switchingModel);

  useEffect(() => {
    const focusState = resolveModelSwitcherFocusState({
      request: modelSwitcherFocusRequest,
      previousRequest: previousModelSwitcherFocusRequestRef.current,
      showModelSwitcher,
      hasFocusableModelSwitcher,
    });
    previousModelSwitcherFocusRequestRef.current = modelSwitcherFocusRequest;
    if (!focusState.shouldHighlight) return;

    setModelSwitcherHighlighted(true);
    const highlightTimer = window.setTimeout(() => {
      setModelSwitcherHighlighted(false);
    }, 2200);

    if (focusState.shouldFocus) {
      window.requestAnimationFrame(() => {
        modelSwitcherTriggerRef.current?.focus();
      });
    }

    return () => window.clearTimeout(highlightTimer);
  }, [hasFocusableModelSwitcher, modelSwitcherFocusRequest, showModelSwitcher]);

  const sessionPermissionMode = resolveSessionPermissionMode(session?.permissionMode);
  const sessionModelDisplayText = resolveSessionModelDisplayText(session?.model);
  const currentExecutionMode =
    EXECUTION_MODE_OPTIONS.find((option) => option.value === sessionPermissionMode) ?? EXECUTION_MODE_OPTIONS[0];

  const showActionError = (kind: SessionStatusBarActionErrorState["kind"], message: string) => {
    setActionError({ kind, message });
    toast.error(message);
  };

  const handleModelChange = async (value: string) => {
    if (!session) return;
    const target = availableModels.find((item) => item.value === value);
    if (!target) return;
    setActionError(null);
    setSwitchingModel(true);
    try {
      const result = await agentApi.configureSession(
        sessionId,
        {
          model: target.value || undefined,
        },
        apiUrl,
      );
      if (result?.model) {
        agentModel.updateSession(sessionId, {
          model: result.model,
          followDefaultModel: false,
        });
      }
    } catch (error) {
      if (error instanceof AppError && error.code === 404) {
        void handleMissingSession({ sessionId, apiUrl });
        return;
      }
      const message = formatSessionStatusBarActionError(error, "模型没有切换成功，请检查本地服务连接后重试。");
      showActionError("model", message);
    } finally {
      setSwitchingModel(false);
    }
  };

  const handleExecutionModeChange = (mode: string) => {
    if (!session) return;
    const planningPatch =
      mode === "plan"
        ? { planningMode: "enabled" as const, goalTracking: true }
        : mode === "default" || mode === "auto"
          ? { planningMode: "disabled" as const, goalTracking: false }
          : {};
    const previousMode = resolveSessionPermissionMode(session.permissionMode);
    const sessionPatch = { permissionMode: mode, ...planningPatch };
    setActionError(null);
    const sent = sendToSession(sessionId, { type: "set_permissionMode", mode, ...planningPatch });
    if (!sent) {
      agentModel.updateSession(sessionId, { permissionMode: previousMode });
      showActionError("execution-mode", "执行模式没有送达本地运行时，请恢复连接后重试。");
      return;
    }
    agentModel.updateSession(sessionId, { permissionMode: mode });
    void agentApi.updateSession(sessionId, sessionPatch, apiUrl).catch((error) => {
      if (error instanceof AppError && error.code === 404) {
        void handleMissingSession({ sessionId, apiUrl });
        return;
      }
      const message = formatSessionStatusBarActionError(error, "执行模式已发送，但保存失败，刷新后可能不会保留。");
      showActionError("execution-mode", message);
    });
  };

  return (
    <div className="flex w-full max-w-full select-none flex-col gap-1 overflow-hidden border-t border-border-light bg-white px-2 py-1 text-[10px] leading-none text-foreground/80 shadow-[rgba(0,0,0,0.04)_0px_2px_4px] sm:flex-row sm:items-center sm:gap-1.5">
      <div className="flex min-w-0 max-w-full items-center gap-1.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:flex-1">
        {!readonlyCwd && (
          <div className="flex h-6 shrink-0 items-center gap-1 rounded-full border border-border-light bg-muted/40 px-2">
            <Sparkles className="size-2.5 text-primary" />
            <Select value={sessionPermissionMode} onValueChange={handleExecutionModeChange}>
              <SelectTrigger
                aria-label={EXECUTION_MODE_SELECT_LABEL}
                className="h-auto border-0 bg-transparent p-0 text-[10px] text-foreground/80 shadow-none focus:ring-0 gap-0.5 [&>svg]:size-2.5 [&>svg]:opacity-50"
              >
                <span>{currentExecutionMode.label}</span>
              </SelectTrigger>
              <SelectContent className="w-72 rounded-[16px] border-border-light bg-white shadow-[rgba(0,0,0,0.08)_0px_12px_16px_-4px]">
                {EXECUTION_MODE_OPTIONS.map((option) => (
                  <SelectItem
                    key={option.value}
                    value={option.value}
                    textValue={option.label}
                    className="items-start py-2.5"
                  >
                    <div className="flex flex-col gap-1">
                      <span className="text-xs font-medium text-foreground">{option.label}</span>
                      <span className="whitespace-normal text-[11px] leading-5 text-foreground/80">
                        {option.description}
                      </span>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {showModelSwitcher && (
          <div
            className={cn(
              "flex h-6 min-w-0 shrink items-center gap-1 rounded-full border border-border-light bg-muted/40 px-2 transition-[background-color,border-color,box-shadow]",
              modelSwitcherHighlighted && "border-primary/60 bg-primary/5 shadow-[0_0_0_3px_rgba(20,86,240,0.10)]",
            )}
          >
            <Cpu className="size-2.5 shrink-0 text-primary" />
            {modelOptions.length > 0 ? (
              <Select
                value={currentModelValue}
                onValueChange={(value) => {
                  void handleModelChange(value);
                }}
                disabled={switchingModel || !session || availableModels.length === 0}
              >
                <SelectTrigger
                  ref={modelSwitcherTriggerRef}
                  aria-label={SESSION_MODEL_SELECT_LABEL}
                  className="h-auto max-w-[136px] border-0 bg-transparent p-0 text-[10px] text-foreground/80 shadow-none focus:ring-0 gap-0.5 sm:max-w-[160px] [&>svg]:size-2.5 [&>svg]:opacity-50"
                >
                  <SelectValue placeholder="选择模型" />
                </SelectTrigger>
                <SelectContent>
                  {modelOptions.map((item) => (
                    <SelectItem key={item.value} value={item.value}>
                      {item.providerName ? `${item.providerName} / ${item.label}` : item.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <span className="max-w-[136px] truncate text-[10px] text-muted-foreground sm:max-w-[160px]">
                未配置模型
              </span>
            )}
            {switchingModel && <Loader2 className="size-2.5 shrink-0 animate-spin" />}
          </div>
        )}
      </div>

      {actionErrorPresentation ? (
        <div
          role="alert"
          className="flex h-6 min-w-0 max-w-full shrink items-center gap-1 rounded-full border border-red-500/15 bg-red-500/[0.04] px-2 text-red-700 sm:max-w-[280px]"
        >
          <CircleAlert className="size-3 shrink-0 text-red-600" />
          <span className="shrink-0 text-[10px] font-medium leading-5">{actionErrorPresentation.title}</span>
          <span className="min-w-0 truncate text-[10px] leading-5">{actionErrorPresentation.message}</span>
          <button
            type="button"
            onClick={() => setActionError(null)}
            aria-label={actionErrorPresentation.dismissLabel}
            className="ml-0.5 flex size-4 shrink-0 items-center justify-center rounded-full text-red-600 transition-colors hover:bg-red-500/10 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-red-500/40"
          >
            <X className="size-2.5" />
          </button>
        </div>
      ) : null}

      <div className="flex w-full min-w-0 items-center justify-between gap-1.5 sm:ml-auto sm:w-auto sm:shrink-0 sm:justify-end">
        <Popover>
          <PopoverTrigger asChild>
            <button
              type="button"
              className="flex h-6 max-w-full items-center gap-1.5 rounded-full border border-primary/30 bg-primary/5 px-2 text-left shadow-[rgba(0,0,0,0.04)_0px_2px_4px] transition-colors hover:border-primary hover:bg-white focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/40"
              aria-label="查看智能体后端运行态"
            >
              <Activity className="size-3 shrink-0 text-primary" />
              <span className={`size-1.5 shrink-0 rounded-full ${mainRuntimeDotClass}`} />
              <span className="max-w-[86px] truncate text-[10px] leading-5 text-foreground/80">
                {runtimeDisplayButtonLabel}
              </span>
            </button>
          </PopoverTrigger>
          <PopoverContent
            side="top"
            align="end"
            sideOffset={8}
            className="w-[380px] max-w-[calc(100vw-24px)] rounded-[20px] border-border-light bg-white p-0 shadow-[rgba(0,0,0,0.10)_0px_18px_40px]"
          >
            <div className="border-b border-border-light px-4 py-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-foreground">后端执行可视化</p>
                  <p className="mt-1 text-[11px] leading-4 text-muted-foreground">
                    基于实时 WebSocket 事件展示主智能体与工具执行状态
                  </p>
                </div>
                <Radio className="size-4 text-primary" />
              </div>
            </div>
            <div className="max-h-[440px] space-y-3 overflow-y-auto p-3">
              <div className="rounded-[16px] border border-border-light bg-muted/20 p-3">
                <div className="mb-3 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Bot className="size-4 text-primary" />
                    <span className="text-xs font-semibold text-foreground">主智能体</span>
                  </div>
                  <span className="rounded-full bg-white px-2 py-1 text-[10px] text-foreground/80">
                    {runtimeDisplayButtonLabel}
                  </span>
                </div>
                <div className="flex items-center">
                  {mainStages.map((stage, index) => (
                    <div key={stage.label} className="flex flex-1 items-center">
                      <div className="flex min-w-0 flex-col items-center gap-1">
                        <span
                          className={`flex size-6 items-center justify-center rounded-full border text-[10px] ${stageClass(stage.state)}`}
                        >
                          {stage.state === "done" ? <CheckCircle2 className="size-3" /> : index + 1}
                        </span>
                        <span className="text-[10px] leading-none text-foreground/80">{stage.label}</span>
                      </div>
                      {index < mainStages.length - 1 ? (
                        <span className={`mx-1 h-px flex-1 ${stageLineClass(stage.state)}`} />
                      ) : null}
                    </div>
                  ))}
                </div>
                <div className="mt-3 space-y-2 rounded-[12px] bg-white p-2">
                  <div className="flex items-center justify-between gap-2 text-[11px]">
                    <span className="text-muted-foreground">连接</span>
                    <span className="font-medium text-foreground">
                      {connection === "connected" ? "已连接" : connection || "未连接"}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-2 text-[11px]">
                    <span className="text-muted-foreground">模型</span>
                    <span className="max-w-[220px] truncate font-medium text-foreground">
                      {sessionModelDisplayText}
                    </span>
                  </div>
                  <PlanningStatusSummary planningState={planningState} />
                  {latestMainRuntimeEvent ? (
                    <div className="rounded-[10px] border border-primary/30 bg-primary/5 px-2 py-1.5">
                      <div className="flex items-center gap-1.5 text-[11px] font-medium text-foreground">
                        <span className={`size-1.5 rounded-full ${runtimeDotClass(latestMainRuntimeEvent)}`} />
                        <span className="truncate">{latestMainRuntimeEvent.label}</span>
                        {formatElapsedMs(latestMainRuntimeEvent.elapsedMs) ? (
                          <span className="ml-auto shrink-0 text-[10px] text-muted-foreground">
                            {formatElapsedMs(latestMainRuntimeEvent.elapsedMs)}
                          </span>
                        ) : null}
                      </div>
                      {latestMainRuntimeEvent.detail ? (
                        <p className="mt-1 text-[10px] leading-4 text-foreground/80">{latestMainRuntimeEvent.detail}</p>
                      ) : null}
                    </div>
                  ) : null}
                  {latestTool ? (
                    <div className="rounded-[10px] border border-border-light bg-muted/40 px-2 py-1.5">
                      <div className="flex items-center gap-1.5 text-[11px] font-medium text-foreground">
                        <Wrench className="size-3 text-primary" />
                        <span className="truncate">{latestTool.toolName}</span>
                        {formatElapsed(latestTool.elapsedTimeSeconds) ? (
                          <span className="ml-auto shrink-0 text-[10px] text-muted-foreground">
                            {formatElapsed(latestTool.elapsedTimeSeconds)}
                          </span>
                        ) : null}
                      </div>
                      {latestTool.input ? (
                        <p className="mt-1 truncate text-[10px] text-foreground/80">{latestTool.input}</p>
                      ) : null}
                    </div>
                  ) : null}
                  {activeRuntimeToolEvents.length > 0 ? (
                    <div className="space-y-1 rounded-[10px] border border-border-light bg-muted/20 px-2 py-1.5">
                      <p className="text-[10px] font-medium text-muted-foreground">后端活跃工具</p>
                      {activeRuntimeToolEvents.map((event) => (
                        <div key={event.id} className="flex items-center gap-1.5 text-[10px] text-foreground/80">
                          <span className={`size-1.5 shrink-0 rounded-full ${runtimeDotClass(event)}`} />
                          <span className="truncate">{event.toolName || event.label}</span>
                          {formatElapsedMs(event.elapsedMs) ? (
                            <span className="ml-auto shrink-0 text-muted-foreground">
                              {formatElapsedMs(event.elapsedMs)}
                            </span>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  ) : null}
                  {recentCompletedTools.length > 0 ? (
                    <div className="space-y-1">
                      <p className="text-[10px] font-medium text-muted-foreground">最近完成工具</p>
                      {recentCompletedTools.map((tool) => (
                        <div key={tool.toolUseId} className="flex items-center gap-1.5 text-[10px] text-foreground/80">
                          <CheckCircle2 className={`size-3 ${tool.is_error ? "text-red-500" : "text-emerald-500"}`} />
                          <span className="truncate">{tool.toolName}</span>
                          {tool.durationMs ? (
                            <span className="ml-auto shrink-0 text-muted-foreground">
                              {Math.round(tool.durationMs)}ms
                            </span>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  ) : null}
                  {perfHint ? (
                    <div className="rounded-[10px] bg-primary/5 px-2 py-1.5 text-[10px] leading-4 text-foreground/80">
                      当前慢点判断：{slowStageLabel(perfHint.slow_stage)}
                    </div>
                  ) : null}
                  {recentRuntimeEvents.length > 0 ? (
                    <div className="space-y-1 rounded-[12px] bg-muted/40 p-2">
                      <div className="flex items-center justify-between text-[10px] font-medium text-muted-foreground">
                        <span>后端任务链路</span>
                        <span>最近 {recentRuntimeEvents.length} 条</span>
                      </div>
                      {recentRuntimeEvents.map((event) => (
                        <div key={event.id} className={`rounded-[10px] border px-2 py-1.5 ${runtimeRowClass(event)}`}>
                          <div className="flex items-center gap-1.5 text-[10px] font-medium text-foreground">
                            <span className={`size-1.5 shrink-0 rounded-full ${runtimeDotClass(event)}`} />
                            <span className="shrink-0 text-muted-foreground">{runtimeKindLabel(event.kind)}</span>
                            <span className="truncate">{event.label}</span>
                            {formatElapsedMs(event.elapsedMs) ? (
                              <span className="ml-auto shrink-0 text-muted-foreground">
                                {formatElapsedMs(event.elapsedMs)}
                              </span>
                            ) : null}
                          </div>
                          {event.detail ? (
                            <p className="mt-1 line-clamp-2 text-[10px] leading-4 text-foreground/80">{event.detail}</p>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="rounded-[10px] border border-dashed border-border-light bg-muted/20 px-2 py-1.5 text-[10px] leading-4 text-muted-foreground">
                      新一轮任务开始后，这里会显示后端结构化遥测事件。
                    </div>
                  )}
                </div>
              </div>
            </div>
          </PopoverContent>
        </Popover>
      </div>
    </div>
  );
}
