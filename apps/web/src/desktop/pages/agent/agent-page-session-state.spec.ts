import * as assert from "node:assert/strict";
import { test } from "node:test";
import type { AgentProcessInfo } from "@/lib/types";
import {
  resolveAgentPageBackgroundSyncNotice,
  resolveAgentPageBootstrapSurface,
  resolveAgentPageSession,
} from "./agent-page-session-state.ts";

function session(input: Partial<AgentProcessInfo> & { sessionId: string }): AgentProcessInfo {
  return {
    sessionId: input.sessionId,
    agentId: input.agentId ?? "super-admin",
    state: input.state ?? "connected",
    createdAt: input.createdAt ?? 1000,
    cwd: input.cwd ?? "",
    name: input.name,
  };
}

test("holds the chat surface while the backend session list is still bootstrapping", () => {
  const resolution = resolveAgentPageSession({
    bootstrapReady: false,
    currentSessionId: "stale-session",
    sessions: [session({ sessionId: "stale-session" })],
  });

  assert.equal(resolution.isRestoringSessions, true);
  assert.equal(resolution.activeSessionId, null);
  assert.equal(resolution.activeSession, null);
  assert.equal(resolution.suggestedCurrentSessionId, "stale-session");
});

test("keeps the verified current session after bootstrap", () => {
  const resolution = resolveAgentPageSession({
    bootstrapReady: true,
    currentSessionId: "session-1",
    sessions: [session({ sessionId: "session-1" }), session({ sessionId: "session-2", createdAt: 2000 })],
  });

  assert.equal(resolution.isRestoringSessions, false);
  assert.equal(resolution.activeSessionId, "session-1");
  assert.equal(resolution.suggestedCurrentSessionId, "session-1");
});

test("falls back to the newest reusable session when the persisted current session is gone", () => {
  const resolution = resolveAgentPageSession({
    bootstrapReady: true,
    currentSessionId: "deleted-session",
    sessions: [
      session({ sessionId: "old-session", createdAt: 1000 }),
      session({ sessionId: "exited-session", state: "exited", createdAt: 5000 }),
      session({ sessionId: "new-session", createdAt: 3000 }),
    ],
  });

  assert.equal(resolution.activeSessionId, "new-session");
  assert.equal(resolution.suggestedCurrentSessionId, "new-session");
});

test("returns no active session after bootstrap when the backend has no sessions", () => {
  const resolution = resolveAgentPageSession({
    bootstrapReady: true,
    currentSessionId: "deleted-session",
    sessions: [],
  });

  assert.equal(resolution.isRestoringSessions, false);
  assert.equal(resolution.activeSessionId, null);
  assert.equal(resolution.suggestedCurrentSessionId, null);
});

test("keeps the loading surface while sessions are bootstrapping", () => {
  assert.equal(
    resolveAgentPageBootstrapSurface({
      bootstrapReady: false,
      bootstrapError: null,
      sessionCount: 0,
    }),
    "loading",
  );
});

test("surfaces bootstrap errors instead of the empty workspace when no sessions loaded", () => {
  assert.equal(
    resolveAgentPageBootstrapSurface({
      bootstrapReady: true,
      bootstrapError: "sidecar unavailable",
      sessionCount: 0,
    }),
    "error",
  );
});

test("keeps cached sessions usable when a background bootstrap reports an error", () => {
  assert.equal(
    resolveAgentPageBootstrapSurface({
      bootstrapReady: true,
      bootstrapError: "sidecar unavailable",
      sessionCount: 1,
    }),
    "workspace",
  );
});

test("surfaces a background sync notice while cached sessions remain usable", () => {
  const notice = resolveAgentPageBackgroundSyncNotice({
    bootstrapReady: true,
    bootstrapError: "sidecar unavailable",
    sessionCount: 1,
    refreshing: false,
  });

  assert.deepEqual(notice, {
    title: "会话同步暂时失败",
    description: "sidecar unavailable",
    actionLabel: "重试同步",
    ariaLive: "polite",
  });
});

test("keeps background sync retry inline without clearing the workspace", () => {
  assert.equal(
    resolveAgentPageBootstrapSurface({
      bootstrapReady: true,
      bootstrapError: "sidecar unavailable",
      sessionCount: 1,
    }),
    "workspace",
  );
  assert.deepEqual(
    resolveAgentPageBackgroundSyncNotice({
      bootstrapReady: true,
      bootstrapError: "sidecar unavailable",
      sessionCount: 1,
      refreshing: true,
    }),
    {
      title: "正在重新同步会话",
      description: "正在重新连接本地 sidecar，当前会话会保持可用。",
      actionLabel: "正在重试",
      ariaLive: "polite",
    },
  );
});

test("does not show a background sync notice for initial or fatal bootstrap states", () => {
  assert.equal(
    resolveAgentPageBackgroundSyncNotice({
      bootstrapReady: false,
      bootstrapError: "sidecar unavailable",
      sessionCount: 1,
      refreshing: false,
    }),
    null,
  );
  assert.equal(
    resolveAgentPageBackgroundSyncNotice({
      bootstrapReady: true,
      bootstrapError: "sidecar unavailable",
      sessionCount: 0,
      refreshing: false,
    }),
    null,
  );
});
