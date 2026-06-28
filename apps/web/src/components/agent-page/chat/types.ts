import type { AgentChatMessage, ContentBlock } from "@/lib/types";
import { stripLeakedInternalReasoning } from "./chat-text-sanitize.ts";

// =============================================================================
// Rich message types
// =============================================================================

export interface ToolCallBlock {
  type: "tool_call";
  tool: string;
  input: string;
  output?: string;
  durationMs?: number;
  isError?: boolean;
  before?: string;
  after?: string;
  filePath?: string;
}

export interface TextBlock {
  type: "text";
  content: string;
}

export type RichBlock = ToolCallBlock | TextBlock;

export type MessageSource = "app" | "dingtalk" | "feishu" | "wecom" | "command:/btw";

export interface RichMessage {
  id: string;
  role: "user" | "assistant" | "system";
  blocks: RichBlock[];
  timestamp: number;
  /** Where this user message was sent from */
  source?: MessageSource;
  /** Model that generated this assistant message */
  model?: string;
  /** Stop reason (end_turn, max_tokens, etc.) */
  stopReason?: string | null;
  durationMs?: number;
  meta?: {
    provider?: string;
    requestModel?: string;
    requestUrl?: string;
    responseId?: string;
    responseModel?: string;
    responseObject?: string;
    firstTokenMs?: number;
    durationMs?: number;
  };
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    cacheReadTokens?: number;
    cacheWriteTokens?: number;
    total_tokens?: number;
  };
  /** Images attached to user messages */
  images?: { mediaType: string; data: string }[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function nonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  return value.trim() ? value : null;
}

function nonEmptyTrimmedString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function normalizeRole(value: unknown): AgentChatMessage["role"] | null {
  return value === "user" || value === "assistant" || value === "system" ? value : null;
}

function normalizeTimestamp(value: unknown): number {
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
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function normalizeToolInput(value: unknown): Record<string, unknown> {
  if (value == null) return {};
  if (isRecord(value)) return value;
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

function normalizeBoolean(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value;
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().toLowerCase();
  if (["true", "yes", "1"].includes(normalized)) return true;
  if (["false", "no", "0"].includes(normalized)) return false;
  return undefined;
}

function normalizeFiniteNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function normalizeRichUsage(value: unknown): RichMessage["usage"] | undefined {
  if (!isRecord(value)) return undefined;
  const usage: NonNullable<RichMessage["usage"]> = {};
  const inputTokens = normalizeFiniteNumber(value.inputTokens ?? value.input_tokens);
  const outputTokens = normalizeFiniteNumber(value.outputTokens ?? value.output_tokens);
  const cacheReadTokens = normalizeFiniteNumber(value.cacheReadTokens ?? value.cache_read_tokens);
  const cacheWriteTokens = normalizeFiniteNumber(value.cacheWriteTokens ?? value.cache_write_tokens);
  const totalTokens = normalizeFiniteNumber(value.total_tokens ?? value.totalTokens);
  if (inputTokens !== undefined) usage.inputTokens = inputTokens;
  if (outputTokens !== undefined) usage.outputTokens = outputTokens;
  if (cacheReadTokens !== undefined) usage.cacheReadTokens = cacheReadTokens;
  if (cacheWriteTokens !== undefined) usage.cacheWriteTokens = cacheWriteTokens;
  if (totalTokens !== undefined) usage.total_tokens = totalTokens;
  return Object.keys(usage).length > 0 ? usage : undefined;
}

function normalizeToolResultContent(value: unknown): string | ContentBlock[] {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return normalizeContentBlocks(value) ?? "";
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

function normalizeContentBlocks(value: unknown): ContentBlock[] | undefined {
  if (!Array.isArray(value)) return undefined;

  const blocks: ContentBlock[] = [];
  let lastToolUseId: string | null = null;

  for (const [index, item] of value.entries()) {
    if (!isRecord(item)) continue;
    if (item.type === "thinking") continue;

    if (item.type === "text" || item.type === undefined || item.type === null) {
      const text = nonEmptyString(item.text) ?? nonEmptyString(item.content) ?? nonEmptyString(item.message);
      if (text) blocks.push({ type: "text", text });
      continue;
    }

    if (item.type === "tool_use") {
      const id =
        nonEmptyTrimmedString(item.id) ??
        nonEmptyTrimmedString(item.toolUseId) ??
        nonEmptyTrimmedString(item.tool_use_id) ??
        nonEmptyTrimmedString(item.toolCallId) ??
        nonEmptyTrimmedString(item.tool_call_id) ??
        `tool-${index}`;
      lastToolUseId = id;
      blocks.push({
        type: "tool_use",
        id,
        name: nonEmptyTrimmedString(item.name) ?? "tool",
        input: normalizeFirstToolInput(item.input, item.toolInput, item.tool_input),
      });
      continue;
    }

    if (item.type === "tool_result") {
      const toolUseId =
        nonEmptyTrimmedString(item.toolUseId) ??
        nonEmptyTrimmedString(item.tool_use_id) ??
        nonEmptyTrimmedString(item.toolCallId) ??
        nonEmptyTrimmedString(item.tool_call_id) ??
        lastToolUseId ??
        `tool-${index}`;
      const block: ContentBlock = {
        type: "tool_result",
        toolUseId,
        content: normalizeFirstToolResultContent(item.content, item.output, item.toolOutput, item.tool_output, item.result),
        isError: normalizeBoolean(item.isError ?? item.is_error),
      };
      const before = optionalString(item.before);
      const after = optionalString(item.after);
      const filePath = optionalString(item.filePath ?? item.file_path);
      if (before != null) block.before = before;
      if (after != null) block.after = after;
      if (filePath != null) block.filePath = filePath;
      blocks.push(block);
    }
  }

  return blocks.length > 0 ? blocks : undefined;
}

function normalizeImages(value: unknown): AgentChatMessage["images"] {
  if (!Array.isArray(value)) return undefined;
  const images = value.flatMap((item) => {
    if (!isRecord(item)) return [];
    const mediaType = nonEmptyString(item.mediaType ?? item.media_type);
    const data = nonEmptyString(item.data);
    return mediaType && data ? [{ mediaType, data }] : [];
  });
  return images.length > 0 ? images : undefined;
}

function normalizeRecordMessage(record: Record<string, unknown>, fallbackId: string): AgentChatMessage | null {
  const role = normalizeRole(record.role);
  if (!role) return null;
  const explicitContentBlocks = normalizeContentBlocks(record.contentBlocks ?? record.content_blocks);
  const legacyContentBlocks = Array.isArray(record.content) ? normalizeContentBlocks(record.content) : undefined;

  return {
    id: nonEmptyTrimmedString(record.id) ?? fallbackId,
    role,
    content: typeof record.content === "string" ? record.content : "",
    contentBlocks: explicitContentBlocks ?? legacyContentBlocks,
    images: normalizeImages(record.images),
    timestamp: normalizeTimestamp(record.timestamp),
    parentToolUseId: optionalString(record.parentToolUseId ?? record.parent_tool_use_id) ?? null,
    model: optionalString(record.model),
    stopReason: optionalString(record.stopReason ?? record.stop_reason) ?? null,
    durationMs: normalizeFiniteNumber(record.durationMs ?? record.duration_ms),
    meta: isRecord(record.meta) ? record.meta : undefined,
    usage: isRecord(record.usage) ? record.usage : undefined,
    source: optionalString(record.source),
  };
}

function normalizeHistoryEntry(record: Record<string, unknown>, fallbackId: string): AgentChatMessage | null {
  if (record.type === "user_message") {
    return normalizeRecordMessage(
      {
        id: record.id,
        role: "user",
        content: typeof record.content === "string" ? record.content : "",
        timestamp: record.timestamp,
      },
      fallbackId,
    );
  }

  if (record.type === "assistant" && isRecord(record.message)) {
    const message = record.message;
    return normalizeRecordMessage(
      {
        id: message.id,
        role: "assistant",
        content: typeof message.content === "string" ? message.content : "",
        contentBlocks: Array.isArray(message.content)
          ? message.content
          : (message.contentBlocks ?? message.content_blocks),
        timestamp: record.timestamp,
        model: message.model,
        stopReason: message.stopReason ?? message.stop_reason,
        durationMs: message.durationMs ?? message.duration_ms,
        meta: message.meta,
        usage: message.usage,
      },
      fallbackId,
    );
  }

  return null;
}

export function normalizeAgentChatMessage(value: unknown, index = 0): AgentChatMessage | null {
  if (!isRecord(value)) return null;
  const fallbackId = `message-${index}`;
  return normalizeRecordMessage(value, fallbackId) ?? normalizeHistoryEntry(value, fallbackId);
}

function normalizeMessageBucket(messages: unknown): unknown[] {
  if (Array.isArray(messages)) return messages;
  if (isRecord(messages)) return Object.values(messages);
  return [];
}

export function normalizeAgentChatMessages(messages: unknown): AgentChatMessage[] {
  return normalizeMessageBucket(messages).flatMap((message, index) => {
    const normalized = normalizeAgentChatMessage(message, index);
    return normalized ? [normalized] : [];
  });
}

function normalizeStructuredText(text: string): string {
  return text.replace(/\r\n/g, "\n");
}

function dedupeStructuredBlocks(blocks: RichBlock[]): RichBlock[] {
  const result: RichBlock[] = [];

  for (const block of blocks) {
    const previous = result[result.length - 1];
    if (block.type === "text" && previous?.type === "text") {
      if (previous.content.trim() === block.content.trim()) {
        continue;
      }
      previous.content += block.content;
      continue;
    }

    result.push(block);
  }

  return result;
}

export function parseTextWithRichBlocks(text: string): RichBlock[] {
  const normalized = normalizeStructuredText(text);
  if (!normalized.trim()) return [];
  return dedupeStructuredBlocks([{ type: "text", content: normalized }]);
}

// =============================================================================
// Convert AgentChatMessage → RichMessage
// =============================================================================

function contentBlocksToRichBlocks(blocks: ContentBlock[]): RichBlock[] {
  const result: RichBlock[] = [];
  const toolCallIndex: Record<string, number> = {};

  const stringifyToolInput = (input: unknown): string => {
    if (typeof input === "string") return input;
    if (
      input &&
      typeof input === "object" &&
      "__display" in (input as Record<string, unknown>) &&
      typeof (input as Record<string, unknown>).__display === "string"
    ) {
      return (input as Record<string, unknown>).__display as string;
    }
    // Handle __raw case - the value is a string that may contain JSON
    if (input && typeof input === "object" && "__raw" in (input as Record<string, unknown>)) {
      const raw = (input as Record<string, unknown>).__raw;
      if (typeof raw === "string" && raw.trim() !== "") {
        // Try to parse the raw string as JSON
        try {
          const parsed = JSON.parse(raw);
          // If parsed result is an object, stringify it nicely
          if (parsed && typeof parsed === "object") {
            return JSON.stringify(parsed, null, 2);
          }
        } catch {
          // Not valid JSON - might be concatenated JSON objects (common in SDK streaming)
          // Try to extract and parse each JSON object from the string
          const results: string[] = [];
          let remaining = raw.trim();
          // Find JSON objects by looking for opening brace
          let startIndex = remaining.indexOf("{");
          while (startIndex !== -1 && startIndex < remaining.length) {
            // Find the matching closing brace by counting nesting level
            let depth = 0;
            let endIndex = startIndex;
            for (let i = startIndex; i < remaining.length; i++) {
              if (remaining[i] === "{") depth++;
              else if (remaining[i] === "}") {
                depth--;
                if (depth === 0) {
                  endIndex = i;
                  break;
                }
              }
            }
            const jsonStr = remaining.substring(startIndex, endIndex + 1);
            try {
              const parsed = JSON.parse(jsonStr);
              results.push(JSON.stringify(parsed, null, 2));
            } catch {
              // Not a valid JSON object, skip
            }
            remaining = remaining.substring(endIndex + 1);
            startIndex = remaining.indexOf("{");
          }
          if (results.length > 0) {
            return results.join("\n---\n");
          }
        }
        // If not JSON or primitive, return the raw string
        return raw;
      }
    }
    return JSON.stringify(input, null, 2);
  };

  const stringifyToolResultContent = (content: string | ContentBlock[]): string => {
    if (typeof content === "string") return content;
    const text = contentBlocksToRichBlocks(content)
      .map((block) => (block.type === "text" ? block.content : (block.output ?? "")))
      .filter((value) => value.trim())
      .join("\n");
    return text || JSON.stringify(content, null, 2);
  };

  for (const b of normalizeContentBlocks(blocks) ?? []) {
    if (b.type === "text") {
      result.push(...parseTextWithRichBlocks(stripLeakedInternalReasoning(b.text)));
    } else if (b.type === "thinking") {
      // Skip thinking blocks - they are internal only, not shown in UI transcript
    } else if (b.type === "tool_use") {
      const idx = result.length;
      toolCallIndex[b.id] = idx;
      result.push({
        type: "tool_call",
        tool: b.name,
        input: stringifyToolInput(b.input),
        output: undefined,
        durationMs: undefined,
      });
    } else if (b.type === "tool_result") {
      const content = stringifyToolResultContent(b.content);
      const idx = toolCallIndex[b.toolUseId];
      if (idx !== undefined && result[idx]?.type === "tool_call") {
        (result[idx] as ToolCallBlock).output = content;
        (result[idx] as ToolCallBlock).isError = b.isError;
        if (b.before != null) (result[idx] as ToolCallBlock).before = b.before;
        if (b.after != null) (result[idx] as ToolCallBlock).after = b.after;
        if (b.filePath != null) (result[idx] as ToolCallBlock).filePath = b.filePath;
      } else {
        result.push({
          type: "tool_call",
          tool: "result",
          input: "",
          output: content,
          isError: b.isError,
        });
      }
    }
  }
  return result;
}

export function chatMessageToRich(msg: AgentChatMessage): RichMessage {
  const safeMessage =
    normalizeAgentChatMessage(msg) ??
    ({
      id: "invalid-message",
      role: "system",
      content: "",
      timestamp: 0,
    } satisfies AgentChatMessage);
  const blocks: RichBlock[] = safeMessage.contentBlocks
    ? contentBlocksToRichBlocks(safeMessage.contentBlocks)
    : [
        {
          type: "text",
          content: stripLeakedInternalReasoning(safeMessage.content),
        },
      ];

  return {
    id: safeMessage.id,
    role: safeMessage.role === "user" ? "user" : safeMessage.role === "system" ? "system" : "assistant",
    timestamp: safeMessage.timestamp,
    source: safeMessage.source as MessageSource | undefined,
    model: safeMessage.model,
    stopReason: safeMessage.stopReason,
    durationMs: safeMessage.durationMs,
    meta: safeMessage.meta,
    usage: normalizeRichUsage(safeMessage.usage),
    images: safeMessage.images,
    blocks,
  };
}
