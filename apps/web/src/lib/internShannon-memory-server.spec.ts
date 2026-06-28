import * as assert from "node:assert/strict";
import { test } from "node:test";
import { mapServerMemoryToTimelineItem, mergeInternShannonMemoryTimeline } from "./internShannon-memory-server.ts";
import type { KernelMemoryItem } from "./agent-api.ts";
import type { InternShannonMemoryTimelineItem } from "./internShannon-memory-timeline-record.ts";

function memoryItem(overrides: Partial<InternShannonMemoryTimelineItem>): InternShannonMemoryTimelineItem {
  return {
    id: "memory",
    sessionId: "session-1",
    layer: "insight",
    action: "stored",
    content: "User prefers concise summaries",
    originalContent: "User prefers concise summaries",
    conversation: {
      sessionId: "session-1",
    },
    createdAt: 1_000,
    ...overrides,
  };
}

test("deduplicates local and server memory rows within the 10 second persistence window", () => {
  const localItem = memoryItem({
    id: "local",
    createdAt: 49_900,
    origin: "local",
  });
  const serverItem = memoryItem({
    id: "server",
    createdAt: 40_100,
    origin: "server",
  });

  const merged = mergeInternShannonMemoryTimeline([localItem], [serverItem]);

  assert.deepEqual(
    merged.map((item) => item.id),
    ["local"],
  );
});

test("keeps an edited local memory authoritative over its server snapshot", () => {
  const localItem = memoryItem({
    id: "local-edited",
    content: "Please keep summaries short and direct",
    originalContent: "User prefers concise summaries",
    createdAt: 49_900,
    updatedAt: 50_500,
    origin: "local",
  });
  const serverItem = memoryItem({
    id: "server-original",
    content: "User prefers concise summaries",
    originalContent: "User prefers concise summaries",
    createdAt: 40_100,
    origin: "server",
  });

  const merged = mergeInternShannonMemoryTimeline([localItem], [serverItem]);

  assert.deepEqual(
    merged.map((item) => item.id),
    ["local-edited"],
  );
});

test("deduplicates local and server memories after trimming server memory ids", () => {
  const localItem = memoryItem({
    id: "local-memory-id",
    memoryId: "memory-1",
    createdAt: 49_900,
    origin: "local",
  });
  const serverItem = mapServerMemoryToTimelineItem({
    id: "server-memory-id",
    sessionId: "session-1",
    layer: "insight",
    action: "stored",
    content: "User prefers concise summaries",
    memoryId: " memory-1 ",
    metadata: {},
    createdAt: "1970-01-01T00:00:40.100Z",
  } satisfies KernelMemoryItem);

  const merged = mergeInternShannonMemoryTimeline([localItem], [serverItem]);

  assert.deepEqual(
    merged.map((item) => item.id),
    ["local-memory-id"],
  );
});

test("deduplicates server memories that only carry legacy metadata memory ids", () => {
  const localItem = memoryItem({
    id: "local-metadata-memory-id",
    memoryId: "memory-1",
    createdAt: 49_900,
    origin: "local",
  });
  const serverItem = mapServerMemoryToTimelineItem({
    id: "server-metadata-memory-id",
    sessionId: "session-1",
    layer: "insight",
    action: "stored",
    content: "User prefers concise summaries",
    memoryId: null,
    metadata: {
      memory_id: " memory-1 ",
    },
    createdAt: "1970-01-01T00:00:40.100Z",
  } satisfies KernelMemoryItem);

  const merged = mergeInternShannonMemoryTimeline([localItem], [serverItem]);

  assert.equal(serverItem.memoryId, "memory-1");
  assert.deepEqual(
    merged.map((item) => item.id),
    ["local-metadata-memory-id"],
  );
});

test("deduplicates no-id memories after trimming server session ids", () => {
  const localItem = memoryItem({
    id: "local-session-trimmed",
    createdAt: 49_900,
    origin: "local",
  });
  const serverItem = mapServerMemoryToTimelineItem({
    id: "server-session-spaced",
    sessionId: " session-1 ",
    layer: "insight",
    action: "stored",
    content: "User prefers concise summaries",
    memoryId: null,
    metadata: {},
    createdAt: "1970-01-01T00:00:40.100Z",
  } satisfies KernelMemoryItem);

  const merged = mergeInternShannonMemoryTimeline([localItem], [serverItem]);

  assert.equal(serverItem.sessionId, "session-1");
  assert.equal(serverItem.conversation.sessionId, "session-1");
  assert.deepEqual(
    merged.map((item) => item.id),
    ["local-session-trimmed"],
  );
});

test("keeps matching no-id local and server memories from different sessions visible", () => {
  const localItem = memoryItem({
    id: "local-session-1",
    sessionId: "session-1",
    createdAt: 49_900,
    origin: "local",
  });
  const serverItem = memoryItem({
    id: "server-session-2",
    sessionId: "session-2",
    createdAt: 40_100,
    origin: "server",
  });

  const merged = mergeInternShannonMemoryTimeline([localItem], [serverItem]);

  assert.deepEqual(
    merged.map((item) => item.id),
    ["local-session-1", "server-session-2"],
  );
});

test("summarizes server recall counts when durable memory content is empty", () => {
  const item = mapServerMemoryToTimelineItem({
    id: "server-recall-1",
    sessionId: "session-1",
    layer: "artifact",
    action: "recalled",
    content: null,
    memoryId: null,
    metadata: {
      memoryType: "semantic",
      resultCount: 4,
    },
    createdAt: "2026-06-17T06:00:00.000Z",
  } satisfies KernelMemoryItem);

  assert.equal(item.content, "召回了 4 条相关记忆");
  assert.equal(item.originalContent, "召回了 4 条相关记忆");
  assert.equal(item.resultCount, 4);
});

test("preserves server memory summary metadata before rendering history", () => {
  const item = mapServerMemoryToTimelineItem({
    id: "server-store-summary-1",
    sessionId: "session-1",
    layer: "insight",
    action: "stored",
    content: null,
    memoryId: "memory-summary-1",
    metadata: {
      memoryType: "profile",
      summary: "用户偏好先看测试结果再看实现说明",
    },
    createdAt: "2026-06-17T06:02:00.000Z",
  } satisfies KernelMemoryItem);

  assert.equal(item.content, "用户偏好先看测试结果再看实现说明");
  assert.equal(item.originalContent, "用户偏好先看测试结果再看实现说明");
  assert.equal(item.memoryType, "profile");
});

test("preserves nested server memory content before rendering history", () => {
  const item = mapServerMemoryToTimelineItem({
    id: "server-store-nested-content-1",
    sessionId: "session-1",
    layer: "insight",
    action: "stored",
    content: null,
    memoryId: "memory-nested-content-1",
    metadata: {
      memory: {
        content: "用户希望InternShannon在历史记忆里显示嵌套内容",
      },
    },
    createdAt: "2026-06-17T06:02:30.000Z",
  } satisfies KernelMemoryItem);

  assert.equal(item.content, "用户希望InternShannon在历史记忆里显示嵌套内容");
  assert.equal(item.originalContent, "用户希望InternShannon在历史记忆里显示嵌套内容");
});

test("preserves server memory typeLabel metadata before rendering history", () => {
  const item = mapServerMemoryToTimelineItem({
    id: "server-store-1",
    sessionId: "session-1",
    layer: "insight",
    action: "stored",
    content: "用户长期偏好先拆小步再提交",
    memoryId: "memory-type-label-1",
    metadata: {
      typeLabel: "洞察层",
    },
    createdAt: "2026-06-17T06:03:00.000Z",
  } satisfies KernelMemoryItem);

  assert.equal(item.memoryId, "memory-type-label-1");
  assert.equal(item.memoryType, "洞察层");
  assert.equal(item.layer, "insight");
});

test("preserves snake_case server memory type labels before rendering history", () => {
  const item = mapServerMemoryToTimelineItem({
    id: "server-store-2",
    sessionId: "session-1",
    layer: "insight",
    action: "stored",
    content: "用户偏好小步提交",
    memoryId: "memory-type-label-2",
    metadata: {
      type_label: "洞察层",
    },
    createdAt: "2026-06-17T06:04:00.000Z",
  } satisfies KernelMemoryItem);

  assert.equal(item.memoryId, "memory-type-label-2");
  assert.equal(item.memoryType, "洞察层");
  assert.equal(item.layer, "insight");
});

test("normalizes numeric-string server memory metadata before rendering history", () => {
  const item = mapServerMemoryToTimelineItem({
    id: "server-recall-2",
    sessionId: "session-1",
    layer: "artifact",
    action: "recalled",
    content: null,
    memoryId: null,
    metadata: {
      result_count: "6",
      relevance: "0.82",
    },
    createdAt: "2026-06-17T06:05:00.000Z",
  } satisfies KernelMemoryItem);

  assert.equal(item.content, "召回了 6 条相关记忆");
  assert.equal(item.resultCount, 6);
  assert.equal(item.relevance, 0.82);
});
