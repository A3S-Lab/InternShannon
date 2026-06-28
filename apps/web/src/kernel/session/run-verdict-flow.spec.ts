import * as assert from "node:assert/strict";
import { test } from "node:test";
import { reducePlanningStateFromEvent } from "./planning-state.ts";
import { normalizeResultMessageData } from "./result-message-normalization.ts";

test("applies an incomplete run verdict without turning unfinished plan tasks green", () => {
  const started = reducePlanningStateFromEvent(
    null,
    {
      type: "task_updated",
      tasks: [
        { id: "write-test", title: "write concurrent_test.rs", status: "running" },
        { id: "verify", title: "run cargo test", status: "pending" },
      ],
      timestamp: 2000000,
    },
    9999,
  );
  const finalized = reducePlanningStateFromEvent(
    started,
    {
      type: "task_updated",
      reason: "run_incomplete_finalize",
      tasks: [
        { id: "write-test", title: "write concurrent_test.rs", status: "failed" },
        { id: "verify", title: "run cargo test", status: "cancelled" },
      ],
      timestamp: 2001000,
    },
    9999,
  );
  const result = normalizeResultMessageData({
    is_error: true,
    status: "incomplete",
    stopReason: "sdk_stream_ended_without_stop_reason",
    retryable: true,
    durationMs: 18 * 60 * 1000,
    totalTokens: 552000,
    toolCalls: 34,
    openPlanTasks: 2,
    message: "运行提前结束，未收到明确完成信号",
  });

  assert.equal(finalized?.phase, "completed");
  assert.equal(finalized?.reason, "run_incomplete_finalize");
  assert.deepEqual(
    finalized?.tasks.map((task) => [task.id, task.status]),
    [
      ["write-test", "failed"],
      ["verify", "cancelled"],
    ],
  );
  assert.deepEqual(result.sessionPatch, {
    lastRunDurationMs: 1_080_000,
    lastRunTotalTokens: 552000,
    lastRunToolCalls: 34,
    lastRunOpenPlanTasks: 2,
    lastRunStatus: "incomplete",
    lastStopReason: "sdk_stream_ended_without_stop_reason",
    lastRunRetryable: true,
  });
  assert.equal(result.isError, true);
  assert.equal(result.errorContent, "运行提前结束，未收到明确完成信号");
});
