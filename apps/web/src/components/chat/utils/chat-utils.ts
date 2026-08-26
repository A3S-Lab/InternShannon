// Shared utility functions for chat message rendering (pure JavaScript version)

import { parseAnsiText } from "@/runtime/ansi-text";

function escapeHtml(text: string): string {
	return text
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#39;");
}

/**
 * Convert ANSI escape sequences to HTML spans with inline styles
 * Pure JavaScript implementation without WASM
 */
export function ansiToHtml(text: string): string {
	return parseAnsiText(text)
		.map((segment) => {
			const escaped = escapeHtml(segment.text);
			return segment.className
				? `<span class="${segment.className}">${escaped}</span>`
				: escaped;
		})
		.join("");
}

export function langFromPath(filePath?: string): string {
	if (!filePath) return "plaintext";
	const ext = filePath.split(".").pop()?.toLowerCase() ?? "";
	const map: Record<string, string> = {
		rs: "rust",
		ts: "typescript",
		tsx: "typescript",
		js: "javascript",
		jsx: "javascript",
		py: "python",
		go: "go",
		json: "json",
		toml: "toml",
		md: "markdown",
		css: "css",
		html: "html",
		sh: "shell",
	};
	return map[ext] ?? "plaintext";
}

export function detectBashBoxEndpointMismatch(
	input: string,
	output?: string,
): string | null {
	if (!output) return null;

	try {
		if (!input.trim()) return null;
		const parsedInput = JSON.parse(input) as Record<string, unknown>;
		const command =
			typeof parsedInput.command === "string" ? parsedInput.command : "";
		if (!command.includes("/api/v1/box/")) return null;

		const parsedOutput = JSON.parse(output) as Record<string, unknown>;
		const isCheckPayload =
			typeof parsedOutput.ready === "boolean" &&
			typeof parsedOutput.installed === "boolean";
		const isCapabilitiesPayload =
			typeof parsedOutput.progressive_disclosure === "boolean" &&
			typeof parsedOutput.requested_command === "string";
		const isAvailablePortsPayload = Array.isArray(parsedOutput.available);

		if (isCheckPayload && !command.includes("/api/v1/box/check")) {
			return "该命令没有请求 /api/v1/box/check，但返回内容像运行时检查结果。";
		}
		if (
			isCapabilitiesPayload &&
			!command.includes("/api/v1/box/capabilities")
		) {
			return "该命令没有请求 /api/v1/box/capabilities，但返回内容像 capabilities 响应。";
		}
		if (
			isAvailablePortsPayload &&
			!command.includes("/api/v1/box/system/ports/available")
		) {
			return "该命令没有请求 /api/v1/box/system/ports/available，但返回内容像可用端口探测结果。";
		}
	} catch {
		return null;
	}

	return null;
}

/**
 * Generate a hash for a block of content
 * Pure JavaScript implementation using DJB2 hash
 */
export function blockHash(input: string): string {
	let hash = 0;
	for (let i = 0; i < input.length; i += 1) {
		hash = (hash * 31 + input.charCodeAt(i)) >>> 0;
	}
	return hash.toString(36).slice(0, 8);
}
