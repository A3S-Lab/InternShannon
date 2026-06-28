import type { ContentBlock } from "../../lib/types";

export type MessageHistoryItem = Record<string, unknown> & { type: string };

export function isHistoryRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

export function normalizeMessageHistoryItems(value: unknown): MessageHistoryItem[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is MessageHistoryItem => {
    return isHistoryRecord(item) && typeof item.type === "string";
  });
}

export function normalizeHistoryText(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export function normalizeHistoryOptionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

export function normalizeHistoryTimestamp(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value > 0 && value < 1e12 ? value * 1000 : value;
  }

  if (typeof value === "string" && value.trim()) {
    const trimmed = value.trim();
    const numeric = Number(trimmed);
    if (Number.isFinite(numeric)) {
      return numeric > 0 && numeric < 1e12 ? numeric * 1000 : numeric;
    }

    const parsed = Date.parse(trimmed);
    if (Number.isFinite(parsed)) return parsed;
  }

  return null;
}

export function normalizeHistoryFiniteNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function normalizeHistoryId(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

export function normalizeHistoryRecord(value: unknown): Record<string, unknown> | null {
  return isHistoryRecord(value) ? value : null;
}

export function normalizeHistoryAssistantContentBlocks(value: unknown): ContentBlock[] {
  if (typeof value === "string") {
    return value.trim() ? [{ type: "text", text: value }] : [];
  }
  if (!Array.isArray(value)) return [];

  const blocks: ContentBlock[] = [];
  let lastToolUseId: string | null = null;

  for (const [index, item] of value.entries()) {
    if (!isHistoryRecord(item)) continue;

    if (item.type === "thinking") {
      continue;
    }

    if (item.type === "text" || item.type === undefined || item.type === null) {
      const text =
        normalizeNonEmptyText(item.text) ??
        normalizeNonEmptyText(item.content) ??
        normalizeNonEmptyText(item.message);
      if (text) blocks.push({ type: "text", text });
      continue;
    }

    if (item.type === "tool_use") {
      const id =
        normalizeNonEmptyTrimmedText(item.id) ??
        normalizeNonEmptyTrimmedText(item.toolUseId) ??
        normalizeNonEmptyTrimmedText(item.tool_use_id) ??
        normalizeNonEmptyTrimmedText(item.toolCallId) ??
        normalizeNonEmptyTrimmedText(item.tool_call_id) ??
        `tool-${index}`;
      lastToolUseId = id;
      blocks.push({
        type: "tool_use",
        id,
        name: normalizeNonEmptyTrimmedText(item.name) ?? "tool",
        input: normalizeFirstToolInput(item.input, item.toolInput, item.tool_input),
      });
      continue;
    }

    if (item.type === "tool_result") {
      const toolUseId =
        normalizeNonEmptyTrimmedText(item.toolUseId) ??
        normalizeNonEmptyTrimmedText(item.tool_use_id) ??
        normalizeNonEmptyTrimmedText(item.toolCallId) ??
        normalizeNonEmptyTrimmedText(item.tool_call_id) ??
        lastToolUseId ??
        `tool-${index}`;
      const block: ContentBlock = {
        type: "tool_result",
        toolUseId,
        content: normalizeFirstToolResultContent(item.content, item.output, item.toolOutput, item.tool_output, item.result),
        isError: normalizeHistoryBoolean(item.isError ?? item.is_error),
      };
      const before = normalizeHistoryOptionalString(item.before);
      const after = normalizeHistoryOptionalString(item.after);
      const filePath = normalizeHistoryOptionalString(item.filePath ?? item.file_path);
      if (before != null) block.before = before;
      if (after != null) block.after = after;
      if (filePath != null) block.filePath = filePath;
      blocks.push(block);
    }
  }

  return blocks;
}

export function normalizeHistoryAssistantMessageContentBlocks(
  message: Record<string, unknown> | null | undefined,
): ContentBlock[] {
  if (!message) return [];
  const explicitBlocks = normalizeHistoryAssistantContentBlocks(
    message.contentBlocks ?? message.content_blocks,
  );
  if (explicitBlocks.length > 0) return explicitBlocks;
  return normalizeHistoryAssistantContentBlocks(message.content);
}

export function normalizeHistoryResultErrorMessage(value: unknown): string | null {
  const data = normalizeHistoryRecord(value);
  if (!data) return null;
  if (normalizeHistoryBoolean(data.isError ?? data.is_error) !== true) return null;
  return normalizeFirstHistoryResultText(data.result, data.error, data.message) || "An error occurred";
}

function normalizeNonEmptyText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  return value.trim() ? value : null;
}

function normalizeNonEmptyTrimmedText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function normalizeHistoryBoolean(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value;
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().toLowerCase();
  if (["true", "yes", "1"].includes(normalized)) return true;
  if (["false", "no", "0"].includes(normalized)) return false;
  return undefined;
}

function normalizeToolInput(value: unknown): Record<string, unknown> {
  if (value == null) return {};
  if (isHistoryRecord(value)) return value;
  if (Array.isArray(value)) return { __display: JSON.stringify(value, null, 2) };
  if (typeof value === "string") return value.trim() ? { __display: value } : {};
  return { __display: String(value) };
}

function normalizeFirstToolInput(...values: unknown[]): Record<string, unknown> {
  for (const value of values) {
    const input = normalizeToolInput(value);
    if (Object.keys(input).length > 0) return input;
  }
  return {};
}

function normalizeToolResultContent(value: unknown): string | ContentBlock[] {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return normalizeHistoryAssistantContentBlocks(value);
  if (value == null) return "";
  try {
    return JSON.stringify(value, null, 2) ?? "";
  } catch {
    return String(value);
  }
}

function normalizeFirstToolResultContent(...values: unknown[]): string | ContentBlock[] {
  for (const value of values) {
    const content = normalizeToolResultContent(value);
    if (Array.isArray(content)) {
      if (content.length > 0) return content;
      continue;
    }
    if (content.trim()) return content;
  }
  return "";
}

function normalizeHistoryResultText(value: unknown): string {
  if (typeof value === "string") return value;
  if (value == null) return "";
  try {
    return JSON.stringify(value, null, 2) ?? "";
  } catch {
    return String(value);
  }
}

function normalizeFirstHistoryResultText(...values: unknown[]): string {
  for (const value of values) {
    const text = normalizeHistoryResultText(value);
    if (text.trim()) return text;
  }
  return "";
}
