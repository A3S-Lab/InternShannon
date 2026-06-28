import * as assert from "node:assert/strict";
import { test } from "node:test";
import { chatMessageToRich, normalizeAgentChatMessages } from "./types.ts";

test("normalizes legacy session history entries before AgentChat render", () => {
  const messages = normalizeAgentChatMessages([
    null,
    { type: "assistant", message: null },
    { id: "bad-role", role: "debug", content: "ignored", timestamp: 1 },
    {
      id: "user-1",
      role: "user",
      content: "hello",
      timestamp: 1_780_000_000_000,
    },
    {
      id: "assistant-1",
      role: "assistant",
      content: null,
      timestamp: null,
      contentBlocks: [
        null,
        { type: "thinking", thinking: "internal" },
        { type: "text", text: null },
        { type: "text", content: "visible answer" },
        { type: "tool_use", id: null, name: null, input: null },
        { type: "tool_result", toolUseId: null, content: null, isError: "yes" },
      ],
    },
  ]);

  assert.equal(messages.length, 2);
  assert.equal(messages[0]?.id, "user-1");
  assert.equal(messages[1]?.id, "assistant-1");
  assert.deepEqual(messages[1]?.contentBlocks, [
    { type: "text", text: "visible answer" },
    { type: "tool_use", id: "tool-4", name: "tool", input: {} },
    { type: "tool_result", toolUseId: "tool-4", content: "", isError: true },
  ]);
});

test("converts sanitized legacy content blocks without throwing", () => {
  const [message] = normalizeAgentChatMessages([
    {
      id: "assistant-1",
      role: "assistant",
      content: "",
      timestamp: 1_780_000_000_000,
      contentBlocks: [
        { type: "text", content: "visible answer" },
        { type: "tool_use", name: "bash", input: null },
        { type: "tool_result", content: null, isError: "true" },
      ],
    },
  ]);

  assert.ok(message);
  assert.doesNotThrow(() => chatMessageToRich(message));
  assert.deepEqual(chatMessageToRich(message).blocks, [
    { type: "text", content: "visible answer" },
    {
      type: "tool_call",
      tool: "bash",
      input: "{}",
      output: "",
      durationMs: undefined,
      isError: true,
    },
  ]);
});

test("strips leaked think-tag reasoning before AgentChat render", () => {
  const [message] = normalizeAgentChatMessages([
    {
      id: "assistant-think-leak",
      role: "assistant",
      content: "",
      timestamp: 1_780_000_000_000,
      contentBlocks: [
        {
          type: "text",
          text:
            "Still blocked. Let me inspect the hook rules before I continue.</think>我会继续用中文说明处理结果。",
        },
      ],
    },
  ]);

  assert.ok(message);
  assert.deepEqual(chatMessageToRich(message).blocks, [
    { type: "text", content: "我会继续用中文说明处理结果。" },
  ]);
});

test("preserves legacy assistant history string content for AgentChat render", () => {
  const [message] = normalizeAgentChatMessages([
    {
      type: "assistant",
      timestamp: "2026-06-05T00:00:00.000Z",
      message: {
        id: "assistant-legacy-string",
        model: "legacy-model",
        content: "legacy answer from an old session",
        stop_reason: "end_turn",
      },
    },
  ]);

  assert.ok(message);
  assert.equal(message.content, "legacy answer from an old session");
  assert.deepEqual(chatMessageToRich(message).blocks, [
    { type: "text", content: "legacy answer from an old session" },
  ]);
});

test("normalizes legacy numeric-string timestamps before AgentChat render", () => {
  const messages = normalizeAgentChatMessages([
    {
      id: "user-epoch-seconds",
      role: "user",
      content: "legacy numeric string timestamp",
      timestamp: "1700000000",
    },
    {
      type: "assistant",
      timestamp: "1700000000000",
      message: {
        id: "assistant-epoch-ms",
        content: "same moment in milliseconds",
      },
    },
  ]);

  assert.equal(messages[0]?.timestamp, 1_700_000_000_000);
  assert.equal(messages[1]?.timestamp, 1_700_000_000_000);
});

test("trims legacy message ids before InternShannon memory timeline focuses conversations", () => {
  const [message] = normalizeAgentChatMessages([
    {
      id: " user-before ",
      role: "user",
      content: "prompt linked from memory timeline",
      timestamp: 1_780_000_000_000,
    },
  ]);

  assert.equal(message?.id, "user-before");
});

test("normalizes camelCase usage totals before AgentChat transcript export", () => {
  const [message] = normalizeAgentChatMessages([
    {
      id: "assistant-usage",
      role: "assistant",
      content: "answer with usage",
      timestamp: 1_780_000_000_000,
      usage: { totalTokens: 123 },
    },
  ]);

  assert.ok(message);
  assert.equal(chatMessageToRich(message).usage?.total_tokens, 123);
});

test("normalizes legacy assistant duration before AgentChat transcript export", () => {
  const [message] = normalizeAgentChatMessages([
    {
      type: "assistant",
      timestamp: "2026-06-05T00:00:00.000Z",
      message: {
        id: "assistant-duration",
        content: "answer with duration",
        duration_ms: "42",
      },
    },
  ]);

  assert.ok(message);
  assert.equal(chatMessageToRich(message).durationMs, 42);
});

test("normalizes a legacy object-shaped message bucket instead of throwing during AgentChat render", () => {
  const messages = normalizeAgentChatMessages({
    "user-1": {
      id: "user-1",
      role: "user",
      content: "legacy object bucket prompt",
      timestamp: 1_780_000_000_000,
    },
    "assistant-1": {
      type: "assistant",
      timestamp: "2026-06-05T00:00:01.000Z",
      message: {
        id: "assistant-1",
        content: [{ type: "text", text: "legacy object bucket answer" }],
      },
    },
  });

  assert.equal(messages.length, 2);
  assert.equal(messages[0]?.content, "legacy object bucket prompt");
  assert.deepEqual(chatMessageToRich(messages[1]!).blocks, [
    { type: "text", content: "legacy object bucket answer" },
  ]);
});

test("recovers legacy assistant messages that stored content blocks in content", () => {
  const [message] = normalizeAgentChatMessages([
    {
      id: "assistant-content-blocks",
      role: "assistant",
      content: [
        { type: "text", text: "remembered block answer" },
        { type: "tool_use", id: "tool-1", name: "read_file", input: { path: "notes.md" } },
        { type: "tool_result", toolUseId: "tool-1", content: "ok" },
      ],
      timestamp: 1_780_000_000_000,
    },
  ]);

  assert.ok(message);
  assert.equal(message.content, "");
  assert.deepEqual(chatMessageToRich(message).blocks, [
    { type: "text", content: "remembered block answer" },
    {
      type: "tool_call",
      tool: "read_file",
      input: "{\n  \"path\": \"notes.md\"\n}",
      output: "ok",
      durationMs: undefined,
      isError: undefined,
    },
  ]);
});

test("trims legacy assistant tool ids before InternShannon pairs tool results", () => {
  const [message] = normalizeAgentChatMessages([
    {
      id: "assistant-spaced-tool-id",
      role: "assistant",
      content: [
        { type: "tool_use", id: " tool-1 ", name: " Bash ", input: { command: "pnpm test" } },
        { type: "tool_result", tool_use_id: "tool-1", content: "ok", is_error: "false" },
      ],
      timestamp: 1_780_000_000_000,
    },
  ]);

  assert.ok(message);
  assert.deepEqual(chatMessageToRich(message).blocks, [
    {
      type: "tool_call",
      tool: "Bash",
      input: "{\n  \"command\": \"pnpm test\"\n}",
      output: "ok",
      durationMs: undefined,
      isError: false,
    },
  ]);
});

test("preserves assistant tool_use id aliases before InternShannon renders paired tool results", () => {
  const [message] = normalizeAgentChatMessages([
    {
      id: "assistant-tool-use-alias-id",
      role: "assistant",
      content: [
        { type: "tool_use", tool_use_id: " call-read ", name: "Read", input: { path: "README.md" } },
        { type: "tool_result", tool_use_id: "call-read", content: "README contents" },
      ],
      timestamp: 1_780_000_000_000,
    },
  ]);

  assert.ok(message);
  assert.deepEqual(chatMessageToRich(message).blocks, [
    {
      type: "tool_call",
      tool: "Read",
      input: "{\n  \"path\": \"README.md\"\n}",
      output: "README contents",
      durationMs: undefined,
      isError: undefined,
    },
  ]);
});

test("preserves assistant tool_use input aliases before InternShannon renders tool parameters", () => {
  const [message] = normalizeAgentChatMessages([
    {
      id: "assistant-tool-use-input-alias",
      role: "assistant",
      content: [
        { type: "tool_use", id: "call-read", name: "Read", toolInput: { path: "README.md" } },
        { type: "tool_result", toolUseId: "call-read", content: "README contents" },
      ],
      timestamp: 1_780_000_000_000,
    },
  ]);

  assert.ok(message);
  assert.deepEqual(chatMessageToRich(message).blocks, [
    {
      type: "tool_call",
      tool: "Read",
      input: "{\n  \"path\": \"README.md\"\n}",
      output: "README contents",
      durationMs: undefined,
      isError: undefined,
    },
  ]);
});

test("ignores blank assistant tool_use input aliases before InternShannon renders tool parameters", () => {
  const [message] = normalizeAgentChatMessages([
    {
      id: "assistant-blank-tool-use-input-alias",
      role: "assistant",
      content: [
        {
          type: "tool_use",
          id: "call-read",
          name: "Read",
          input: "   ",
          tool_input: { path: "README.md" },
        },
        { type: "tool_result", toolUseId: "call-read", content: "README contents" },
      ],
      timestamp: 1_780_000_000_000,
    },
  ]);

  assert.ok(message);
  assert.deepEqual(chatMessageToRich(message).blocks, [
    {
      type: "tool_call",
      tool: "Read",
      input: "{\n  \"path\": \"README.md\"\n}",
      output: "README contents",
      durationMs: undefined,
      isError: undefined,
    },
  ]);
});

test("preserves assistant tool_result tool_call_id before InternShannon renders multiple tool results", () => {
  const [message] = normalizeAgentChatMessages([
    {
      id: "assistant-tool-call-id-results",
      role: "assistant",
      content: [
        { type: "tool_use", id: "call-read", name: "Read", input: { path: "README.md" } },
        { type: "tool_use", id: "call-grep", name: "Grep", input: { pattern: "InternShannon" } },
        { type: "tool_result", tool_call_id: "call-read", content: "README contents" },
        { type: "tool_result", toolCallId: " call-grep ", content: "grep matches" },
      ],
      timestamp: 1_780_000_000_000,
    },
  ]);

  assert.ok(message);
  assert.deepEqual(chatMessageToRich(message).blocks, [
    {
      type: "tool_call",
      tool: "Read",
      input: "{\n  \"path\": \"README.md\"\n}",
      output: "README contents",
      durationMs: undefined,
      isError: undefined,
    },
    {
      type: "tool_call",
      tool: "Grep",
      input: "{\n  \"pattern\": \"InternShannon\"\n}",
      output: "grep matches",
      durationMs: undefined,
      isError: undefined,
    },
  ]);
});

test("ignores blank assistant tool_result content aliases before InternShannon renders tool output", () => {
  const [message] = normalizeAgentChatMessages([
    {
      id: "assistant-blank-tool-result-content",
      role: "assistant",
      content: [
        { type: "tool_use", id: "call-read", name: "Read", input: { path: "README.md" } },
        {
          type: "tool_result",
          toolUseId: "call-read",
          content: "   ",
          output: "README contents from legacy output",
        },
      ],
      timestamp: 1_780_000_000_000,
    },
  ]);

  assert.ok(message);
  assert.deepEqual(chatMessageToRich(message).blocks, [
    {
      type: "tool_call",
      tool: "Read",
      input: "{\n  \"path\": \"README.md\"\n}",
      output: "README contents from legacy output",
      durationMs: undefined,
      isError: undefined,
    },
  ]);
});

test("renders nested tool result text blocks before InternShannon replays assistant history", () => {
  const [message] = normalizeAgentChatMessages([
    {
      id: "assistant-nested-tool-result",
      role: "assistant",
      content: [
        { type: "tool_use", id: "tool-1", name: "read_file", input: { path: "README.md" } },
        {
          type: "tool_result",
          toolUseId: "tool-1",
          content: [{ type: "text", text: "README contents from history replay" }],
        },
      ],
      timestamp: 1_780_000_000_000,
    },
  ]);

  assert.ok(message);
  assert.deepEqual(chatMessageToRich(message).blocks, [
    {
      type: "tool_call",
      tool: "read_file",
      input: "{\n  \"path\": \"README.md\"\n}",
      output: "README contents from history replay",
      durationMs: undefined,
      isError: undefined,
    },
  ]);
});

test("recovers legacy assistant text blocks that lost their type before AgentChat render", () => {
  const [message] = normalizeAgentChatMessages([
    {
      id: "assistant-untyped-content-block",
      role: "assistant",
      content: [{ text: "legacy visible answer without type" }],
      timestamp: 1_780_000_000_000,
    },
  ]);

  assert.ok(message);
  assert.deepEqual(chatMessageToRich(message).blocks, [
    { type: "text", content: "legacy visible answer without type" },
  ]);
});

test("prefers legacy assistant content_blocks when content is an empty string", () => {
  const [message] = normalizeAgentChatMessages([
    {
      type: "assistant",
      timestamp: "2026-06-05T00:00:01.000Z",
      message: {
        id: "assistant-empty-content",
        content: "",
        content_blocks: [{ type: "text", text: "answer kept in legacy blocks" }],
      },
    },
  ]);

  assert.ok(message);
  assert.equal(message.content, "");
  assert.deepEqual(chatMessageToRich(message).blocks, [
    { type: "text", content: "answer kept in legacy blocks" },
  ]);
});
