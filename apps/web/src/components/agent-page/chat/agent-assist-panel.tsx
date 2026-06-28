import {
  ChevronDown,
  ListChecks,
  Loader2,
  MessageSquareQuote,
  SkipForward,
  Square,
  SquareCheckBig,
  SquareX,
} from "lucide-react";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import {
  getPlanningProgress,
  type PlanningStateView,
  type PlanningTaskView,
  planningTaskTextClass,
  shouldShowPlanningState,
} from "./planning-display";

type TabId = "tasks" | "bypass";

interface BypassTurn {
  id: string;
  question: string;
  answer: string;
  timestamp: number;
}

interface AgentAssistPanelProps {
  planningState: PlanningStateView | null | undefined;
  bypassTurns: BypassTurn[];
}

function TaskStatusIcon({ task }: { task: PlanningTaskView }) {
  if (task.status === "completed") return <SquareCheckBig className="size-3.5 shrink-0 text-emerald-600" />;
  if (task.status === "running") return <Loader2 className="size-3.5 shrink-0 animate-spin text-primary" />;
  if (task.status === "failed") return <SquareX className="size-3.5 shrink-0 text-red-500" />;
  if (task.status === "cancelled" || task.status === "skipped")
    return <SkipForward className="size-3 shrink-0 text-muted-foreground" />;
  return <Square className="size-3.5 shrink-0 text-muted-foreground/70" />;
}

function ElapsedBadge({ startedAt }: { startedAt?: string | number }) {
  const [elapsed, setElapsed] = useState("");
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!startedAt) return;
    const start = typeof startedAt === "number" ? startedAt : Date.parse(startedAt);
    if (!Number.isFinite(start)) return;
    const update = () => {
      const seconds = Math.floor((Date.now() - start) / 1000);
      setElapsed(seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m${seconds % 60}s`);
    };
    update();
    intervalRef.current = setInterval(update, 1000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [startedAt]);

  if (!elapsed) return null;
  return <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground">{elapsed}</span>;
}

function TaskRow({ task, isActive }: { task: PlanningTaskView; isActive: boolean }) {
  return (
    <div
      className={`flex min-w-0 items-center gap-2 rounded-md px-1.5 py-1 text-[11px] leading-4 transition-colors ${isActive ? "bg-primary/5" : ""}`}
    >
      <TaskStatusIcon task={task} />
      <span className={`min-w-0 flex-1 truncate ${planningTaskTextClass(task.status)}`}>{task.title}</span>
      {task.status === "running" && <ElapsedBadge startedAt={task.startedAt} />}
    </div>
  );
}

function TasksTabContent({ planningState }: { planningState: PlanningStateView }) {
  const { tasks, activeTask, progressPercent } = getPlanningProgress(planningState);
  const isComplete = planningState.phase === "completed";

  return (
    <div>
      <div className="h-[2px] bg-muted/50">
        <div
          className={`h-full transition-[width] duration-500 ease-out ${isComplete ? "bg-emerald-500" : "bg-primary"}`}
          style={{ width: `${progressPercent}%` }}
        />
      </div>
      {tasks.length > 0 ? (
        <div className="max-h-36 overflow-y-auto px-2 py-1">
          <div className="space-y-0.5">
            {tasks.map((task) => (
              <TaskRow key={task.id} task={task} isActive={task.id === activeTask?.id} />
            ))}
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-2 px-3 py-2">
          <div className="size-3 animate-pulse rounded-full bg-muted" />
          <div className="h-2.5 w-28 animate-pulse rounded bg-muted" />
        </div>
      )}
    </div>
  );
}

function BypassTabContent({ turns }: { turns: BypassTurn[] }) {
  const displayTurns = useMemo(() => [...turns].reverse(), [turns]);

  return (
    <div className="max-h-36 overflow-y-auto px-2 py-1.5">
      {displayTurns.map((turn) => (
        <div key={turn.id} className="mb-2 last:mb-0">
          <div className="text-[11px] font-medium text-muted-foreground">{turn.question.replace(/^\/btw\s*/i, "")}</div>
          {turn.answer && <div className="mt-0.5 text-[11px] leading-relaxed text-foreground/90">{turn.answer}</div>}
        </div>
      ))}
    </div>
  );
}

export const AgentAssistPanel = memo(function AgentAssistPanel({ planningState, bypassTurns }: AgentAssistPanelProps) {
  const hasTasks = shouldShowPlanningState(planningState);
  const hasBypass = bypassTurns.length > 0;
  const hasAnyContent = hasTasks || hasBypass;

  const [expanded, setExpanded] = useState(true);
  const [activeTab, setActiveTab] = useState<TabId>("tasks");

  useEffect(() => {
    if (hasTasks && activeTab !== "tasks") setActiveTab("tasks");
    else if (!hasTasks && hasBypass) setActiveTab("bypass");
  }, [hasTasks, hasBypass, activeTab]);

  if (!hasAnyContent) return null;

  const planningProgress = hasTasks && planningState ? getPlanningProgress(planningState) : null;
  const tabs: Array<{ id: TabId; label: string; icon: React.ReactNode; badge?: string; show: boolean }> = [
    {
      id: "tasks",
      label: "任务",
      icon: <ListChecks className="size-3" />,
      badge: hasTasks
        ? `${planningProgress?.settledTaskCount ?? 0}/${planningProgress?.totalTaskCount ?? 0}`
        : undefined,
      show: hasTasks,
    },
    {
      id: "bypass",
      label: "悄悄话",
      icon: <MessageSquareQuote className="size-3" />,
      badge: hasBypass ? String(bypassTurns.length) : undefined,
      show: hasBypass,
    },
  ];

  const visibleTabs = tabs.filter((t) => t.show);
  const isLive = hasTasks && (planningState?.phase === "planning" || planningState?.phase === "running");

  return (
    <div className="shrink-0 border-t border-border bg-white">
      {/* Tab bar + collapse toggle */}
      <div className="flex items-center gap-0.5 px-2 py-1">
        {visibleTabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => {
              setActiveTab(tab.id);
              setExpanded(true);
            }}
            className={cn(
              "flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium transition-colors",
              activeTab === tab.id
                ? "bg-primary/5 text-primary"
                : "text-muted-foreground hover:bg-muted/40 hover:text-foreground/90",
            )}
          >
            {tab.icon}
            {tab.label}
            {tab.id === "tasks" && isLive && (
              <span className="relative flex size-1.5">
                <span className="absolute inline-flex size-full animate-ping rounded-full bg-primary opacity-40" />
                <span className="relative inline-flex size-1.5 rounded-full bg-primary" />
              </span>
            )}
            {tab.badge && (
              <span className="rounded-full bg-muted/50 px-1 text-[9px] tabular-nums text-muted-foreground">
                {tab.badge}
              </span>
            )}
          </button>
        ))}
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="ml-auto rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted/40 hover:text-muted-foreground"
          aria-label={expanded ? "收起面板" : "展开面板"}
        >
          <ChevronDown className={`size-3 transition-transform duration-200 ${expanded ? "rotate-180" : ""}`} />
        </button>
      </div>

      {/* Content */}
      {expanded && (
        <div className="border-t border-[#f3f4f6]">
          {activeTab === "tasks" && planningState && <TasksTabContent planningState={planningState} />}
          {activeTab === "bypass" && hasBypass && <BypassTabContent turns={bypassTurns} />}
        </div>
      )}
    </div>
  );
});
