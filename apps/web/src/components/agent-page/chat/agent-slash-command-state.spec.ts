import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeAgentSlashCommandName,
  resolveAgentSlashCommandDispatchAction,
  resolveAgentSlashCommandSuggestions,
} from "./agent-slash-command-state.ts";

test("normalizes slash command names while hiding internal bypass commands", () => {
  assert.equal(normalizeAgentSlashCommandName("/model"), "model");
  assert.equal(normalizeAgentSlashCommandName("///help extra"), "help");
  assert.equal(normalizeAgentSlashCommandName("/btw"), null);
  assert.equal(normalizeAgentSlashCommandName(" / "), null);
});

test("suggests local commands and runtime-backed commands without future-only commands", () => {
  assert.deepEqual(
    resolveAgentSlashCommandSuggestions().map((item) => item.name),
    ["model", "clear", "help"],
  );

  assert.deepEqual(
    resolveAgentSlashCommandSuggestions(["compact", "cost", "/deploy", "model", "/btw"]).map((item) => item),
    [
      { name: "model", description: "查看或切换当前模型" },
      { name: "clear", description: "清空对话历史" },
      { name: "help", description: "查看可用命令列表" },
      { name: "compact", description: "整理并压缩对话上下文" },
      { name: "cost", description: "查看当前会话 Token 用量和费用" },
      { name: "deploy", description: "运行时命令" },
    ],
  );
});

test("resolves local slash command actions", () => {
  assert.deepEqual(
    resolveAgentSlashCommandDispatchAction({
      commandText: "/clear",
      hasImages: false,
      runtimeCommands: [],
      showStatusBar: true,
      showModelSwitcher: true,
    }),
    { kind: "clear-session" },
  );

  assert.deepEqual(
    resolveAgentSlashCommandDispatchAction({
      commandText: "/model",
      hasImages: false,
      runtimeCommands: [],
      showStatusBar: true,
      showModelSwitcher: true,
    }),
    {
      kind: "focus-model",
      toastMessage: "已定位到模型选择器，可按 Enter 打开",
    },
  );

  assert.deepEqual(
    resolveAgentSlashCommandDispatchAction({
      commandText: "/help",
      hasImages: false,
      runtimeCommands: [],
      showStatusBar: true,
      showModelSwitcher: true,
    }),
    {
      kind: "show-help",
      toastMessage: "已打开快捷键与命令帮助",
    },
  );
});

test("keeps unavailable built-in commands as drafts unless the runtime advertises them", () => {
  assert.deepEqual(
    resolveAgentSlashCommandDispatchAction({
      commandText: "/compact",
      hasImages: false,
      runtimeCommands: [],
      showStatusBar: true,
      showModelSwitcher: true,
    }),
    {
      kind: "unavailable",
      actionError: {
        message: "/compact 需要当前内核提供运行时命令后才能使用。草稿已保留。",
        dismissLabel: "关闭 /compact 命令提示",
      },
      toastMessage: "当前会话暂不支持 /compact",
    },
  );

  assert.deepEqual(
    resolveAgentSlashCommandDispatchAction({
      commandText: "/compact",
      hasImages: false,
      runtimeCommands: ["compact"],
      showStatusBar: true,
      showModelSwitcher: true,
    }),
    { kind: "none" },
  );
});

test("does not intercept slash commands with attachments or unknown runtime commands", () => {
  assert.deepEqual(
    resolveAgentSlashCommandDispatchAction({
      commandText: "/deploy",
      hasImages: false,
      runtimeCommands: ["deploy"],
      showStatusBar: true,
      showModelSwitcher: true,
    }),
    { kind: "none" },
  );

  assert.deepEqual(
    resolveAgentSlashCommandDispatchAction({
      commandText: "/help",
      hasImages: true,
      runtimeCommands: [],
      showStatusBar: true,
      showModelSwitcher: true,
    }),
    { kind: "none" },
  );
});
