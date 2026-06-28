export type ChatSearchNavigationDirection = "previous" | "next";
export type ChatSearchInputKeyAction = "previous" | "next" | "close" | null;

export interface ChatSearchStateInput {
  query: string;
  matchCount: number;
  currentIndex: number;
}

export interface ChatSearchState {
  active: boolean;
  matchCount: number | undefined;
  currentIndex: number;
  hasMatches: boolean;
}

export interface ChatSearchNavigationInput {
  direction: ChatSearchNavigationDirection;
  matchCount: number;
  currentIndex: number;
}

export interface ChatSearchShortcutInput {
  key: string;
  metaKey?: boolean;
  ctrlKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
}

export interface ChatSearchInputKeyActionInput extends ChatSearchShortcutInput {
  hasMatches: boolean;
  isComposing?: boolean;
}

export function isChatSearchActive(query: string): boolean {
  return query.trim().length > 0;
}

export function resolveChatSearchState(input: ChatSearchStateInput): ChatSearchState {
  if (!isChatSearchActive(input.query)) {
    return {
      active: false,
      matchCount: undefined,
      currentIndex: 0,
      hasMatches: false,
    };
  }

  const matchCount = normalizeMatchCount(input.matchCount);
  if (matchCount === 0) {
    return {
      active: true,
      matchCount: 0,
      currentIndex: 0,
      hasMatches: false,
    };
  }

  return {
    active: true,
    matchCount,
    currentIndex: clampSearchIndex(input.currentIndex, matchCount),
    hasMatches: true,
  };
}

export function resolveChatSearchNavigation(input: ChatSearchNavigationInput): number {
  const matchCount = normalizeMatchCount(input.matchCount);
  if (matchCount === 0) return 0;

  const currentIndex = clampSearchIndex(input.currentIndex, matchCount);
  if (input.direction === "previous") {
    return currentIndex <= 0 ? matchCount - 1 : currentIndex - 1;
  }
  return currentIndex >= matchCount - 1 ? 0 : currentIndex + 1;
}

export function shouldOpenChatSearchFromShortcut(input: ChatSearchShortcutInput): boolean {
  if (input.altKey || input.shiftKey) return false;
  if (!input.metaKey && !input.ctrlKey) return false;
  return input.key.toLowerCase() === "f";
}

export function resolveChatSearchInputKeyAction(input: ChatSearchInputKeyActionInput): ChatSearchInputKeyAction {
  if (input.isComposing) return null;
  if (input.key === "Escape" && !input.metaKey && !input.ctrlKey && !input.altKey && !input.shiftKey) {
    return "close";
  }
  if (input.key !== "Enter") return null;
  if (input.metaKey || input.ctrlKey || input.altKey) return null;
  if (!input.hasMatches) return null;
  return input.shiftKey ? "previous" : "next";
}

function normalizeMatchCount(matchCount: number): number {
  if (!Number.isFinite(matchCount) || matchCount <= 0) return 0;
  return Math.floor(matchCount);
}

function clampSearchIndex(currentIndex: number, matchCount: number): number {
  if (!Number.isFinite(currentIndex)) return 0;
  return Math.min(Math.max(0, Math.floor(currentIndex)), matchCount - 1);
}
