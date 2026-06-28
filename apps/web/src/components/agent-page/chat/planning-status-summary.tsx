import { ListChecks, Loader2, SkipForward, Square, SquareCheckBig, SquareX } from "lucide-react";
import { memo } from "react";
import {
  getPlanningProgress,
  type PlanningStateView,
  type PlanningTaskView,
  planningPhaseLabel,
  planningTaskTextClass,
  shouldShowPlanningState,
} from "./planning-display";

function TaskDot({ task }: { task: PlanningTaskView }) {
  if (task.status === "completed") return <SquareCheckBig className="size-3 shrink-0 text-emerald-600" />;
  if (task.status === "running") return <Loader2 className="size-3 shrink-0 animate-spin text-primary" />;
  if (task.status === "failed") return <SquareX className="size-3 shrink-0 text-red-500" />;
  if (task.status === "cancelled" || task.status === "skipped")
    return <SkipForward className="size-2.5 shrink-0 text-muted-foreground" />;
  return <Square className="size-3 shrink-0 text-muted-foreground/70" />;
}

export const PlanningStatusSummary = memo(function PlanningStatusSummary({
  planningState,
}: {
  planningState: PlanningStateView | null | undefined;
}) {
  if (!shouldShowPlanningState(planningState)) {
    return null;
  }

  const { tasks, activeTask, settledTaskCount, totalTaskCount } = getPlanningProgress(planningState);
  const isLive = planningState.phase === "planning" || planningState.phase === "running";
  const isIncomplete = planningState.reason === "run_incomplete_finalize";
  const headline = isIncomplete ? "本轮未完成" : activeTask?.title || planningPhaseLabel(planningState.phase);

  return (
    <div
      className={`rounded-xl border px-2.5 py-2 ${
        isIncomplete
          ? "border-amber-200 bg-amber-50/70"
          : isLive
            ? "border-primary/15 bg-[#fafbff]"
            : "border-border bg-muted/20"
      }`}
    >
      <div className="flex items-center gap-1.5 text-[11px] font-medium text-foreground">
        <ListChecks
          className={`size-3.5 ${isIncomplete ? "text-amber-600" : isLive ? "text-primary" : "text-emerald-500"}`}
        />
        <span className="shrink-0">任务计划</span>
        {isLive && (
          <span className="relative flex size-1.5">
            <span className="absolute inline-flex size-full animate-ping rounded-full bg-primary opacity-40" />
            <span className="relative inline-flex size-1.5 rounded-full bg-primary" />
          </span>
        )}
        <span className="truncate text-muted-foreground">{headline}</span>
        {tasks.length > 0 && (
          <span className="ml-auto shrink-0 rounded-full bg-muted/50 px-1.5 py-0.5 text-[10px] tabular-nums text-muted-foreground">
            {settledTaskCount}/{totalTaskCount}
          </span>
        )}
      </div>
      {tasks.length > 0 ? (
        <div className="mt-1.5 max-h-32 space-y-0.5 overflow-y-auto pr-1">
          {tasks.map((task) => (
            <div
              key={task.id}
              className={`flex items-center gap-1.5 rounded px-1 py-0.5 text-[10px] ${
                task.status === "running" ? "bg-primary/5" : ""
              }`}
            >
              <TaskDot task={task} />
              <span className={`truncate ${planningTaskTextClass(task.status)}`}>{task.title}</span>
            </div>
          ))}
        </div>
      ) : (
        <div className="mt-1.5 flex items-center gap-1.5 px-1">
          <div className="size-3 animate-pulse rounded-full bg-muted" />
          <div className="h-2.5 w-24 animate-pulse rounded bg-muted" />
        </div>
      )}
    </div>
  );
});
