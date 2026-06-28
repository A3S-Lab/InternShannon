// Shared utility functions for chat message rendering.
// These are duplicated across message-blocks.tsx and streaming-display.tsx;
// this module is the single source of truth.

import { ansiToHtml as wasmAnsiToHtml } from "@/runtime/wasm/ansi-wasm";
import { wasmSha1 } from "@/runtime/wasm/hash-wasm";

export { stripLeakedInternalReasoning } from "./chat-text-sanitize.ts";

/** Convert ANSI escape sequences to HTML spans with Tailwind color classes (WASM-accelerated) */
export function ansiToHtml(text: string): string {
  return wasmAnsiToHtml(text);
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

export function detectBashBoxEndpointMismatch(input: string, output?: string): string | null {
  if (!output) return null;

  try {
    // Empty input is not valid JSON, skip mismatch detection
    if (!input.trim()) return null;
    const parsedInput = JSON.parse(input) as Record<string, unknown>;
    const command = typeof parsedInput.command === "string" ? parsedInput.command : "";
    if (!command.includes("/api/v1/box/")) return null;

    const parsedOutput = JSON.parse(output) as Record<string, unknown>;
    const isCheckPayload = typeof parsedOutput.ready === "boolean" && typeof parsedOutput.installed === "boolean";
    const isCapabilitiesPayload =
      typeof parsedOutput.progressive_disclosure === "boolean" && typeof parsedOutput.requested_command === "string";
    const isAvailablePortsPayload = Array.isArray(parsedOutput.available);

    if (isCheckPayload && !command.includes("/api/v1/box/check")) {
      return "该命令没有请求 /api/v1/box/check，但返回内容像运行时检查结果。";
    }
    if (isCapabilitiesPayload && !command.includes("/api/v1/box/capabilities")) {
      return "该命令没有请求 /api/v1/box/capabilities，但返回内容像 capabilities 响应。";
    }
    if (isAvailablePortsPayload && !command.includes("/api/v1/box/system/ports/available")) {
      return "该命令没有请求 /api/v1/box/system/ports/available，但返回内容像可用端口探测结果。";
    }
  } catch {
    return null;
  }

  return null;
}

export function blockHash(input: string): string {
  // Try WASM SHA-1 first
  const sha1 = wasmSha1(input);
  if (sha1 !== null) {
    // Truncate to 8 chars to match the original hash length
    return sha1.slice(0, 8);
  }
  // Fallback to DJB2 hash
  let hash = 0;
  for (let i = 0; i < input.length; i += 1) {
    hash = (hash * 31 + input.charCodeAt(i)) >>> 0;
  }
  return hash.toString(36);
}
