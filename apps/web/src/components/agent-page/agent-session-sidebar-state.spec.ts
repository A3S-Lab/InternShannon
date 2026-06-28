import * as assert from "node:assert/strict";
import { test } from "node:test";
import type { AgentProcessInfo } from "@/lib/types";
import {
  formatSessionSidebarActionError,
  nextSessionSearchQueryAfterCreate,
  resolveFirstSelectableSessionId,
  resolveLatestSessionMessagePreview,
  resolveSessionDeleteTarget,
  resolveSessionPickerSearchKeyAction,
  resolveSessionSidebarActions,
  resolveSessionSidebarCreateError,
  resolveSessionSidebarDeleteError,
  resolveSessionSidebarEmptyState,
  resolveSessionSidebarPreview,
  resolveSessionSidebarRenameError,
  resolveSessionSidebarStatus,
  resolveSessionMessagePreview,
  sessionDisplayName,
  sessionSearchHaystack,
} from "./agent-session-sidebar-state.ts";

function session(input: Partial<AgentProcessInfo> & { sessionId: string }): AgentProcessInfo {
  return {
    sessionId: input.sessionId,
    agentId: input.agentId ?? "default",
    state: input.state ?? "connected",
    createdAt: input.createdAt ?? 1000,
    cwd: input.cwd ?? "",
    name: input.name,
  };
}

test("uses local session names before backend names and generated titles", () => {
  const namedSession = session({ sessionId: "session-1", name: "后端名称" });

  assert.equal(sessionDisplayName(namedSession, { "session-1": "本地名称" }), "本地名称");
  assert.equal(sessionDisplayName(namedSession, {}), "后端名称");
  assert.equal(sessionDisplayName(session({ sessionId: "session-2" }), {}), "会话 2");
});

test("resolves the pending delete target with the visible display name", () => {
  const target = resolveSessionDeleteTarget({
    sessionId: "session-2",
    sessions: [session({ sessionId: "session-1" }), session({ sessionId: "session-2", name: "待删除会话" })],
    sessionNames: {},
  });

  assert.deepEqual(target, {
    sessionId: "session-2",
    name: "待删除会话",
  });
});

test("uses the local visible session name for delete confirmations", () => {
  const target = resolveSessionDeleteTarget({
    sessionId: "session-2",
    sessions: [session({ sessionId: "session-2", name: "后端旧名称" })],
    sessionNames: { "session-2": "用户重命名" },
  });

  assert.deepEqual(target, {
    sessionId: "session-2",
    name: "用户重命名",
  });
});

test("does not resolve stale delete targets", () => {
  assert.equal(
    resolveSessionDeleteTarget({
      sessionId: "missing-session",
      sessions: [session({ sessionId: "session-1" })],
      sessionNames: {},
    }),
    null,
  );
});

test("clears a non-empty search query after creating a session", () => {
  assert.equal(nextSessionSearchQueryAfterCreate("design"), "");
  assert.equal(nextSessionSearchQueryAfterCreate("  "), "  ");
  assert.equal(nextSessionSearchQueryAfterCreate(""), "");
});

test("describes an empty session list with a create affordance", () => {
  assert.deepEqual(resolveSessionSidebarEmptyState({ totalSessions: 0, query: "" }), {
    title: "暂无会话",
    description: "新建一段会话后，书小安会在这里保留最近的上下文。",
    showClearSearch: false,
    clearSearchLabel: "清空搜索",
    createLabel: "新会话",
  });
});

test("offers search recovery when sessions exist but the filter has no matches", () => {
  assert.deepEqual(resolveSessionSidebarEmptyState({ totalSessions: 3, query: "  release plan  " }), {
    title: "没有匹配的会话",
    description: "未找到包含“release plan”的会话。",
    showClearSearch: true,
    clearSearchLabel: "清空搜索",
    createLabel: "新会话",
  });
});

test("surfaces sidebar create failures with a retry affordance", () => {
  assert.deepEqual(resolveSessionSidebarCreateError(" sidecar offline "), {
    title: "新会话创建失败",
    message: "sidecar offline",
    retryLabel: "重试",
  });
  assert.equal(resolveSessionSidebarCreateError("  "), null);
  assert.equal(resolveSessionSidebarCreateError(null), null);
});

test("formats sidebar action errors without losing backend reasons", () => {
  assert.equal(formatSessionSidebarActionError(new Error("sidecar offline"), "fallback"), "sidecar offline");
  assert.equal(formatSessionSidebarActionError("permission denied", "fallback"), "permission denied");
  assert.equal(formatSessionSidebarActionError({ message: "workspace missing" }, "fallback"), "workspace missing");
  assert.equal(formatSessionSidebarActionError({ reason: "unknown" }, "fallback"), "fallback");
});

test("surfaces row-scoped rename failures only when actionable", () => {
  assert.deepEqual(
    resolveSessionSidebarRenameError({
      sessionId: "session-1",
      message: " update failed ",
    }),
    {
      sessionId: "session-1",
      title: "重命名失败",
      message: "update failed",
    },
  );
  assert.equal(resolveSessionSidebarRenameError({ sessionId: "session-1", message: "  " }), null);
  assert.equal(resolveSessionSidebarRenameError(null), null);
});

test("surfaces row-scoped delete failures only when actionable", () => {
  assert.deepEqual(
    resolveSessionSidebarDeleteError({
      sessionId: "session-1",
      message: " delete failed ",
    }),
    {
      sessionId: "session-1",
      title: "删除失败",
      message: "delete failed",
    },
  );
  assert.equal(resolveSessionSidebarDeleteError({ sessionId: "session-1", message: "  " }), null);
  assert.equal(resolveSessionSidebarDeleteError(undefined), null);
});

test("keeps optimistic creating sessions visible but not actionable", () => {
  assert.deepEqual(resolveSessionSidebarActions(session({ sessionId: "pending-1", state: "creating" })), {
    canSelect: false,
    canRename: false,
    canDelete: false,
    disabledReason: "会话创建完成后可操作",
  });

  assert.deepEqual(resolveSessionSidebarActions(session({ sessionId: "session-1" })), {
    canSelect: true,
    canRename: true,
    canDelete: true,
  });
});

test("finds the first selectable session for keyboard selection", () => {
  assert.equal(
    resolveFirstSelectableSessionId([
      session({ sessionId: "pending-1", state: "creating" }),
      session({ sessionId: "session-2" }),
      session({ sessionId: "session-3" }),
    ]),
    "session-2",
  );
  assert.equal(resolveFirstSelectableSessionId([session({ sessionId: "pending-1", state: "creating" })]), null);
});

test("resolves session picker search keyboard actions", () => {
  assert.equal(resolveSessionPickerSearchKeyAction({ key: "Enter", hasSelectableSession: true }), "select-first");
  assert.equal(resolveSessionPickerSearchKeyAction({ key: "Enter", hasSelectableSession: false }), null);
  assert.equal(resolveSessionPickerSearchKeyAction({ key: "Escape", hasSelectableSession: false }), "close");
});

test("ignores modified or composing session picker search shortcuts", () => {
  assert.equal(resolveSessionPickerSearchKeyAction({ key: "Enter", shiftKey: true, hasSelectableSession: true }), null);
  assert.equal(resolveSessionPickerSearchKeyAction({ key: "Enter", metaKey: true, hasSelectableSession: true }), null);
  assert.equal(resolveSessionPickerSearchKeyAction({ key: "Escape", ctrlKey: true, hasSelectableSession: true }), null);
  assert.equal(
    resolveSessionPickerSearchKeyAction({ key: "Enter", isComposing: true, hasSelectableSession: true }),
    null,
  );
});

test("resolves sidebar status labels and tones from lifecycle and runtime state", () => {
  assert.deepEqual(resolveSessionSidebarStatus({ sessionState: "creating" }), {
    label: "正在创建...",
    tone: "creating",
  });
  assert.deepEqual(resolveSessionSidebarStatus({ sessionState: "exited", sessionStatus: "running" }), {
    label: "已结束",
    tone: "ended",
  });
  assert.deepEqual(resolveSessionSidebarStatus({ sessionStatus: "running" }), {
    label: "正在回复",
    tone: "running",
  });
  assert.deepEqual(resolveSessionSidebarStatus({ sessionStatus: "compacting" }), {
    label: "正在整理上下文",
    tone: "running",
  });
  assert.deepEqual(resolveSessionSidebarStatus({ connectionStatus: "connecting" }), {
    label: "连接中",
    tone: "connecting",
  });
  assert.deepEqual(resolveSessionSidebarStatus({ connectionStatus: "disconnected" }), {
    label: "连接已断开",
    tone: "disconnected",
  });
  assert.deepEqual(resolveSessionSidebarStatus({ connectionStatus: "connected" }), {
    label: "在线",
    tone: "active",
  });
});

test("indexes the visible sidebar status in session search text", () => {
  const target = session({ sessionId: "session-1", cwd: "/workspace/demo", name: "桌面会话" });
  const haystack = sessionSearchHaystack({
    session: target,
    sessionNames: {},
    statusLabel: resolveSessionSidebarStatus({ connectionStatus: "disconnected" }).label,
  });

  assert.equal(haystack.includes("桌面会话"), true);
  assert.equal(haystack.includes("/workspace/demo"), true);
  assert.equal(haystack.includes("连接已断开"), true);
});

test("indexes transient runtime status labels for session picker search", () => {
  const target = session({ sessionId: "session-1", cwd: "/workspace/demo", name: "桌面会话" });
  const runningHaystack = sessionSearchHaystack({
    session: target,
    sessionNames: {},
    statusLabel: resolveSessionSidebarStatus({ sessionStatus: "running" }).label,
  });
  const connectingHaystack = sessionSearchHaystack({
    session: target,
    sessionNames: {},
    statusLabel: resolveSessionSidebarStatus({ connectionStatus: "connecting" }).label,
  });

  assert.equal(runningHaystack.includes("正在回复"), true);
  assert.equal(connectingHaystack.includes("连接中"), true);
});

test("previews malformed legacy chat messages without throwing", () => {
  assert.equal(
    resolveSessionMessagePreview({
      role: "assistant",
      content: [{ type: "text", text: "legacy answer from content array" }],
    }),
    "书小安: legacy answer from content array",
  );

  assert.equal(
    resolveSessionMessagePreview({
      role: "user",
      content: { text: "legacy user prompt object" },
    }),
    "你: legacy user prompt object",
  );

  assert.equal(
    resolveSessionMessagePreview({
      role: "assistant",
      contentBlocks: [{ type: "tool_result", isError: true }],
    }),
    "书小安: 工具执行失败",
  );
});

test("previews legacy chat text blocks that lost their type before InternShannon renders the sidebar", () => {
  assert.equal(
    resolveSessionMessagePreview({
      role: "assistant",
      content: [{ text: "legacy block without type" }],
    }),
    "书小安: legacy block without type",
  );

  assert.equal(
    resolveSessionMessagePreview({
      role: "user",
      contentBlocks: [{ content: "legacy user block without type" }],
    }),
    "你: legacy user block without type",
  );
});

test("finds the latest renderable sidebar preview across malformed stored messages", () => {
  assert.equal(
    resolveLatestSessionMessagePreview([
      null,
      { role: "system", content: "hidden system prompt" },
      { role: "assistant", content: [{ type: "thinking", text: "internal notes" }] },
      {
        role: "user",
        contentBlocks: [{ type: "text", content: "latest usable legacy prompt" }],
      },
    ]),
    "你: latest usable legacy prompt",
  );
});

test("uses a new-session prompt when no sidebar preview can be rendered", () => {
  assert.equal(resolveSessionSidebarPreview(undefined), "发送消息开始对话");
  assert.equal(resolveSessionSidebarPreview([]), "发送消息开始对话");
  assert.equal(
    resolveSessionSidebarPreview([
      { role: "system", content: "hidden prompt" },
      { role: "assistant", content: [{ type: "thinking", text: "internal notes" }] },
      { role: "assistant", content: [{ type: "text", text: "visible answer" }] },
    ]),
    "书小安: visible answer",
  );
  assert.equal(
    resolveSessionSidebarPreview([
      null,
      { role: "system", content: "hidden prompt" },
      { role: "assistant", content: [{ type: "thinking", text: "internal notes" }] },
    ]),
    "发送消息开始对话",
  );
});
