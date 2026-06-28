import { DOCUMENT_KEYBINDINGS, isApplePlatformName } from "./keyboard-shortcuts";

/**
 * 一条可执行的工作区命令 —— 命令面板 / 快捷键速查 / tooltip 的单一事实源。
 * keybinding 仅用于展示;真正的按键派发仍在 keyboard-shortcuts.ts 解析器 / Monaco addCommand 里
 * (命令面板只调 run(),不抢键位),避免重复维护两套派发。
 */
export interface WorkspaceCommand {
  id: string;
  title: string;
  group: string;
  /** 展示用组合键,如 "mod+s" / "mod+shift+e" / "alt+n" / "ctrl+`"。mod = ⌘(Mac)/ Ctrl(其它)。 */
  keybinding?: string;
  /** 返回 false 时从面板隐藏(动作当前不可用)。 */
  when?: () => boolean;
  run: () => void;
}

const APPLE_SYMBOLS: Record<string, string> = { mod: "⌘", ctrl: "⌃", alt: "⌥", shift: "⇧" };
const OTHER_LABELS: Record<string, string> = { mod: "Ctrl", ctrl: "Ctrl", alt: "Alt", shift: "Shift" };

function currentIsApple(): boolean {
  return typeof navigator !== "undefined" && isApplePlatformName(navigator.platform);
}

/** 把 "mod+shift+e" 这样的组合键格式化成跨平台展示串(Mac:⌘⇧E;其它:Ctrl+Shift+E)。 */
export function formatKeybinding(combo: string, isApple = currentIsApple()): string {
  const map = isApple ? APPLE_SYMBOLS : OTHER_LABELS;
  const sep = isApple ? "" : "+";
  return combo
    .split("+")
    .map((part) => map[part] ?? (part.length === 1 ? part.toUpperCase() : part))
    .join(sep);
}

/** 仅展示用的快捷键(编辑器内 Monaco 命令、文件树 scoped 操作)—— 这些有上下文,不进命令面板执行,只在速查表列出。 */
export interface ReferenceShortcut {
  title: string;
  group: string;
  keybinding: string;
}

export const REFERENCE_SHORTCUTS: ReferenceShortcut[] = [
  { group: "导航", title: "命令面板", keybinding: DOCUMENT_KEYBINDINGS["command-palette"] },
  { group: "编辑器", title: "查找", keybinding: "mod+f" },
  { group: "编辑器", title: "替换", keybinding: "mod+h" },
  { group: "编辑器", title: "跳转到行", keybinding: "mod+g" },
  { group: "编辑器", title: "格式化文档", keybinding: "shift+alt+f" },
  { group: "编辑器", title: "切换自动换行", keybinding: "alt+z" },
  { group: "编辑器", title: "切换缩略图", keybinding: "mod+shift+m" },
  { group: "文件树", title: "复制", keybinding: "mod+c" },
  { group: "文件树", title: "剪切", keybinding: "mod+x" },
  { group: "文件树", title: "粘贴", keybinding: "mod+v" },
  { group: "文件树", title: "全选", keybinding: "mod+a" },
  { group: "文件树", title: "撤销", keybinding: "mod+z" },
  { group: "文件树", title: "重做", keybinding: "mod+shift+z" },
  { group: "文件树", title: "折叠全部", keybinding: "mod+shift+h" },
];
