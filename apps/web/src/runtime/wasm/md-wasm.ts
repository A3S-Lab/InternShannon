/*---------------------------------------------------------------------------------------------
 *  InternShannon WASM Markdown Normalization Bridge
 *  Fast markdown normalization via WebAssembly with transparent JS fallback.
 *--------------------------------------------------------------------------------------------*/

import { workspaceAssetPath } from "@/lib/constants";
import type { MarkdownWasmModule } from "@/types/wasm";

let wasmModule: MarkdownWasmModule | null = null;
let normalizer: { normalize: (input: string) => string } | null = null;
let initPromise: Promise<void> | null = null;
let initFailed = false;

async function ensureWasm(): Promise<any> {
	if (wasmModule) {
		return wasmModule;
	}
	if (initFailed) {
		return null;
	}
	if (!initPromise) {
		initPromise = (async () => {
			try {
				const wasmPath = workspaceAssetPath("wasm/md/sidex_md_wasm.js");
				const mod = await import(/* webpackIgnore: true */ wasmPath);
				await mod.default();
				wasmModule = mod;
				normalizer = new mod.MarkdownNormalizer();
			} catch {
				initFailed = true;
			}
		})();
	}
	await initPromise;
	return wasmModule;
}

void ensureWasm();

/**
 * Normalize markdown content using WASM-accelerated functions.
 * Falls back to JS implementation if WASM is not available.
 */
export function normalizeMarkdownContent(
	markdown: string,
	options?: { streaming?: boolean },
): string {
	const base = options?.streaming
		? stripIncompleteTrailingFence(markdown)
		: markdown;

	// Try WASM first
	if (normalizer) {
		try {
			return normalizer.normalize(base);
		} catch {
			// Fall through to JS implementation
		}
	}

	// JS fallback
	return jsNormalizeMarkdownContent(base);
}

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

function jsNormalizeMarkdownContent(markdown: string): string {
	return dedupeAdjacentBlocks(
		dedupeAdjacentLines(
			normalizeBrokenListEmphasis(normalizeSummaryTables(markdown)),
		),
	).trim();
}

export function isMdWasmReady(): boolean {
	return normalizer !== null;
}
