export type FileTreeDocumentShortcut =
  | "command-palette"
  | "quick-open"
  | "show-shortcuts"
  | "focus-explorer"
  | "search"
  | "toggle-terminal"
  | "toggle-sidebar"
  | "save-all"
  | "new-file"
  | "new-folder";

export type FileTreeScopedShortcut = "copy" | "cut" | "paste" | "undo" | "redo" | "select-all" | "collapse-all";

export interface KeyboardEventLike {
  key: string;
  altKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
}

export function isApplePlatformName(platform = ""): boolean {
  return /Mac|iPhone|iPad|iPod/i.test(platform);
}

export function hasPrimaryShortcutModifier(event: KeyboardEventLike, platform = ""): boolean {
  return isApplePlatformName(platform) ? !!event.metaKey : !!event.ctrlKey;
}

function normalizeKey(key: string): string {
  if (key === " ") return "space";
  return key.toLowerCase();
}

interface DocumentKeymapEntry {
  shortcut: FileTreeDocumentShortcut;
  /** 展示用组合键(单一事实源:派发与展示共用,见 DOCUMENT_KEYBINDINGS)。 */
  combo: string;
  /** 命中判定。primary = 已按平台解析的主修饰键(Cmd/Ctrl);key 已 normalize。 */
  match: (
    event: KeyboardEventLike,
    ctx: { key: string; primary: boolean; supportsNativeShell?: boolean },
  ) => boolean;
}

// 文档级快捷键表 —— 取代原先一长串硬编码 if 分支。各 key 互不相同,故顺序不影响判定。
// 命中判定逐字保留旧逻辑(spec 覆盖);combo 同时供命令面板/速查表展示,消除两处键位串漂移。
const DOCUMENT_KEYMAP: DocumentKeymapEntry[] = [
  // Cmd/Ctrl+Shift+P 命令面板;Cmd/Ctrl+P 快速打开(VS Code 同款,Monaco 不占用)。
  { shortcut: "command-palette", combo: "mod+shift+p", match: (e, c) => c.primary && !!e.shiftKey && !e.altKey && c.key === "p" },
  { shortcut: "quick-open", combo: "mod+p", match: (e, c) => c.primary && !e.shiftKey && !e.altKey && c.key === "p" },
  // ?(Shift+/,GitHub 同款)无修饰键;派发侧「正在输入」时让位。
  { shortcut: "show-shortcuts", combo: "?", match: (e, c) => !e.ctrlKey && !e.metaKey && !e.altKey && c.key === "?" },
  { shortcut: "focus-explorer", combo: "mod+shift+e", match: (e, c) => c.primary && !!e.shiftKey && !e.altKey && c.key === "e" },
  { shortcut: "search", combo: "mod+shift+f", match: (e, c) => c.primary && !!e.shiftKey && !e.altKey && c.key === "f" },
  { shortcut: "toggle-sidebar", combo: "mod+b", match: (e, c) => c.primary && !e.shiftKey && !e.altKey && c.key === "b" },
  { shortcut: "save-all", combo: "mod+s", match: (e, c) => c.primary && !e.shiftKey && !e.altKey && c.key === "s" },
  { shortcut: "new-file", combo: "alt+n", match: (e, c) => !!e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey && c.key === "n" },
  { shortcut: "new-folder", combo: "alt+b", match: (e, c) => !!e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey && c.key === "b" },
  // 切换终端:原生 ctrl+`(仅桌面/有终端时)。用裸 ctrlKey 而非 primary,Mac 上也是 Ctrl 不是 ⌘。
  {
    shortcut: "toggle-terminal",
    combo: "ctrl+`",
    match: (e, c) => !!c.supportsNativeShell && !!e.ctrlKey && !e.metaKey && !e.shiftKey && !e.altKey && c.key === "`",
  },
];

/** 文档级快捷键的展示组合键(单一事实源,供命令面板/速查表显示,免与派发逻辑重复维护)。 */
export const DOCUMENT_KEYBINDINGS = Object.fromEntries(
  DOCUMENT_KEYMAP.map((entry) => [entry.shortcut, entry.combo]),
) as Record<FileTreeDocumentShortcut, string>;

export function resolveFileTreeDocumentShortcut(
  event: KeyboardEventLike,
  options: { platform?: string; supportsNativeShell?: boolean } = {},
): FileTreeDocumentShortcut | null {
  const ctx = {
    key: normalizeKey(event.key),
    primary: hasPrimaryShortcutModifier(event, options.platform),
    supportsNativeShell: options.supportsNativeShell,
  };
  for (const entry of DOCUMENT_KEYMAP) {
    if (entry.match(event, ctx)) return entry.shortcut;
  }
  return null;
}

export function resolveFileTreeScopedShortcut(
  event: KeyboardEventLike,
  options: { platform?: string } = {},
): FileTreeScopedShortcut | null {
  if (!hasPrimaryShortcutModifier(event, options.platform) || event.altKey) {
    return null;
  }

  const key = normalizeKey(event.key);

  if (!event.shiftKey && key === "c") return "copy";
  if (!event.shiftKey && key === "x") return "cut";
  if (!event.shiftKey && key === "v") return "paste";
  if (!event.shiftKey && key === "a") return "select-all";
  if (!event.shiftKey && key === "z") return "undo";
  if (event.shiftKey && key === "z") return "redo";
  if (event.shiftKey && key === "h") return "collapse-all";
  if (!event.shiftKey && key === "y") return "redo";

  return null;
}

export function shouldHandleFileTreeDeleteKey(
  event: KeyboardEventLike,
  options: { editableTarget?: boolean; readOnly?: boolean } = {},
): boolean {
  if (options.readOnly || options.editableTarget) return false;
  if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return false;
  const key = normalizeKey(event.key);
  return key === "delete" || key === "backspace";
}

export function isEditableKeyboardTarget(target: EventTarget | null): boolean {
  if (typeof Element === "undefined" || !(target instanceof Element)) {
    return false;
  }

  if (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement
  ) {
    return true;
  }

  const element = target as HTMLElement;
  return (
    element.isContentEditable ||
    !!element.closest(
      '[contenteditable="true"], .monaco-editor, .ProseMirror, [data-menu-shortcut-scope="custom-editor"]',
    )
  );
}
