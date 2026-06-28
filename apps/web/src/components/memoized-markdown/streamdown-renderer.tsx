/**
 * StreamdownRenderer — streaming-first markdown renderer.
 *
 * Built on streamdown with custom plugins for:
 * - Shiki syntax highlighting via @streamdown/code
 * - Mermaid diagrams via @streamdown/mermaid
 * - Math rendering via @streamdown/math
 * - CJK support via @streamdown/cjk
 * - VisChart custom renderer (no streamdown equivalent, kept as custom)
 *
 * Normalization logic from md-wasm.ts is preserved here since streamdown
 * handles streaming caret rendering but we still need business-specific fixes.
 */
import { memo } from "react";
import { Streamdown } from "streamdown";
import { code } from "@streamdown/code";
import { mermaid } from "@streamdown/mermaid";
import { math } from "@streamdown/math";
import { cjk } from "@streamdown/cjk";

// =============================================================================
// Business normalization — preserved from md-wasm.ts
// =============================================================================

function stripIncompleteTrailingFence(markdown: string): string {
	const normalized = markdown.replace(/\r\n/g, "\n");
	const fenceCount = (normalized.match(/```/gm) || []).length;
	if (fenceCount % 2 === 0) {
		return normalized;
	}
	const lastFenceIndex = normalized.lastIndexOf("```");
	if (lastFenceIndex < 0) {
		return normalized;
	}
	return normalized.slice(0, lastFenceIndex).trimEnd();
}

function dedupeAdjacentBlocks(markdown: string): string {
	const parts = markdown.split(/\n{2,}/);
	const deduped: string[] = [];
	let prevNormalized = "";
	for (const part of parts) {
		const normalized = part.trim();
		if (normalized && normalized !== prevNormalized) {
			deduped.push(part);
			prevNormalized = normalized;
		} else if (!normalized) {
			deduped.push(part);
		}
	}
	return deduped.join("\n\n");
}

function dedupeAdjacentLines(markdown: string): string {
	const lines = markdown.split("\n");
	const deduped: string[] = [];
	let prevNormalized = "";
	for (const line of lines) {
		if (!line.trim()) {
			deduped.push(line);
			prevNormalized = "";
			continue;
		}
		const normalized = line.trim();
		if (normalized !== prevNormalized) {
			deduped.push(line);
			prevNormalized = normalized;
		}
	}
	return deduped.join("\n");
}

function normalizeSummaryTables(markdown: string): string {
	if (!markdown.includes("节点")) {
		return markdown;
	}
	const lines = markdown.split("\n");
	const normalized: string[] = [];
	for (let i = 0; i < lines.length; i += 1) {
		const rawLine = lines[i] ?? "";
		const line = rawLine.trim();
		const nextRawLine = lines[i + 1] ?? "";
		const nextLine = nextRawLine.trim();
		if (/^`+$/.test(line)) {
			continue;
		}
		if (
			line === "节点 ID\t类型\t标题/功能" ||
			line === "节点 ID 类型 标题/功能"
		) {
			normalized.push("| 节点 ID | 类型 | 标题/功能 |");
			normalized.push("| --- | --- | --- |");
			continue;
		}
		const nodeIdMatch = line.match(/^([A-Za-z0-9_-]+)$/);
		if (nodeIdMatch && nextLine.startsWith("|")) {
			const row = nextLine
				.replace(/^\|\s*/, "")
				.replace(/\s*\|\s*$/, "")
				.trim();
			normalized.push(`| \`${nodeIdMatch[1]}\` | ${row} |`);
			i += 1;
			continue;
		}
		if (line.startsWith("` |")) {
			normalized.push(line.replace(/^`\s*/, ""));
			continue;
		}
		normalized.push(rawLine);
	}
	return normalized.join("\n");
}

function normalizeBrokenListEmphasis(markdown: string): string {
	return markdown
		.replace(/\*\*\s*\n+\+\*\*/g, "** ")
		.replace(/\n+\*\*/g, " **")
		.replace(/^(\d+\.)\s*\*\*\s*$/gm, "$1")
		.replace(/^-\s*\*\*\s*$/gm, "-");
}

function normalizeMarkdownContent(
	markdown: string,
	streaming: boolean,
): string {
	const base = streaming ? stripIncompleteTrailingFence(markdown) : markdown;
	return dedupeAdjacentBlocks(
		dedupeAdjacentLines(
			normalizeBrokenListEmphasis(normalizeSummaryTables(base)),
		),
	).trim();
}

// =============================================================================
// StreamdownRenderer component
// =============================================================================

export const StreamdownRenderer = memo(
	({
		content,
		id,
		streaming = false,
	}: {
		content: string;
		id: string;
		streaming?: boolean;
	}) => {
		// Normalize content with business logic
		const normalizedContent = normalizeMarkdownContent(content, streaming);

		return (
			<Streamdown
				plugins={{ code, mermaid, math, cjk }}
				animated={streaming}
				isAnimating={streaming}
				className="prose-chat"
				data-markdown-id={id}
			>
				{normalizedContent}
			</Streamdown>
		);
	},
);

StreamdownRenderer.displayName = "StreamdownRenderer";

export default StreamdownRenderer;
