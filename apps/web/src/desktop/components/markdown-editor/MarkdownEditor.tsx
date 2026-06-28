/**
 * MarkdownEditor — Obsidian-style WYSIWYG markdown editor.
 *
 * - WYSIWYG mode: TipTap with full formatting toolbar
 * - Source mode: Monaco editor (raw markdown)
 * - Syncs seamlessly between the two modes
 */
import CodeEditor from "../code-editor/CodeEditor";
import MentionList from "@/components/tiptap-editor/mention-list";
import { EDITOR_COMMANDS, formatKeyCombo } from "../code-editor/keybindings";
import {
  AI_COMMANDS,
  executeMarkdownCommand,
  isMarkdownAiWriting,
  MdSlashCommand,
  subscribeMarkdownAiLifecycle,
} from "./slash-commands";
import Image from "@tiptap/extension-image";
import { TableKit } from "@tiptap/extension-table";
import { toast } from "sonner";
import { CalloutDecoration } from "./callout-decoration";
import { restoreWikiLinkBrackets, WikiLink } from "./wikilink-extension";
import Placeholder from "@tiptap/extension-placeholder";
import Link from "@tiptap/extension-link";
import TaskItem from "@tiptap/extension-task-item";
import TaskList from "@tiptap/extension-task-list";
import Underline from "@tiptap/extension-underline";
import { EditorContent, type Editor, useEditor, useEditorState } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import type { EditorProps } from "@monaco-editor/react";
import {
  Bold,
  CheckSquare,
  Code,
  Code2,
  FileCode,
  Italic,
  Link as LinkIcon,
  List,
  ListOrdered,
  ListTree,
  Loader2,
  Minus,
  PenLine,
  Quote,
  Redo,
  Strikethrough,
  Trash2,
  Underline as UnderlineIcon,
  Undo,
  X,
} from "lucide-react";
import { Markdown } from "tiptap-markdown";
import { memo, useCallback, useEffect, useMemo, useRef } from "react";
import { useReactive } from "ahooks";
import { useKeyboardDispatcher } from "@/contexts/keyboard-dispatcher-context";
import { useTiptapEditor, setActiveEditorType, tiptapRegistry } from "@/contexts/keyboard-dispatcher-provider";
import settingsModel from "@/models/settings.model";
import { useSnapshot } from "valtio";
import "./editor.css";

type ViewMode = "wysiwyg" | "source";
const MARKDOWN_EDITOR_ID = "markdown-wysiwyg";
const EDITOR_COMMAND_DEFAULT_KEY = new Map(EDITOR_COMMANDS.map((command) => [command.id, command.defaultKey]));

// Inline image paste/drop: read image files as data URLs and insert as image
// nodes (round-trips to `![](data:…)` markdown; the viewer renders them after
// allowing the `data:` protocol). Capped so the markdown file (data URL stored
// inline) stays reasonable — larger images should be linked rather than embedded.
// ponytail: data-URL inline; swap to a hosted upload + `![](raw-url)` when files grow.
const MAX_INLINE_IMAGE_BYTES = 1.5 * 1024 * 1024;

function imageFilesFromTransfer(data: DataTransfer | null): File[] {
  if (!data) return [];
  return Array.from(data.files).filter((file) => file.type.startsWith("image/"));
}

function readFileAsDataUrl(file: File): Promise<string | null> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : null);
    reader.onerror = () => resolve(null);
    reader.readAsDataURL(file);
  });
}

async function insertImageFiles(editor: Editor | null, files: File[]): Promise<void> {
  if (!editor) return;
  for (const file of files) {
    if (file.size > MAX_INLINE_IMAGE_BYTES) {
      toast.error(`图片「${file.name || "未命名"}」超过 1.5MB，请压缩后再插入`);
      continue;
    }
    const dataUrl = await readFileAsDataUrl(file);
    if (dataUrl) editor.chain().focus().setImage({ src: dataUrl, alt: file.name }).run();
  }
}

interface MarkdownEditorProps {
  value: string;
  onChange?: (value: string) => void;
  onMount?: EditorProps["onMount"];
  onEditorReady?: (editor: Editor | null) => void;
  onSave?: (value: string) => void;
  className?: string;
  editable?: boolean;
  /** Asset whose wiki pages power `[[wikilink]]` autocomplete + click-through.
   * When absent the wikilink behavior is fully disabled (the editor is
   * unchanged). */
  assetId?: string | null;
  /** Opens a wikilink target (a repo-relative wiki page path) in the host. */
  onOpenWikiLink?: (target: string) => void;
}

interface SelectionMenuState {
  from: number;
  to: number;
  top: number;
  left: number;
  source?: "selection" | "context";
}

interface AiActionState {
  label: string;
  abortController: AbortController;
  cancelling?: boolean;
}

const AI_MARKDOWN_SYNC_INTERVAL_MS = 500;

function getMenuPosition(event: React.MouseEvent<HTMLElement>) {
  const width = 288;
  const height = 320;
  const gap = 8;
  return {
    top: Math.max(gap, Math.min(event.clientY, window.innerHeight - height - gap)),
    left: Math.max(gap, Math.min(event.clientX, window.innerWidth - width - gap)),
  };
}

function AiActionLoadingPanel({
  label,
  cancelling,
  onCancel,
}: {
  label: string;
  cancelling?: boolean;
  onCancel: () => void;
}) {
  return (
    <div className="flex w-72 items-center gap-3 rounded-md border bg-popover px-3 py-3 text-popover-foreground shadow-[0_4px_6px_rgba(0,0,0,0.08)]">
      <Loader2 className="size-4 shrink-0 animate-spin text-primary" />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">{cancelling ? "正在取消" : `${label}处理中`}</div>
        <div className="mt-0.5 text-xs text-muted-foreground">AI 正在生成并批量写入编辑器...</div>
      </div>
      <button
        type="button"
        title="取消"
        disabled={cancelling}
        onClick={onCancel}
        className="flex size-7 shrink-0 items-center justify-center rounded border border-border/70 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
      >
        <X className="size-3.5" />
      </button>
    </div>
  );
}

function withShortcut(label: string, shortcut?: string) {
  return shortcut ? `${label} (${shortcut})` : label;
}

// ---------------------------------------------------------------------------
// Toolbar
// ---------------------------------------------------------------------------

function Divider() {
  return <div className="w-px h-4 bg-border/60 mx-0.5 shrink-0" />;
}

function TBtn({
  active,
  disabled,
  onClick,
  title,
  children,
}: {
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onClick={onClick}
      className={`flex items-center justify-center size-7 rounded transition-colors shrink-0 ${
        active ? "bg-primary/15 text-primary" : "text-muted-foreground hover:text-foreground hover:bg-muted/60"
      } disabled:opacity-30 disabled:pointer-events-none`}
    >
      {children}
    </button>
  );
}

function HeadingDropdown({ editor }: { editor: Editor }) {
  const state = useReactive({ open: false });
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        state.open = false;
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // Subscribe only to the active heading level — re-renders this dropdown when the
  // heading changes, not on every keystroke.
  const current = useEditorState({
    editor,
    selector: ({ editor: e }) => [1, 2, 3, 4].find((l) => e.isActive("heading", { level: l })),
  });
  const label = current ? `H${current}` : "正文";

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => (state.open = !state.open)}
        className="flex items-center gap-1 px-2 h-7 rounded text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
      >
        {label}
        <svg className="size-3" viewBox="0 0 16 16" fill="currentColor">
          <path
            d="M4 6l4 4 4-4"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            fill="none"
          />
        </svg>
      </button>
      {state.open && (
        <div className="absolute top-full left-0 mt-1 z-50 bg-popover border border-border rounded-md shadow-[0_4px_6px_rgba(0,0,0,0.08)] py-1 min-w-[120px]">
          {[
            {
              label: "正文",
              action: () => editor.chain().focus().setParagraph().run(),
            },
            {
              label: "标题 1",
              action: () => editor.chain().focus().toggleHeading({ level: 1 }).run(),
            },
            {
              label: "标题 2",
              action: () => editor.chain().focus().toggleHeading({ level: 2 }).run(),
            },
            {
              label: "标题 3",
              action: () => editor.chain().focus().toggleHeading({ level: 3 }).run(),
            },
            {
              label: "标题 4",
              action: () => editor.chain().focus().toggleHeading({ level: 4 }).run(),
            },
          ].map(({ label: l, action }) => (
            <button
              key={l}
              type="button"
              onClick={() => {
                action();
                state.open = false;
              }}
              className="w-full flex items-center px-3 py-1.5 text-sm hover:bg-accent/60 transition-colors text-left"
            >
              {l}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

const FormatToolbar = memo(function FormatToolbar({
  editor,
  shortcutFor,
}: {
  editor: Editor;
  shortcutFor: (commandId: string) => string;
}) {
  const addLink = useCallback(() => {
    const prev = editor.getAttributes("link").href as string | undefined;
    const url = window.prompt("链接地址", prev ?? "https://");
    if (url === null) return;
    if (url === "") {
      editor.chain().focus().extendMarkRange("link").unsetLink().run();
    } else {
      editor.chain().focus().extendMarkRange("link").setLink({ href: url }).run();
    }
  }, [editor]);

  // Subscribe to just the toolbar's active/availability flags. Combined with the
  // React.memo wrapper, the toolbar re-renders only when one of these actually
  // flips — not on every keystroke / parent re-render.
  const s = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      bold: e.isActive("bold"),
      italic: e.isActive("italic"),
      underline: e.isActive("underline"),
      strike: e.isActive("strike"),
      code: e.isActive("code"),
      link: e.isActive("link"),
      blockquote: e.isActive("blockquote"),
      codeBlock: e.isActive("codeBlock"),
      bulletList: e.isActive("bulletList"),
      orderedList: e.isActive("orderedList"),
      taskList: e.isActive("taskList"),
      inTable: e.isActive("table"),
      canUndo: e.can().undo(),
      canRedo: e.can().redo(),
    }),
  });

  return (
    <div className="flex items-center gap-0.5 flex-wrap">
      <HeadingDropdown editor={editor} />
      <Divider />
      <TBtn
        active={s.bold}
        onClick={() => editor.chain().focus().toggleBold().run()}
        title={withShortcut("加粗", shortcutFor("editor.bold"))}
      >
        <Bold className="size-3.5" />
      </TBtn>
      <TBtn
        active={s.italic}
        onClick={() => editor.chain().focus().toggleItalic().run()}
        title={withShortcut("斜体", shortcutFor("editor.italic"))}
      >
        <Italic className="size-3.5" />
      </TBtn>
      <TBtn
        active={s.underline}
        onClick={() => editor.chain().focus().toggleUnderline().run()}
        title={withShortcut("下划线", shortcutFor("editor.underline"))}
      >
        <UnderlineIcon className="size-3.5" />
      </TBtn>
      <TBtn
        active={s.strike}
        onClick={() => editor.chain().focus().toggleStrike().run()}
        title={withShortcut("删除线", shortcutFor("editor.strikethrough"))}
      >
        <Strikethrough className="size-3.5" />
      </TBtn>
      <TBtn
        active={s.code}
        onClick={() => editor.chain().focus().toggleCode().run()}
        title={withShortcut("行内代码", shortcutFor("editor.code"))}
      >
        <Code className="size-3.5" />
      </TBtn>
      <TBtn active={s.link} onClick={addLink} title="插入链接">
        <LinkIcon className="size-3.5" />
      </TBtn>
      <Divider />
      <TBtn
        active={s.blockquote}
        onClick={() => editor.chain().focus().toggleBlockquote().run()}
        title={withShortcut("引用", shortcutFor("editor.blockquote"))}
      >
        <Quote className="size-3.5" />
      </TBtn>
      <TBtn
        active={s.codeBlock}
        onClick={() => editor.chain().focus().toggleCodeBlock().run()}
        title={withShortcut("代码块", shortcutFor("editor.codeBlock"))}
      >
        <Code2 className="size-3.5" />
      </TBtn>
      <Divider />
      <TBtn
        active={s.bulletList}
        onClick={() => editor.chain().focus().toggleBulletList().run()}
        title={withShortcut("无序列表", shortcutFor("editor.bulletList"))}
      >
        <List className="size-3.5" />
      </TBtn>
      <TBtn
        active={s.orderedList}
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
        title={withShortcut("有序列表", shortcutFor("editor.orderedList"))}
      >
        <ListOrdered className="size-3.5" />
      </TBtn>
      <TBtn
        active={s.taskList}
        onClick={() => editor.chain().focus().toggleTaskList().run()}
        title="任务列表"
      >
        <CheckSquare className="size-3.5" />
      </TBtn>
      <Divider />
      <TBtn onClick={() => editor.chain().focus().setHorizontalRule().run()} title="分割线">
        <Minus className="size-3.5" />
      </TBtn>
      {s.inTable && (
        <>
          <Divider />
          <TBtn onClick={() => editor.chain().focus().addRowAfter().run()} title="在下方插入行">
            <span className="text-[10px] font-medium">+行</span>
          </TBtn>
          <TBtn onClick={() => editor.chain().focus().deleteRow().run()} title="删除当前行">
            <span className="text-[10px] font-medium">−行</span>
          </TBtn>
          <TBtn onClick={() => editor.chain().focus().addColumnAfter().run()} title="在右侧插入列">
            <span className="text-[10px] font-medium">+列</span>
          </TBtn>
          <TBtn onClick={() => editor.chain().focus().deleteColumn().run()} title="删除当前列">
            <span className="text-[10px] font-medium">−列</span>
          </TBtn>
          <TBtn onClick={() => editor.chain().focus().deleteTable().run()} title="删除表格">
            <Trash2 className="size-3.5" />
          </TBtn>
        </>
      )}
      <Divider />
      <TBtn
        disabled={!s.canUndo}
        onClick={() => editor.chain().focus().undo().run()}
        title={withShortcut("撤销", shortcutFor("editor.undo"))}
      >
        <Undo className="size-3.5" />
      </TBtn>
      <TBtn
        disabled={!s.canRedo}
        onClick={() => editor.chain().focus().redo().run()}
        title={withShortcut("重做", shortcutFor("editor.redo"))}
      >
        <Redo className="size-3.5" />
      </TBtn>
    </div>
  );
});

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function MarkdownEditor({
  value,
  onChange,
  onMount,
  onEditorReady,
  onSave,
  className,
  editable = true,
  assetId,
  onOpenWikiLink,
}: MarkdownEditorProps) {
  const { editorSettings } = useSnapshot(settingsModel.state);
  const state = useReactive({
    mode: "wysiwyg" as ViewMode,
    selectionMenu: null as SelectionMenuState | null,
    aiAction: null as AiActionState | null,
    // Obsidian-style live outline rail (opt-in; bumping docVersion on edits keeps
    // the heading list in sync only while the rail is open).
    outlineOpen: false,
    docVersion: 0,
  });
  // Track source-mode edits so we can sync back to TipTap on mode switch
  const sourceValueRef = useRef(value);
  const wysiwygContainerRef = useRef<HTMLDivElement | null>(null);
  // Track the last value that has already been pushed into TipTap so internal
  // edits don't get replayed back through setContent().
  const lastSyncedRef = useRef(value);
  const pendingAiSyncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Debounces the outline-rail refresh so typing doesn't force a re-render per
  // keystroke (the outline only needs to catch up shortly after a pause).
  const outlineBumpTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Keyboard dispatcher for WYSIWYG mode shortcuts
  const { dispatchKeyDown, notifyFocusChange } = useKeyboardDispatcher();
  const dispatchRef = useRef<typeof dispatchKeyDown>(() => false);

  useEffect(() => {
    dispatchRef.current = dispatchKeyDown;
  });

  // Keep setMode and editor accessible to the command handler
  const setModeRef = useRef((v: ViewMode) => (state.mode = v));
  const editorRef = useRef<Editor | null>(null);
  // Keep onSave accessible to the save handler
  const onSaveRef = useRef(onSave);
  useEffect(() => {
    onSaveRef.current = onSave;
  });
  // Route wikilink clicks through a ref so the once-created extension always
  // invokes the latest host callback.
  const onOpenWikiLinkRef = useRef(onOpenWikiLink);
  useEffect(() => {
    onOpenWikiLinkRef.current = onOpenWikiLink;
  });
  useEffect(() => {
    setModeRef.current = (v: ViewMode) => (state.mode = v);
  });
  useEffect(() => {
    editorRef.current = editor;
  });

  const handleModeChange = useCallback(
    (next: ViewMode) => {
      if (next === "wysiwyg" && state.mode === "source" && editorRef.current) {
        editorRef.current.commands.setContent(sourceValueRef.current);
        lastSyncedRef.current = sourceValueRef.current;
      }
      // Track which editor is active for keyboard shortcut dispatch
      setActiveEditorType(next === "wysiwyg" ? "tiptap" : "monaco");
      state.mode = next;
    },
    [state.mode],
  );

  const shortcutFor = useCallback(
    (commandId: string) => {
      const shortcut = editorSettings.keybindings[commandId] ?? EDITOR_COMMAND_DEFAULT_KEY.get(commandId) ?? "";
      return shortcut ? formatKeyCombo(shortcut) : "";
    },
    [editorSettings.keybindings],
  );

  const clearPendingAiSync = useCallback(() => {
    if (!pendingAiSyncTimerRef.current) return;
    clearTimeout(pendingAiSyncTimerRef.current);
    pendingAiSyncTimerRef.current = null;
  }, []);

  const syncMarkdownFromEditor = useCallback(
    (targetEditor: Editor) => {
      if (targetEditor.isDestroyed) return sourceValueRef.current;
      clearPendingAiSync();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const rawMd = ((targetEditor.storage as any).markdown as { getMarkdown(): string }).getMarkdown();
      // When wikilinks are active, undo the serializer's bracket-escaping so
      // `[[wikilink]]` round-trips as literal text in the saved file. No-op (and
      // skipped entirely) when assetId is absent, so other surfaces are unchanged.
      const md = assetId ? restoreWikiLinkBrackets(rawMd) : rawMd;
      const previous = lastSyncedRef.current;
      sourceValueRef.current = md;
      lastSyncedRef.current = md;
      if (md !== previous) {
        onChange?.(md);
      }
      return md;
    },
    [assetId, clearPendingAiSync, onChange],
  );

  const scheduleMarkdownSyncFromEditor = useCallback(
    (targetEditor: Editor) => {
      if (pendingAiSyncTimerRef.current) return;
      pendingAiSyncTimerRef.current = setTimeout(() => {
        pendingAiSyncTimerRef.current = null;
        if (!targetEditor.isDestroyed) {
          syncMarkdownFromEditor(targetEditor);
        }
      }, AI_MARKDOWN_SYNC_INTERVAL_MS);
    },
    [syncMarkdownFromEditor],
  );

  useEffect(() => {
    return () => {
      clearPendingAiSync();
      if (outlineBumpTimerRef.current) clearTimeout(outlineBumpTimerRef.current);
    };
  }, [clearPendingAiSync]);

  const editor = useEditor({
    extensions: [
      StarterKit,
      Underline,
      Markdown.configure({
        html: false,
        tightLists: true,
      }),
      Link.configure({ openOnClick: false }),
      TaskList,
      TaskItem.configure({ nested: true }),
      Placeholder.configure({ placeholder: "开始写作，输入 / 触发指令..." }),
      MdSlashCommand,
      // GFM tables — editable cells (Tab to move), resizable columns; round-trips
      // through tiptap-markdown's table serializer.
      TableKit.configure({ table: { resizable: true } }),
      // Inline images (block); allowBase64 so pasted/dropped data-URL images render.
      Image.configure({ inline: false, allowBase64: true }),
      // Live Obsidian-style callout boxes for `> [!TYPE]` blockquotes.
      CalloutDecoration,
      // `[[wikilink]]` autocomplete + highlight + click-through. No-ops entirely
      // when assetId is absent, so the editor degrades to its prior behavior.
      WikiLink.configure({
        assetId: assetId ?? null,
        onOpenWikiLink: (target) => onOpenWikiLinkRef.current?.(target),
      }),
    ],
    content: value,
    editorProps: {
      handlePaste: (_view, event) => {
        const files = imageFilesFromTransfer(event.clipboardData);
        if (files.length === 0) return false;
        event.preventDefault();
        void insertImageFiles(editorRef.current, files);
        return true;
      },
      handleDrop: (_view, event) => {
        const files = imageFilesFromTransfer((event as DragEvent).dataTransfer);
        if (files.length === 0) return false;
        event.preventDefault();
        void insertImageFiles(editorRef.current, files);
        return true;
      },
      handleKeyDown: (_view, event) => {
        // TipTap/ProseMirror passes a KeyEvent wrapper with .nativeEvent property.
        const nativeEvent = (event as unknown as { nativeEvent: KeyboardEvent }).nativeEvent;
        // Dispatch non-formatting commands. Formatting commands (bold, italic, etc.)
        // are handled by TipTap's keymap which runs BEFORE this callback,
        // so we skip them here to avoid double execution.
        if (dispatchRef.current(nativeEvent, { editorId: MARKDOWN_EDITOR_ID })) {
          return true;
        }
        // Let event continue to bubble (TipTap's keymap already handled it if applicable)
        return false;
      },
    },
    editable,
    onUpdate({ editor: e }) {
      if (state.outlineOpen) {
        if (outlineBumpTimerRef.current) clearTimeout(outlineBumpTimerRef.current);
        outlineBumpTimerRef.current = setTimeout(() => {
          state.docVersion++;
        }, 350);
      }
      if (isMarkdownAiWriting(e)) {
        scheduleMarkdownSyncFromEditor(e);
        return;
      }
      syncMarkdownFromEditor(e);
    },
  });

  // Register this TipTap editor with the keyboard dispatcher
  useTiptapEditor(MARKDOWN_EDITOR_ID, editor);

  useEffect(() => {
    editor?.setEditable(editable);
  }, [editable, editor]);

  useEffect(() => {
    if (!editor) return;
    const disposable = tiptapRegistry.registerCommandHandler(MARKDOWN_EDITOR_ID, "editor.toggleSourceMode", (ed) => {
      const next = state.mode === "wysiwyg" ? "source" : "wysiwyg";
      if (next === "wysiwyg") {
        ed.commands.setContent(sourceValueRef.current);
        lastSyncedRef.current = sourceValueRef.current;
      }
      setActiveEditorType(next === "wysiwyg" ? "tiptap" : "monaco");
      state.mode = next;
    });
    return () => disposable.dispose();
  }, [editor]);

  useEffect(() => {
    if (!editor) return;
    return subscribeMarkdownAiLifecycle(({ editor: targetEditor, phase }) => {
      if (targetEditor !== editor || phase !== "finish") return;
      syncMarkdownFromEditor(targetEditor);
    });
  }, [editor, syncMarkdownFromEditor]);

  // Track editor focus for keyboard dispatcher context
  useEffect(() => {
    if (!editor) return;
    const editorElement = editor.view.dom;
    const handleFocus = () => notifyFocusChange(true);
    const handleBlur = () => notifyFocusChange(false);
    editorElement.addEventListener("focus", handleFocus);
    editorElement.addEventListener("blur", handleBlur);
    // Set initial focus state
    notifyFocusChange(true);
    return () => {
      editorElement.removeEventListener("focus", handleFocus);
      editorElement.removeEventListener("blur", handleBlur);
      notifyFocusChange(false);
    };
  }, [editor, notifyFocusChange]);

  // Register save handler for Ctrl+S via tiptapRegistry (for keyboard dispatcher)
  useEffect(() => {
    if (!editor) return;
    const dispose = tiptapRegistry.registerCommandHandler(MARKDOWN_EDITOR_ID, "editor.save", () => {
      const currentEditor = editorRef.current;
      if (state.mode === "wysiwyg" && currentEditor) {
        onSaveRef.current?.(syncMarkdownFromEditor(currentEditor));
        return;
      }
      onSaveRef.current?.(sourceValueRef.current);
    });
    return () => dispose.dispose();
  }, [editor, syncMarkdownFromEditor]);

  // Set initial active editor type (WYSIWYG mode uses TipTap)
  useEffect(() => {
    setActiveEditorType("tiptap");
  }, []);

  useEffect(() => {
    onEditorReady?.(editor ?? null);
    return () => onEditorReady?.(null);
  }, [editor, onEditorReady]);

  useEffect(() => {
    if (!editor || value === lastSyncedRef.current) return;
    lastSyncedRef.current = value;
    sourceValueRef.current = value;
    editor.commands.setContent(value);
  }, [editor, value]);

  const openAiContextMenu = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      if (!editable || !editor || state.mode !== "wysiwyg" || state.aiAction) return;
      const target = event.target as HTMLElement | null;
      if (!target?.closest(".ProseMirror")) return;

      event.preventDefault();
      event.stopPropagation();

      const clicked = editor.view.posAtCoords({
        left: event.clientX,
        top: event.clientY,
      });
      if (!clicked) return;

      const currentSelection = editor.state.selection;
      const clickedInsideSelection =
        !currentSelection.empty && clicked.pos >= currentSelection.from && clicked.pos <= currentSelection.to;

      const range = clickedInsideSelection
        ? { from: currentSelection.from, to: currentSelection.to }
        : { from: clicked.pos, to: clicked.pos };

      if (!clickedInsideSelection) {
        editor.chain().focus().setTextSelection(clicked.pos).run();
      } else {
        editor.commands.focus();
      }

      state.selectionMenu = {
        ...range,
        ...getMenuPosition(event),
        source: "context",
      };
    },
    [editable, editor, state.aiAction, state.mode],
  );

  useEffect(() => {
    const dom = wysiwygContainerRef.current;
    if (!editor || state.mode !== "wysiwyg" || !dom) {
      state.selectionMenu = null;
      return;
    }

    let rafId = 0;
    const scheduleSelectionRefresh = () => {
      if (state.aiAction) return;
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        const { from, to, empty } = editor.state.selection;
        if (empty || from === to) {
          if (state.selectionMenu?.source === "context") return;
          state.selectionMenu = null;
          return;
        }
        const text = editor.state.doc.textBetween(from, to, "\n").trim();
        if (!text) {
          state.selectionMenu = null;
          return;
        }
        try {
          const start = editor.view.coordsAtPos(from);
          const end = editor.view.coordsAtPos(to);
          state.selectionMenu = {
            from,
            to,
            top: Math.max(start.bottom, end.bottom) + 4,
            left: Math.max(8, Math.min(start.left, end.left)),
            source: "selection",
          };
        } catch {
          state.selectionMenu = null;
        }
      });
    };
    const handleMouseUp = () => scheduleSelectionRefresh();
    const handleKeyUp = () => scheduleSelectionRefresh();
    const handleBlur = () => {
      window.setTimeout(() => {
        if (state.aiAction) return;
        if (!editor.isFocused) {
          state.selectionMenu = null;
        }
      }, 0);
    };
    editor.on("selectionUpdate", scheduleSelectionRefresh);
    dom.addEventListener("mouseup", handleMouseUp);
    dom.addEventListener("keyup", handleKeyUp);
    dom.addEventListener("blur", handleBlur, true);
    scheduleSelectionRefresh();

    return () => {
      cancelAnimationFrame(rafId);
      editor.off("selectionUpdate", scheduleSelectionRefresh);
      dom.removeEventListener("mouseup", handleMouseUp);
      dom.removeEventListener("keyup", handleKeyUp);
      dom.removeEventListener("blur", handleBlur, true);
    };
  }, [editor, state.mode]);

  const runMenuCommand = useCallback(
    (item: (typeof AI_COMMANDS)[number]) => {
      if (!editor || !state.selectionMenu || state.aiAction) return;
      const range = state.selectionMenu;
      const abortController = new AbortController();
      state.aiAction = {
        label: item.label,
        abortController,
      };
      void executeMarkdownCommand(editor, range, item.id, {
        signal: abortController.signal,
      }).finally(() => {
        state.aiAction = null;
        state.selectionMenu = null;
      });
    },
    [editor],
  );

  // Live document outline (top-level headings) — recomputed whenever the rail is
  // open and the doc changes (docVersion). doc.forEach walks immediate children;
  // markdown headings are always top-level so that is sufficient.
  const outlineItems = useMemo(() => {
    if (!editor || !state.outlineOpen) return [];
    // Touch docVersion so this recomputes on each edit while the rail is open.
    void state.docVersion;
    const items: { level: number; text: string; pos: number }[] = [];
    editor.state.doc.forEach((node, offset) => {
      if (node.type.name === "heading") {
        items.push({ level: (node.attrs.level as number) ?? 1, text: node.textContent || "(无标题)", pos: offset });
      }
    });
    return items;
  }, [editor, state.outlineOpen, state.docVersion]);

  const scrollToHeading = useCallback((pos: number) => {
    const ed = editorRef.current;
    if (!ed) return;
    ed.chain().setTextSelection(pos + 1).run();
    const dom = ed.view.nodeDOM(pos);
    if (dom instanceof HTMLElement) dom.scrollIntoView({ block: "start", behavior: "smooth" });
  }, []);

  return (
    <div className={`flex flex-col h-full bg-background ${className ?? ""}`}>
      {/* Toolbar */}
      <div className="md-editor-toolbar flex items-center gap-2 px-3 py-1.5 border-b border-border/40 bg-muted/10 shrink-0 flex-wrap">
        {/* Mode toggle */}
        <div className="flex items-center gap-0.5 bg-muted/60 rounded-md p-0.5 shrink-0">
          <button
            type="button"
            onClick={() => handleModeChange("wysiwyg")}
            title={withShortcut("切换到所见即所得", shortcutFor("editor.toggleSourceMode"))}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-xs transition-colors ${
              state.mode === "wysiwyg"
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <PenLine className="size-3" />
            所见即所得
          </button>
          <button
            type="button"
            onClick={() => handleModeChange("source")}
            title={withShortcut("切换到源码", shortcutFor("editor.toggleSourceMode"))}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-xs transition-colors ${
              state.mode === "source"
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <FileCode className="size-3" />
            源码
          </button>
        </div>

        {/* Formatting buttons — WYSIWYG only */}
        {editable && state.mode === "wysiwyg" && editor && (
          <>
            <Divider />
            <FormatToolbar editor={editor} shortcutFor={shortcutFor} />
          </>
        )}

        {/* Outline toggle — WYSIWYG only (navigation, available read-only too) */}
        {state.mode === "wysiwyg" && editor && (
          <button
            type="button"
            onClick={() => {
              state.outlineOpen = !state.outlineOpen;
              if (state.outlineOpen) state.docVersion++;
            }}
            title="大纲"
            className={`ml-auto flex items-center justify-center size-7 rounded transition-colors shrink-0 ${
              state.outlineOpen ? "bg-primary/15 text-primary" : "text-muted-foreground hover:text-foreground hover:bg-muted/60"
            }`}
          >
            <ListTree className="size-3.5" />
          </button>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 min-h-0 overflow-hidden">
        {state.mode === "wysiwyg" ? (
          <div className="flex h-full min-h-0">
          <div
            ref={wysiwygContainerRef}
            className="md-editor-content h-full flex-1 overflow-y-auto"
            onContextMenu={openAiContextMenu}
          >
            <EditorContent editor={editor} className="h-full" />
            {editor && state.selectionMenu && (
              <div
                className="fixed z-[9999]"
                style={{
                  top: state.selectionMenu.top,
                  left: state.selectionMenu.left,
                }}
                onMouseDown={(event) => {
                  event.preventDefault();
                }}
              >
                {state.aiAction ? (
                  <AiActionLoadingPanel
                    label={state.aiAction.label}
                    cancelling={state.aiAction.cancelling}
                    onCancel={() => {
                      if (!state.aiAction) return;
                      state.aiAction.cancelling = true;
                      state.aiAction.abortController.abort();
                    }}
                  />
                ) : (
                  <MentionList
                    items={AI_COMMANDS}
                    executeOnMouseDown
                    command={runMenuCommand}
                    onClose={() => (state.selectionMenu = null)}
                  />
                )}
              </div>
            )}
          </div>
          {state.outlineOpen && editor && (
            <aside className="w-56 shrink-0 overflow-y-auto border-l border-border/40 bg-muted/10 px-2 py-2">
              <div className="px-1 pb-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                大纲
              </div>
              {outlineItems.length === 0 ? (
                <div className="px-1 py-2 text-xs text-muted-foreground">暂无标题</div>
              ) : (
                <ul className="space-y-0.5">
                  {outlineItems.map((item) => (
                    <li key={item.pos}>
                      <button
                        type="button"
                        onClick={() => scrollToHeading(item.pos)}
                        style={{ paddingLeft: `${(item.level - 1) * 10 + 4}px` }}
                        className="block w-full truncate rounded px-1 py-1 text-left text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                        title={item.text}
                      >
                        {item.text}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </aside>
          )}
          </div>
        ) : (
          <CodeEditor
            language="markdown"
            value={sourceValueRef.current}
            onChange={(v) => {
              if (!editable) return;
              sourceValueRef.current = v ?? "";
              onChange?.(v ?? "");
            }}
            onMount={onMount}
            options={{ readOnly: !editable }}
          />
        )}
      </div>
    </div>
  );
}
