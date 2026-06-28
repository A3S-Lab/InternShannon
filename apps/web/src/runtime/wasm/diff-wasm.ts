/*---------------------------------------------------------------------------------------------
 *  InternShannon WASM Diff Bridge
 *  Myers line diff algorithm via WebAssembly with transparent JS fallback.
 *--------------------------------------------------------------------------------------------*/

import { workspaceAssetPath } from "@/lib/constants";
import type { DiffWasmModule } from "@/types/wasm";

let wasmModule: DiffWasmModule | null = null;
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
				const wasmPath = workspaceAssetPath("wasm/diff/sidex_diff_wasm.js");
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

export interface DiffResult {
	type: "unchanged" | "added" | "removed";
	content: string;
	origLineNum: number;
	modLineNum: number;
}

/**
 * Compute line-by-line diff using WASM-accelerated Myers algorithm.
 * Falls back to JS implementation if WASM is not available.
 */
export function computeLineDiff(
	origLines: string[],
	modLines: string[],
): DiffResult[] {
	// Try WASM first
	if (wasmModule) {
		try {
			const engine = new wasmModule.DiffEngine(
				JSON.stringify(origLines),
				JSON.stringify(modLines),
			);
			const results = engine.compute_diff();
			const out: DiffResult[] = [];
			for (let i = 0; i < results.length(); i++) {
				const r = results.get(i);
				out.push({
					type:
						r.diff_type === 0
							? "unchanged"
							: r.diff_type === 1
								? "added"
								: "removed",
					content: r.content,
					origLineNum: r.orig_line_num,
					modLineNum: r.mod_line_num,
				});
				r.free();
			}
			results.free();
			return out;
		} catch {
			// Fall through to JS implementation
		}
	}

	// JS fallback - pure TypeScript Myers implementation
	return jsMyersLineDiff(origLines, modLines);
}

function jsMyersLineDiff(
	origLines: string[],
	modLines: string[],
): DiffResult[] {
	const n = origLines.length;
	const m = modLines.length;
	const max = n + m;
	const v: Map<number, number> = new Map();
	const trace: Map<number, number>[] = [];

	v.set(1, 0);
	for (let d = 0; d <= max; d++) {
		trace.push(new Map(v));
		for (let k = -d; k <= d; k += 2) {
			let x: number;
			if (k === -d || (k !== d && (v.get(k - 1) ?? 0) < (v.get(k + 1) ?? 0))) {
				x = v.get(k + 1) ?? 0;
			} else {
				x = (v.get(k) ?? 0) + 1;
			}
			let y = x - k;
			while (x < n && y < m && origLines[x] === modLines[y]) {
				x++;
				y++;
			}
			v.set(k, x);
			if (x >= n && y >= m) {
				return jsBacktrack(trace, origLines, modLines);
			}
		}
	}
	return [];
}

function jsBacktrack(
	trace: Map<number, number>[],
	origLines: string[],
	modLines: string[],
): DiffResult[] {
	const result: DiffResult[] = [];
	let x = origLines.length;
	let y = modLines.length;

	for (let i = trace.length - 1; i >= 0; i--) {
		const v = trace[i];
		const k = x - y;
		let prevK: number;
		if (k === -i || (k !== i && (v.get(k - 1) ?? 0) < (v.get(k + 1) ?? 0))) {
			prevK = k + 1;
		} else {
			prevK = k;
		}
		const prevX = v.get(prevK) ?? 0;
		const prevY = prevX - prevK;

		while (x > prevX && y > prevY) {
			result.unshift({
				type: "unchanged",
				content: origLines[x - 1],
				origLineNum: x - 1,
				modLineNum: y - 1,
			});
			x--;
			y--;
		}

		if (i > 0) {
			if (x === prevX) {
				result.unshift({
					type: "added",
					content: modLines[y - 1],
					origLineNum: 0,
					modLineNum: y - 1,
				});
				y--;
			} else {
				result.unshift({
					type: "removed",
					content: origLines[x - 1],
					origLineNum: x - 1,
					modLineNum: 0,
				});
				x--;
			}
		}
	}

	while (x > 0 && y > 0 && origLines[x - 1] === modLines[y - 1]) {
		result.unshift({
			type: "unchanged",
			content: origLines[x - 1],
			origLineNum: x - 1,
			modLineNum: y - 1,
		});
		x--;
		y--;
	}

	return result;
}

export function isDiffWasmReady(): boolean {
	return wasmModule !== null;
}
