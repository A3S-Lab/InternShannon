import {
  PLANNING_EVENT_TYPES,
  TASK_ID_FIELDS,
  TASK_TITLE_FIELDS,
  TERMINAL_TASK_STATUSES,
  mergeTasksByEvent,
  normalizePlanningStatus,
  planningEventTypeOf,
  stringField,
  terminalOrCompleted,
  upsertTaskByIdOrTitle,
} from "@a3s-lab/agent-planning";

type PlanningTaskRecord = Record<string, unknown> & {
  id?: string;
  title?: string;
  status?: string;
  startedAt?: string | number;
  completedAt?: string | number;
  note?: string;
};

export class KernelPlanningProgressTracker {
  private tasks: PlanningTaskRecord[] = [];
  private sdkProgressSeen = false;

  observe(event: Record<string, unknown> | null): void {
    const eventType = planningEventTypeOf(event);
    if (!eventType) return;

    if (eventType === "planning_start") {
      this.tasks = [];
      this.sdkProgressSeen = false;
      return;
    }

    const tasks = normalizeTasks(event?.tasks);
    if (tasks) {
      this.tasks = mergeTasksByEvent(eventType, this.tasks, tasks);
      if (eventType === "task_updated" && hasProgress(tasks)) {
        this.sdkProgressSeen = true;
      }
    }

    if (eventType === "step_start" || eventType === "step_end") {
      const step = normalizeTask(event?.step ?? event?.task ?? event?.currentStep, 0);
      if (step) {
        step.status = eventType === "step_start" ? "running" : terminalOrCompleted(step.status);
        this.tasks = upsertTaskByIdOrTitle(this.tasks, step);
        this.sdkProgressSeen = true;
      }
    }
  }

  toolStarted(toolName: string): Record<string, unknown> | null {
    if (this.sdkProgressSeen || this.tasks.length === 0) return null;
    const index = this.runningTaskIndex();
    const targetIndex = index >= 0 ? index : this.firstOpenTaskIndex();
    if (targetIndex < 0) return null;

    const current = this.tasks[targetIndex];
    if (current.status === "running") return null;

    const timestamp = Date.now();
    this.tasks = this.tasks.map((task, taskIndex) =>
      taskIndex === targetIndex
        ? {
            ...task,
            status: "running",
            startedAt: task.startedAt ?? timestamp,
            note: toolName ? `执行工具：${toolName}` : task.note,
          }
        : task
    );
    return this.snapshot("tool_start_fallback", timestamp);
  }

  toolEnded(toolName: string, failed: boolean): Record<string, unknown> | null {
    if (this.sdkProgressSeen || this.tasks.length === 0) return null;
    const index = this.runningTaskIndex();
    if (index < 0) return null;

    const timestamp = Date.now();
    this.tasks = this.tasks.map((task, taskIndex) =>
      taskIndex === index
        ? {
            ...task,
            status: failed ? "failed" : "completed",
            completedAt: timestamp,
            note: toolName
              ? failed
                ? `工具失败：${toolName}`
                : `工具完成：${toolName}`
              : task.note,
          }
        : task
    );
    return this.snapshot("tool_end_fallback", timestamp);
  }

  /**
   * Run 结束时收尾：把所有非终态任务推到一个终态，避免"会话完成了任务还在进行中"。
   * - `completed`：`running` → `completed`，`pending` → `skipped`（仅在 run verdict 确认为 succeeded 时使用）。
   * - `incomplete`：`running` → `failed`，`pending` → `cancelled`。
   * - `cancelled`：所有非终态 → `cancelled`。
   * - `failed`：`running` → `failed`，`pending` → `cancelled`。
   *
   * 没有需要收尾的任务时返回 null，避免发空更新。
   */
  finalize(outcome: "completed" | "incomplete" | "cancelled" | "failed"): Record<string, unknown> | null {
    if (this.tasks.length === 0) return null;
    let mutated = false;
    const timestamp = Date.now();
    this.tasks = this.tasks.map(task => {
      const status = normalizePlanningStatus(task.status);
      if (TERMINAL_TASK_STATUSES.has(status)) return task;
      mutated = true;
      const nextStatus: PlanningTaskRecord["status"] =
        outcome === "completed"
          ? status === "running"
            ? "completed"
            : "skipped"
          : outcome === "incomplete"
            ? status === "running"
              ? "failed"
              : "cancelled"
          : outcome === "failed"
            ? status === "running"
              ? "failed"
              : "cancelled"
            : "cancelled";
      const noteForOutcome =
        outcome === "completed"
          ? status === "running"
            ? "会话结束，任务标记为已完成"
            : "会话结束，任务未启动已跳过"
          : outcome === "incomplete"
            ? status === "running"
              ? "会话提前结束，任务未确认完成"
              : "会话提前结束，任务未启动已取消"
          : outcome === "failed"
            ? status === "running"
              ? "会话失败，任务标记为失败"
              : "会话失败，任务未启动已取消"
            : "会话已取消";
      return {
        ...task,
        status: nextStatus,
        completedAt: task.completedAt ?? timestamp,
        note: task.note ?? noteForOutcome,
      };
    });
    if (!mutated) return null;
    return this.snapshot(`run_${outcome}_finalize`, timestamp);
  }

  openTaskCount(): number {
    return this.openTasks().length;
  }

  openTasks(): PlanningTaskRecord[] {
    return this.tasks
      .filter(task => !TERMINAL_TASK_STATUSES.has(normalizePlanningStatus(task.status)))
      .map(task => ({ ...task }));
  }

  private runningTaskIndex(): number {
    return this.tasks.findIndex(task => normalizePlanningStatus(task.status) === "running");
  }

  private firstOpenTaskIndex(): number {
    return this.tasks.findIndex(task => !TERMINAL_TASK_STATUSES.has(normalizePlanningStatus(task.status)));
  }

  private snapshot(reason: string, timestamp: number): Record<string, unknown> {
    return {
      type: "task_updated",
      reason,
      timestamp,
      tasks: this.tasks.map(task => ({ ...task })),
    };
  }
}

export function isPlanningProgressEvent(event: Record<string, unknown> | null): boolean {
  return planningEventTypeOf(event) !== null;
}

// Re-export the SDK event type set so callers that previously imported
// PLANNING_EVENT_TYPES from this module keep working.
export { PLANNING_EVENT_TYPES };

function normalizeTasks(value: unknown): PlanningTaskRecord[] | null {
  if (!Array.isArray(value)) return null;
  return value
    .map((item, index) => normalizeTask(item, index))
    .filter((task): task is PlanningTaskRecord => Boolean(task));
}

function normalizeTask(value: unknown, index: number): PlanningTaskRecord | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    const title = String(value ?? "").trim();
    return title ? { id: `task-${index + 1}`, title, status: "pending" } : null;
  }

  const record = value as Record<string, unknown>;
  const title = stringField(record, TASK_TITLE_FIELDS);
  const id = stringField(record, TASK_ID_FIELDS) || (title ? `task-${index + 1}-${title}` : `task-${index + 1}`);
  return {
    ...record,
    id,
    ...(title ? { title } : {}),
    status: normalizePlanningStatus(record.status ?? record.state),
  };
}

function hasProgress(tasks: PlanningTaskRecord[]): boolean {
  return tasks.some(task => {
    const status = normalizePlanningStatus(task.status);
    return status === "running" || TERMINAL_TASK_STATUSES.has(status);
  });
}
