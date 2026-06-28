import type { KernelMemoryItem } from "./agent-api.ts";
import type { InternShannonMemoryConversationRef } from "./internShannon-memory-timeline-conversation.ts";
import type { InternShannonMemoryTimelineItem } from "./internShannon-memory-timeline-record.ts";

/**
 * Maps a durable server memory row into a read-only timeline entry, and merges it with the
 * live localStorage entries the current browser recorded during a run.
 *
 * The live store gives instant feedback during a run (and is the only place edits/deletes apply);
 * the server is the durable source so prior-session / other-device memories surface on open.
 * De-dup keeps the local copy when both sides describe the same memory.
 */

function optionalNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string" || !value.trim()) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function metadataNumber(metadata: Record<string, unknown>, ...keys: string[]): number | undefined {
  for (const key of keys) {
    const value = optionalNumber(metadata[key]);
    if (value !== undefined) return value;
  }
  return undefined;
}

function metadataString(metadata: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = metadataText(metadata[key]);
    if (value) return value;
  }
  return undefined;
}

function metadataText(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (Array.isArray(value)) {
    const joined = value
      .map((item) => (typeof item === "string" ? item.trim() : ""))
      .filter(Boolean)
      .join("；");
    return joined || undefined;
  }
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  return metadataString(record, "content", "summary", "text", "detail", "message", "value", "label", "title", "name");
}

function trimmedString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function toTimestamp(iso: string): number {
  const parsed = Date.parse(iso);
  return Number.isFinite(parsed) ? parsed : Date.now();
}

function defaultContent(action: KernelMemoryItem["action"], resultCount?: number): string {
  if (action === "recalled" && resultCount !== undefined) return `召回了 ${resultCount} 条相关记忆`;
  if (action === "recalled") return "召回了一条相关记忆";
  if (action === "cleared") return "清理了一条记忆";
  return "记录了一条记忆要点";
}

/** A read-only conversation ref for a server memory (no captured messages → no preview/role). */
function serverConversationRef(item: KernelMemoryItem, sessionId: string): InternShannonMemoryConversationRef {
  return {
    sessionId,
    sessionName: metadataString(item.metadata, "sessionName", "session_name") ?? undefined,
  };
}

export function mapServerMemoryToTimelineItem(item: KernelMemoryItem): InternShannonMemoryTimelineItem {
  const createdAt = toTimestamp(item.createdAt);
  const resultCount = metadataNumber(item.metadata, "resultCount", "result_count");
  const sessionId = trimmedString(item.sessionId) ?? "";
  const content =
    (item.content ?? "").trim() ||
    metadataString(item.metadata, "content", "summary", "text", "detail", "message", "memory", "value", "label", "title", "name") ||
    defaultContent(item.action, resultCount);
  return {
    id: `internShannon-memory-server-${item.id}`,
    sessionId,
    memoryId:
      trimmedString(item.memoryId) ??
      metadataString(item.metadata, "memoryId", "memory_id", "memoryKey", "memory_key", "key"),
    memoryType:
      metadataString(item.metadata, "memoryType", "memory_type", "typeLabel", "type_label", "type", "kind") ??
      undefined,
    layer: item.layer,
    action: item.action,
    content,
    originalContent: content,
    importance: metadataNumber(item.metadata, "importance"),
    relevance: metadataNumber(item.metadata, "relevance"),
    resultCount,
    conversation: serverConversationRef(item, sessionId),
    createdAt,
    origin: "server",
  };
}

const PERSISTENCE_SKEW_MS = 10_000;

function memoryIdDedupKey(item: InternShannonMemoryTimelineItem): string | undefined {
  if (item.memoryId) return `id:${item.memoryId}:${item.action}`;
  return undefined;
}

function contentIdentityCandidates(item: InternShannonMemoryTimelineItem): Set<string> {
  return new Set([item.content, item.originalContent].map((value) => value.trim()).filter(Boolean));
}

function hasSharedContentIdentity(left: InternShannonMemoryTimelineItem, right: InternShannonMemoryTimelineItem): boolean {
  const leftCandidates = contentIdentityCandidates(left);
  for (const candidate of contentIdentityCandidates(right)) {
    if (leftCandidates.has(candidate)) return true;
  }
  return false;
}

function isContentWindowMatch(left: InternShannonMemoryTimelineItem, right: InternShannonMemoryTimelineItem): boolean {
  if (left.memoryId || right.memoryId) return false;
  return (
    left.sessionId === right.sessionId &&
    left.layer === right.layer &&
    left.action === right.action &&
    hasSharedContentIdentity(left, right) &&
    Math.abs(left.createdAt - right.createdAt) <= PERSISTENCE_SKEW_MS
  );
}

/**
 * Merge live local entries with server entries. Local wins on collision (it carries the
 * editable/deletable copy and any user corrections); server-only rows are appended read-only.
 * Soft-deleted local entries are excluded, and a server row matching a deleted local one stays hidden.
 */
export function mergeInternShannonMemoryTimeline(
  localItems: readonly InternShannonMemoryTimelineItem[],
  serverItems: readonly InternShannonMemoryTimelineItem[],
): InternShannonMemoryTimelineItem[] {
  const seenMemoryIds = new Set<string>();
  const seenContentWindowItems: InternShannonMemoryTimelineItem[] = [];
  const merged: InternShannonMemoryTimelineItem[] = [];

  // Local first so its (editable) copy claims the dedup slot; also reserve keys for deleted locals
  // so the durable server twin doesn't resurrect a memory the user removed in this browser.
  for (const item of localItems) {
    const key = memoryIdDedupKey(item);
    if (key) seenMemoryIds.add(key);
    else seenContentWindowItems.push(item);
    if (item.deletedAt) continue;
    merged.push(item);
  }

  for (const item of serverItems) {
    const key = memoryIdDedupKey(item);
    if (key && seenMemoryIds.has(key)) continue;
    if (!key && seenContentWindowItems.some((seenItem) => isContentWindowMatch(seenItem, item))) continue;

    if (key) seenMemoryIds.add(key);
    else seenContentWindowItems.push(item);
    merged.push(item);
  }

  return merged.sort((left, right) => right.createdAt - left.createdAt);
}
