import * as assert from "node:assert/strict";
import { test } from "node:test";
import { reducePlanningStateFromEvent } from "./planning-state.ts";

test("starts a fresh planning state on planning_start", () => {
  const state = reducePlanningStateFromEvent(
    {
      phase: "completed",
      tasks: [{ id: "old", title: "old", status: "completed", updatedAt: 1 }],
      updatedAt: 1,
    },
    { type: "planning_start", reason: "new task", timestamp: 1000 },
    9999,
  );

  assert.deepEqual(state, {
    phase: "planning",
    tasks: [],
    reason: "new task",
    turn: undefined,
    updatedAt: 1000000,
  });
});

test("normalizes legacy planning timestamps before InternShannon renders plan recency", () => {
  const started = reducePlanningStateFromEvent(
    null,
    { type: "planning_start", reason: "legacy timestamp", timestamp: "1700000000" },
    9999,
  );
  const updated = reducePlanningStateFromEvent(
    started,
    {
      type: "task_updated",
      tasks: [{ id: "a", title: "分析需求", status: "in_progress" }],
      timestamp: "2024-01-02T03:04:05.000Z",
    },
    9999,
  );

  assert.equal(started?.updatedAt, 1_700_000_000_000);
  assert.equal(updated?.updatedAt, 1_704_164_645_000);
  assert.equal(updated?.tasks[0]?.updatedAt, 1_704_164_645_000);
});

test("treats multi-item task_updated as an authoritative task snapshot", () => {
  const state = reducePlanningStateFromEvent(
    {
      phase: "running",
      tasks: [{ id: "old", title: "old", status: "running", updatedAt: 1 }],
      currentTaskId: "old",
      updatedAt: 1,
    },
    {
      type: "task_updated",
      tasks: [
        { id: "a", title: "分析需求", status: "done" },
        { id: "b", title: "实现", status: "in_progress" },
      ],
      timestamp: 2000000,
    },
    9999,
  );

  assert.equal(state?.phase, "running");
  assert.equal(state?.currentTaskId, "b");
  assert.deepEqual(
    state?.tasks.map((task) => [task.id, task.status]),
    [
      ["a", "completed"],
      ["b", "running"],
    ],
  );
});

test("merges a single task_updated item into the existing plan", () => {
  const state = reducePlanningStateFromEvent(
    {
      phase: "running",
      tasks: [
        { id: "a", title: "分析需求", status: "completed", updatedAt: 1 },
        { id: "b", title: "实现", status: "running", updatedAt: 1 },
        { id: "c", title: "验收", status: "pending", updatedAt: 1 },
      ],
      currentTaskId: "b",
      updatedAt: 1,
    },
    {
      type: "task_updated",
      tasks: [{ id: "b", title: "实现", status: "done" }],
      timestamp: 2000000,
    },
    9999,
  );

  assert.deepEqual(
    state?.tasks.map((task) => [task.id, task.status]),
    [
      ["a", "completed"],
      ["b", "completed"],
      ["c", "pending"],
    ],
  );
});

test("preserves run_incomplete_finalize reason while rendering terminal task states", () => {
  const state = reducePlanningStateFromEvent(
    {
      phase: "running",
      tasks: [
        { id: "write-test", title: "write concurrent_test.rs", status: "running", updatedAt: 1 },
        { id: "verify", title: "run cargo test", status: "pending", updatedAt: 1 },
      ],
      currentTaskId: "write-test",
      updatedAt: 1,
    },
    {
      type: "task_updated",
      reason: "run_incomplete_finalize",
      tasks: [
        { id: "write-test", title: "write concurrent_test.rs", status: "failed" },
        { id: "verify", title: "run cargo test", status: "cancelled" },
      ],
      timestamp: 2000000,
    },
    9999,
  );

  assert.equal(state?.phase, "completed");
  assert.equal(state?.reason, "run_incomplete_finalize");
  assert.deepEqual(
    state?.tasks.map((task) => [task.id, task.status]),
    [
      ["write-test", "failed"],
      ["verify", "cancelled"],
    ],
  );
});

test("merges task_updated.task into the existing plan", () => {
  const state = reducePlanningStateFromEvent(
    {
      phase: "running",
      tasks: [
        { id: "a", title: "分析需求", status: "completed", updatedAt: 1 },
        { id: "b", title: "实现", status: "running", updatedAt: 1 },
        { id: "c", title: "验收", status: "pending", updatedAt: 1 },
      ],
      currentTaskId: "b",
      updatedAt: 1,
    },
    {
      type: "task_updated",
      task: { id: "b", title: "实现", status: "done" },
      timestamp: 2000000,
    },
    9999,
  );

  assert.deepEqual(
    state?.tasks.map((task) => [task.id, task.status]),
    [
      ["a", "completed"],
      ["b", "completed"],
      ["c", "pending"],
    ],
  );
});

test("preserves task phase metadata for swimlane boards", () => {
  const state = reducePlanningStateFromEvent(
    null,
    {
      type: "task_updated",
      tasks: [{ id: "a", title: "配置运行参数", status: "todo", phase: "configuring" }],
      timestamp: 2000000,
    },
    9999,
  );

  assert.equal(state?.tasks[0]?.phase, "configuring");
});

test("does not treat phase metadata as an unknown status before InternShannon renders task chips", () => {
  const state = reducePlanningStateFromEvent(
    null,
    {
      type: "task_updated",
      tasks: [{ id: "a", title: "配置运行参数", phase: "configuring" }],
      timestamp: 2000000,
    },
    9999,
  );

  assert.equal(state?.tasks[0]?.phase, "configuring");
  assert.equal(state?.tasks[0]?.status, "pending");
});

test("preserves snake_case task ids and parent ids before InternShannon renders planning hierarchy", () => {
  const state = reducePlanningStateFromEvent(
    null,
    {
      type: "task_updated",
      tasks: [
        { task_id: "parent-1", title: "分析需求", status: "done" },
        { task_id: "child-1", parent_task_id: "parent-1", title: "实现方案", status: "in_progress" },
      ],
      timestamp: 2000000,
    },
    9999,
  );

  assert.deepEqual(
    state?.tasks.map((task) => ({ id: task.id, parentId: task.parentId, status: task.status })),
    [
      { id: "parent-1", parentId: undefined, status: "completed" },
      { id: "child-1", parentId: "parent-1", status: "running" },
    ],
  );
  assert.equal(state?.currentTaskId, "child-1");
});

test("preserves snake_case task timing before InternShannon renders running elapsed badges", () => {
  const state = reducePlanningStateFromEvent(
    null,
    {
      type: "task_updated",
      tasks: [
        {
          task_id: "task-running-1",
          title: "执行工具调用",
          status: "in_progress",
          started_at: "2026-06-15T10:00:00.000Z",
          completed_at: "2026-06-15T10:01:30.000Z",
        },
      ],
      timestamp: 2000000,
    },
    9999,
  );

  assert.equal(state?.tasks[0]?.startedAt, "2026-06-15T10:00:00.000Z");
  assert.equal(state?.tasks[0]?.completedAt, "2026-06-15T10:01:30.000Z");
});

test("preserves flat step_start fields before InternShannon renders planning progress", () => {
  const state = reducePlanningStateFromEvent(
    null,
    {
      type: "step_start",
      step_id: "step-legacy-1",
      task_id: "task-parent-1",
      title: "执行旧版规划步骤",
      timestamp: 2_000_000,
    },
    9999,
  );

  assert.equal(state?.phase, "running");
  assert.equal(state?.currentTaskId, "step-legacy-1");
  assert.deepEqual(state?.tasks, [
    {
      id: "step-legacy-1",
      title: "执行旧版规划步骤",
      description: undefined,
      status: "running",
      phase: undefined,
      priority: undefined,
      startedAt: undefined,
      completedAt: undefined,
      note: undefined,
      reason: undefined,
      parentId: "task-parent-1",
      updatedAt: 2_000_000_000,
    },
  ]);
});

test("upserts step progress when a task snapshot is not present", () => {
  const started = reducePlanningStateFromEvent(
    {
      phase: "running",
      tasks: [{ id: "a", title: "分析需求", status: "completed", updatedAt: 1 }],
      updatedAt: 1,
    },
    { type: "step_start", step: { id: "b", title: "实现" }, timestamp: 3000000 },
    9999,
  );
  const completed = reducePlanningStateFromEvent(
    started,
    { type: "step_end", step: { id: "b", title: "实现" }, timestamp: 4000000 },
    9999,
  );

  assert.equal(started?.currentTaskId, "b");
  assert.equal(started?.tasks.find((task) => task.id === "b")?.status, "running");
  assert.equal(completed?.phase, "completed");
  assert.equal(completed?.tasks.find((task) => task.id === "b")?.status, "completed");
});

test("ignores non-planning stream events", () => {
  const state = reducePlanningStateFromEvent(null, { type: "text_delta", text: "hello" }, 1234);
  assert.equal(state, undefined);
});
