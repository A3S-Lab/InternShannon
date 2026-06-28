import * as assert from "node:assert/strict";
import { test } from "node:test";
import {
	extractToolPath,
	formatToolInvocation,
	getToolInvocationParts,
	getTerminalVerb,
	getToolKind,
	shouldShowToolPreviewByDefault,
	summarizeToolInput,
	summarizeToolResult,
} from "./tool-call-display-utils.ts";

test("classifies common a3s-code tools by capability", () => {
	assert.equal(getToolKind("read"), "read");
	assert.equal(getToolKind("write_file"), "write");
	assert.equal(getToolKind("patch"), "edit");
	assert.equal(getToolKind("bash"), "command");
	assert.equal(getToolKind("grep"), "search");
	assert.equal(getToolKind("ls"), "list");
	assert.equal(getToolKind("web_fetch"), "web");
});

test("summarizes tool input without leaking raw JSON as primary text", () => {
	assert.equal(
		summarizeToolInput("bash", JSON.stringify({ command: "pnpm build" })),
		"pnpm build",
	);
	assert.equal(
		summarizeToolInput("grep", JSON.stringify({ pattern: "agent" })),
		"agent",
	);
	assert.equal(
		summarizeToolInput(
			"write",
			JSON.stringify({ path: "test.md", content: "hello" }),
		),
		"test.md",
	);
});

test("extracts explicit and JSON paths", () => {
	assert.equal(extractToolPath(undefined, "/tmp/out.md"), "/tmp/out.md");
	assert.equal(
		extractToolPath(JSON.stringify({ filePath: "apps/web/src/main.tsx" })),
		"apps/web/src/main.tsx",
	);
});

test("uses terminal-style verbs for status", () => {
	assert.equal(getTerminalVerb("command", true), "正在执行");
	assert.equal(getTerminalVerb("command", false), "已执行");
	assert.equal(getTerminalVerb("read", false), "已读取");
	assert.equal(getTerminalVerb("web", false, true), "执行失败");
});

test("formats coding-agent style tool invocations", () => {
	assert.equal(
		formatToolInvocation("bash", JSON.stringify({ command: "pnpm build" })),
		"Bash(pnpm build)",
	);
	assert.equal(
		formatToolInvocation("read", JSON.stringify({ filePath: "test.md" })),
		"Read(test.md)",
	);
	assert.deepEqual(
		getToolInvocationParts("bash", JSON.stringify({ command: "pnpm build" })),
		{ name: "Bash", args: "pnpm build" },
	);
});

test("summarizes tool results as concise terminal receipts", () => {
	assert.equal(
		summarizeToolResult("command", undefined, false, true),
		"运行中...",
	);
	assert.equal(
		summarizeToolResult("read", "a\nb\n", false, false),
		"读取 2 行",
	);
	assert.equal(
		summarizeToolResult("search", "one\n", false, false),
		"1 条匹配",
	);
	assert.equal(summarizeToolResult("command", "ok\nextra", false, false), "ok");
	assert.equal(summarizeToolResult("command", "failed", true, false), "出错");
});

test("keeps useful tool output visible by default", () => {
	assert.equal(shouldShowToolPreviewByDefault("read", true), true);
	assert.equal(shouldShowToolPreviewByDefault("edit", true), true);
	assert.equal(shouldShowToolPreviewByDefault("command", true), true);
	assert.equal(shouldShowToolPreviewByDefault("write", true), false);
	assert.equal(shouldShowToolPreviewByDefault("other", true, true), true);
	assert.equal(shouldShowToolPreviewByDefault("command", false), false);
});
