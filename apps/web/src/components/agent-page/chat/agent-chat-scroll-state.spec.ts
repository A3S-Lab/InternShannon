import * as assert from "node:assert/strict";
import { test } from "node:test";
import {
  resolveAgentChatHiddenNewMessageCount,
  resolveAgentChatMessageListRenderMode,
  resolveAgentChatScrollButtonPresentation,
  resolveAgentChatStreamingUiState,
} from "./agent-chat-scroll-state.ts";

test("does not track hidden new messages while the user is following the latest output", () => {
  assert.equal(
    resolveAgentChatHiddenNewMessageCount({
      previousMessageCount: 4,
      nextMessageCount: 6,
      currentHiddenNewMessageCount: 3,
      userScrolledUp: false,
    }),
    0,
  );
});

test("accumulates new completed messages while the user is scrolled up", () => {
  assert.equal(
    resolveAgentChatHiddenNewMessageCount({
      previousMessageCount: 4,
      nextMessageCount: 6,
      currentHiddenNewMessageCount: 1,
      userScrolledUp: true,
    }),
    3,
  );
});

test("clamps hidden new message count when messages are removed or cleared", () => {
  assert.equal(
    resolveAgentChatHiddenNewMessageCount({
      previousMessageCount: 8,
      nextMessageCount: 5,
      currentHiddenNewMessageCount: 7,
      userScrolledUp: true,
    }),
    5,
  );
  assert.equal(
    resolveAgentChatHiddenNewMessageCount({
      previousMessageCount: 8,
      nextMessageCount: 0,
      currentHiddenNewMessageCount: 7,
      userScrolledUp: true,
    }),
    0,
  );
});

test("formats the scroll-to-latest button label for hidden messages", () => {
  assert.deepEqual(resolveAgentChatScrollButtonPresentation({ hiddenNewMessageCount: 0 }), {
    label: "最新消息",
    ariaLabel: "滚动到最新消息",
  });
  assert.deepEqual(resolveAgentChatScrollButtonPresentation({ hiddenNewMessageCount: 3 }), {
    label: "3 条新消息",
    ariaLabel: "滚动到最新消息，3 条新消息",
  });
  assert.deepEqual(resolveAgentChatScrollButtonPresentation({ hiddenNewMessageCount: 120 }), {
    label: "99+ 条新消息",
    ariaLabel: "滚动到最新消息，99+ 条新消息",
  });
});

test("ignores idle empty streaming residue when deciding whether streaming UI exists", () => {
  assert.equal(
    resolveAgentChatStreamingUiState({
      streamingText: "",
      streamingSegmentCount: 0,
      isRunning: false,
      isCompacting: false,
    }),
    false,
  );
  assert.equal(
    resolveAgentChatStreamingUiState({
      streamingText: "",
      streamingSegmentCount: 0,
      isRunning: true,
      isCompacting: false,
    }),
    true,
  );
  assert.equal(
    resolveAgentChatStreamingUiState({
      streamingText: "partial",
      streamingSegmentCount: 0,
      isRunning: false,
      isCompacting: false,
    }),
    true,
  );
});

test("uses a static message list for ordinary desktop history sizes", () => {
  assert.equal(resolveAgentChatMessageListRenderMode({ messageCount: 0 }), "static");
  assert.equal(resolveAgentChatMessageListRenderMode({ messageCount: 12 }), "static");
  assert.equal(resolveAgentChatMessageListRenderMode({ messageCount: 200 }), "static");
  assert.equal(resolveAgentChatMessageListRenderMode({ messageCount: 201 }), "virtual");
});
