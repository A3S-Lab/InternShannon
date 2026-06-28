import * as assert from "node:assert/strict";
import { test } from "node:test";
import {
  normalizeHistoryAssistantContentBlocks,
  normalizeHistoryAssistantMessageContentBlocks,
  normalizeHistoryFiniteNumber,
  normalizeHistoryResultErrorMessage,
  normalizeHistoryTimestamp,
  normalizeMessageHistoryItems,
} from "./history-message-normalization.ts";

test("filters malformed message_history payloads before replay", () => {
  assert.deepEqual(normalizeMessageHistoryItems(null), []);
  assert.deepEqual(
    normalizeMessageHistoryItems([
      null,
      {},
      { type: null },
      { type: "user_message", content: null },
      { type: "assistant", message: { content: "hello" } },
    ]).map((item) => item.type),
    ["user_message", "assistant"],
  );
});

test("normalizes legacy assistant history content without throwing", () => {
  assert.deepEqual(normalizeHistoryAssistantContentBlocks("legacy answer"), [
    { type: "text", text: "legacy answer" },
  ]);
  assert.deepEqual(normalizeHistoryAssistantContentBlocks(null), []);
  assert.deepEqual(normalizeHistoryAssistantContentBlocks({ type: "text", text: "not-an-array" }), []);
});

test("repairs sparse legacy assistant content blocks", () => {
  assert.deepEqual(
    normalizeHistoryAssistantContentBlocks([
      null,
      { type: "thinking", thinking: "internal" },
      { type: "text", text: null, content: "visible" },
      { type: "tool_use", id: null, name: null, input: null },
      { type: "tool_result", toolUseId: null, content: null, is_error: "true" },
    ]),
    [
      { type: "text", text: "visible" },
      { type: "tool_use", id: "tool-3", name: "tool", input: {} },
      { type: "tool_result", toolUseId: "tool-3", content: "", isError: true },
    ],
  );
});

test("trims legacy history tool ids before InternShannon pairs replayed tool results", () => {
  assert.deepEqual(
    normalizeHistoryAssistantContentBlocks([
      { type: "tool_use", id: " tool-1 ", name: " Bash ", input: { command: "pnpm test" } },
      { type: "tool_result", tool_use_id: "tool-1", content: "ok", is_error: "false" },
    ]),
    [
      { type: "tool_use", id: "tool-1", name: "Bash", input: { command: "pnpm test" } },
      { type: "tool_result", toolUseId: "tool-1", content: "ok", isError: false },
    ],
  );
});

test("preserves history tool_use id aliases before InternShannon pairs replayed tool results", () => {
  assert.deepEqual(
    normalizeHistoryAssistantContentBlocks([
      { type: "tool_use", tool_use_id: " call-read ", name: "Read", input: { path: "README.md" } },
      { type: "tool_result", tool_use_id: "call-read", content: "README contents" },
    ]),
    [
      { type: "tool_use", id: "call-read", name: "Read", input: { path: "README.md" } },
      { type: "tool_result", toolUseId: "call-read", content: "README contents", isError: undefined },
    ],
  );
});

test("preserves history tool_use input aliases before InternShannon replays tool parameters", () => {
  assert.deepEqual(
    normalizeHistoryAssistantContentBlocks([
      { type: "tool_use", id: "call-read", name: "Read", tool_input: { path: "README.md" } },
    ]),
    [{ type: "tool_use", id: "call-read", name: "Read", input: { path: "README.md" } }],
  );
});

test("ignores blank history tool_use input aliases before InternShannon replays tool parameters", () => {
  assert.deepEqual(
    normalizeHistoryAssistantContentBlocks([
      {
        type: "tool_use",
        id: "call-read",
        name: "Read",
        input: "   ",
        tool_input: { path: "README.md" },
      },
    ]),
    [{ type: "tool_use", id: "call-read", name: "Read", input: { path: "README.md" } }],
  );
});

test("preserves history tool_result tool_call_id before InternShannon pairs replayed tool results", () => {
  assert.deepEqual(
    normalizeHistoryAssistantContentBlocks([
      { type: "tool_use", id: "call-read", name: "Read", input: { path: "README.md" } },
      { type: "tool_use", id: "call-grep", name: "Grep", input: { pattern: "InternShannon" } },
      { type: "tool_result", tool_call_id: "call-read", content: "README contents" },
      { type: "tool_result", toolCallId: " call-grep ", content: "grep matches" },
    ]),
    [
      { type: "tool_use", id: "call-read", name: "Read", input: { path: "README.md" } },
      { type: "tool_use", id: "call-grep", name: "Grep", input: { pattern: "InternShannon" } },
      { type: "tool_result", toolUseId: "call-read", content: "README contents", isError: undefined },
      { type: "tool_result", toolUseId: "call-grep", content: "grep matches", isError: undefined },
    ],
  );
});

test("ignores blank history tool_result content aliases before InternShannon replays tool output", () => {
  assert.deepEqual(
    normalizeHistoryAssistantContentBlocks([
      { type: "tool_use", id: "call-read", name: "Read", input: { path: "README.md" } },
      {
        type: "tool_result",
        toolUseId: "call-read",
        content: "   ",
        output: "README contents from legacy output",
      },
    ]),
    [
      { type: "tool_use", id: "call-read", name: "Read", input: { path: "README.md" } },
      {
        type: "tool_result",
        toolUseId: "call-read",
        content: "README contents from legacy output",
        isError: undefined,
      },
    ],
  );
});

test("recovers legacy assistant text blocks that lost their type before InternShannon replays history", () => {
  assert.deepEqual(
    normalizeHistoryAssistantContentBlocks([
      { text: "visible answer without type" },
      { content: "second visible block without type" },
    ]),
    [
      { type: "text", text: "visible answer without type" },
      { type: "text", text: "second visible block without type" },
    ],
  );
});

test("prefers explicit assistant block fields when legacy content is empty", () => {
  assert.deepEqual(
    normalizeHistoryAssistantMessageContentBlocks({
      content: "",
      content_blocks: [{ type: "text", text: "kept from blocks" }],
    }),
    [{ type: "text", text: "kept from blocks" }],
  );
});

test("normalizes legacy result errors before InternShannon replays failed turns", () => {
  assert.equal(
    normalizeHistoryResultErrorMessage({
      is_error: "yes",
      result: { message: "tool failed after reconnect" },
    }),
    JSON.stringify({ message: "tool failed after reconnect" }, null, 2),
  );

  assert.equal(
    normalizeHistoryResultErrorMessage({
      isError: "true",
      error: "sidecar failed before reconnect",
    }),
    "sidecar failed before reconnect",
  );

  assert.equal(
    normalizeHistoryResultErrorMessage({
      is_error: "false",
      result: "ok",
    }),
    null,
  );
});

test("ignores blank history result aliases before InternShannon replays failed turns", () => {
  assert.equal(
    normalizeHistoryResultErrorMessage({
      is_error: true,
      result: "   ",
      error: "sidecar failed before history replay",
    }),
    "sidecar failed before history replay",
  );
});

test("normalizes legacy history timestamps before InternShannon replays message order", () => {
  assert.equal(normalizeHistoryTimestamp(1_700_000_000), 1_700_000_000_000);
  assert.equal(normalizeHistoryTimestamp("1700000000"), 1_700_000_000_000);
  assert.equal(normalizeHistoryTimestamp("1700000000000"), 1_700_000_000_000);
  assert.equal(normalizeHistoryTimestamp("2024-01-02T03:04:05.000Z"), 1_704_164_645_000);
  assert.equal(normalizeHistoryTimestamp("not-a-date"), null);
});

test("normalizes legacy finite numeric strings before InternShannon replays metrics", () => {
  assert.equal(normalizeHistoryFiniteNumber(42), 42);
  assert.equal(normalizeHistoryFiniteNumber("42"), 42);
  assert.equal(normalizeHistoryFiniteNumber(""), undefined);
  assert.equal(normalizeHistoryFiniteNumber("not-a-number"), undefined);
});
