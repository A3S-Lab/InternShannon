import * as assert from "node:assert/strict";
import { test } from "node:test";
import { normalizeResultMessageData } from "./result-message-normalization.ts";

test("ignores malformed result data instead of throwing", () => {
  assert.deepEqual(normalizeResultMessageData(null), {
    sessionPatch: {},
    isError: false,
    errorContent: "An error occurred",
  });
});

test("normalizes sparse legacy result metrics and object error content", () => {
  assert.deepEqual(
    normalizeResultMessageData({
      totalCostUsd: "0.25",
      numTurns: "3",
      totalLinesAdded: 12,
      totalLinesRemoved: Number.NaN,
      contextUsedPercent: "not-number",
      inputTokens: "100",
      outputTokens: " 42 ",
      cacheReadTokens: null,
      cacheWriteTokens: 0,
      is_error: "yes",
      result: { message: "tool failed" },
    }),
    {
      sessionPatch: {
        totalCostUsd: 0.25,
        numTurns: 3,
        totalLinesAdded: 12,
        inputTokens: 100,
        outputTokens: 42,
        cacheWriteTokens: 0,
      },
      isError: true,
      errorContent: JSON.stringify({ message: "tool failed" }, null, 2),
    },
  );
});

test("normalizes snake_case result metrics before InternShannon updates session counters", () => {
  assert.deepEqual(
    normalizeResultMessageData({
      total_cost_usd: "0.5",
      num_turns: "4",
      total_lines_added: "12",
      total_lines_removed: 3,
      context_used_percent: "47.5",
      input_tokens: "1000",
      output_tokens: "250",
      cache_read_tokens: "80",
      cache_write_tokens: "40",
      isError: "true",
      result: "sidecar failed",
    }),
    {
      sessionPatch: {
        totalCostUsd: 0.5,
        numTurns: 4,
        totalLinesAdded: 12,
        totalLinesRemoved: 3,
        contextUsedPercent: 47.5,
        inputTokens: 1000,
        outputTokens: 250,
        cacheReadTokens: 80,
        cacheWriteTokens: 40,
      },
      isError: true,
      errorContent: "sidecar failed",
    },
  );
});

test("normalizes run verdict summary fields before InternShannon renders stop reason", () => {
  assert.deepEqual(
    normalizeResultMessageData({
      status: "incomplete",
      stop_reason: "sdk_stream_ended_without_stop_reason",
      retryable: "true",
      duration_ms: "1234",
      total_tokens: "552000",
      tool_calls: "34",
      open_plan_tasks: "2",
      is_error: true,
      message: "运行提前结束，未收到明确完成信号",
    }),
    {
      sessionPatch: {
        lastRunStatus: "incomplete",
        lastStopReason: "sdk_stream_ended_without_stop_reason",
        lastRunRetryable: true,
        lastRunDurationMs: 1234,
        lastRunTotalTokens: 552000,
        lastRunToolCalls: 34,
        lastRunOpenPlanTasks: 2,
      },
      isError: true,
      errorContent: "运行提前结束，未收到明确完成信号",
      runStatus: "incomplete",
      stopReason: "sdk_stream_ended_without_stop_reason",
      retryable: true,
    },
  );
});

test("suppresses chat error rows for text-only missing SDK stop signal", () => {
  assert.deepEqual(
    normalizeResultMessageData({
      status: "incomplete",
      stopReason: "sdk_stream_ended_without_stop_reason",
      retryable: true,
      toolCalls: 0,
      openPlanTasks: 0,
      is_error: true,
      message: "运行提前结束，未收到明确完成信号",
    }),
    {
      sessionPatch: {
        lastRunToolCalls: 0,
        lastRunOpenPlanTasks: 0,
        lastRunStatus: "incomplete",
        lastStopReason: "sdk_stream_ended_without_stop_reason",
        lastRunRetryable: true,
      },
      isError: true,
      errorContent: "运行提前结束，未收到明确完成信号",
      shouldAppendErrorMessage: false,
      runStatus: "incomplete",
      stopReason: "sdk_stream_ended_without_stop_reason",
      retryable: true,
    },
  );
});

test("keeps missing SDK stop signal visible when run counters are absent", () => {
  assert.deepEqual(
    normalizeResultMessageData({
      status: "incomplete",
      stopReason: "sdk_stream_ended_without_stop_reason",
      retryable: true,
      is_error: true,
      message: "运行提前结束，未收到明确完成信号",
    }),
    {
      sessionPatch: {
        lastRunStatus: "incomplete",
        lastStopReason: "sdk_stream_ended_without_stop_reason",
        lastRunRetryable: true,
      },
      isError: true,
      errorContent: "运行提前结束，未收到明确完成信号",
      runStatus: "incomplete",
      stopReason: "sdk_stream_ended_without_stop_reason",
      retryable: true,
    },
  );
});

test("preserves string result error content", () => {
  assert.deepEqual(normalizeResultMessageData({ is_error: true, result: "sidecar failed" }), {
    sessionPatch: {},
    isError: true,
    errorContent: "sidecar failed",
  });
});

test("preserves result error aliases before InternShannon renders failure messages", () => {
  assert.deepEqual(normalizeResultMessageData({ is_error: true, error: "sidecar lost connection" }), {
    sessionPatch: {},
    isError: true,
    errorContent: "sidecar lost connection",
  });

  assert.deepEqual(normalizeResultMessageData({ isError: "true", message: { detail: "tool failed" } }), {
    sessionPatch: {},
    isError: true,
    errorContent: JSON.stringify({ detail: "tool failed" }, null, 2),
  });
});

test("ignores blank result aliases before InternShannon renders failure messages", () => {
  assert.deepEqual(
    normalizeResultMessageData({
      is_error: true,
      result: "   ",
      error: "sidecar lost connection after tool result",
    }),
    {
      sessionPatch: {},
      isError: true,
      errorContent: "sidecar lost connection after tool result",
    },
  );
});
