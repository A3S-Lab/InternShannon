import * as assert from "node:assert/strict";
import { test } from "node:test";
import { normalizeToolErrorActivity } from "./tool-error-activity.ts";

test("normalizes legacy tool_error aliases before InternShannon renders runtime failures", () => {
  assert.deepEqual(
    normalizeToolErrorActivity(
      {
        type: "tool_error",
        tool_id: "tool-1",
        tool_name: "read_file",
        message: "permission denied",
        duration_ms: "2400",
        consecutive_failures: "2",
      },
      { timestamp: 4_000 },
    ),
    {
      id: "tool_error:tool-1:4000",
      kind: "tool",
      status: "failed",
      phase: "tool_error",
      label: "工具失败：read_file （2s 后失败）",
      detail: "permission denied（同工具连续失败 2 次）",
      source: "工具运行器",
      toolUseId: "tool-1",
      toolName: "read_file",
      elapsedMs: 2_400,
      timestamp: 4_000,
    },
  );
});

test("preserves tool_error detail before InternShannon renders runtime failures", () => {
  assert.deepEqual(
    normalizeToolErrorActivity(
      {
        type: "tool_error",
        toolName: "shell",
        detail: "command exited with code 1",
      },
      { timestamp: 4_200 },
    ),
    {
      id: "tool_error:shell:4200",
      kind: "tool",
      status: "failed",
      phase: "tool_error",
      label: "工具失败：shell",
      detail: "command exited with code 1",
      source: "工具运行器",
      toolUseId: undefined,
      toolName: "shell",
      elapsedMs: undefined,
      timestamp: 4_200,
    },
  );
});

test("trims legacy tool_error fields before InternShannon groups runtime failures", () => {
  assert.deepEqual(
    normalizeToolErrorActivity(
      {
        type: "tool_error",
        tool_id: " tool-legacy-2 ",
        tool_name: " Read ",
        message: " permission denied ",
        duration_ms: "2400",
        consecutive_failures: "2",
      },
      { timestamp: 4_300 },
    ),
    {
      id: "tool_error:tool-legacy-2:4300",
      kind: "tool",
      status: "failed",
      phase: "tool_error",
      label: "工具失败：Read （2s 后失败）",
      detail: "permission denied（同工具连续失败 2 次）",
      source: "工具运行器",
      toolUseId: "tool-legacy-2",
      toolName: "Read",
      elapsedMs: 2_400,
      timestamp: 4_300,
    },
  );
});

test("ignores blank tool_error aliases before InternShannon groups runtime failures", () => {
  assert.deepEqual(
    normalizeToolErrorActivity(
      {
        type: "tool_error",
        toolId: "   ",
        tool_id: " tool-legacy-3 ",
        toolName: "   ",
        tool_name: " Read ",
        message: " permission denied ",
      },
      { timestamp: 4_400 },
    ),
    {
      id: "tool_error:tool-legacy-3:4400",
      kind: "tool",
      status: "failed",
      phase: "tool_error",
      label: "工具失败：Read",
      detail: "permission denied",
      source: "工具运行器",
      toolUseId: "tool-legacy-3",
      toolName: "Read",
      elapsedMs: undefined,
      timestamp: 4_400,
    },
  );
});

test("ignores blank tool_error metric aliases before InternShannon renders runtime failure timing", () => {
  assert.deepEqual(
    normalizeToolErrorActivity(
      {
        type: "tool_error",
        tool_id: "tool-legacy-4",
        tool_name: "Read",
        message: "permission denied",
        durationMs: "   ",
        duration_ms: "3000",
        consecutiveFailures: "   ",
        consecutive_failures: "3",
      },
      { timestamp: 4_500 },
    ),
    {
      id: "tool_error:tool-legacy-4:4500",
      kind: "tool",
      status: "failed",
      phase: "tool_error",
      label: "工具失败：Read （3s 后失败）",
      detail: "permission denied（同工具连续失败 3 次）",
      source: "工具运行器",
      toolUseId: "tool-legacy-4",
      toolName: "Read",
      elapsedMs: 3_000,
      timestamp: 4_500,
    },
  );
});
