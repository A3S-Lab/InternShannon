import {
  TASK_ID_FIELDS,
  TASK_TITLE_FIELDS,
  TERMINAL_TASK_STATUSES,
  mergeTasksByEvent,
  normalizePlanningStatus,
  planningEventTypeOf,
  stringField,
  type PlanningEventType,
} from "@a3s-lab/agent-planning";
import type { AgentPlanningState, AgentPlanningTask, AgentPlanningTaskStatus } from "@/lib/types";

const TASK_RECORD_ID_FIELDS = [...TASK_ID_FIELDS, "task_id", "step_id"] as const;
const STEP_RECORD_ID_FIELDS = ["id", "stepId", "step_id", "key"] as const;
const TASK_PARENT_ID_FIELDS = ["parentId", "parent_id", "parentTaskId", "parent_task_id"] as const;
const STEP_PARENT_ID_FIELDS = [...TASK_PARENT_ID_FIELDS, "taskId", "task_id"] as const;
const FLAT_STEP_FIELDS = [
  ...STEP_RECORD_ID_FIELDS,
  ...TASK_TITLE_FIELDS,
  ...STEP_PARENT_ID_FIELDS,
] as const;

export function reducePlanningStateFromEvent(
  previous: AgentPlanningState | null | undefined,
  event: Record<string, unknown>,
  now = Date.now(),
): AgentPlanningState | undefined {
  const eventType = planningEventTypeOf(event);
  if (!eventType) return undefined;

  const timestamp = planningTimestamp(event, now);
  const current = previous ?? {
    phase: "idle",
    tasks: [],
    updatedAt: timestamp,
  };
  const reason = typeof event.reason === "string" && event.reason.trim() ? event.reason.trim() : current.reason;
  const turn = typeof event.turn === "number" && Number.isFinite(event.turn) ? event.turn : current.turn;

  if (eventType === "planning_start") {
    return {
      phase: "planning",
      tasks: [],
      reason,
      turn,
      updatedAt: timestamp,
    };
  }

  let tasks = current.tasks ? [...current.tasks] : [];
  let currentTaskId = current.currentTaskId;
  const taskSnapshot = normalizePlanningTasks(event.tasks, "pending", timestamp);
  if (taskSnapshot) {
    tasks = mergeTasksByEvent(eventType, tasks, taskSnapshot);
  }

  if (eventType === "step_start" || eventType === "step_end" || (eventType === "task_updated" && !taskSnapshot)) {
    const step = normalizePlanningStepForEvent(event, eventType, timestamp);
    if (step) {
      tasks = upsertPlanningStep(tasks, step);
      currentTaskId = eventType === "task_updated" ? resolveCurrentPlanningTaskId(tasks, currentTaskId) : step.id;
    }
  } else {
    currentTaskId = resolveCurrentPlanningTaskId(tasks, currentTaskId);
  }

  return {
    phase: inferPlanningPhase(eventType, tasks, current.phase),
    tasks,
    currentTaskId,
    reason,
    turn,
    updatedAt: timestamp,
  };
}

function normalizeEventTimestamp(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value > 0 && value < 1e12 ? value * 1000 : value;
  }

  if (typeof value === "string" && value.trim()) {
    const trimmed = value.trim();
    const numeric = Number(trimmed);
    if (Number.isFinite(numeric)) {
      return numeric > 0 && numeric < 1e12 ? numeric * 1000 : numeric;
    }
    const parsed = Date.parse(trimmed);
    if (Number.isFinite(parsed)) return parsed;
  }

  return null;
}

function planningTimestamp(event: Record<string, unknown>, now: number): number {
  return normalizeEventTimestamp(event.timestamp) ?? now;
}

function normalizePlanningTask(
  value: unknown,
  index: number,
  fallbackStatus: AgentPlanningTaskStatus,
  timestamp: number,
  fields: {
    id: readonly string[];
    parentId: readonly string[];
  } = {
    id: TASK_RECORD_ID_FIELDS,
    parentId: TASK_PARENT_ID_FIELDS,
  },
): AgentPlanningTask | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    const title = String(value ?? "").trim();
    return title
      ? {
          id: `task-${index + 1}`,
          title,
          status: fallbackStatus,
          updatedAt: timestamp,
        }
      : null;
  }

  const record = value as Record<string, unknown>;
  const title = stringField(record, TASK_TITLE_FIELDS) || `任务 ${index + 1}`;
  const id = stringField(record, fields.id) || `task-${index + 1}-${title}`;

  return {
    id,
    title,
    description: stringField(record, ["description", "detail"]),
    status: normalizePlanningTaskStatus(record, fallbackStatus),
    phase: stringField(record, ["phase", "stage", "lane", "agentPhase"]),
    priority: stringField(record, ["priority"]),
    startedAt: timestampField(record, ["startedAt", "started_at"]),
    completedAt: timestampField(record, ["completedAt", "completed_at"]),
    note: stringField(record, ["note"]),
    reason: stringField(record, ["reason"]),
    parentId: stringField(record, fields.parentId),
    updatedAt: timestamp,
  };
}

function normalizePlanningTasks(
  value: unknown,
  fallbackStatus: AgentPlanningTaskStatus,
  timestamp: number,
): AgentPlanningTask[] | null {
  if (!Array.isArray(value)) return null;
  return value
    .map((item, index) => normalizePlanningTask(item, index, fallbackStatus, timestamp))
    .filter((task): task is AgentPlanningTask => Boolean(task));
}

function timestampField(record: Record<string, unknown>, keys: readonly string[]): string | number | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" || typeof value === "number") return value;
  }
  return undefined;
}

function normalizePlanningTaskStatus(
  record: Record<string, unknown>,
  fallbackStatus: AgentPlanningTaskStatus,
): AgentPlanningTaskStatus {
  if (record.status !== undefined) return normalizePlanningStatus(record.status, fallbackStatus);
  if (record.state !== undefined) return normalizePlanningStatus(record.state, fallbackStatus);
  if (record.phase !== undefined) {
    const phaseStatus = normalizePlanningStatus(record.phase, fallbackStatus);
    return phaseStatus === "unknown" ? fallbackStatus : phaseStatus;
  }
  return fallbackStatus;
}

function normalizePlanningStepForEvent(
  event: Record<string, unknown>,
  eventType: PlanningEventType,
  timestamp: number,
): AgentPlanningTask | null {
  const fallbackStatus =
    eventType === "step_start" ? "running" : eventType === "step_end" ? "completed" : "pending";
  const source =
    event.step ?? event.task ?? event.currentStep ?? (hasFlatPlanningStepFields(event) ? event : undefined);
  const step = normalizePlanningTask(
    source,
    0,
    fallbackStatus,
    timestamp,
    {
      id: STEP_RECORD_ID_FIELDS,
      parentId: STEP_PARENT_ID_FIELDS,
    },
  );
  if (!step) return null;
  return {
    ...step,
    status:
      eventType === "step_start"
        ? "running"
        : eventType === "step_end"
          ? TERMINAL_TASK_STATUSES.has(step.status)
            ? step.status
            : "completed"
          : step.status,
  };
}

function hasFlatPlanningStepFields(event: Record<string, unknown>): boolean {
  return FLAT_STEP_FIELDS.some((field) => event[field] !== undefined);
}

function resolveCurrentPlanningTaskId(tasks: AgentPlanningTask[], previousTaskId?: string): string | undefined {
  const runningTask = tasks.find((task) => task.status === "running");
  if (runningTask) return runningTask.id;
  if (previousTaskId && tasks.some((task) => task.id === previousTaskId)) return previousTaskId;
  return undefined;
}

function upsertPlanningStep(tasks: AgentPlanningTask[], step: AgentPlanningTask): AgentPlanningTask[] {
  const existingIndex = tasks.findIndex((task) => task.id === step.id || task.title === step.title);
  if (existingIndex < 0) return [...tasks, step];
  return tasks.map((task, index) =>
    index === existingIndex
      ? {
          ...task,
          ...step,
          id: task.id || step.id,
          title: step.title || task.title,
        }
      : task,
  );
}

function inferPlanningPhase(
  eventType: PlanningEventType,
  tasks: AgentPlanningTask[],
  previousPhase: AgentPlanningState["phase"],
): AgentPlanningState["phase"] {
  if (eventType === "planning_start") return "planning";
  if (tasks.some((task) => task.status === "running")) return "running";
  if (eventType === "step_start") return "running";
  if (tasks.length > 0 && tasks.every((task) => TERMINAL_TASK_STATUSES.has(task.status))) {
    return "completed";
  }
  if (eventType === "planning_end" || eventType === "task_updated") return "running";
  return previousPhase;
}
