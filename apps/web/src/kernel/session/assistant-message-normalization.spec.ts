import * as assert from "node:assert/strict";
import { test } from "node:test";
import { normalizeAssistantSocketMessage } from "./assistant-message-normalization.ts";

test("normalizes legacy live assistant string content", () => {
  assert.deepEqual(
    normalizeAssistantSocketMessage(
      {
        content: "legacy live answer",
        duration_ms: 42,
        stop_reason: "end_turn",
        meta: { provider: "local" },
      },
      "assistant-fallback",
    ),
    {
      id: "assistant-fallback",
      contentBlocks: [{ type: "text", text: "legacy live answer" }],
      model: undefined,
      stopReason: "end_turn",
      durationMs: 42,
      meta: { provider: "local" },
      usage: undefined,
    },
  );
});

test("normalizes legacy live assistant duration strings", () => {
  assert.equal(
    normalizeAssistantSocketMessage(
      {
        content: "legacy live answer",
        duration_ms: "42",
      },
      "assistant-fallback",
    )?.durationMs,
    42,
  );
});

test("trims legacy live assistant ids before InternShannon reuses socket history", () => {
  assert.equal(
    normalizeAssistantSocketMessage(
      {
        id: " assistant-live ",
        content: "legacy live answer with a spaced id",
      },
      "assistant-fallback",
    )?.id,
    "assistant-live",
  );
});

test("repairs sparse live assistant content blocks", () => {
  assert.deepEqual(
    normalizeAssistantSocketMessage(
      {
        id: "assistant-1",
        model: "provider/model",
        content: [
          null,
          { type: "thinking", thinking: "internal" },
          { type: "text", content: "visible answer" },
          { type: "tool_use", id: null, name: null, input: "path:README.md" },
          { type: "tool_result", content: null, is_error: "yes" },
        ],
        usage: { inputTokens: 1 },
      },
      "assistant-fallback",
    ),
    {
      id: "assistant-1",
      contentBlocks: [
        { type: "text", text: "visible answer" },
        { type: "tool_use", id: "tool-3", name: "tool", input: { __display: "path:README.md" } },
        { type: "tool_result", toolUseId: "tool-3", content: "", isError: true },
      ],
      model: "provider/model",
      stopReason: null,
      durationMs: undefined,
      meta: undefined,
      usage: { inputTokens: 1 },
    },
  );
});

test("keeps live assistant content_blocks when legacy content is empty", () => {
  assert.deepEqual(
    normalizeAssistantSocketMessage(
      {
        id: "assistant-blocks",
        content: "",
        content_blocks: [{ type: "text", text: "answer from legacy blocks" }],
      },
      "assistant-fallback",
    ),
    {
      id: "assistant-blocks",
      contentBlocks: [{ type: "text", text: "answer from legacy blocks" }],
      model: undefined,
      stopReason: null,
      durationMs: undefined,
      meta: undefined,
      usage: undefined,
    },
  );
});

test("ignores malformed live assistant messages", () => {
  assert.equal(normalizeAssistantSocketMessage(null, "assistant-fallback"), null);
  assert.equal(normalizeAssistantSocketMessage("legacy answer without message object", "assistant-fallback"), null);
});
