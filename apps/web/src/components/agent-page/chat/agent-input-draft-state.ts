export interface AgentInputDraftStorage {
  read: (key: string) => string | null | undefined;
  write: (key: string, value: string) => void;
  remove: (key: string) => void;
}

export interface AgentInputPrefillImage {
  mediaType: string;
  data: string;
  name?: string | null;
}

export interface AgentInputPrefillPendingFile {
  id: string;
  name: string;
  mediaType: string;
  data: string;
}

export const MAX_AGENT_INPUT_DRAFT_LENGTH = 20_000;

const STORAGE_KEY_PREFIX = "agent-input-draft";

export function createAgentInputDraftStorageKey(sessionId: string): string | null {
  const normalizedSessionId = sessionId.trim();
  if (!normalizedSessionId) return null;
  return `${STORAGE_KEY_PREFIX}:${encodeURIComponent(normalizedSessionId)}`;
}

export function normalizeAgentInputDraftText(text: string): string | null {
  if (text.trim().length === 0) return null;
  return text.length > MAX_AGENT_INPUT_DRAFT_LENGTH ? text.slice(0, MAX_AGENT_INPUT_DRAFT_LENGTH) : text;
}

export function readAgentInputDraft(storage: AgentInputDraftStorage, sessionId: string): string {
  const key = createAgentInputDraftStorageKey(sessionId);
  if (!key) return "";

  const draft = normalizeAgentInputDraftText(storage.read(key) ?? "");
  if (!draft) {
    storage.remove(key);
    return "";
  }
  return draft;
}

export function persistAgentInputDraft(
  storage: AgentInputDraftStorage,
  sessionId: string,
  text: string,
): string | null {
  const key = createAgentInputDraftStorageKey(sessionId);
  if (!key) return null;

  const draft = normalizeAgentInputDraftText(text);
  if (!draft) {
    storage.remove(key);
    return null;
  }

  storage.write(key, draft);
  return draft;
}

export function clearAgentInputDraft(storage: AgentInputDraftStorage, sessionId: string): void {
  const key = createAgentInputDraftStorageKey(sessionId);
  if (!key) return;
  storage.remove(key);
}

export function createAgentInputPendingFilesFromPrefillImages(
  images: readonly AgentInputPrefillImage[] | null | undefined,
  createId: () => string,
  fallbackName = "粘贴图片",
): AgentInputPrefillPendingFile[] {
  if (!images?.length) return [];

  const files: AgentInputPrefillPendingFile[] = [];
  for (const image of images) {
    const mediaType = image.mediaType.trim();
    const data = image.data.trim();
    if (!mediaType || !data) continue;
    const name = image.name?.trim() || fallbackName;
    files.push({
      id: createId(),
      name,
      mediaType,
      data,
    });
  }
  return files;
}
