import * as assert from "node:assert/strict";
import { test } from "node:test";
import { normalizeInternShannonMemoryTimelineItems } from "./internShannon-memory-timeline-record.ts";

test("drops malformed memory timeline records that cannot render conversation details", () => {
  const items = normalizeInternShannonMemoryTimelineItems([
    {
      id: "legacy-without-conversation",
      sessionId: "session-1",
      layer: "resource",
      action: "stored",
      content: "旧版记录",
      originalContent: "旧版记录",
      createdAt: 1_000,
    },
    {
      id: "valid",
      sessionId: "session-1",
      layer: "resource",
      action: "stored",
      content: "可渲染记录",
      originalContent: "可渲染记录",
      conversation: {
        sessionId: "session-1",
        messageId: "message-1",
        role: "user",
        preview: "请记住这个口径",
        timestamp: 900,
      },
      createdAt: 900,
    },
  ]);

  assert.deepEqual(
    items.map((item) => item.id),
    ["valid"],
  );
});

test("recovers legacy memory timeline records that predate originalContent", () => {
  const items = normalizeInternShannonMemoryTimelineItems([
    {
      id: "legacy-with-content-only",
      sessionId: "session-1",
      layer: "insight",
      action: "stored",
      content: "用户偏好先看测试结果",
      conversation: {
        sessionId: "session-1",
        messageId: "message-1",
        role: "user",
        preview: "请记住我的偏好",
        timestamp: 900,
      },
      createdAt: 1_000,
    },
  ]);

  assert.equal(items[0]?.id, "legacy-with-content-only");
  assert.equal(items[0]?.content, "用户偏好先看测试结果");
  assert.equal(items[0]?.originalContent, "用户偏好先看测试结果");
});

test("recovers legacy snake_case original content before InternShannon deduplicates edited memories", () => {
  const items = normalizeInternShannonMemoryTimelineItems([
    {
      id: "legacy-edited-original-content",
      sessionId: "session-1",
      layer: "insight",
      action: "stored",
      content: "用户偏好先写测试再小步提交",
      original_content: "用户偏好小步提交",
      conversation: {
        sessionId: "session-1",
      },
      createdAt: 1_050,
    },
  ]);

  assert.equal(items[0]?.content, "用户偏好先写测试再小步提交");
  assert.equal(items[0]?.originalContent, "用户偏好小步提交");
});

test("recovers legacy memory timeline records with snake_case conversation refs", () => {
  const items = normalizeInternShannonMemoryTimelineItems([
    {
      id: "legacy-snake-conversation",
      sessionId: "session-1",
      layer: "resource",
      action: "stored",
      content: "用户希望保留对话来源",
      originalContent: "用户希望保留对话来源",
      conversation: {
        session_id: "session-1",
        session_name: "旧版会话",
        message_id: "message-1",
        role: "user",
        preview: "请记住这个来源",
        timestamp: 900,
      },
      createdAt: 1_000,
    },
  ]);

  assert.equal(items[0]?.id, "legacy-snake-conversation");
  assert.deepEqual(items[0]?.conversation, {
    sessionId: "session-1",
    sessionName: "旧版会话",
    messageId: "message-1",
    role: "user",
    preview: "请记住这个来源",
    timestamp: 900,
  });
});

test("trims legacy conversation refs before InternShannon memory timeline focuses source messages", () => {
  const items = normalizeInternShannonMemoryTimelineItems([
    {
      id: "legacy-spaced-conversation",
      sessionId: "session-1",
      layer: "resource",
      action: "stored",
      content: "用户希望定位到来源消息",
      originalContent: "用户希望定位到来源消息",
      conversation: {
        session_id: " session-1 ",
        session_name: " 资金测算 ",
        message_id: " user-before ",
        role: "user",
        preview: "请记住这个来源",
        timestamp: 900,
      },
      createdAt: 1_000,
    },
  ]);

  assert.deepEqual(items[0]?.conversation, {
    sessionId: "session-1",
    sessionName: "资金测算",
    messageId: "user-before",
    role: "user",
    preview: "请记住这个来源",
    timestamp: 900,
  });
});

test("trims legacy top-level session ids before InternShannon deduplicates memory history", () => {
  const items = normalizeInternShannonMemoryTimelineItems([
    {
      id: "legacy-spaced-session",
      sessionId: " session-1 ",
      layer: "resource",
      action: "stored",
      content: "用户希望旧版记忆也能和服务端记录去重",
      originalContent: "用户希望旧版记忆也能和服务端记录去重",
      conversation: {
        sessionId: " session-1 ",
      },
      createdAt: 1_000,
    },
  ]);

  assert.equal(items[0]?.sessionId, "session-1");
  assert.equal(items[0]?.conversation.sessionId, "session-1");
});

test("normalizes legacy conversation timestamp strings before InternShannon renders source times", () => {
  const items = normalizeInternShannonMemoryTimelineItems([
    {
      id: "legacy-conversation-timestamp",
      sessionId: "session-1",
      layer: "resource",
      action: "stored",
      content: "用户希望保留对话来源时间",
      originalContent: "用户希望保留对话来源时间",
      conversation: {
        sessionId: "session-1",
        messageId: "message-1",
        role: "user",
        preview: "请记住这个来源时间",
        timestamp: "1700000000000",
      },
      createdAt: 1_000,
    },
  ]);

  assert.equal(items[0]?.conversation.timestamp, 1_700_000_000_000);
});

test("drops malformed direct conversation refs before InternShannon focuses source messages", () => {
  const items = normalizeInternShannonMemoryTimelineItems([
    {
      id: "legacy-malformed-direct-conversation",
      sessionId: "session-1",
      layer: "resource",
      action: "stored",
      content: "用户希望坏的来源消息字段不会破坏定位",
      originalContent: "用户希望坏的来源消息字段不会破坏定位",
      conversation: {
        sessionId: "session-1",
        sessionName: 123,
        messageId: 456,
        role: "user",
        preview: "请记住这个来源",
        timestamp: "1700000000000",
      },
      createdAt: 1_000,
    },
  ]);

  assert.deepEqual(items[0]?.conversation, {
    sessionId: "session-1",
    role: "user",
    preview: "请记住这个来源",
    timestamp: 1_700_000_000_000,
  });
});

test("normalizes snake_case memory timeline tombstones before InternShannon filters deleted records", () => {
  const items = normalizeInternShannonMemoryTimelineItems([
    {
      id: "deleted",
      sessionId: "session-1",
      layer: "resource",
      action: "stored",
      content: "已删除的旧版记录",
      originalContent: "旧版记录",
      conversation: {
        sessionId: "session-1",
        messageId: "message-1",
        role: "user",
        preview: "请记住这个口径",
        timestamp: 900,
      },
      createdAt: 900,
      updated_at: 1_100,
      deleted_at: 1_200,
    },
  ]);

  assert.equal(items[0]?.updatedAt, 1_100);
  assert.equal(items[0]?.deletedAt, 1_200);
});

test("normalizes numeric-string memory timeline timestamps before InternShannon sorts history", () => {
  const items = normalizeInternShannonMemoryTimelineItems([
    {
      id: "numeric-string-timestamps",
      sessionId: "session-1",
      layer: "artifact",
      action: "stored",
      content: "用户希望保留字符串时间戳记录",
      originalContent: "用户希望保留字符串时间戳记录",
      conversation: {
        sessionId: "session-1",
      },
      createdAt: "1700000000000",
      updated_at: "1700000000100",
      deleted_at: "1700000000200",
    },
  ]);

  assert.equal(items[0]?.id, "numeric-string-timestamps");
  assert.equal(items[0]?.createdAt, 1_700_000_000_000);
  assert.equal(items[0]?.updatedAt, 1_700_000_000_100);
  assert.equal(items[0]?.deletedAt, 1_700_000_000_200);
});

test("normalizes legacy memory metadata aliases before InternShannon deduplicates history", () => {
  const items = normalizeInternShannonMemoryTimelineItems([
    {
      id: "legacy-memory-metadata",
      sessionId: "session-1",
      layer: "artifact",
      action: "recalled",
      content: "召回了 5 条相关记忆",
      originalContent: "召回了 5 条相关记忆",
      conversation: {
        sessionId: "session-1",
      },
      createdAt: 1_300,
      memory_id: "memory-legacy-1",
      memory_type: "semantic",
      result_count: "5",
    },
  ]);

  assert.equal(items[0]?.memoryId, "memory-legacy-1");
  assert.equal(items[0]?.memoryType, "semantic");
  assert.equal(items[0]?.resultCount, 5);
});

test("normalizes legacy memory score strings before InternShannon renders history", () => {
  const items = normalizeInternShannonMemoryTimelineItems([
    {
      id: "legacy-memory-score",
      sessionId: "session-1",
      layer: "insight",
      action: "recalled",
      content: "用户希望InternShannon保留重要性和相关性分数",
      originalContent: "用户希望InternShannon保留重要性和相关性分数",
      conversation: {
        sessionId: "session-1",
      },
      createdAt: 1_350,
      importance: "0.88",
      relevance: "0.74",
    },
  ]);

  assert.equal(items[0]?.importance, 0.88);
  assert.equal(items[0]?.relevance, 0.74);
});

test("normalizes snake_case memory timeline creation timestamps before InternShannon sorts history", () => {
  const items = normalizeInternShannonMemoryTimelineItems([
    {
      id: "newer",
      sessionId: "session-1",
      layer: "resource",
      action: "stored",
      content: "新版记录",
      originalContent: "新版记录",
      conversation: {
        sessionId: "session-1",
      },
      createdAt: 1_000,
    },
    {
      id: "legacy-created-at",
      sessionId: "session-1",
      layer: "resource",
      action: "stored",
      content: "旧版记录",
      originalContent: "旧版记录",
      conversation: {
        sessionId: "session-1",
      },
      created_at: 1_200,
    },
  ]);

  assert.deepEqual(
    items.map((item) => [item.id, item.createdAt]),
    [
      ["legacy-created-at", 1_200],
      ["newer", 1_000],
    ],
  );
});
