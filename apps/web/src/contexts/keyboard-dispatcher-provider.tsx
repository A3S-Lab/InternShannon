/**
 * KeyboardDispatcherProvider — app-level provider that:
 * 1. Registers all editor commands and keybindings on mount
 * 2. Listens to window keydown and dispatches to KeybindingRegistry
 * 3. Provides KeyboardDispatcherContext to all React children
 * 4. Tracks TipTap editor instances for focused command execution
 *
 * Usage: wrap your app root with this provider.
 */
import {
  KeyboardDispatcherContext,
  useFocusTracker,
  type KeyboardDispatchOptions,
  type KeyboardDispatcherValue,
} from "./keyboard-dispatcher-context";
import { KeybindingRegistry } from "@/lib/keybinding-registry";
import { CommandRegistry } from "@/lib/command-registry";
import { EDITOR_COMMANDS, MONACO_ACTION_MAP } from "../components/custom/code-editor/keybindings";
import settingsModel from "@/models/settings.model";
import { captureKeyCombo, normalizeKeyCombo } from "@/lib/key-combo";
import { getMarkdownFormattingEdit } from "@/lib/markdown-source-formatting";
import { subscribe } from "valtio";
import type { IDisposable } from "@/lib/command-registry";
import type { Editor } from "@tiptap/react";
import React, { useCallback, useEffect, useMemo, useRef } from "react";
import { useEventListener } from "ahooks";
import type { Context } from "@/lib/keybinding-registry";

const EDITOR_COMMAND_BY_ID = new Map(EDITOR_COMMANDS.map((command) => [command.id, command]));

const TIPTAP_NATIVE_COMMAND_SHORTCUTS: Record<string, readonly string[]> = {
  "editor.bold": ["ctrl+b"],
  "editor.italic": ["ctrl+i"],
  "editor.underline": ["ctrl+u"],
  "editor.strikethrough": ["ctrl+shift+s"],
  "editor.code": ["ctrl+e"],
  "editor.bulletList": ["ctrl+shift+8"],
  "editor.orderedList": ["ctrl+shift+7"],
  "editor.blockquote": ["ctrl+shift+b"],
  "editor.codeBlock": ["ctrl+alt+c"],
  "editor.undo": ["ctrl+z"],
  "editor.redo": ["ctrl+shift+z", "ctrl+y"],
};

const TIPTAP_SUPPORTED_COMMANDS = new Set([
  ...Object.keys(TIPTAP_NATIVE_COMMAND_SHORTCUTS),
  "editor.heading",
  "editor.save",
  "editor.toggleSourceMode",
]);

function getEffectiveCommandShortcut(commandId: string): string {
  return (
    settingsModel.state.editorSettings.keybindings[commandId] ?? EDITOR_COMMAND_BY_ID.get(commandId)?.defaultKey ?? ""
  );
}

function shouldLetTiptapNativeKeymapHandle(commandId: string, combo: string): boolean {
  const normalizedCombo = normalizeKeyCombo(combo);
  const nativeShortcuts = TIPTAP_NATIVE_COMMAND_SHORTCUTS[commandId];
  if (!nativeShortcuts?.some((shortcut) => normalizeKeyCombo(shortcut) === normalizedCombo)) {
    return false;
  }

  return normalizeKeyCombo(getEffectiveCommandShortcut(commandId)) === normalizedCombo;
}

function shouldBlockTiptapNativeKeymap(combo: string): boolean {
  const normalizedCombo = normalizeKeyCombo(combo);
  if (!normalizedCombo) return false;

  return Object.entries(TIPTAP_NATIVE_COMMAND_SHORTCUTS).some(([commandId, shortcuts]) => {
    const isNativeShortcut = shortcuts.some((shortcut) => normalizeKeyCombo(shortcut) === normalizedCombo);
    if (!isNativeShortcut) return false;
    return normalizeKeyCombo(getEffectiveCommandShortcut(commandId)) !== normalizedCombo;
  });
}

function isTiptapNativeKeymapCombo(combo: string): boolean {
  const normalizedCombo = normalizeKeyCombo(combo);
  if (!normalizedCombo) return false;

  return Object.values(TIPTAP_NATIVE_COMMAND_SHORTCUTS).some((shortcuts) =>
    shortcuts.some((shortcut) => normalizeKeyCombo(shortcut) === normalizedCombo),
  );
}

// ---------------------------------------------------------------------------
// TiptapEditorContext — tracks all active TipTap editor instances
// ---------------------------------------------------------------------------

const TiptapEditorContext = React.createContext<{
  registerEditor: (id: string, editor: Editor) => IDisposable;
  unregisterEditor: (id: string) => void;
} | null>(null);

export function useTiptapEditor(id: string, editor: Editor | null) {
  const ctx = React.useContext(TiptapEditorContext);
  const registeredRef = useRef(false);

  useEffect(() => {
    if (!editor || !ctx || registeredRef.current) return;
    registeredRef.current = true;
    const d = ctx.registerEditor(id, editor);
    const editorElement = editor.view.dom;
    const handleFocus = () => {
      tiptapRegistry.setActiveEditor(id);
      setActiveEditorType("tiptap");
    };
    const handleBlur = () => {
      window.setTimeout(() => {
        if (!editor.isFocused) {
          tiptapRegistry.clearActiveEditor(id);
        }
      }, 0);
    };
    editorElement.addEventListener("focus", handleFocus);
    editorElement.addEventListener("blur", handleBlur);
    if (editor.isFocused) {
      handleFocus();
    }
    return () => {
      registeredRef.current = false;
      editorElement.removeEventListener("focus", handleFocus);
      editorElement.removeEventListener("blur", handleBlur);
      tiptapRegistry.clearActiveEditor(id);
      d.dispose();
      ctx.unregisterEditor(id);
    };
  }, [editor, ctx, id]);
}

// ---------------------------------------------------------------------------
// TiptapEditorRegistry — tracks all active TipTap editor instances
// ---------------------------------------------------------------------------

class TiptapEditorRegistry {
  private _editors = new Map<string, Editor>();
  private _commandHandlers = new Map<string, Map<string, (editor: Editor) => void>>();
  private _activeEditorId: string | null = null;

  register(id: string, editor: Editor): IDisposable {
    this._editors.set(id, editor);
    return {
      dispose: () => {
        this._editors.delete(id);
        this._commandHandlers.delete(id);
        if (this._activeEditorId === id) {
          this._activeEditorId = null;
        }
      },
    };
  }

  unregister(id: string) {
    this._editors.delete(id);
    this._commandHandlers.delete(id);
    if (this._activeEditorId === id) {
      this._activeEditorId = null;
    }
  }

  /**
   * Register a command handler for a specific editor.
   * Used for editor-specific commands like editor.toggleSourceMode.
   */
  registerCommandHandler(editorId: string, commandId: string, handler: (editor: Editor) => void): IDisposable {
    if (!this._commandHandlers.has(editorId)) {
      this._commandHandlers.set(editorId, new Map());
    }
    this._commandHandlers.get(editorId)!.set(commandId, handler);
    return {
      dispose: () => {
        const handlers = this._commandHandlers.get(editorId);
        if (handlers?.get(commandId) === handler) {
          handlers.delete(commandId);
        }
        if (handlers?.size === 0) {
          this._commandHandlers.delete(editorId);
        }
      },
    };
  }

  /**
   * Get the editor's specific handler for a command, if any.
   */
  getCommandHandler(editorId: string, commandId: string): ((editor: Editor) => void) | undefined {
    return this._commandHandlers.get(editorId)?.get(commandId);
  }

  getAnyEditable(): Editor | null {
    for (const editor of this._editors.values()) {
      if (editor.isEditable) return editor;
    }
    return null;
  }

  getEditableById(id: string): Editor | null {
    const editor = this._editors.get(id);
    return editor?.isEditable ? editor : null;
  }

  setActiveEditor(id: string) {
    if (this._editors.has(id)) {
      this._activeEditorId = id;
    }
  }

  clearActiveEditor(id: string) {
    if (this._activeEditorId === id) {
      this._activeEditorId = null;
    }
  }

  getActiveEditableEditor(): { id: string; editor: Editor } | null {
    if (!this._activeEditorId) return null;
    const editor = this._editors.get(this._activeEditorId);
    if (!editor?.isEditable) return null;
    return { id: this._activeEditorId, editor };
  }

  /**
   * Returns the first editable editor and its id, or null if none are editable.
   */
  getAnyEditableEditor(): { id: string; editor: Editor } | null {
    for (const [id, editor] of this._editors) {
      if (editor.isEditable) return { id, editor };
    }
    return null;
  }

  clear() {
    this._editors.clear();
    this._commandHandlers.clear();
    this._activeEditorId = null;
  }
}

export const tiptapRegistry = new TiptapEditorRegistry();

// ---------------------------------------------------------------------------
// Command execution helpers
// ---------------------------------------------------------------------------

export async function executeTiptapCommand(editorId: string | null, editor: Editor, commandId: string): Promise<void> {
  // Try editor-specific handler first (e.g., editor.toggleSourceMode)
  if (editorId) {
    const handler = tiptapRegistry.getCommandHandler(editorId, commandId);
    if (handler) {
      handler(editor);
      return;
    }
  }

  // Generic TipTap commands
  switch (commandId) {
    // ── Formatting (TipTap handles these natively via keymap, but we also
    //    handle them here for the dispatch path) ───────────────────────
    case "editor.bold":
      editor.chain().focus().toggleBold().run();
      break;
    case "editor.italic":
      editor.chain().focus().toggleItalic().run();
      break;
    case "editor.underline":
      editor.chain().focus().toggleUnderline().run();
      break;
    case "editor.strikethrough":
      editor.chain().focus().toggleStrike().run();
      break;
    case "editor.code":
      editor.chain().focus().toggleCode().run();
      break;
    case "editor.heading":
      editor.chain().focus().toggleHeading({ level: 1 }).run();
      break;
    case "editor.bulletList":
      editor.chain().focus().toggleBulletList().run();
      break;
    case "editor.orderedList":
      editor.chain().focus().toggleOrderedList().run();
      break;
    case "editor.blockquote":
      editor.chain().focus().toggleBlockquote().run();
      break;
    case "editor.codeBlock":
      editor.chain().focus().toggleCodeBlock().run();
      break;
    case "editor.undo":
      editor.chain().focus().undo().run();
      break;
    case "editor.redo":
      editor.chain().focus().redo().run();
      break;
    // ── Edit commands (TipTap/StarterKit doesn't have these, use Monaco) ──
    // These fall through to CommandRegistry which handles them in Monaco
    // ── Other commands ───────────────────────────────────────────────
    case "editor.save":
      CommandRegistry.executeCommand("editor.save");
      break;
    default:
      CommandRegistry.executeCommand(commandId);
  }
}

// ---------------------------------------------------------------------------
// Dispatch command from Monaco action
// When Monaco intercepts a keyboard shortcut, this function is called to
// execute the command. It decides which editor to target based on activeEditorTypeRef.
// ---------------------------------------------------------------------------

// Track the currently active editor type
export type ActiveEditorType = "monaco" | "tiptap";
const activeEditorTypeRef = { current: "monaco" as ActiveEditorType };

export function setActiveEditorType(type: ActiveEditorType) {
  activeEditorTypeRef.current = type;
}

/**
 * Execute a command on the appropriate editor.
 * Called from Monaco action run() functions and from handleKeyDown callbacks.
 */
export function dispatchCommand(commandId: string, monacoEditor?: monacoEditor.editor.IStandaloneCodeEditor): void {
  // If TipTap is the active editor, execute TipTap command
  if (activeEditorTypeRef.current === "tiptap") {
    const activeTiptap = tiptapRegistry.getActiveEditableEditor() ?? tiptapRegistry.getAnyEditableEditor();
    if (activeTiptap) {
      void executeTiptapCommand(activeTiptap.id, activeTiptap.editor, commandId);
      return;
    }
  }

  // Monaco is active (source mode) - execute Monaco command
  const monacoActionId = MONACO_ACTION_MAP[commandId];
  if (monacoActionId && monacoEditor) {
    monacoEditor.getAction(monacoActionId)?.run();
  } else if (monacoEditor) {
    // Commands that need special handling in Monaco source mode
    switch (commandId) {
      case "editor.save":
        // Try to trigger save via TipTap registry first (for markdown editor source mode)
        // Then fall back to CommandRegistry
        {
          const tiptapEditor = tiptapRegistry.getEditableById("markdown-wysiwyg");
          if (tiptapEditor) {
            const handler = tiptapRegistry.getCommandHandler("markdown-wysiwyg", "editor.save");
            if (handler) {
              handler(tiptapEditor);
              break;
            }
          }
          CommandRegistry.executeCommand("editor.save");
        }
        break;
      case "editor.toggleSourceMode":
        {
          const tiptapEditor = tiptapRegistry.getEditableById("markdown-wysiwyg");
          if (tiptapEditor) {
            const handler = tiptapRegistry.getCommandHandler("markdown-wysiwyg", "editor.toggleSourceMode");
            if (handler) {
              handler(tiptapEditor);
              break;
            }
          }
        }
        break;
      case "editor.undo":
        monacoEditor.trigger("", "undo", null);
        break;
      case "editor.redo":
        monacoEditor.trigger("", "redo", null);
        break;
      default:
        // Try markdown formatting commands
        executeMarkdownFormatting(commandId, monacoEditor);
    }
  }
}

/**
 * Handle markdown formatting commands in Monaco source mode.
 * These wrap/unwrap the selection with markdown syntax.
 */
function executeMarkdownFormatting(commandId: string, editor: monacoEditor.editor.IStandaloneCodeEditor): void {
  const selection = editor.getSelection();
  if (!selection) return;

  const model = editor.getModel();
  if (!model) return;

  switch (commandId) {
    case "editor.undo":
      editor.trigger("", "undo", null);
      return;
    case "editor.redo":
      editor.trigger("", "redo", null);
      return;
  }

  const edit = getMarkdownFormattingEdit(commandId, model, selection);
  if (!edit) return;
  editor.executeEdits("", [
    {
      range: edit.range,
      text: edit.text,
    },
  ]);
  if (edit.cursor) {
    editor.setPosition(edit.cursor);
  }
}

// Import Monaco types for the dispatchCommand function
import type * as monacoEditor from "monaco-editor";

// ---------------------------------------------------------------------------
// Main provider
// ---------------------------------------------------------------------------

interface KeyboardDispatcherProviderProps {
  children: React.ReactNode;
}

export function KeyboardDispatcherProvider({ children }: KeyboardDispatcherProviderProps) {
  const { registerFocusChangeHandler, notifyFocusChange, getContext } = useFocusTracker();
  const kbDisposablesRef = useRef<IDisposable[]>([]);
  const dispatchRef = useRef<((event: KeyboardEvent) => boolean) | null>(null);
  const tiptapEditorDisposables = useRef<Map<string, IDisposable>>(new Map());

  // ---------------------------------------------------------------------------
  // Build keybinding rules from settings + EDITOR_COMMANDS defaults
  // ---------------------------------------------------------------------------

  const buildRules = useCallback(() => {
    const userKb = settingsModel.state.editorSettings.keybindings;
    return EDITOR_COMMANDS.map((cmd) => ({
      commandId: cmd.id,
      key: userKb[cmd.id] ?? cmd.defaultKey ?? "",
      when: "textInputFocus",
      weight: 0,
    })).filter((r) => r.key !== "");
  }, []);

  // ---------------------------------------------------------------------------
  // Register commands + keybindings on mount
  // ---------------------------------------------------------------------------

  useEffect(() => {
    // Register all editor commands
    const cmdDisposables = EDITOR_COMMANDS.map((cmd) =>
      CommandRegistry.registerCommand(
        cmd.id,
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        (_accessor, ..._args) => {
          // Generic handlers are no-ops here.
          // TipTap commands are executed by executeTiptapCommand().
          // Monaco commands are executed by Monaco's own action system.
        },
        {
          id: cmd.id,
          label: cmd.label,
          category: cmd.category,
          defaultKey: cmd.defaultKey,
        },
      ),
    );

    // Apply initial keybindings
    const rules = buildRules();
    kbDisposablesRef.current = rules.map((rule) => KeybindingRegistry.registerKeybinding(rule));

    return () => {
      cmdDisposables.forEach((d) => d.dispose());
      kbDisposablesRef.current.forEach((d) => d.dispose());
      kbDisposablesRef.current = [];
    };
  }, [buildRules]);

  // ---------------------------------------------------------------------------
  // Re-apply keybindings when settings change
  // ---------------------------------------------------------------------------

  useEffect(() => {
    const unsub = subscribe(settingsModel.state, () => {
      kbDisposablesRef.current.forEach((d) => d.dispose());
      kbDisposablesRef.current = [];
      const rules = buildRules();
      kbDisposablesRef.current = rules.map((rule) => KeybindingRegistry.registerKeybinding(rule));
    });

    return unsub;
  }, [buildRules]);

  // ---------------------------------------------------------------------------
  // Window-level keyboard event dispatcher
  // ---------------------------------------------------------------------------

  const dispatchKeyDown = useCallback((event: KeyboardEvent, options: KeyboardDispatchOptions = {}): boolean => {
    // Guard against undefined event (defensive)
    if (!event) return false;

    // Don't intercept modifier-only presses
    if (["Control", "Shift", "Alt", "Meta"].includes(event.key)) {
      return false;
    }

    // Get the combo string
    const combo = captureKeyCombo(event);
    if (!combo) return false;

    if (event.defaultPrevented) {
      return false;
    }

    if (activeEditorTypeRef.current !== "tiptap") {
      return false;
    }

    const preferredEditor = options.editorId ? tiptapRegistry.getEditableById(options.editorId) : null;
    const active = preferredEditor
      ? { id: options.editorId!, editor: preferredEditor }
      : tiptapRegistry.getActiveEditableEditor();

    if (!active) return false;

    // Don't dispatch TipTap-native commands — they are handled by
    // TipTap's own keymap which runs before our handleKeyDown callback.
    // Dispatching them would cause double execution (toggle on, toggle off).
    const ctx: Context = {
      textInputFocus: true,
      editorFocus: true,
      editorReadonly: !active.editor.isEditable,
    };
    const match = KeybindingRegistry.resolveKeybinding(event, ctx);
    if (match) {
      const hasEditorSpecificHandler = !!tiptapRegistry.getCommandHandler(active.id, match.commandId);
      if (!hasEditorSpecificHandler && !TIPTAP_SUPPORTED_COMMANDS.has(match.commandId)) {
        if (isTiptapNativeKeymapCombo(combo)) {
          event.preventDefault();
          event.stopPropagation();
          return true;
        }
        return false;
      }

      if (shouldLetTiptapNativeKeymapHandle(match.commandId, combo)) {
        return false;
      }

      event.preventDefault();
      event.stopPropagation();
      void executeTiptapCommand(active.id, active.editor, match.commandId);
      return true;
    }

    if (shouldBlockTiptapNativeKeymap(combo)) {
      event.preventDefault();
      event.stopPropagation();
      return true;
    }

    return false;
  }, []);

  // Keep dispatchRef in sync so window listener always calls latest
  dispatchRef.current = dispatchKeyDown;

  // Set up window-level listener for global shortcuts (Ctrl+S, etc.)
  useEventListener(
    "keydown",
    (event: KeyboardEvent) => {
      dispatchRef.current?.(event);
    },
    { capture: true },
  );

  // ---------------------------------------------------------------------------
  // Editor registry (for TipTap editors to register themselves)
  // ---------------------------------------------------------------------------

  const registerEditor = useCallback((id: string, editor: Editor): IDisposable => {
    tiptapEditorDisposables.current.get(id)?.dispose();
    const d = tiptapRegistry.register(id, editor);
    tiptapEditorDisposables.current.set(id, d);
    return d;
  }, []);

  const unregisterEditor = useCallback((id: string) => {
    tiptapEditorDisposables.current.get(id)?.dispose();
    tiptapEditorDisposables.current.delete(id);
    tiptapRegistry.unregister(id);
  }, []);

  // ---------------------------------------------------------------------------
  // Provide context
  // ---------------------------------------------------------------------------

  const ctxValue = useMemo<KeyboardDispatcherValue>(
    () => ({
      dispatchKeyDown,
      registerFocusChangeHandler,
      notifyFocusChange,
      getContext,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [dispatchKeyDown, registerFocusChangeHandler, notifyFocusChange, getContext],
  );

  return (
    <TiptapEditorContext.Provider value={{ registerEditor, unregisterEditor }}>
      <KeyboardDispatcherContext.Provider value={ctxValue}>{children}</KeyboardDispatcherContext.Provider>
    </TiptapEditorContext.Provider>
  );
}
