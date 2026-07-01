import * as assert from "node:assert/strict";
import { test } from "node:test";
import {
  normalizeAuthStatusSocketPayload,
  normalizeAgentMessageSocketPayload,
  normalizeSocketBoolean,
  normalizeSocketText,
  normalizeSocketTimestamp,
  normalizeToolProgressSocketPayload,
  normalizeToolConfirmationSocketPayload,
} from "./socket-message-normalization.ts";

test("normalizes malformed socket chat text into safe strings", () => {
  assert.equal(normalizeSocketText(null, "fallback"), "fallback");
  assert.equal(normalizeSocketText(42, "fallback"), "42");
  assert.equal(normalizeSocketText({ message: "sidecar failed" }, "fallback"), "sidecar failed");
  assert.equal(normalizeSocketText({ code: "E_RUNTIME", detail: "boom" }, "fallback"), "boom");
  assert.equal(normalizeSocketText({ code: "E_RUNTIME" }, "fallback"), JSON.stringify({ code: "E_RUNTIME" }, null, 2));
});

test("normalizes socket booleans and timestamps from legacy payloads", () => {
  assert.equal(normalizeSocketBoolean("yes"), true);
  assert.equal(normalizeSocketBoolean("0", true), false);
  assert.equal(normalizeSocketBoolean(null, true), true);
  assert.equal(normalizeSocketTimestamp("1700000000", 1), 1700000000000);
  assert.equal(normalizeSocketTimestamp("2024-01-02T03:04:05.000Z", 1), 1704164645000);
  assert.equal(normalizeSocketTimestamp(null, 7), 7);
});

test("normalizes sparse agent_message payloads before inbox state", () => {
  assert.deepEqual(
    normalizeAgentMessageSocketPayload(
      {
        message_id: "",
        from_session_id: "",
        topic: null,
        message: { detail: "please continue" },
        auto_execute: "true",
        execution_error: { message: "previous send failed" },
      },
      "fallback-message",
    ),
    {
      messageId: "fallback-message",
      fromSessionId: "unknown",
      topic: "Agent 消息",
      content: "please continue",
      autoExecute: true,
      executionError: "previous send failed",
    },
  );
});

test("ignores blank agent_message content before InternShannon receives inbox updates", () => {
  assert.deepEqual(
    normalizeAgentMessageSocketPayload(
      {
        messageId: "agent-msg-blank-content",
        fromSessionId: "session-source",
        content: "   ",
        message: { detail: "please review the latest fix" },
        autoExecute: "false",
      },
      "fallback-message",
    ),
    {
      messageId: "agent-msg-blank-content",
      fromSessionId: "session-source",
      topic: "Agent 消息",
      content: "please review the latest fix",
      autoExecute: false,
    },
  );
});

test("drops agent_message payloads with no usable content", () => {
  assert.equal(normalizeAgentMessageSocketPayload({ messageId: "agent-msg-1", content: null }, "fallback"), null);
  assert.equal(normalizeAgentMessageSocketPayload(null, "fallback"), null);
});

test("normalizes sparse tool confirmation requests before HITL state", () => {
  const normalized = normalizeToolConfirmationSocketPayload(
    {
      request_id: "",
      session_id: "",
      tool_name: "",
      tool_input: '{"path":"README.md"}',
      timestamp: "1700000000",
    },
    "session-current",
    "request-fallback",
  );

  assert.deepEqual(normalized, {
    requestId: "request-fallback",
    sessionId: "session-current",
    toolName: "tool",
    toolInput: { path: "README.md" },
    timestamp: 1700000000000,
  });
});

test("trims legacy tool confirmation fields before InternShannon applies HITL policy", () => {
  assert.deepEqual(
    normalizeToolConfirmationSocketPayload(
      {
        request_id: " request-1 ",
        session_id: " session-1 ",
        tool_name: " Bash ",
        input: { command: "pnpm test" },
        timestamp: "1700000000",
      },
      "session-current",
      "request-fallback",
    ),
    {
      requestId: "request-1",
      sessionId: "session-1",
      toolName: "Bash",
      toolInput: { command: "pnpm test" },
      timestamp: 1700000000000,
    },
  );
});

test("ignores blank tool confirmation input aliases before InternShannon renders HITL details", () => {
  assert.deepEqual(
    normalizeToolConfirmationSocketPayload(
      {
        requestId: "request-blank-tool-input",
        sessionId: "session-blank-tool-input",
        toolName: "Bash",
        toolInput: "   ",
        tool_input: { command: "pnpm test" },
        timestamp: 1700000000000,
      },
      "session-current",
      "request-fallback",
    ),
    {
      requestId: "request-blank-tool-input",
      sessionId: "session-blank-tool-input",
      toolName: "Bash",
      toolInput: { command: "pnpm test" },
      timestamp: 1700000000000,
    },
  );
});

test("ignores blank tool confirmation ids before InternShannon responds to HITL requests", () => {
  assert.deepEqual(
    normalizeToolConfirmationSocketPayload(
      {
        requestId: "   ",
        request_id: " request-from-snake ",
        sessionId: "   ",
        session_id: " session-from-snake ",
        toolName: "Bash",
        input: { command: "pnpm test" },
        timestamp: 1700000000000,
      },
      "session-current",
      "request-fallback",
    ),
    {
      requestId: "request-from-snake",
      sessionId: "session-from-snake",
      toolName: "Bash",
      toolInput: { command: "pnpm test" },
      timestamp: 1700000000000,
    },
  );
});

test("ignores blank tool confirmation names before InternShannon applies HITL policy", () => {
  assert.deepEqual(
    normalizeToolConfirmationSocketPayload(
      {
        requestId: "request-blank-tool-name",
        sessionId: "session-blank-tool-name",
        toolName: "   ",
        tool_name: " Bash ",
        input: { command: "pnpm test" },
        timestamp: 1700000000000,
      },
      "session-current",
      "request-fallback",
    ),
    {
      requestId: "request-blank-tool-name",
      sessionId: "session-blank-tool-name",
      toolName: "Bash",
      toolInput: { command: "pnpm test" },
      timestamp: 1700000000000,
    },
  );
});

test("preserves tool confirmation tool aliases before InternShannon applies HITL policy", () => {
  assert.deepEqual(
    normalizeToolConfirmationSocketPayload(
      {
        requestId: "request-tool-alias",
        sessionId: "session-tool-alias",
        toolName: "   ",
        tool: " Bash ",
        input: { command: "pnpm test" },
        timestamp: 1700000000000,
      },
      "session-current",
      "request-fallback",
    ),
    {
      requestId: "request-tool-alias",
      sessionId: "session-tool-alias",
      toolName: "Bash",
      toolInput: { command: "pnpm test" },
      timestamp: 1700000000000,
    },
  );
});

test("wraps non-record tool confirmation input for display", () => {
  assert.deepEqual(
    normalizeToolConfirmationSocketPayload(
      {
        requestId: "request-1",
        sessionId: "session-1",
        toolName: "Bash",
        input: "pnpm test",
        timestamp: 1700000000000,
      },
      "session-current",
      "request-fallback",
    ),
    {
      requestId: "request-1",
      sessionId: "session-1",
      toolName: "Bash",
      toolInput: { __display: "pnpm test" },
      timestamp: 1700000000000,
    },
  );
});

test("drops malformed tool confirmation requests", () => {
  assert.equal(normalizeToolConfirmationSocketPayload(null, "session-current", "request-fallback"), null);
});

test("normalizes auth_status payloads into renderable status state", () => {
  assert.deepEqual(
    normalizeAuthStatusSocketPayload({
      is_authenticating: "true",
      output: ["open browser", { message: "waiting for code" }, null, 42],
      error: { detail: "oauth timeout" },
    }),
    {
      isAuthenticating: true,
      output: ["open browser", "waiting for code", "42"],
      error: "oauth timeout",
    },
  );
  assert.equal(normalizeAuthStatusSocketPayload(null), null);
});

test("ignores blank auth_status output aliases before InternShannon renders authentication logs", () => {
  assert.deepEqual(
    normalizeAuthStatusSocketPayload({
      is_authenticating: "true",
      output: "   ",
      logs: ["open browser", { message: "waiting for code" }],
      error: null,
    }),
    {
      isAuthenticating: true,
      output: ["open browser", "waiting for code"],
      error: undefined,
    },
  );
});

test("normalizes direct tool_progress payloads before stream state", () => {
  assert.deepEqual(
    normalizeToolProgressSocketPayload({
      tool_use_id: null,
      tool_name: " Bash ",
      elapsed_time_seconds: "2.5",
      input: { command: "pnpm test" },
      output: ["line 1", "line 2"],
      seq: "4.9",
    }),
    {
      toolUseId: "",
      toolName: "Bash",
      elapsedTimeSeconds: 2.5,
      input: JSON.stringify({ command: "pnpm test" }, null, 2),
      output: JSON.stringify(["line 1", "line 2"], null, 2),
      seq: 4,
    },
  );
});

test("converts tool_progress elapsedMs before InternShannon renders elapsed tool time", () => {
  assert.deepEqual(
    normalizeToolProgressSocketPayload({
      toolId: "tool-ms",
      toolName: "Bash",
      elapsedMs: 2_500,
    }),
    {
      toolUseId: "tool-ms",
      toolName: "Bash",
      elapsedTimeSeconds: 2.5,
    },
  );
});

test("preserves tool_progress input streaming phase metadata", () => {
  assert.deepEqual(
    normalizeToolProgressSocketPayload({
      toolId: "tool-input-stream",
      toolName: "Write",
      phase: "input_streaming",
      elapsedMs: 0,
      input_delta_count: "12",
      input_streaming_ms: "4250",
    }),
    {
      toolUseId: "tool-input-stream",
      toolName: "Write",
      elapsedTimeSeconds: 0,
      phase: "input_streaming",
      inputDeltaCount: 12,
      inputStreamingMs: 4250,
    },
  );
});

test("preserves tool_progress tool_call_id before InternShannon pairs streaming updates", () => {
  assert.deepEqual(
    normalizeToolProgressSocketPayload({
      tool_call_id: "call-legacy-tool-1",
      toolName: "Read",
      elapsedMs: "1250",
    }),
    {
      toolUseId: "call-legacy-tool-1",
      toolName: "Read",
      elapsedTimeSeconds: 1.25,
    },
  );
});

test("trims direct tool_progress ids before InternShannon pairs streaming updates", () => {
  assert.deepEqual(
    normalizeToolProgressSocketPayload({
      tool_call_id: " call-legacy-tool-2 ",
      toolName: "Read",
      elapsedMs: "1500",
    }),
    {
      toolUseId: "call-legacy-tool-2",
      toolName: "Read",
      elapsedTimeSeconds: 1.5,
    },
  );
});

test("ignores blank direct tool_progress ids before InternShannon pairs streaming updates", () => {
  assert.deepEqual(
    normalizeToolProgressSocketPayload({
      toolUseId: "   ",
      tool_call_id: "call-direct-tool-3",
      toolName: "Read",
      elapsedMs: "1500",
    }),
    {
      toolUseId: "call-direct-tool-3",
      toolName: "Read",
      elapsedTimeSeconds: 1.5,
    },
  );
});

test("ignores blank direct tool_progress names before InternShannon renders progress labels", () => {
  assert.deepEqual(
    normalizeToolProgressSocketPayload({
      toolUseId: "call-direct-tool-4",
      toolName: "   ",
      tool_name: " Read ",
      elapsedMs: "1500",
    }),
    {
      toolUseId: "call-direct-tool-4",
      toolName: "Read",
      elapsedTimeSeconds: 1.5,
    },
  );
});

test("preserves direct tool_progress tool aliases before InternShannon renders progress labels", () => {
  assert.deepEqual(
    normalizeToolProgressSocketPayload({
      tool_call_id: "call-direct-tool-5",
      tool: " Read ",
      elapsedMs: "1500",
    }),
    {
      toolUseId: "call-direct-tool-5",
      toolName: "Read",
      elapsedTimeSeconds: 1.5,
    },
  );
});

test("normalizes tool_progress input and output aliases before InternShannon renders tool progress", () => {
  assert.deepEqual(
    normalizeToolProgressSocketPayload({
      toolId: "tool-2",
      toolName: "Read",
      elapsedTimeSeconds: 3,
      tool_input: { path: "AGENTS.md" },
      toolOutput: { bytes: 128 },
    }),
    {
      toolUseId: "tool-2",
      toolName: "Read",
      elapsedTimeSeconds: 3,
      input: JSON.stringify({ path: "AGENTS.md" }, null, 2),
      output: JSON.stringify({ bytes: 128 }, null, 2),
    },
  );
});

test("preserves direct tool_progress result aliases before InternShannon renders active tool output", () => {
  assert.deepEqual(
    normalizeToolProgressSocketPayload({
      tool_call_id: "call-direct-progress-result",
      tool_name: " Read ",
      elapsed_time_seconds: "2",
      result: "partial output from direct result alias",
    }),
    {
      toolUseId: "call-direct-progress-result",
      toolName: "Read",
      elapsedTimeSeconds: 2,
      output: "partial output from direct result alias",
    },
  );
});

test("ignores blank direct tool_progress aliases before InternShannon renders active tool output", () => {
  assert.deepEqual(
    normalizeToolProgressSocketPayload({
      tool_call_id: "call-direct-progress-blank-alias",
      tool_name: " Read ",
      elapsedTimeSeconds: "   ",
      elapsed_time_seconds: "2.75",
      output: "   ",
      result: "partial output from fallback result alias",
    }),
    {
      toolUseId: "call-direct-progress-blank-alias",
      toolName: "Read",
      elapsedTimeSeconds: 2.75,
      output: "partial output from fallback result alias",
    },
  );
});

test("drops tool_progress payloads without a usable tool name", () => {
  assert.equal(normalizeToolProgressSocketPayload({ toolUseId: "tool-1", toolName: null }), null);
  assert.equal(normalizeToolProgressSocketPayload(null), null);
});
