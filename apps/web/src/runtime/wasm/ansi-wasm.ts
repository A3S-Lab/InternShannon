/*---------------------------------------------------------------------------------------------
 *  InternShannon WASM ANSI Bridge
 *  Accelerated ANSI to HTML conversion via WebAssembly with transparent JS fallback.
 *--------------------------------------------------------------------------------------------*/

import { workspaceAssetPath } from "@/lib/constants";
import type { AnsiWasmModule } from "@/types/wasm";

let wasmModule: AnsiWasmModule | null = null;
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
				const wasmPath = workspaceAssetPath("wasm/ansi/sidex_ansi_wasm.js");
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

/**
 * Convert ANSI escape sequences to HTML spans with Tailwind color classes.
 * Uses WASM-accelerated parser when available.
 */
export function ansiToHtml(text: string): string {
	// Try WASM first
	if (wasmModule) {
		try {
			return wasmModule.ansi_to_html(text);
		} catch {
			// Fall through to JS implementation
		}
	}

	// JS fallback
	return jsAnsiToHtml(text);
}

function jsAnsiToHtml(text: string): string {
	const fgMap: Record<number, string> = {
		30: "text-gray-800",
		31: "text-red-600",
		32: "text-green-600",
		33: "text-yellow-600",
		34: "text-blue-600",
		35: "text-purple-600",
		36: "text-cyan-600",
		37: "text-gray-100",
		40: "bg-gray-800",
		41: "bg-red-600",
		42: "bg-green-600",
		43: "bg-yellow-600",
		44: "bg-blue-600",
		45: "bg-purple-600",
		46: "bg-cyan-600",
		47: "bg-gray-100",
		90: "text-gray-500",
		91: "text-red-400",
		92: "text-green-400",
		93: "text-yellow-400",
		94: "text-blue-400",
		95: "text-pink-400",
		96: "text-cyan-400",
		97: "text-gray-100",
		100: "bg-gray-600",
		101: "bg-red-300",
		102: "bg-green-300",
		103: "bg-yellow-300",
		104: "bg-blue-300",
		105: "bg-pink-300",
		106: "bg-cyan-300",
		107: "bg-white",
	};
	const bgMap: Record<number, string> = {
		40: "bg-gray-800",
		41: "bg-red-600",
		42: "bg-green-600",
		43: "bg-yellow-600",
		44: "bg-blue-600",
		45: "bg-purple-600",
		46: "bg-cyan-600",
		47: "bg-gray-100",
		90: "bg-gray-500",
		91: "bg-red-400",
		92: "bg-green-400",
		93: "bg-yellow-400",
		94: "bg-blue-400",
		95: "bg-pink-400",
		96: "bg-cyan-400",
		97: "bg-gray-100",
		100: "bg-gray-600",
		101: "bg-red-300",
		102: "bg-green-300",
		103: "bg-yellow-300",
		104: "bg-blue-300",
		105: "bg-pink-300",
		106: "bg-cyan-300",
		107: "bg-white",
	};

	let result = "";
	let i = 0;
	let bold = false,
		dim = false,
		underline = false,
		italic = false,
		strike = false;
	let fg = "",
		bg = "";

	const flush = (t: string) => {
		if (!t) return;
		const escaped = t
			.replace(/&/g, "&amp;")
			.replace(/</g, "&lt;")
			.replace(/>/g, "&gt;");
		const classes = [
			dim ? "opacity-75" : "",
			bold ? "font-bold" : "",
			italic ? "italic" : "",
			underline ? "underline" : "",
			strike ? "line-through" : "",
			fg,
			bg,
		].filter(Boolean);
		result +=
			classes.length > 0
				? `<span class="${classes.join(" ")}">${escaped}</span>`
				: escaped;
	};

	while (i < text.length) {
		if (text[i] !== "\x1b" || text[i + 1] !== "[") {
			let j = i;
			while (j < text.length && (text[j] !== "\x1b" || text[j + 1] !== "["))
				j++;
			flush(text.slice(i, j));
			i = j;
			continue;
		}
		let end = i + 2;
		while (end < text.length && text[end] !== "m") end++;
		if (end >= text.length) {
			i++;
			continue;
		}
		const codes = text
			.slice(i + 2, end)
			.split(";")
			.map((n) => parseInt(n, 10) || 0);
		i = end + 1;
		for (const code of codes) {
			if (code === 0) {
				bold = false;
				dim = false;
				underline = false;
				italic = false;
				strike = false;
				fg = "";
				bg = "";
			} else if (code === 1) {
				bold = true;
			} else if (code === 2) {
				dim = true;
			} else if (code === 3) {
				italic = true;
			} else if (code === 4) {
				underline = true;
			} else if (code === 9) {
				strike = true;
			} else if (code in fgMap) {
				fg = fgMap[code];
			} else if (code in bgMap) {
				bg = bgMap[code];
			}
		}
	}
	return result;
}

export function isAnsiWasmReady(): boolean {
	return wasmModule !== null;
}
