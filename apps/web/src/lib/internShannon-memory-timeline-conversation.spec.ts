import * as assert from "node:assert/strict";
import { test } from "node:test";
import { resolveInternShannonMemoryConversationRef } from "./internShannon-memory-timeline-conversation.ts";
import type { AgentChatMessage } from "./types.ts";

function message(input: Pick<AgentChatMessage, "id" | "role" | "content" | "timestamp">): AgentChatMessage {
  return input;
}

test("links memory events to the latest user message at or before the event time", () => {
  const conversation = resolveInternShannonMemoryConversationRef({
    sessionId: "session-1",
    sessionName: "资金测算",
    timestamp: 1_000,
    messages: [
      message({ id: "user-before", role: "user", content: "请记住项目口径", timestamp: 900 }),
      message({ id: "assistant-before", role: "assistant", content: "已经记录", timestamp: 950 }),
      message({ id: "user-after", role: "user", content: "下一轮问题", timestamp: 1_100 }),
    ],
  });

  assert.equal(conversation.sessionId, "session-1");
  assert.equal(conversation.sessionName, "资金测算");
  assert.equal(conversation.messageId, "user-before");
  assert.equal(conversation.role, "user");
  assert.equal(conversation.preview, "请记住项目口径");
  assert.equal(conversation.timestamp, 900);
});

test("trims live session names before InternShannon renders memory source headers", () => {
  const conversation = resolveInternShannonMemoryConversationRef({
    sessionId: "session-1",
    sessionName: " 资金测算 ",
    timestamp: 1_000,
    messages: [message({ id: "user-before", role: "user", content: "请记住项目口径", timestamp: 900 })],
  });

  assert.equal(conversation.sessionName, "资金测算");
});

test("links memory events to the nearest future user message when no past message exists", () => {
  const conversation = resolveInternShannonMemoryConversationRef({
    sessionId: "session-1",
    timestamp: 1_000,
    messages: [
      message({ id: "assistant-near", role: "assistant", content: "我准备好了", timestamp: 1_500 }),
      message({ id: "user-near", role: "user", content: "第一条需求", timestamp: 2_000 }),
      message({ id: "user-later", role: "user", content: "后续补充", timestamp: 9_000 }),
    ],
  });

  assert.equal(conversation.messageId, "user-near");
  assert.equal(conversation.role, "user");
  assert.equal(conversation.preview, "第一条需求");
  assert.equal(conversation.timestamp, 2_000);
});

test("links memory events to a near future user message when only past assistant messages exist", () => {
  const conversation = resolveInternShannonMemoryConversationRef({
    sessionId: "session-1",
    timestamp: 1_000,
    messages: [
      message({ id: "assistant-before", role: "assistant", content: "我准备好了", timestamp: 900 }),
      message({ id: "user-near", role: "user", content: "第一条需求", timestamp: 2_000 }),
      message({ id: "user-later", role: "user", content: "后续补充", timestamp: 9_000 }),
    ],
  });

  assert.equal(conversation.messageId, "user-near");
  assert.equal(conversation.role, "user");
  assert.equal(conversation.preview, "第一条需求");
  assert.equal(conversation.timestamp, 2_000);
});

test("previews text content blocks before InternShannon renders memory conversation details", () => {
  const conversation = resolveInternShannonMemoryConversationRef({
    sessionId: "session-1",
    timestamp: 1_000,
    messages: [
      {
        id: "user-content-blocks",
        role: "user",
        content: "",
        contentBlocks: [{ type: "text", text: "请记住我希望先看测试结果" }],
        timestamp: 900,
      },
    ],
  });

  assert.equal(conversation.messageId, "user-content-blocks");
  assert.equal(conversation.role, "user");
  assert.equal(conversation.preview, "请记住我希望先看测试结果");
});

test("previews legacy content block text before InternShannon renders memory conversation details", () => {
  const conversation = resolveInternShannonMemoryConversationRef({
    sessionId: "session-1",
    timestamp: 1_000,
    messages: [
      {
        id: "user-legacy-content-block",
        role: "user",
        content: "",
        contentBlocks: [{ type: "text", content: "请记住旧版文本块里的来源" }],
        timestamp: 900,
      } as unknown as AgentChatMessage,
    ],
  });

  assert.equal(conversation.messageId, "user-legacy-content-block");
  assert.equal(conversation.role, "user");
  assert.equal(conversation.preview, "请记住旧版文本块里的来源");
});

test("previews untyped legacy content block text before InternShannon renders memory conversation details", () => {
  const conversation = resolveInternShannonMemoryConversationRef({
    sessionId: "session-1",
    timestamp: 1_000,
    messages: [
      {
        id: "user-untyped-content-block",
        role: "user",
        content: "",
        contentBlocks: [{ content: "请记住没有 type 的旧版文本块" }],
        timestamp: 900,
      } as unknown as AgentChatMessage,
    ],
  });

  assert.equal(conversation.messageId, "user-untyped-content-block");
  assert.equal(conversation.role, "user");
  assert.equal(conversation.preview, "请记住没有 type 的旧版文本块");
});
