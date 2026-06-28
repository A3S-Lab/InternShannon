// Shared utility functions for chat message rendering (pure JavaScript version)

/**
 * Convert ANSI escape sequences to HTML spans with inline styles
 * Pure JavaScript implementation without WASM
 */
export function ansiToHtml(text: string): string {
	if (!text.includes("\x1b[")) return text;

	const colorMap: Record<number, string> = {
		30: "#000000", 31: "#cd3131", 32: "#0dbc79", 33: "#e5e510",
		34: "#2472c8", 35: "#bc3fbc", 36: "#11a8cd", 37: "#e5e5e5",
		90: "#666666", 91: "#f14c4c", 92: "#23d18b", 93: "#f5f543",
		94: "#3b8eea", 95: "#d670d6", 96: "#29b8db", 97: "#ffffff",
	};

	let result = "";
	let currentColor = "";
	let isBold = false;
	let i = 0;

	while (i < text.length) {
		if (text[i] === "\x1b" && text[i + 1] === "[") {
			const match = text.slice(i).match(/^\x1b\[([0-9;]+)m/);
			if (match) {
				const codes = match[1].split(";").map(Number);
				for (const code of codes) {
					if (code === 0) {
						if (currentColor || isBold) result += "</span>";
						currentColor = "";
						isBold = false;
					} else if (code === 1) {
						isBold = true;
					} else if (code >= 30 && code <= 37) {
						if (currentColor) result += "</span>";
						currentColor = colorMap[code] || "";
						result += `<span style="color:${currentColor}${isBold ? ";font-weight:bold" : ""}">`;
					} else if (code >= 90 && code <= 97) {
						if (currentColor) result += "</span>";
						currentColor = colorMap[code] || "";
						result += `<span style="color:${currentColor}${isBold ? ";font-weight:bold" : ""}">`;
					}
				}
				i += match[0].length;
				continue;
			}
		}
		result += text[i];
		i++;
	}

	if (currentColor || isBold) result += "</span>";
	return result;
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
