import { onUserStorageScopeChange, readUserJsonStorage, writeUserJsonStorage } from "./browser-storage.ts";
import type { InternShannonMemoryConversationRef } from "./internShannon-memory-timeline-conversation.ts";
import {
  createInternShannonMemoryTimelineItem,
  resolveInternShannonMemoryLayer,
  INTERNSHANNON_MEMORY_LAYER_DEFINITIONS,
  type InternShannonMemoryTimelineEventInput,
} from "./internShannon-memory-timeline-item.ts";
import {
  normalizeInternShannonMemoryTimelineItems,
  type InternShannonMemoryAction,
  type InternShannonMemoryLayer,
  type InternShannonMemoryTimelineItem,
} from "./internShannon-memory-timeline-record.ts";

export const INTERNSHANNON_MEMORY_TIMELINE_STORAGE_KEY = "internShannon-memory-timeline-v1";
const MAX_MEMORY_TIMELINE_ITEMS = 160;
const MEMORY_REPLAY_WINDOW_MS = 10_000;

export type {
  InternShannonMemoryAction,
  InternShannonMemoryConversationRef,
  InternShannonMemoryLayer,
  InternShannonMemoryTimelineEventInput,
  InternShannonMemoryTimelineItem,
};

export { createInternShannonMemoryTimelineItem, resolveInternShannonMemoryLayer, INTERNSHANNON_MEMORY_LAYER_DEFINITIONS };

const memoryTimelineListeners = new Set<() => void>();

function truncateText(value: string, maxLength: number): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength - 1)}…` : normalized;
}

function notifyMemoryTimelineChanged(): void {
  for (const listener of Array.from(memoryTimelineListeners)) {
    listener();
  }
}

export function subscribeInternShannonMemoryTimeline(listener: () => void): () => void {
  memoryTimelineListeners.add(listener);
  return () => memoryTimelineListeners.delete(listener);
}

export function readInternShannonMemoryTimeline(): InternShannonMemoryTimelineItem[] {
  return normalizeInternShannonMemoryTimelineItems(
    readUserJsonStorage<unknown[]>(INTERNSHANNON_MEMORY_TIMELINE_STORAGE_KEY, []),
  );
}

function writeInternShannonMemoryTimeline(items: readonly InternShannonMemoryTimelineItem[]): void {
  writeUserJsonStorage(
    INTERNSHANNON_MEMORY_TIMELINE_STORAGE_KEY,
    [...items].sort((left, right) => right.createdAt - left.createdAt).slice(0, MAX_MEMORY_TIMELINE_ITEMS),
  );
  notifyMemoryTimelineChanged();
}

function memoryIdReplayKey(item: InternShannonMemoryTimelineItem): string | undefined {
  if (!item.memoryId) return undefined;
  return `${item.memoryId}:${item.action}`;
}

function contentReplayCandidates(item: InternShannonMemoryTimelineItem): Set<string> {
  return new Set([item.content, item.originalContent].map((value) => value.trim()).filter(Boolean));
}

function hasSharedContentReplay(left: InternShannonMemoryTimelineItem, right: InternShannonMemoryTimelineItem): boolean {
  const leftCandidates = contentReplayCandidates(left);
  for (const candidate of contentReplayCandidates(right)) {
    if (leftCandidates.has(candidate)) return true;
  }
  return false;
}

function isContentReplay(left: InternShannonMemoryTimelineItem, right: InternShannonMemoryTimelineItem): boolean {
  if (left.memoryId || right.memoryId) return false;
  return (
    left.sessionId === right.sessionId &&
    left.layer === right.layer &&
    left.action === right.action &&
    hasSharedContentReplay(left, right) &&
    Math.abs(left.createdAt - right.createdAt) <= MEMORY_REPLAY_WINDOW_MS
  );
}

function findReplayExistingItem(
  current: readonly InternShannonMemoryTimelineItem[],
  item: InternShannonMemoryTimelineItem,
): InternShannonMemoryTimelineItem | null {
  const key = memoryIdReplayKey(item);
  if (key) return current.find((existing) => memoryIdReplayKey(existing) === key) ?? null;
  return current.find((existing) => isContentReplay(existing, item)) ?? null;
}

export function recordInternShannonMemoryEvent(input: InternShannonMemoryTimelineEventInput): InternShannonMemoryTimelineItem | null {
  const item = createInternShannonMemoryTimelineItem(input);
  if (!item) return null;
  const current = readInternShannonMemoryTimeline();
  const existing = findReplayExistingItem(current, item);
  if (existing) return existing;
  writeInternShannonMemoryTimeline([item, ...current]);
  return item;
}

export function updateInternShannonMemoryTimelineItem(itemId: string, patch: { content: string }): void {
  const content = truncateText(patch.content, 360);
  const next = readInternShannonMemoryTimeline().map((item) =>
    item.id === itemId
      ? {
          ...item,
          content,
          updatedAt: Date.now(),
        }
      : item,
  );
  writeInternShannonMemoryTimeline(next);
}

export function deleteInternShannonMemoryTimelineItem(itemId: string): void {
  const next = readInternShannonMemoryTimeline().map((item) =>
    item.id === itemId
      ? {
          ...item,
          deletedAt: Date.now(),
          updatedAt: Date.now(),
        }
      : item,
  );
  writeInternShannonMemoryTimeline(next);
}

if (typeof window !== "undefined") {
  window.addEventListener("storage", (event) => {
    if (event.key?.includes(INTERNSHANNON_MEMORY_TIMELINE_STORAGE_KEY)) {
      notifyMemoryTimelineChanged();
    }
  });
}

onUserStorageScopeChange(() => notifyMemoryTimelineChanged());
