import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildMarkdownSourceDecorations } from "./markdown-source-decorations.ts";

describe("packaged Markdown source decorations", () => {
	it("marks the structural syntax users need to distinguish", () => {
		const decorations = buildMarkdownSourceDecorations(
			[
				"# Heading",
				"- list item with `code` and **strong**",
				"> quote",
				"[source](file.md)",
				"```ts",
				"const answer = 42;",
				"```",
			].join("\n"),
		);
		const classes = new Set(decorations.map((item) => item.className));
		assert.deepEqual(
			classes,
			new Set([
				"file-tree-editor-md-heading",
				"file-tree-editor-md-marker",
				"file-tree-editor-md-code",
				"file-tree-editor-md-strong",
				"file-tree-editor-md-link",
			]),
		);
	});

	it("keeps fenced code coloured until the closing fence", () => {
		const decorations = buildMarkdownSourceDecorations(
			"```\nplain code\nmore code\n```\nafter",
		).filter((item) => item.className === "file-tree-editor-md-code");
		assert.deepEqual(
			decorations.map((item) => item.startLineNumber),
			[1, 2, 3, 4],
		);
	});
});
