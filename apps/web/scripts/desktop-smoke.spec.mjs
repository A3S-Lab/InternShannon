import * as assert from "node:assert/strict";
import { test } from "node:test";
import {
  assertConfigCategoryList,
  assertDesktopSettingsConfig,
  assertDesktopShellHtml,
  assertSocketMessageHistoryContainsRun,
  assertSessionSnapshotContainsRun,
  assertSocketRunOutcome,
  assertSkillsDirectoryContains,
  describeProbeError,
  formatProbeAttempts,
  isSocketRunOutcomeMessage,
  joinSmokeWorkspacePath,
  normalizeGatewayUrl,
} from "./desktop-smoke.mjs";

test("normalizes gateway URLs pasted from API endpoints", () => {
  assert.equal(normalizeGatewayUrl(" http://127.0.0.1:29653 "), "http://127.0.0.1:29653");
  assert.equal(normalizeGatewayUrl("http://127.0.0.1:29653/api/v1"), "http://127.0.0.1:29653");
  assert.equal(normalizeGatewayUrl("http://127.0.0.1:29653/api/v1/health/"), "http://127.0.0.1:29653");
});

test("explains sandbox-denied localhost probe errors", () => {
  const error = new TypeError("fetch failed", {
    cause: Object.assign(new Error("connect EPERM"), {
      address: "127.0.0.1",
      code: "EPERM",
      port: 29653,
      syscall: "connect",
    }),
  });

  const message = describeProbeError(error);

  assert.match(message, /code=EPERM/);
  assert.match(message, /localhost access was denied/);
});

test("summarizes failed probe attempts with a sandbox hint", () => {
  const attempts = Array.from({ length: 10 }, (_, index) => ({
    detail: `ECONNREFUSED ${index}`,
    url: `http://127.0.0.1:${5000 + index}`,
  }));

  const summary = formatProbeAttempts(attempts);

  assert.match(summary, /http:\/\/127\.0\.0\.1:5000: ECONNREFUSED 0/);
  assert.match(summary, /\.\.\. 2 more/);
  assert.match(summary, /current sandbox/);
});

test("fingerprints non-desktop shell HTML", () => {
  const html = '<html><head><title>Other app</title></head><body><main id="app"></main></body></html>';

  assert.throws(
    () => assertDesktopShellHtml("web shell", { ok: true, status: 200 }, html),
    /missing desktop title, bootstrap guard, React root.*title="Other app".*ids="app"/,
  );
});

test("validates settings config payloads used by the desktop settings page", () => {
  assert.doesNotThrow(() =>
    assertDesktopSettingsConfig("settings config", {
      general: { workspacePath: "/tmp/workspace" },
      llm: { providers: [], defaultModel: "" },
      search: { defaultEngine: "google" },
      storage: { skillDirs: [] },
    }),
  );

  assert.throws(
    () =>
      assertDesktopSettingsConfig("settings config", {
        general: {},
        llm: { providers: {} },
        search: {},
        storage: {},
      }),
    /llm\.providers was not an array/,
  );
});

test("validates config category lists needed by settings tabs", () => {
  assert.doesNotThrow(() =>
    assertConfigCategoryList("settings categories", {
      items: [{ name: "general" }, { name: "llm" }, { name: "search" }, { name: "storage" }],
    }),
  );

  assert.throws(
    () =>
      assertConfigCategoryList("settings categories", {
        items: [{ name: "general" }],
      }),
    /missing category names: llm, search, storage/,
  );
});

test("validates skill workspace read-dir entries for smoke-created files", () => {
  assert.doesNotThrow(() =>
    assertSkillsDirectoryContains(
      "skills workspace read-dir",
      [
        { name: "desktop-smoke-abc.md", isFile: true },
        { name: "nested", isDirectory: true },
      ],
      "desktop-smoke-abc.md",
    ),
  );

  assert.throws(
    () =>
      assertSkillsDirectoryContains(
        "skills workspace read-dir",
        [{ name: "desktop-smoke-abc.md", isDirectory: true }],
        "desktop-smoke-abc.md",
      ),
    /did not include desktop-smoke-abc\.md/,
  );
});

test("joins smoke workspace paths with platform-appropriate separators", () => {
  assert.equal(joinSmokeWorkspacePath("/tmp/root/", "/users/", "local", "skills"), "/tmp/root/users/local/skills");
  assert.equal(
    joinSmokeWorkspacePath("C:\\Users\\me\\workspace\\", "\\users\\", "local", "skills"),
    "C:\\Users\\me\\workspace\\users\\local\\skills",
  );
});

test("requires a user message run to reach a visible socket outcome", () => {
  const intakeOnlyEvents = [
    {
      type: "message",
      message: {
        type: "stream_event",
        event: {
          type: "main_agent_activity",
          phase: "intake",
          status: "queued",
        },
      },
    },
  ];

  assert.throws(
    () => assertSocketRunOutcome("user_message", intakeOnlyEvents),
    /did not receive an assistant or result message/,
  );

  const diagnosticAssistant = {
    type: "message",
    message: {
      type: "assistant",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "模型未返回有效响应，请检查系统 AI 配置" }],
      },
    },
  };

  assert.equal(isSocketRunOutcomeMessage(diagnosticAssistant.message), true);
  assert.doesNotThrow(() => assertSocketRunOutcome("user_message", [...intakeOnlyEvents, diagnosticAssistant]));
});

test("requires snapshot replay to include the smoke user turn and assistant response", () => {
  const userContent = "desktop smoke user message 123";
  const userOnlySnapshot = {
    messages: [{ type: "user_message", content: userContent }],
  };

  assert.throws(
    () => assertSessionSnapshotContainsRun("session snapshot", userOnlySnapshot, userContent),
    /missing assistant response after smoke user message/,
  );

  const replayableSnapshot = {
    messages: [
      { type: "user_message", content: userContent },
      {
        type: "assistant",
        message: {
          content: [{ type: "text", text: "Visible answer" }],
        },
      },
    ],
  };

  assert.doesNotThrow(() => assertSessionSnapshotContainsRun("session snapshot", replayableSnapshot, userContent));
});

test("requires socket message_history replay to include the smoke user turn and assistant response", () => {
  const userContent = "desktop smoke user message 456";

  assert.throws(
    () =>
      assertSocketMessageHistoryContainsRun(
        "socket message history",
        {
          type: "message_history",
          messages: [{ type: "user_message", content: userContent }],
        },
        userContent,
      ),
    /missing assistant response after smoke user message/,
  );

  assert.doesNotThrow(() =>
    assertSocketMessageHistoryContainsRun(
      "socket message history",
      {
        type: "message_history",
        messages: [
          { type: "user_message", content: userContent },
          {
            type: "assistant",
            message: {
              content: [{ type: "text", text: "Visible answer" }],
            },
          },
        ],
      },
      userContent,
    ),
  );
});
