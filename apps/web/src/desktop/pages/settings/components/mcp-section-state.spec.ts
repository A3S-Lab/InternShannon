import * as assert from "node:assert/strict";
import { test } from "node:test";
import {
  formatMcpActionError,
  isMcpServerRowActionPending,
  resolveMcpServerFormValidation,
  resolveMcpServerRowActionFeedback,
  resolveMcpServerSavePlan,
} from "./mcp-section-state.ts";

test("adds a new MCP server without scheduling removal", () => {
  assert.deepEqual(
    resolveMcpServerSavePlan({
      nextName: "filesystem",
    }),
    {
      kind: "create",
      nextName: "filesystem",
      removePreviousAfterUpsert: false,
      successMessage: "MCP 服务 filesystem 已添加",
    },
  );
});

test("updates the current MCP server with a single upsert", () => {
  assert.deepEqual(
    resolveMcpServerSavePlan({
      editingName: "filesystem",
      nextName: "filesystem",
    }),
    {
      kind: "update",
      nextName: "filesystem",
      previousName: "filesystem",
      removePreviousAfterUpsert: false,
      successMessage: "MCP 服务 filesystem 已更新",
    },
  );
});

test("renames MCP servers by removing the previous name only after upsert", () => {
  assert.deepEqual(
    resolveMcpServerSavePlan({
      editingName: "filesystem",
      nextName: "local-files",
    }),
    {
      kind: "rename",
      nextName: "local-files",
      previousName: "filesystem",
      removePreviousAfterUpsert: true,
      successMessage: "MCP 服务 filesystem 已重命名为 local-files",
    },
  );
});

test("formats MCP action errors for inline recovery", () => {
  assert.equal(formatMcpActionError(new Error("sidecar offline")), "sidecar offline");
  assert.equal(formatMcpActionError(" permission denied "), "permission denied");
  assert.equal(formatMcpActionError({ message: "invalid command" }), "invalid command");
  assert.equal(formatMcpActionError({ reason: "unknown" }), "MCP 服务操作失败，请确认本地后端已启动后重试。");
});

test("explains why stdio MCP service forms cannot be saved yet", () => {
  assert.deepEqual(
    resolveMcpServerFormValidation({
      name: "",
      transport: "stdio",
      command: "",
      url: "",
    }),
    {
      canSave: false,
      title: "还不能添加 stdio MCP 服务",
      description: "请输入服务名和 Command。",
      saveButtonAriaLabel: "请输入 MCP 服务名和 Command 后保存",
    },
  );

  const missingCommand = resolveMcpServerFormValidation({
    name: "filesystem",
    transport: "stdio",
    command: "  ",
    url: "",
  });
  assert.equal(missingCommand.canSave, false);
  assert.equal(missingCommand.title, "需要 Command");
});

test("explains why HTTP MCP service forms cannot be saved yet", () => {
  const missingUrl = resolveMcpServerFormValidation({
    name: "browser",
    transport: "http",
    command: "",
    url: "",
  });

  assert.equal(missingUrl.canSave, false);
  assert.equal(missingUrl.title, "需要 URL");
  assert.equal(missingUrl.saveButtonAriaLabel, "请输入 HTTP MCP URL 后保存");
});

test("allows complete MCP service forms to be saved", () => {
  assert.deepEqual(
    resolveMcpServerFormValidation({
      name: "filesystem",
      transport: "stdio",
      command: "npx",
      url: "",
    }),
    {
      canSave: true,
      title: "MCP 服务配置可以保存",
      description: "保存后会同步到本地后端并刷新服务状态。",
      saveButtonAriaLabel: "保存 MCP 服务配置",
    },
  );

  assert.equal(
    resolveMcpServerFormValidation({
      name: "browser",
      transport: "http",
      command: "",
      url: "http://127.0.0.1:8787/mcp",
    }).canSave,
    true,
  );
});

test("scopes MCP row action pending state to the affected service", () => {
  const pending = { serverName: "filesystem", kind: "toggle" as const };

  assert.equal(isMcpServerRowActionPending(pending, "filesystem"), true);
  assert.equal(isMcpServerRowActionPending(pending, "filesystem", "toggle"), true);
  assert.equal(isMcpServerRowActionPending(pending, "filesystem", "remove"), false);
  assert.equal(isMcpServerRowActionPending(pending, "github"), false);
});

test("scopes MCP row action failures to the affected service", () => {
  const feedback = resolveMcpServerRowActionFeedback(
    {
      serverName: "filesystem",
      kind: "remove",
      message: "failed to update config",
    },
    "filesystem",
  );

  assert.equal(feedback?.title, "移除 MCP 服务失败");
  assert.equal(feedback?.role, "alert");
  assert.equal(feedback?.ariaLive, "assertive");
  assert.equal(feedback?.description, "failed to update config");
  assert.equal(
    resolveMcpServerRowActionFeedback(
      {
        serverName: "filesystem",
        kind: "toggle",
        message: "failed",
      },
      "github",
    ),
    null,
  );
});
