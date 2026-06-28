import * as assert from "node:assert/strict";
import { test } from "node:test";
import { normalizeStreamStalledActivity } from "./stream-stalled-activity.ts";

test("describes stream stalls without active tools as model response waiting", () => {
  assert.deepEqual(
    normalizeStreamStalledActivity(
      {
        type: "stream_stalled",
        stalledMs: 90_001,
        activeToolCount: 0,
      },
      { timestamp: 1_000 },
    ),
    {
      id: "stream_stalled:n/a:1000",
      kind: "main_agent",
      status: "waiting",
      phase: "stalled",
      label: "模型响应等待中 90s",
      detail: "模型暂未返回新事件，正在等待…",
      source: "运行时看门狗",
      toolUseId: undefined,
      elapsedMs: 90_001,
      activeToolCount: 0,
      timestamp: 1_000,
    },
  );
});

test("describes stream stalls with active tools as tool execution waiting", () => {
  assert.deepEqual(
    normalizeStreamStalledActivity(
      {
        type: "stream_stalled",
        stalledMs: 30_004,
        activeToolCount: 1,
        activeToolId: "tool-1",
      },
      { baseId: "activity-1", timestamp: 2_000 },
    ),
    {
      id: "activity-1",
      kind: "tool",
      status: "waiting",
      phase: "stalled",
      label: "工具执行已无响应 30s",
      detail: "仍在等待工具 tool-1 返回结果",
      source: "运行时看门狗",
      toolUseId: "tool-1",
      elapsedMs: 30_004,
      activeToolCount: 1,
      timestamp: 2_000,
    },
  );
});

test("normalizes legacy stream stall aliases before InternShannon renders watchdog activity", () => {
  assert.deepEqual(
    normalizeStreamStalledActivity(
      {
        type: "stream_stalled",
        stalled_ms: "30004",
        active_tool_count: "1",
        active_tool_id: "tool-1",
      },
      { timestamp: 3_000 },
    ),
    {
      id: "stream_stalled:tool-1:3000",
      kind: "tool",
      status: "waiting",
      phase: "stalled",
      label: "工具执行已无响应 30s",
      detail: "仍在等待工具 tool-1 返回结果",
      source: "运行时看门狗",
      toolUseId: "tool-1",
      elapsedMs: 30_004,
      activeToolCount: 1,
      timestamp: 3_000,
    },
  );
});

test("treats legacy stream stalls with only a tool id as tool waiting", () => {
  assert.deepEqual(
    normalizeStreamStalledActivity(
      {
        type: "stream_stalled",
        stalled_ms: "45000",
        tool_id: "tool-legacy-1",
      },
      { timestamp: 3_500 },
    ),
    {
      id: "stream_stalled:tool-legacy-1:3500",
      kind: "tool",
      status: "waiting",
      phase: "stalled",
      label: "工具执行已无响应 45s",
      detail: "仍在等待工具 tool-legacy-1 返回结果",
      source: "运行时看门狗",
      toolUseId: "tool-legacy-1",
      elapsedMs: 45_000,
      activeToolCount: 1,
      timestamp: 3_500,
    },
  );
});

test("trims legacy stream stall tool ids before InternShannon groups watchdog activity", () => {
  assert.deepEqual(
    normalizeStreamStalledActivity(
      {
        type: "stream_stalled",
        stalled_ms: "120000",
        active_tool_id: " tool-legacy-2 ",
      },
      { timestamp: 3_600 },
    ),
    {
      id: "stream_stalled:tool-legacy-2:3600",
      kind: "tool",
      status: "waiting",
      phase: "stalled",
      label: "工具执行已无响应 120s",
      detail: "仍在等待工具 tool-legacy-2 返回结果",
      source: "运行时看门狗",
      toolUseId: "tool-legacy-2",
      elapsedMs: 120_000,
      activeToolCount: 1,
      timestamp: 3_600,
    },
  );
});

test("ignores blank stream stall aliases before InternShannon groups watchdog activity", () => {
  assert.deepEqual(
    normalizeStreamStalledActivity(
      {
        type: "stream_stalled",
        stalledMs: "   ",
        stalled_ms: "180000",
        activeToolCount: "   ",
        active_tool_count: "2",
        activeToolId: "   ",
        active_tool_id: " tool-legacy-3 ",
      },
      { timestamp: 3_700 },
    ),
    {
      id: "stream_stalled:tool-legacy-3:3700",
      kind: "tool",
      status: "waiting",
      phase: "stalled",
      label: "工具执行已无响应 180s",
      detail: "仍在等待工具 tool-legacy-3 返回结果",
      source: "运行时看门狗",
      toolUseId: "tool-legacy-3",
      elapsedMs: 180_000,
      activeToolCount: 2,
      timestamp: 3_700,
    },
  );
});
