import * as assert from "node:assert/strict";
import { test } from "node:test";
import { createInternShannonMemoryTimelineItem } from "./internShannon-memory-timeline-item.ts";

test("describes memory clear events without exposing internal memory ids as content", () => {
  const item = createInternShannonMemoryTimelineItem({
    sessionId: "session-1",
    sessionName: "资金测算",
    event: {
      type: "memory_cleared",
      memoryId: "memory-internal-id",
      memoryType: "semantic",
    },
    now: 1_000,
  });

  assert.ok(item);
  assert.equal(item.action, "cleared");
  assert.equal(item.memoryId, "memory-internal-id");
  assert.equal(item.content, "清理了一条记忆");
  assert.equal(item.originalContent, "清理了一条记忆");
});

test("summarizes memory recall counts before falling back to internal memory ids", () => {
  const item = createInternShannonMemoryTimelineItem({
    sessionId: "session-1",
    event: {
      type: "memory_recalled",
      memoryId: "memory-internal-id",
      memoryKey: "internShannon.preference.commit-style",
      memoryType: "semantic",
      resultCount: 3,
      scope: "session",
    },
    now: 1_100,
  });

  assert.ok(item);
  assert.equal(item.action, "recalled");
  assert.equal(item.memoryId, "memory-internal-id");
  assert.equal(item.resultCount, 3);
  assert.equal(item.content, "召回了 3 条相关记忆");
});

test("describes memory recall events without content as recalls", () => {
  const item = createInternShannonMemoryTimelineItem({
    sessionId: "session-1",
    event: {
      type: "memory_recalled",
      memoryType: "semantic",
    },
    now: 1_150,
  });

  assert.ok(item);
  assert.equal(item.action, "recalled");
  assert.equal(item.content, "召回了一条相关记忆");
  assert.equal(item.originalContent, "召回了一条相关记忆");
});

test("derives memory recall counts from recalled memory arrays", () => {
  const item = createInternShannonMemoryTimelineItem({
    sessionId: "session-1",
    event: {
      type: "memory_recalled",
      memoryType: "semantic",
      memories: [
        { id: "memory-1", content: "用户偏好小步提交" },
        { id: "memory-2", content: "用户希望中文总结" },
      ],
    },
    now: 1_180,
  });

  assert.ok(item);
  assert.equal(item.action, "recalled");
  assert.equal(item.resultCount, 2);
  assert.equal(item.content, "召回了 2 条相关记忆");
});

test("derives memory recall counts from nested memory objects", () => {
  const item = createInternShannonMemoryTimelineItem({
    sessionId: "session-1",
    event: {
      type: "memory_recalled",
      memoryType: "semantic",
      memory: {
        result_count: 4,
      },
    },
    now: 1_185,
  });

  assert.ok(item);
  assert.equal(item.action, "recalled");
  assert.equal(item.resultCount, 4);
  assert.equal(item.content, "召回了 4 条相关记忆");
});

test("normalizes string memory recall counts before rendering InternShannon timeline items", () => {
  const item = createInternShannonMemoryTimelineItem({
    sessionId: "session-1",
    event: {
      type: "memory_recalled",
      memoryType: "semantic",
      result_count: "5",
    },
    now: 1_187,
  });

  assert.ok(item);
  assert.equal(item.resultCount, 5);
  assert.equal(item.content, "召回了 5 条相关记忆");
});

test("uses stream event timestamps before InternShannon links memory events to conversations", () => {
  const item = createInternShannonMemoryTimelineItem({
    sessionId: "session-1",
    sessionName: "测试会话",
    event: {
      type: "memory_stored",
      memoryType: "profile",
      content: "用户希望记忆事件按流式事件时间定位来源消息",
      timestamp: 2_000,
    },
    messages: [
      { id: "user-at-event", role: "user", content: "请记住这个偏好", timestamp: 1_900 },
      { id: "user-later", role: "user", content: "后续不相关问题", timestamp: 5_000 },
    ],
  });

  assert.ok(item);
  assert.equal(item.createdAt, 2_000);
  assert.equal(item.conversation.messageId, "user-at-event");
  assert.equal(item.conversation.preview, "请记住这个偏好");
});

test("preserves legacy memory keys as InternShannon timeline memory ids", () => {
  const item = createInternShannonMemoryTimelineItem({
    sessionId: "session-1",
    event: {
      type: "memory_stored",
      key: "internShannon.preference.commit-style",
      layer: "insight",
    },
    now: 1_190,
  });

  assert.ok(item);
  assert.equal(item.action, "stored");
  assert.equal(item.memoryId, "internShannon.preference.commit-style");
  assert.equal(item.content, "internShannon.preference.commit-style");
  assert.equal(item.layer, "insight");
});

test("preserves nested memory object metadata for InternShannon timeline items", () => {
  const item = createInternShannonMemoryTimelineItem({
    sessionId: "session-1",
    event: {
      type: "memory_stored",
      memory: {
        id: "memory-nested-1",
        type: "profile",
        content: "用户偏好先看测试结果再看实现说明",
      },
      importance: 0.76,
    },
    now: 1_195,
  });

  assert.ok(item);
  assert.equal(item.memoryId, "memory-nested-1");
  assert.equal(item.memoryType, "profile");
  assert.equal(item.layer, "insight");
  assert.equal(item.content, "用户偏好先看测试结果再看实现说明");
});

test("preserves memory detail aliases before InternShannon renders timeline items", () => {
  const item = createInternShannonMemoryTimelineItem({
    sessionId: "session-1",
    event: {
      type: "memory_stored",
      memoryId: "memory-detail-1",
      memoryType: "profile",
      detail: "用户偏好先看测试结果再看实现说明",
    },
    now: 1_195,
  });

  assert.ok(item);
  assert.equal(item.memoryId, "memory-detail-1");
  assert.equal(item.content, "用户偏好先看测试结果再看实现说明");
});

test("preserves nested memory typeLabel aliases for InternShannon timeline items", () => {
  const item = createInternShannonMemoryTimelineItem({
    sessionId: "session-1",
    event: {
      type: "memory_stored",
      memory: {
        id: "memory-nested-label-1",
        typeLabel: "洞察层",
        content: "用户长期偏好先拆小步再提交",
      },
    },
    now: 1_196,
  });

  assert.ok(item);
  assert.equal(item.memoryId, "memory-nested-label-1");
  assert.equal(item.memoryType, "洞察层");
  assert.equal(item.layer, "insight");
  assert.equal(item.content, "用户长期偏好先拆小步再提交");
});

test("preserves snake_case memory type labels for InternShannon timeline items", () => {
  const item = createInternShannonMemoryTimelineItem({
    sessionId: "session-1",
    event: {
      type: "memory_stored",
      memory: {
        id: "memory-snake-label-1",
        type_label: "洞察层",
        content: "用户长期偏好先拆小步再提交",
      },
    },
    now: 1_197,
  });

  assert.ok(item);
  assert.equal(item.memoryId, "memory-snake-label-1");
  assert.equal(item.memoryType, "洞察层");
  assert.equal(item.layer, "insight");
  assert.equal(item.content, "用户长期偏好先拆小步再提交");
});

test("preserves nested memory score metadata for InternShannon timeline items", () => {
  const item = createInternShannonMemoryTimelineItem({
    sessionId: "session-1",
    event: {
      type: "memory_recalled",
      memory: {
        id: "memory-score-1",
        type: "semantic",
        content: "用户希望InternShannon保留重要性和相关性分数",
        importance: 0.88,
        relevance: 0.74,
      },
    },
    now: 1_198,
  });

  assert.ok(item);
  assert.equal(item.memoryId, "memory-score-1");
  assert.equal(item.importance, 0.88);
  assert.equal(item.relevance, 0.74);
});

test("classifies Chinese memory layer labels before rendering InternShannon timeline items", () => {
  const item = createInternShannonMemoryTimelineItem({
    sessionId: "session-1",
    event: {
      type: "memory_stored",
      layer: "洞察层",
      content: "用户长期偏好先拆小步再提交",
    },
    now: 1_200,
  });

  assert.ok(item);
  assert.equal(item.memoryType, "洞察层");
  assert.equal(item.layer, "insight");
  assert.equal(item.content, "用户长期偏好先拆小步再提交");
});
