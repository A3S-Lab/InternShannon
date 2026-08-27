import * as assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
	shouldUseRichMarkdownEditor,
	sourceModeContentForSave,
} from "./markdown-mode-selection.ts";

const fileTreeEditorSource = readFileSync(
	fileURLToPath(new URL("./FileTreeEditor.tsx", import.meta.url)),
	"utf8",
);
const skillsPageSource = readFileSync(
	fileURLToPath(
		new URL("../../../desktop/pages/agent/SkillsPage.tsx", import.meta.url),
	),
	"utf8",
);

// These tests protect the contract that reviewer #7 required:
//   - SKILL.md opens in source mode (Monaco), never TipTap/WYSIWYG.
//   - Because TipTap is never mounted, its tiptap-markdown serializer cannot
//     rewrite the file on save → YAML frontmatter survives round-trip
//     (PR #7 Bug 1 root cause).

test("returns false when rich markdown is disabled, regardless of file extension", () => {
	// PR #7 fix: SkillsPage passes enableRichMarkdown=false so SKILL.md always
	// opens in Monaco. The path extension must not override that.
	assert.equal(shouldUseRichMarkdownEditor(false, "SKILL.md"), false);
	assert.equal(shouldUseRichMarkdownEditor(false, "README.markdown"), false);
	assert.equal(shouldUseRichMarkdownEditor(false, "notes.mkd"), false);
	assert.equal(shouldUseRichMarkdownEditor(undefined, "anything.md"), false);
});

test("returns true for .md / .markdown / .mkd only when rich markdown is enabled", () => {
	// Default AssetFileManager behavior: enableRichMarkdown=true, so regular
	// markdown files keep going through TipTap WYSIWYG.
	assert.equal(shouldUseRichMarkdownEditor(true, "post.md"), true);
	assert.equal(shouldUseRichMarkdownEditor(true, "post.markdown"), true);
	assert.equal(shouldUseRichMarkdownEditor(true, "post.mkd"), true);
});

test("returns false for .mdx even when rich markdown is enabled", () => {
	// .mdx can embed JSX, which TipTap cannot represent faithfully. Monaco is
	// the safer default.
	assert.equal(shouldUseRichMarkdownEditor(true, "component.mdx"), false);
});

test("returns false for non-markdown files even when rich markdown is enabled", () => {
	assert.equal(shouldUseRichMarkdownEditor(true, "config.json"), false);
	assert.equal(shouldUseRichMarkdownEditor(true, "script.ts"), false);
	assert.equal(shouldUseRichMarkdownEditor(true, "skill/SKILL.yaml"), false);
});

test("returns false for empty or undefined paths even when rich markdown is enabled", () => {
	assert.equal(shouldUseRichMarkdownEditor(true, ""), false);
	assert.equal(shouldUseRichMarkdownEditor(true, undefined), false);
});

test("SkillsPage wires its source-mode contract into FileTreeEditor", () => {
	assert.match(
		skillsPageSource,
		/enableRichMarkdown=\{SKILL_PANEL_ENABLE_RICH_MARKDOWN\}/,
	);
	assert.match(
		fileTreeEditorSource,
		/shouldUseRichMarkdownEditor\(\s*params\?\.enableRichMarkdown,\s*params\?\.path,?\s*\)/,
	);
	assert.match(
		fileTreeEditorSource,
		/if \(isMarkdown\)[\s\S]*?<MarkdownEditor/,
	);
	assert.equal(
		shouldUseRichMarkdownEditor(
			false,
			"users/local/skills/excalidraw/SKILL.md",
		),
		false,
	);
});

test("source-mode SKILL.md save preserves YAML frontmatter byte for byte", () => {
	const content = [
		"---",
		"name: excalidraw",
		"description: Draw diagrams without rewriting YAML",
		"kind: instruction",
		"---",
		"",
		"# Excalidraw",
		"",
	].join("\n");

	assert.equal(sourceModeContentForSave(content), content);
	assert.match(
		fileTreeEditorSource,
		/sourceModeContentForSave\(currentContent\)/,
	);
});
