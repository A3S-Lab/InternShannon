import type { AgentPlanningState, AgentPlanningTask } from "@/lib/types";

export type PlanningTaskView = Readonly<AgentPlanningTask>;
export type PlanningStateView = Readonly<Omit<AgentPlanningState, "tasks">> & {
  readonly tasks: readonly PlanningTaskView[];
};

const SETTLED_TASK_STATUSES = new Set<PlanningTaskView["status"]>(["completed", "failed", "cancelled", "skipped"]);

export function shouldShowPlanningState(
  planningState: PlanningStateView | null | undefined,
): planningState is PlanningStateView {
  return Boolean(planningState && (planningState.phase !== "idle" || planningState.tasks.length > 0));
}

export function planningPhaseLabel(phase?: AgentPlanningState["phase"]) {
  if (phase === "planning") return "生成计划";
  if (phase === "running") return "执行中";
  if (phase === "completed") return "已完成";
  return "待开始";
}

export function planningTaskStatusLabel(status?: PlanningTaskView["status"]) {
  if (status === "running") return "执行中";
  if (status === "completed") return "完成";
  if (status === "failed") return "失败";
  if (status === "cancelled") return "取消";
  if (status === "skipped") return "跳过";
  if (status === "pending") return "待办";
  return "未知";
}

export function planningTaskDotClass(status?: PlanningTaskView["status"]) {
  if (status === "running") return "bg-[#1456f0]";
  if (status === "completed") return "bg-emerald-500";
  if (status === "failed") return "bg-red-500";
  if (status === "cancelled" || status === "skipped") return "bg-[#8e8e93]";
  return "bg-[#d1d5db]";
}

export function planningTaskTextClass(status?: PlanningTaskView["status"]) {
  if (status === "running") return "text-[#1456f0]";
  if (status === "completed") return "text-emerald-700 line-through decoration-emerald-500/60";
  if (status === "failed") return "text-red-600";
  if (status === "cancelled" || status === "skipped") return "text-[#8e8e93]";
  return "text-[#45515e]";
}

export function isPlanningTaskSettled(task: PlanningTaskView) {
  return SETTLED_TASK_STATUSES.has(task.status);
}

export function getActivePlanningTask(planningState: PlanningStateView, tasks = planningState.tasks) {
  return (
    tasks.find((task) => task.id === planningState.currentTaskId) ??
    tasks.find((task) => task.status === "running") ??
    null
  );
}

export function getPlanningProgress(planningState: PlanningStateView) {
  const tasks = planningState.tasks;
  const totalTaskCount = tasks.length;
  const settledTaskCount = tasks.filter(isPlanningTaskSettled).length;
  const activeTask = getActivePlanningTask(planningState, tasks);
  return {
    tasks,
    activeTask,
    totalTaskCount,
    settledTaskCount,
    progressPercent: totalTaskCount > 0 ? Math.round((settledTaskCount / totalTaskCount) * 100) : 0,
  };
}
