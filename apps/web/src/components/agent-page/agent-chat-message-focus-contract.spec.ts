import * as assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const source = readFileSync(fileURLToPath(new URL("./agent-chat.tsx", import.meta.url)), "utf8");
const messageItemSource = readFileSync(fileURLToPath(new URL("./chat/message-item.tsx", import.meta.url)), "utf8");
const agentPageSource = readFileSync(
  fileURLToPath(new URL("../../desktop/pages/agent/AgentPage.tsx", import.meta.url)),
  "utf8",
);
const knowledgePageSource = readFileSync(
  fileURLToPath(new URL("../../desktop/pages/knowledge/KnowledgePage.tsx", import.meta.url)),
  "utf8",
);

test("supports host-driven message focus for InternShannon memory timeline links", () => {
  assert.match(source, /focusMessageId\?: string;/);
  assert.match(source, /focusMessageRequest\?: number;/);
  assert.match(source, /focusSourceAnchorId\?: string;/);
  assert.match(source, /focusMessageOffsetPx\?: number;/);
  assert.match(source, /focusMessageScrollerOffsetPx\?: number;/);
  assert.match(source, /onFocusMessageRestoreSettled\?: \(outcome: "restored" \| "unavailable"\) => void;/);
  assert.match(source, /data-agent-message-id=\{msg\.id\}/);
  assert.match(source, /highlightedMessageId === msg\.id/);
  assert.match(source, /displayMessages\.findIndex\([\s\S]{0,100}message\.id === focusMessageId/);
  assert.match(source, /displayMessages\.some\(\(message\) => message\.id === focusMessageId\)/);
  assert.match(source, /element\.dataset\.agentMessageId === focusMessageId/);
  assert.match(source, /element\.dataset\.knowledgeSourceAnchor === focusSourceAnchorId/);
  assert.match(source, /targetRect\.top\s*-\s*scrollerRect\.top/);
  assert.match(source, /scroller\.scrollBy\(\{ top: delta, behavior: "auto" \}\)/);
  assert.match(source, /hasPendingFocusedMessage/);
  assert.match(source, /focusRestorePendingRef\.current \|\|[\s\S]{0,100}restoredPositionLockRef\.current !== null/);
  assert.match(source, /settle\("restored"\)/);
  assert.match(source, /settle\("unavailable"\)/);
  assert.match(source, /stableAlignmentCount >= 2/);
  assert.match(source, /hasMeasurableMessageFocusGeometry\(geometry\)/);
  assert.match(source, /isMessageFocusTargetVisible\(geometry\)/);
  assert.match(source, /new ResizeObserver/);
  assert.match(source, /scrollerCleanupRef\.current\?\.\(\)/);
  assert.doesNotMatch(source, /__scrollBound/);
  assert.match(source, /initialTopMostItemIndex=/);
  assert.match(source, /focusSourceAnchorId=\{[\s\S]{0,180}msg\.id === focusMessageId/);
  assert.match(messageItemSource, /index >= 6/);
  assert.match(
    messageItemSource,
    /knowledgeSourceAnchorId\(messageId, source\.resource\)[\s\S]{0,100}focusSourceAnchorId/,
  );
  assert.match(messageItemSource, /const isExpanded = expanded \|\| focusedSourceIsCollapsed;/);
  assert.match(messageItemSource, /const visible = isExpanded \? sources : sources\.slice\(0, 6\);/);
});

test("keeps the return anchor until chat reports a settled restore", () => {
  assert.match(agentPageSource, /requestedKnowledgeReturnAnchor\(location\.state\)/);
  assert.match(agentPageSource, /\[returnRequestId\]/);
  assert.match(agentPageSource, /knowledgeReturnRestoreAttempt < 3/);
  assert.match(agentPageSource, /acknowledgeKnowledgeReturnAnchor\(requestId\)/);
  assert.match(agentPageSource, /onFocusMessageRestoreSettled=\{handleKnowledgeReturnSettled\}/);
  assert.doesNotMatch(agentPageSource, /consumeKnowledgeReturnAnchor\(\)/);
  assert.doesNotMatch(knowledgePageSource, /navigate\(-1\)/);
  assert.doesNotMatch(source, /outcome === "unavailable"[\s\S]{0,420}scrollToIndex\(\{[\s\S]{0,80}index: "LAST"/);
  assert.match(knowledgePageSource, /navigate\("\/",\s*\{/);
  assert.match(knowledgePageSource, /knowledgeReturnAnchor:\s*returnAnchor/);
  assert.match(knowledgePageSource, /persistSession=\{!fromChatSource\}/);
  assert.match(knowledgePageSource, /preview: fromChatSource/);
});

test("keeps the static chat scroller ref stable across reactive scroll state updates", () => {
  assert.match(source, /ref=\{handleScrollerRef\}/);
  assert.doesNotMatch(source, /ref=\{\(el\) => handleScrollerRef\(el\)\}/);
});

test("does not resync the runtime prompt while a reply or compaction is active", () => {
  assert.match(source, /if \(isBackendLockedAgent\) return;[\s\S]{0,280}if \(isRuntimeBusy\) return;/);
});
