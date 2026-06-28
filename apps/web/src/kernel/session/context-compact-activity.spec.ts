import * as assert from "node:assert/strict";
import { test } from "node:test";
import { normalizeContextCompactActivity } from "./context-compact-activity.ts";

test("normalizes legacy context_compacted aliases before InternShannon renders compression summaries", () => {
  assert.deepEqual(
    normalizeContextCompactActivity(
      {
        type: "context_compacted",
        before: "24",
        after: "9",
        operation: "summarize",
      },
      { timestamp: 6_000 },
    ),
    {
      id: "context_compacted:6000",
      kind: "main_agent",
      status: "completed",
      phase: "context_compact",
      label: "上下文已压缩 24 → 9 条消息",
      detail: "summarize",
      source: "上下文管理",
      timestamp: 6_000,
    },
  );
});

test("summarizes percent-only context compaction before InternShannon renders activity", () => {
  assert.deepEqual(
    normalizeContextCompactActivity(
      {
        type: "context_compacted",
        percent_before: "0.82",
        operation: "auto_compact",
      },
      { timestamp: 6_100 },
    ),
    {
      id: "context_compacted:6100",
      kind: "main_agent",
      status: "completed",
      phase: "context_compact",
      label: "上下文已压缩至 82%",
      detail: "auto_compact",
      source: "上下文管理",
      timestamp: 6_100,
    },
  );
});

test("trims context compaction operation before InternShannon renders activity detail", () => {
  assert.deepEqual(
    normalizeContextCompactActivity(
      {
        type: "context_compacted",
        before_messages: "30",
        after_messages: "12",
        operation: " summarize ",
      },
      { timestamp: 6_200 },
    ),
    {
      id: "context_compacted:6200",
      kind: "main_agent",
      status: "completed",
      phase: "context_compact",
      label: "上下文已压缩 30 → 12 条消息",
      detail: "summarize",
      source: "上下文管理",
      timestamp: 6_200,
    },
  );
});

test("ignores blank context compaction aliases before InternShannon renders activity detail", () => {
  assert.deepEqual(
    normalizeContextCompactActivity(
      {
        type: "context_compacted",
        beforeMessages: "   ",
        before_messages: "42",
        afterMessages: "   ",
        after_messages: "18",
        percentBefore: "   ",
        percent_before: "0.43",
        operation: " summarize ",
      },
      { timestamp: 6_300 },
    ),
    {
      id: "context_compacted:6300",
      kind: "main_agent",
      status: "completed",
      phase: "context_compact",
      label: "上下文已压缩 42 → 18 条消息",
      detail: "summarize",
      source: "上下文管理",
      timestamp: 6_300,
    },
  );
});
