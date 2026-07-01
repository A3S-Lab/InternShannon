import * as assert from "node:assert/strict";
import { test } from "node:test";
import {
  normalizeStreamToolEndEvent,
  normalizeStreamToolOutputDeltaEvent,
  normalizeStreamToolProgressEvent,
  normalizeStreamToolStartEvent,
} from "./stream-event-normalization.ts";

test("normalizes legacy stream tool_start payloads before streaming state", () => {
  assert.deepEqual(
    normalizeStreamToolStartEvent({
      tool_id: 42,
      tool_name: " Bash ",
      input: { command: "pnpm test" },
    }),
    {
      toolUseId: "42",
      toolName: "Bash",
      input: JSON.stringify({ command: "pnpm test" }, null, 2),
    },
  );
});

test("ignores blank stream tool_start input aliases before InternShannon renders tool parameters", () => {
  assert.deepEqual(
    normalizeStreamToolStartEvent({
      tool_call_id: "call-stream-start-blank-input",
      tool_name: "Read",
      input: "   ",
      tool_input: { path: "README.md" },
    }),
    {
      toolUseId: "call-stream-start-blank-input",
      toolName: "Read",
      input: JSON.stringify({ path: "README.md" }, null, 2),
    },
  );
});

test("normalizes legacy stream tool_end payloads before completed tool rendering", () => {
  assert.deepEqual(
    normalizeStreamToolEndEvent({
      tool_id: "",
      tool_name: " Bash ",
      tool_output: { stdout: "ok", stderr: null },
      is_error: "false",
      file_path: { detail: "apps/web/src/main.tsx" },
    }),
    {
      toolUseId: "",
      toolName: "Bash",
      output: JSON.stringify({ stdout: "ok", stderr: null }, null, 2),
      isError: false,
      filePath: "apps/web/src/main.tsx",
    },
  );
});

test("preserves stream tool_end result aliases before InternShannon renders completed tools", () => {
  assert.deepEqual(
    normalizeStreamToolEndEvent({
      tool_call_id: "call-stream-result",
      tool_name: "Read",
      result: "README contents from stream result alias",
      status: "completed",
      duration_ms: "42",
    }),
    {
      toolUseId: "call-stream-result",
      toolName: "Read",
      output: "README contents from stream result alias",
      isError: false,
      durationMs: 42,
    },
  );
});

test("ignores blank stream tool_end output aliases before InternShannon renders completed tools", () => {
  assert.deepEqual(
    normalizeStreamToolEndEvent({
      tool_call_id: "call-stream-blank-output",
      tool_name: "Read",
      output: "   ",
      result: "completed output from fallback result alias",
      status: "completed",
    }),
    {
      toolUseId: "call-stream-blank-output",
      toolName: "Read",
      output: "completed output from fallback result alias",
      isError: false,
    },
  );
});

test("marks non-zero stream tool_end exit codes as failed before InternShannon renders completed tools", () => {
  assert.deepEqual(
    normalizeStreamToolEndEvent({
      toolUseId: "call-stream-failed",
      toolName: "Read",
      output: "permission denied",
      error: "permission denied",
      exitCode: 1,
    }),
    {
      toolUseId: "call-stream-failed",
      toolName: "Read",
      output: "permission denied",
      isError: true,
    },
  );
});

test("normalizes legacy stream tool output deltas", () => {
  assert.deepEqual(
    normalizeStreamToolOutputDeltaEvent({
      tool_use_id: "tool-1",
      tool_name: "Read",
      output_delta: ["line 1", "line 2"],
      elapsed_time_seconds: "3.25",
    }),
    {
      toolUseId: "tool-1",
      toolName: "Read",
      delta: JSON.stringify(["line 1", "line 2"], null, 2),
      elapsedTimeSeconds: 3.25,
    },
  );
});

test("ignores blank stream tool output delta aliases before InternShannon renders live output", () => {
  assert.deepEqual(
    normalizeStreamToolOutputDeltaEvent({
      tool_call_id: "call-stream-delta-blank-alias",
      tool_name: "Read",
      delta: "   ",
      output_delta: "live output from fallback delta alias",
      elapsedTimeSeconds: "   ",
      elapsed_time_seconds: "1.75",
    }),
    {
      toolUseId: "call-stream-delta-blank-alias",
      toolName: "Read",
      delta: "live output from fallback delta alias",
      elapsedTimeSeconds: 1.75,
    },
  );
});

test("converts stream elapsedMs before InternShannon renders tool progress time", () => {
  assert.deepEqual(
    normalizeStreamToolOutputDeltaEvent({
      toolUseId: "tool-ms",
      toolName: "Bash",
      delta: "done",
      elapsed_ms: 3_250,
    }),
    {
      toolUseId: "tool-ms",
      toolName: "Bash",
      delta: "done",
      elapsedTimeSeconds: 3.25,
    },
  );
});

test("normalizes legacy stream tool_progress payloads", () => {
  assert.deepEqual(
    normalizeStreamToolProgressEvent({
      tool_use_id: null,
      tool_name: " Grep ",
      elapsed_time_seconds: "4",
      phase: "input_streaming",
      input_delta_count: "9",
      input_streaming_ms: "4100",
      input: { pattern: "Agent" },
      output: { matches: 2 },
    }),
    {
      toolUseId: "",
      toolName: "Grep",
      elapsedTimeSeconds: 4,
      phase: "input_streaming",
      input: JSON.stringify({ pattern: "Agent" }, null, 2),
      output: JSON.stringify({ matches: 2 }, null, 2),
      inputDeltaCount: 9,
      inputStreamingMs: 4100,
    },
  );
});

test("preserves stream tool_progress result aliases before InternShannon renders active tool output", () => {
  assert.deepEqual(
    normalizeStreamToolProgressEvent({
      tool_call_id: "call-stream-progress-result",
      tool_name: " Read ",
      elapsed_time_seconds: "2",
      result: "partial output from result alias",
    }),
    {
      toolUseId: "call-stream-progress-result",
      toolName: "Read",
      elapsedTimeSeconds: 2,
      output: "partial output from result alias",
    },
  );
});

test("ignores blank stream tool_progress aliases before InternShannon renders active tool output", () => {
  assert.deepEqual(
    normalizeStreamToolProgressEvent({
      tool_call_id: "call-stream-progress-blank-alias",
      tool_name: " Read ",
      elapsedTimeSeconds: "   ",
      elapsed_time_seconds: "2.75",
      output: "   ",
      result: "partial output from stream fallback result alias",
    }),
    {
      toolUseId: "call-stream-progress-blank-alias",
      toolName: "Read",
      elapsedTimeSeconds: 2.75,
      output: "partial output from stream fallback result alias",
    },
  );
});

test("preserves stream tool_progress tool_call_id before InternShannon pairs updates", () => {
  assert.deepEqual(
    normalizeStreamToolProgressEvent({
      tool_call_id: "call-stream-tool-1",
      tool_name: " Read ",
      elapsed_ms: "1250",
    }),
    {
      toolUseId: "call-stream-tool-1",
      toolName: "Read",
      elapsedTimeSeconds: 1.25,
    },
  );
});

test("trims stream tool ids before InternShannon pairs tool updates", () => {
  assert.deepEqual(
    normalizeStreamToolEndEvent({
      tool_call_id: " call-stream-tool-2 ",
      tool_name: " Read ",
      output: "done",
      status: "completed",
    }),
    {
      toolUseId: "call-stream-tool-2",
      toolName: "Read",
      output: "done",
      isError: false,
    },
  );
});

test("ignores blank stream tool ids before InternShannon pairs tool updates", () => {
  assert.deepEqual(
    normalizeStreamToolEndEvent({
      toolUseId: "   ",
      tool_call_id: "call-stream-tool-3",
      tool_name: " Read ",
      output: "done",
      status: "completed",
    }),
    {
      toolUseId: "call-stream-tool-3",
      toolName: "Read",
      output: "done",
      isError: false,
    },
  );
});

test("ignores blank stream tool names before InternShannon renders completed tools", () => {
  assert.deepEqual(
    normalizeStreamToolEndEvent({
      tool_call_id: "call-stream-tool-4",
      toolName: "   ",
      tool_name: " Read ",
      output: "done",
      status: "completed",
    }),
    {
      toolUseId: "call-stream-tool-4",
      toolName: "Read",
      output: "done",
      isError: false,
    },
  );
});

test("drops stream tool payloads without a usable tool name", () => {
  assert.equal(normalizeStreamToolStartEvent({ tool_name: "" }), null);
  assert.equal(normalizeStreamToolEndEvent({ output: "ok" }), null);
  assert.equal(normalizeStreamToolOutputDeltaEvent({ delta: "ok" }), null);
  assert.equal(normalizeStreamToolProgressEvent({ output: "ok" }), null);
});
