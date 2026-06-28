import * as assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildAgentSessionCreateOptions,
  formatAgentSessionCreateError,
  shouldInitializeAgentDefaultsAfterCreate,
} from "./agent-session-create-state.ts";

test("uses the effective agent default permission mode when creating a session", () => {
  assert.deepEqual(
    buildAgentSessionCreateOptions({
      agentId: "super-admin",
      agent: {
        defaultPermissionMode: "plan",
      },
    }),
    {
      agentId: "super-admin",
      permissionMode: "plan",
    },
  );
});

test("omits blank optional fields so createAgentSession can use its fallback defaults", () => {
  assert.deepEqual(
    buildAgentSessionCreateOptions({
      agentId: "super-admin",
      agent: {
        defaultPermissionMode: "   ",
      },
      apiUrl: " ",
      optimisticPlaceholder: false,
    }),
    {
      agentId: "super-admin",
    },
  );
});

test("preserves apiUrl and optimistic placeholder intent for sidebar callers", () => {
  assert.deepEqual(
    buildAgentSessionCreateOptions({
      agentId: "super-admin",
      agent: {
        defaultPermissionMode: "default",
      },
      apiUrl: "http://127.0.0.1:29653",
      optimisticPlaceholder: true,
    }),
    {
      agentId: "super-admin",
      permissionMode: "default",
      apiUrl: "http://127.0.0.1:29653",
      optimisticPlaceholder: true,
    },
  );
});

test("initializes agent defaults only for local desktop-created sessions", () => {
  assert.equal(shouldInitializeAgentDefaultsAfterCreate(), true);
  assert.equal(shouldInitializeAgentDefaultsAfterCreate("   "), true);
  assert.equal(shouldInitializeAgentDefaultsAfterCreate("http://127.0.0.1:29653"), false);
});

test("formats session creation errors for persistent inline recovery", () => {
  assert.equal(formatAgentSessionCreateError(new Error("sidecar offline")), "sidecar offline");
  assert.equal(formatAgentSessionCreateError("permission denied"), "permission denied");
  assert.equal(formatAgentSessionCreateError({ message: "workspace missing" }), "workspace missing");
  assert.equal(
    formatAgentSessionCreateError({ reason: "unknown" }),
    "创建会话失败，请检查本地服务连接",
  );
});
