/*---------------------------------------------------------------------------------------------
 *  InternShannon WASM Unified Diff Bridge
 *  Fast unified diff parsing via WebAssembly with transparent JS fallback.
 *--------------------------------------------------------------------------------------------*/

import { workspaceAssetPath } from "@/lib/constants";
import type { UnifiedDiffWasmModule } from "@/types/wasm";

let wasmModule: UnifiedDiffWasmModule | null = null;
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
				const wasmPath = workspaceAssetPath("wasm/udiff/sidex_udiff_wasm.js");
				const mod = await import(/* webpackIgnore: true */ wasmPath);
				await mod.default();
				wasmModule = mod;
			} catch {
				initFailed = true;
			}
		})();
	}
	await initPromise;
	return wasmModule;
}

void ensureWasm();

export interface UnifiedDiffLine {
	type: "added" | "removed" | "context";
	text: string;
}

export interface UnifiedDiffResult {
	lines: UnifiedDiffLine[];
	added: number;
	removed: number;
	original: string;
	modified: string;
}

/**
 * Parse unified diff output using WASM-accelerated parser.
 * Falls back to JS implementation if WASM is not available.
 */
export function parseUnifiedDiff(output: string): UnifiedDiffResult | null {
	// Try WASM first
	if (wasmModule) {
		try {
			const result = wasmModule.parse_unified_diff(output);
			if (!result) return null;

			const lines: UnifiedDiffLine[] = [];
			const wasmLines = result.lines();
			for (let i = 0; i < wasmLines.length(); i++) {
				const line = wasmLines.get(i);
				lines.push({
					type:
						line.line_type === 1
							? "added"
							: line.line_type === 2
								? "removed"
								: "context",
					text: line.text,
				});
				line.free();
			}
			wasmLines.free();

			return {
				lines,
				added: result.added,
				removed: result.removed,
				original: result.original,
				modified: result.modified,
			};
		} catch {
			// Fall through to JS implementation
		}
	}

	// JS fallback
	return jsParseUnifiedDiff(output);
}

function jsParseUnifiedDiff(output: string): UnifiedDiffResult | null {
	const lines = output.split("\n");
	const resultLines: UnifiedDiffLine[] = [];
	const originalParts: string[] = [];
	const modifiedParts: string[] = [];
	let added = 0;
	let removed = 0;
	let inHunk = false;

	for (const line of lines) {
		if (line.startsWith("@@")) {
			inHunk = true;
			resultLines.push({ type: "context", text: line });
			originalParts.push(line);
			modifiedParts.push(line);
		} else if (line.startsWith("+") && !line.startsWith("+++")) {
			added++;
			resultLines.push({ type: "added", text: line.slice(1) });
			modifiedParts.push(line);
		} else if (line.startsWith("-") && !line.startsWith("---")) {
			removed++;
			resultLines.push({ type: "removed", text: line.slice(1) });
			originalParts.push(line);
		} else if (line.startsWith(" ") || line === "") {
			inHunk = false;
			resultLines.push({ type: "context", text: line.slice(1) || line });
			originalParts.push(line);
			modifiedParts.push(line);
		} else if (
			!line.startsWith("diff ") &&
			!line.startsWith("index ") &&
			!line.startsWith("--- ") &&
			!line.startsWith("+++ ") &&
			!line.startsWith("Only in")
		) {
			if (line.startsWith("--- ") || line.startsWith("+++ ")) {
				// Skip file path headers
			} else if (inHunk || resultLines.length > 0) {
				resultLines.push({ type: "context", text: line });
				originalParts.push(line);
				modifiedParts.push(line);
			}
		}
	}

	if (added === 0 && removed === 0) return null;

	return {
		lines: resultLines,
		added,
		removed,
		original: originalParts.join("\n"),
		modified: modifiedParts.join("\n"),
	};
}

export function isUdifWasmReady(): boolean {
	return wasmModule !== null;
}
