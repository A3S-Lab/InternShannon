/**
 * Code editor keybinding utilities.
 *
 * This module is the bridge between:
 * 1. EDITOR_COMMANDS — generic editor commands (bold, italic, save, etc.)
 * 2. MONACO_ACTION_MAP — maps command IDs → Monaco built-in action IDs
 * 3. parseKeybinding / captureKeyCombo / formatKeyCombo — string ↔ Monaco constants
 *
 * The settings UI reads EDITOR_COMMANDS to render the keybinding list.
 * CodeEditor applies Monaco actions via applyKeybindings().
 * The keyboard dispatcher reads EDITOR_COMMANDS defaults + user overrides.
 */
import type { Monaco } from "@monaco-editor/react";
import type * as monacoEditor from "monaco-editor";
import { isApplePlatform } from "@/lib/runtime-environment";
import { captureKeyCombo as captureKeyComboFromEvent, normalizeKeyCombo } from "@/lib/key-combo";

// ---------------------------------------------------------------------------
// Generic editor commands (shared across all editor types)
// ---------------------------------------------------------------------------

export interface EditorCommand {
  /** Unique command identifier, e.g. "editor.bold" */
  id: string;
  /** Chinese display label */
  label: string;
  /** UI grouping category */
  category: string;
  /** Default keyboard shortcut */
  defaultKey: string;
}

/**
 * All generic editor commands.
 * These are shared across CodeEditor (Monaco), TiptapEditor, and MarkdownEditor.
 *
 * Formatting commands (bold, italic, etc.) have no Monaco action equivalent —
 * they are handled by TipTap in WYSIWYG mode and by Monaco in source mode.
 */
export const EDITOR_COMMANDS: EditorCommand[] = [
  // ── 格式化 ──────────────────────────────────────────────────────────────
  {
    id: "editor.bold",
    label: "加粗",
    category: "格式化",
    defaultKey: "ctrl+b",
  },
  {
    id: "editor.italic",
    label: "斜体",
    category: "格式化",
    defaultKey: "ctrl+i",
  },
  {
    id: "editor.underline",
    label: "下划线",
    category: "格式化",
    defaultKey: "ctrl+u",
  },
  {
    id: "editor.strikethrough",
    label: "删除线",
    category: "格式化",
    defaultKey: "ctrl+shift+s",
  },
  {
    id: "editor.code",
    label: "行内代码",
    category: "格式化",
    defaultKey: "ctrl+e",
  },
  {
    id: "editor.heading",
    label: "标题",
    category: "格式化",
    defaultKey: "ctrl+shift+h",
  },
  {
    id: "editor.bulletList",
    label: "无序列表",
    category: "格式化",
    defaultKey: "ctrl+shift+8",
  },
  {
    id: "editor.orderedList",
    label: "有序列表",
    category: "格式化",
    defaultKey: "ctrl+shift+7",
  },
  {
    id: "editor.blockquote",
    label: "引用块",
    category: "格式化",
    defaultKey: "ctrl+shift+9",
  },
  {
    id: "editor.codeBlock",
    label: "代码块",
    category: "格式化",
    defaultKey: "ctrl+shift+`",
  },
  // ── 编辑 ────────────────────────────────────────────────────────────────
  {
    id: "editor.duplicateLine",
    label: "复制行",
    category: "编辑",
    defaultKey: "ctrl+d",
  },
  {
    id: "editor.deleteLine",
    label: "删除当前行",
    category: "编辑",
    defaultKey: "ctrl+y",
  },
  {
    id: "editor.moveLineUp",
    label: "上移当前行",
    category: "编辑",
    defaultKey: "alt+shift+up",
  },
  {
    id: "editor.moveLineDown",
    label: "下移当前行",
    category: "编辑",
    defaultKey: "alt+shift+down",
  },
  {
    id: "editor.copyLineUp",
    label: "向上复制行",
    category: "编辑",
    defaultKey: "ctrl+alt+shift+up",
  },
  {
    id: "editor.copyLineDown",
    label: "向下复制行",
    category: "编辑",
    defaultKey: "ctrl+alt+shift+down",
  },
  {
    id: "editor.indentLine",
    label: "增加缩进",
    category: "编辑",
    defaultKey: "tab",
  },
  {
    id: "editor.outdentLine",
    label: "减少缩进",
    category: "编辑",
    defaultKey: "shift+tab",
  },
  {
    id: "editor.toUpperCase",
    label: "转为大写",
    category: "编辑",
    defaultKey: "ctrl+shift+u",
  },
  {
    id: "editor.toLowerCase",
    label: "转为小写",
    category: "编辑",
    defaultKey: "",
  },
  {
    id: "editor.trimWhitespace",
    label: "删除行末空格",
    category: "编辑",
    defaultKey: "",
  },
  // ── 选择 ────────────────────────────────────────────────────────────────
  {
    id: "editor.selectNextMatch",
    label: "选中下一个匹配",
    category: "选择",
    defaultKey: "alt+j",
  },
  {
    id: "editor.selectAllMatches",
    label: "选中所有匹配",
    category: "选择",
    defaultKey: "ctrl+alt+shift+j",
  },
  // ── 注释 ────────────────────────────────────────────────────────────────
  {
    id: "editor.toggleComment",
    label: "切换行注释",
    category: "注释",
    defaultKey: "ctrl+/",
  },
  {
    id: "editor.blockComment",
    label: "切换块注释",
    category: "注释",
    defaultKey: "ctrl+shift+/",
  },
  // ── 格式化 ──────────────────────────────────────────────────────────────
  {
    id: "editor.formatDocument",
    label: "格式化文档",
    category: "格式化",
    defaultKey: "ctrl+alt+l",
  },
  // ── 查找 ────────────────────────────────────────────────────────────────
  {
    id: "editor.find",
    label: "查找",
    category: "查找",
    defaultKey: "ctrl+f",
  },
  {
    id: "editor.replace",
    label: "查找并替换",
    category: "查找",
    defaultKey: "ctrl+r",
  },
  // ── 导航 ────────────────────────────────────────────────────────────────
  {
    id: "editor.gotoLine",
    label: "跳转到行",
    category: "导航",
    defaultKey: "ctrl+g",
  },
  {
    id: "editor.gotoDefinition",
    label: "转到定义",
    category: "导航",
    defaultKey: "f12",
  },
  {
    id: "editor.rename",
    label: "重命名符号",
    category: "导航",
    defaultKey: "shift+f6",
  },
  // ── 折叠 ────────────────────────────────────────────────────────────────
  {
    id: "editor.foldRegion",
    label: "折叠代码块",
    category: "折叠",
    defaultKey: "ctrl+shift+[",
  },
  {
    id: "editor.unfoldRegion",
    label: "展开代码块",
    category: "折叠",
    defaultKey: "ctrl+shift+]",
  },
  {
    id: "editor.foldAll",
    label: "折叠全部",
    category: "折叠",
    defaultKey: "ctrl+shift+numpadsubtract",
  },
  {
    id: "editor.unfoldAll",
    label: "展开全部",
    category: "折叠",
    defaultKey: "ctrl+shift+numpadadd",
  },
  // ── 通用 ────────────────────────────────────────────────────────────────
  {
    id: "editor.save",
    label: "保存",
    category: "通用",
    defaultKey: "ctrl+s",
  },
  {
    id: "editor.undo",
    label: "撤销",
    category: "通用",
    defaultKey: "ctrl+z",
  },
  {
    id: "editor.redo",
    label: "重做",
    category: "通用",
    defaultKey: "ctrl+shift+z",
  },
  {
    id: "editor.toggleSourceMode",
    label: "切换源码模式",
    category: "通用",
    defaultKey: "ctrl+shift+m",
  },
];

// ---------------------------------------------------------------------------
// Monaco-specific action ID mapping
// ---------------------------------------------------------------------------

/**
 * Maps generic command IDs to Monaco built-in action IDs.
 * Only entries with a Monaco action equivalent are included.
 */
export const MONACO_ACTION_MAP: Record<string, string> = {
  "editor.duplicateLine": "editor.action.copyLinesDownAction",
  "editor.deleteLine": "editor.action.deleteLines",
  "editor.moveLineUp": "editor.action.moveLinesUpAction",
  "editor.moveLineDown": "editor.action.moveLinesDownAction",
  "editor.copyLineUp": "editor.action.copyLinesUpAction",
  "editor.copyLineDown": "editor.action.copyLinesDownAction",
  "editor.indentLine": "editor.action.indentLines",
  "editor.outdentLine": "editor.action.outdentLines",
  "editor.toUpperCase": "editor.action.transformToUppercase",
  "editor.toLowerCase": "editor.action.transformToLowercase",
  "editor.selectNextMatch": "editor.action.addSelectionToNextFindMatch",
  "editor.selectAllMatches": "editor.action.selectHighlights",
  "editor.toggleComment": "editor.action.commentLine",
  "editor.blockComment": "editor.action.blockComment",
  "editor.formatDocument": "editor.action.formatDocument",
  "editor.find": "editor.action.find",
  "editor.replace": "editor.action.startFindReplaceAction",
  "editor.gotoLine": "editor.action.gotoLine",
  "editor.gotoDefinition": "editor.action.revealDefinition",
  "editor.rename": "editor.action.rename",
  "editor.foldRegion": "editor.action.fold",
  "editor.unfoldRegion": "editor.action.unfold",
  "editor.foldAll": "editor.action.foldAll",
  "editor.unfoldAll": "editor.action.unfoldAll",
};

export function defaultKeybindings(): Record<string, string> {
  return Object.fromEntries(EDITOR_COMMANDS.map((a) => [a.id, a.defaultKey]));
}

export function actionCategories(): string[] {
  return [...new Set(EDITOR_COMMANDS.map((a) => a.category))];
}

export function actionsByCategory(category: string): EditorCommand[] {
  return EDITOR_COMMANDS.filter((a) => a.category === category);
}

// ---------------------------------------------------------------------------
// Parse combo string → Monaco numeric keybinding
// ---------------------------------------------------------------------------

export function parseKeybinding(monaco: Monaco, combo: string): number {
  const normalizedCombo = normalizeKeyCombo(combo);
  if (!normalizedCombo) return 0;
  const parts = normalizedCombo.split("+");
  let binding = 0;

  for (const part of parts) {
    switch (part) {
      case "ctrl":
      case "cmd":
      case "mod":
        binding |= monaco.KeyMod.CtrlCmd;
        break;
      case "shift":
        binding |= monaco.KeyMod.Shift;
        break;
      case "alt":
        binding |= monaco.KeyMod.Alt;
        break;
      case "up":
        binding |= monaco.KeyCode.UpArrow;
        break;
      case "down":
        binding |= monaco.KeyCode.DownArrow;
        break;
      case "left":
        binding |= monaco.KeyCode.LeftArrow;
        break;
      case "right":
        binding |= monaco.KeyCode.RightArrow;
        break;
      case "/":
        binding |= monaco.KeyCode.Slash;
        break;
      case "[":
        binding |= monaco.KeyCode.BracketLeft;
        break;
      case "]":
        binding |= monaco.KeyCode.BracketRight;
        break;
      case ";":
        binding |= monaco.KeyCode.Semicolon;
        break;
      case "'":
        binding |= monaco.KeyCode.Quote;
        break;
      case "`":
        binding |= monaco.KeyCode.Backquote;
        break;
      case "-":
        binding |= monaco.KeyCode.Minus;
        break;
      case "=":
        binding |= monaco.KeyCode.Equal;
        break;
      case ",":
        binding |= monaco.KeyCode.Comma;
        break;
      case ".":
        binding |= monaco.KeyCode.Period;
        break;
      case "tab":
        binding |= monaco.KeyCode.Tab;
        break;
      case "enter":
        binding |= monaco.KeyCode.Enter;
        break;
      case "backspace":
        binding |= monaco.KeyCode.Backspace;
        break;
      case "delete":
        binding |= monaco.KeyCode.Delete;
        break;
      case "escape":
        binding |= monaco.KeyCode.Escape;
        break;
      case "space":
        binding |= monaco.KeyCode.Space;
        break;
      default: {
        if (part.length === 1 && /[a-z]/.test(part)) {
          const kn = `Key${part.toUpperCase()}` as keyof typeof monaco.KeyCode;
          binding |= monaco.KeyCode[kn] as number;
        } else if (part.length === 1 && /[0-9]/.test(part)) {
          const kn = `Digit${part}` as keyof typeof monaco.KeyCode;
          binding |= monaco.KeyCode[kn] as number;
        } else if (/^f\d+$/.test(part)) {
          const kn = `F${part.slice(1)}` as keyof typeof monaco.KeyCode;
          binding |= monaco.KeyCode[kn] as number;
        } else if (/^numpad\d$/.test(part)) {
          // numpad0 - numpad9
          const kn = part.toUpperCase() as keyof typeof monaco.KeyCode;
          binding |= monaco.KeyCode[kn] as number;
        } else if (part === "numpadadd" || part === "numpad+") {
          binding |= monaco.KeyCode.NumpadAdd as number;
        } else if (part === "numpadsubtract" || part === "numpad-") {
          binding |= monaco.KeyCode.NumpadSubtract as number;
        } else if (part === "numpadmultiply" || part === "numpad*") {
          binding |= monaco.KeyCode.NumpadMultiply as number;
        } else if (part === "numpaddivide" || part === "numpad/") {
          binding |= monaco.KeyCode.NumpadDivide as number;
        } else if (part === "numpaddecimal" || part === "numpad.") {
          binding |= monaco.KeyCode.NumpadDecimal as number;
        } else if (part === "numpadenter" || part === "numpadenter") {
          binding |= monaco.KeyCode.NumpadEnter as number;
        }
      }
    }
  }

  return binding;
}

// ---------------------------------------------------------------------------
// Capture combo string from a DOM KeyboardEvent
// ---------------------------------------------------------------------------

export function captureKeyCombo(e: KeyboardEvent): string | null {
  return captureKeyComboFromEvent(e);
}

// ---------------------------------------------------------------------------
// Format combo string for display
// ---------------------------------------------------------------------------

const isMac = isApplePlatform();

export function formatKeyCombo(combo: string): string {
  const normalizedCombo = normalizeKeyCombo(combo);
  if (!normalizedCombo) return "";

  return normalizedCombo
    .split("+")
    .map((p) => {
      switch (p) {
        case "ctrl":
          return isMac ? "⌘" : "Ctrl";
        case "shift":
          return isMac ? "⇧" : "Shift";
        case "alt":
          return isMac ? "⌥" : "Alt";
        case "up":
          return "↑";
        case "down":
          return "↓";
        case "left":
          return "←";
        case "right":
          return "→";
        case "enter":
          return "↵";
        case "backspace":
          return "⌫";
        case "escape":
          return "Esc";
        case "tab":
          return "Tab";
        case "space":
          return "Space";
        case "delete":
          return "Del";
        // Numpad keys
        case "numpad0":
        case "numpad1":
        case "numpad2":
        case "numpad3":
        case "numpad4":
        case "numpad5":
        case "numpad6":
        case "numpad7":
        case "numpad8":
        case "numpad9":
          return p.replace("numpad", "Num");
        case "numpadadd":
          return isMac ? "Num +" : "Num+";
        case "numpadsubtract":
          return isMac ? "Num -" : "Num-";
        case "numpadmultiply":
          return isMac ? "Num *" : "Num*";
        case "numpaddivide":
          return isMac ? "Num /" : "Num/";
        case "numpaddecimal":
          return isMac ? "Num ." : "Num.";
        case "numpadenter":
          return isMac ? "Num ↵" : "Num↵";
        default:
          return p.toUpperCase();
      }
    })
    .join(isMac ? "" : "+");
}

// ---------------------------------------------------------------------------
// Apply keybindings to a Monaco editor instance — returns disposables
// ---------------------------------------------------------------------------

export function applyKeybindings(
  editor: monacoEditor.editor.IStandaloneCodeEditor,
  monaco: Monaco,
  keybindings: Record<string, string>,
): monacoEditor.IDisposable[] {
  // Register editor commands as Monaco actions.
  // For commands WITH Monaco equivalents (deleteLine, gotoLine, etc.),
  // Monaco's built-in action handles them directly. Our custom action would
  // have lower priority and never fire.
  // For commands WITHOUT Monaco equivalents (bold, italic, etc.),
  // we register a custom action that dispatches to the keyboard dispatcher.
  return EDITOR_COMMANDS.map((cmd) => {
    const combo = keybindings[cmd.id] ?? cmd.defaultKey;
    const kb = parseKeybinding(monaco, combo);
    const monacoActionId = MONACO_ACTION_MAP[cmd.id];

    // Skip registering custom action for commands with Monaco equivalents.
    // Monaco's built-in action will handle these directly.
    // (Our custom action via addAction would have lower priority and never fire.)
    if (monacoActionId) {
      return { dispose: () => {} };
    }

    // Only register custom actions for formatting commands that Monaco doesn't have.
    // Also skip if the keybinding is invalid (kb === 0)
    if (!kb) {
      return { dispose: () => {} };
    }

    return editor.addAction({
      id: `custom.${cmd.id}`,
      label: cmd.label,
      keybindings: [kb],
      run: () => {
        // Dispatch to keyboard dispatcher which handles the command
        // in the active editor (TipTap or Monaco source mode)
        void import("@/contexts/keyboard-dispatcher-provider").then(({ dispatchCommand }) => {
          dispatchCommand(cmd.id, editor);
        });
      },
    });
  });
}
