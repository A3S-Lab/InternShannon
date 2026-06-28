/**
 * FileTreeEditor — resizable file-tree + multi-format editor.
 * Used by KnowledgePage for local knowledge-base file management.
 */
import "@/desktop/lib/monaco-env";
import CodeEditor from "@/desktop/components/code-editor/CodeEditor";
import { AppError } from "@/lib/error";
import {
  DockviewReact,
  type DockviewReadyEvent,
  type IDockviewPanelHeaderProps,
  type IDockviewPanelProps,
  type IPaneviewPanelProps,
  PaneviewReact,
  type PaneviewReadyEvent,
} from "@/desktop/components/dockview";
import MarkdownEditor from "@/desktop/components/markdown-editor/MarkdownEditor";
import { useInterval } from "ahooks";
import React from "react";
import { OFFICE_FILE_EXTENSIONS } from "@a3s-lab/ooxml/capabilities";

import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { readUserJsonStorage, writeUserJsonStorage } from "@/lib/browser-storage";
import { writeClipboardText } from "@/lib/clipboard";
import { createCompatId, hasTauriCore, isApplePlatform } from "@/lib/runtime-environment";
import { cn } from "@/lib/utils";
import { workspaceApi, type GitStatusResult } from "@/lib/workspace-api";
import {
  getParentWorkspacePath,
  getWorkspaceBaseName,
  getWorkspaceRelativePath as getRelativeWorkspacePath,
  joinWorkspacePath as joinWorkspacePathParts,
} from "@/lib/workspace-path";
import {
  Archive,
  Braces,
  ChevronsUp,
  Code,
  Database,
  File,
  FileCode,
  FileCode2,
  FileText,
  Folder,
  GitBranch,
  Image,
  Music,
  Presentation,
  Table,
  Terminal,
  Video,
} from "lucide-react";

import { InputDialog } from "./input-dialog";
import { ConfirmDialog } from "./confirm-dialog";
import { DiffDialog } from "./diff-dialog";
import { IntegratedTerminal } from "@/components/workspace/integrated-terminal";
import { GlobalSearch } from "@/components/workspace/global-search";
import { resolveFileTreePanelLayout } from "./layout-state";
import {
  FileHistoryDialog,
  FileSnapshotCompareDialog,
  FileSnapshotPreviewDialog,
  type LocalFileSnapshot,
} from "./file-history-dialog";
import { ExternalChangeDialog } from "./external-change-dialog";
import {
  BinaryFilePanel,
  ImageViewerPanel,
  MermaidViewerPanel,
  OfficeViewerPanel,
  PdfViewerPanel,
} from "./file-viewer-panels";
import { InlineRenameInput, InlineCreationInput } from "./inline-inputs";
import { SourceControlPanel } from "./source-control-panel";
import {
  FILE_EDITOR_SAVE_ALL_EVENT,
  FILE_TREE_EDITOR_COMMAND_EVENT,
  type FileEditorSaveAllDetail,
  type FileTreeEditorCommandDetail,
} from "./events";
import {
  DOCUMENT_KEYBINDINGS,
  isEditableKeyboardTarget,
  resolveFileTreeDocumentShortcut,
  resolveFileTreeScopedShortcut,
  shouldHandleFileTreeDeleteKey,
} from "./keyboard-shortcuts";
import { CommandPalette } from "./command-palette";
import type { WorkspaceCommand } from "./command-registry";
import { ShortcutsCheatsheet } from "./shortcuts-cheatsheet";
import { QuickOpen, type QuickOpenFile } from "./quick-open";
import {
  resolveNativeRevealPath,
  type NativeOpenOptions,
} from "./native-reveal-state";

// Lucide icons for UI controls (keep these)
import {
  ArrowRightToLine,
  Check,
  ChevronDown,
  ChevronRight,
  ClipboardPaste,
  Copy,
  ExternalLink,
  Eye,
  FilePlus,
  FolderOpen,
  FolderPlus,
  Globe,
  History,
  Layers,
  Loader2,
  Minimize2,
  MoreHorizontal,
  PanelLeftOpen,
  Pencil,
  Pin,
  RefreshCw,
  RotateCcw,
  RotateCw,
  Save,
  Scissors,
  Search,
  Trash2,
  WrapText,
  X,
  XCircle,
} from "lucide-react";

import type { Editor as TiptapEditor } from "@tiptap/react";
import * as monacoEditor from "monaco-editor";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useReactive } from "ahooks";
import { createPortal } from "react-dom";
import type { ImperativePanelHandle } from "react-resizable-panels";
import { toast } from "sonner";
import "./styles.css";

// ── File Tab Icon (used in Dockview tabs) ───────────────────────────────────

function getFileTabIconElement(name: string, ext: string): React.ReactNode {
  const lowerName = name.toLowerCase();

  // Special filenames (before extension check)
  if (lowerName === "dockerfile" || lowerName === ".dockerignore")
    return <Database className="size-4 text-[#2496ed]" />;
  if (lowerName === ".gitignore" || lowerName === ".gitattributes" || lowerName === ".gitkeep")
    return <Code className="size-4 text-[#f05032]" />;

  // JavaScript / TypeScript
  if (["js", "jsx"].includes(ext)) return <FileCode2 className="size-4 text-[#f0db4f]" />;
  if (["ts", "tsx"].includes(ext)) return <FileCode2 className="size-4 text-[#3178c6]" />;

  // Backend languages
  if (["py"].includes(ext)) return <Code className="size-4 text-[#3776ab]" />;
  if (["kt", "kts"].includes(ext)) return <Code className="size-4 text-[#7f52ff]" />;
  if (["swift"].includes(ext)) return <Code className="size-4 text-[#fa7343]" />;
  if (["php"].includes(ext)) return <Code className="size-4 text-[#777bb4]" />;
  if (["rs"].includes(ext)) return <Code className="size-4 text-[#dea584]" />;
  if (["go"].includes(ext)) return <Code className="size-4 text-[#00add8]" />;
  if (["rb"].includes(ext)) return <Code className="size-4 text-[#cc342d]" />;
  if (["java", "c", "cpp", "h", "hpp"].includes(ext)) return <Code className="size-4 text-[#dc143c]" />;

  // Web
  if (["html", "htm"].includes(ext)) return <Globe className="size-4 text-[#e34c26]" />;
  if (["css", "scss", "sass", "less"].includes(ext)) return <FileCode className="size-4 text-[#264de4]" />;
  if (["vue"].includes(ext)) return <Code className="size-4 text-[#4fc08d]" />;
  if (["svelte"].includes(ext)) return <Code className="size-4 text-[#ff3e00]" />;

  // Config / Data
  if (["json", "jsonc"].includes(ext)) return <Braces className="size-4 text-[#f59e0b]" />;
  if (["yaml", "yml"].includes(ext)) return <FileText className="size-4 text-[#cb171e]" />;
  if (["toml"].includes(ext)) return <FileText className="size-4 text-[#9422ff]" />;
  if (["ini", "conf", "env"].includes(ext)) return <FileText className="size-4 text-muted-foreground" />;
  if (["xml"].includes(ext)) return <Code className="size-4 text-[#16a34a]" />;

  // Documents
  if (["md", "mdx"].includes(ext)) return <FileText className="size-4 text-primary" />;
  if (["txt", "rst"].includes(ext)) return <FileText className="size-4 text-muted-foreground" />;
  if (["pdf"].includes(ext)) return <FileText className="size-4 text-[#dc2626]" />;

  // Media
  if (["png", "jpg", "jpeg", "gif", "webp", "bmp", "ico", "avif", "svg"].includes(ext))
    return <Image className="size-4 text-[#a855f7]" />;
  if (["mp4", "mov", "avi", "mkv", "webm"].includes(ext)) return <Video className="size-4 text-[#ec4899]" />;
  if (["mp3", "wav", "ogg", "flac", "aac"].includes(ext)) return <Music className="size-4 text-[#22c55e]" />;

  // Archives
  if (["zip", "tar", "gz", "rar", "7z", "bz2"].includes(ext)) return <Archive className="size-4 text-[#d97706]" />;

  // Database
  if (["db", "sqlite", "sql"].includes(ext)) return <Database className="size-4 text-[#0891b2]" />;

  // Shell / Scripts
  if (["sh", "bash", "zsh", "fish"].includes(ext)) return <Terminal className="size-4 text-[#22c55e]" />;
  if (["ps1", "bat", "cmd"].includes(ext)) return <Terminal className="size-4 text-muted-foreground" />;

  // Default
  return <File className="size-4 text-muted-foreground" />;
}

interface FileTabProps {
  api: import("@/desktop/components/dockview-core").DockviewPanelApi;
  containerApi: import("@/desktop/components/dockview-core").DockviewApi;
  params: {
    path?: string;
    isPreview?: boolean;
    isPinned?: boolean;
    isDirty?: boolean;
    showPreviewIndicator?: boolean;
    workbenchVariant?: "default" | "vscode";
    onCloseRequest?: (path: string) => void;
    onPinRequest?: (path: string) => void;
    [key: string]: unknown;
  };
  hideClose?: boolean;
  closeActionOverride?: () => void;
  className?: string;
  onClick?: React.MouseEventHandler<HTMLDivElement>;
  onCloseRequest?: (path: string) => void;
  [key: string]: unknown;
}

function FileTab({ api, params, hideClose, closeActionOverride, className, onClick, onCloseRequest }: FileTabProps) {
  const [title, setTitle] = React.useState<string | undefined>(api.title as string | undefined);

  React.useEffect(() => {
    const disposable = api.onDidTitleChange((event) => {
      setTitle((current) => (current === event.title ? current : event.title));
    });
    return () => disposable.dispose();
  }, [api]);

  const path = params?.path ?? "";
  const fileName = path.split("/").pop() ?? title ?? "";
  const ext = fileName.split(".").pop()?.toLowerCase() ?? "";
  const icon = getFileTabIconElement(fileName, ext);
  const isPreview = !!params?.isPreview && !params?.isPinned;
  const isVsCodeTab = params?.workbenchVariant === "vscode";
  const onCloseRequestParam = params?.onCloseRequest;
  const onPinRequest = params?.onPinRequest;
  const rawTitle = title ?? fileName;
  const titleHasDirtySuffix = /\s+\*$/.test(rawTitle);
  const displayTitle = isVsCodeTab ? rawTitle.replace(/\s+\*$/, "") : rawTitle;
  const isDirty = !!params?.isDirty || titleHasDirtySuffix;
  const showPreviewIndicator = params?.showPreviewIndicator !== false;

  const requestClose = React.useCallback(() => {
    const requestCloseHandler = onCloseRequest ?? onCloseRequestParam;
    if (requestCloseHandler) {
      requestCloseHandler(path);
    } else if (closeActionOverride) {
      closeActionOverride();
    } else {
      api.close();
    }
  }, [api, closeActionOverride, onCloseRequest, onCloseRequestParam, path]);

  const handleClose = React.useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      event.preventDefault();
      event.stopPropagation();
      requestClose();
    },
    [requestClose],
  );

  const handleCloseKeyDown = React.useCallback(
    (event: React.KeyboardEvent<HTMLButtonElement>) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      event.stopPropagation();
      requestClose();
    },
    [requestClose],
  );

  const handleClick = React.useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      if (event.defaultPrevented) return;
      api.setActive();
      onClick?.(event);
    },
    [api, onClick],
  );

  const handleDoubleClick = React.useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      event.preventDefault();
      event.stopPropagation();
      onPinRequest?.(path);
    },
    [onPinRequest, path],
  );

  const handleTabKeyDown = React.useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      api.setActive();
    },
    [api],
  );

  return (
    <div
      className={cn("dv-default-tab", isPreview && "is-preview-tab", isDirty && "is-dirty", className)}
      data-panel-id={path}
      role="tab"
      tabIndex={0}
      aria-selected={api.isActive}
      aria-label={`${displayTitle}${isDirty ? "，未保存" : ""}${isPreview ? "，预览" : ""}`}
      title={path || displayTitle}
      onClick={handleClick}
      onDoubleClick={handleDoubleClick}
      onKeyDown={handleTabKeyDown}
    >
      <span className="dv-default-tab-icon" aria-hidden="true">
        {icon}
      </span>
      <span className="dv-default-tab-content">{displayTitle}</span>
      {isPreview && showPreviewIndicator && (
        <span className="dv-default-tab-preview" title="预览，双击保持打开" aria-hidden="true">
          <Pin className="size-3" aria-hidden="true" />
        </span>
      )}
      {isVsCodeTab && isDirty && <span className="dv-default-tab-dirty" title="未保存" aria-hidden="true" />}
      {!hideClose && (
        <button
          type="button"
          className="dv-default-tab-action"
          aria-label={`关闭 ${displayTitle}`}
          title="关闭"
          onPointerDown={(e) => e.preventDefault()}
          onClick={handleClose}
          onKeyDown={handleCloseKeyDown}
        >
          <X className="size-3" aria-hidden="true" />
        </button>
      )}
    </div>
  );
}

// ── Pointer-based drag state (bypasses broken HTML5 drag API in Tauri WebKit) ─
// Using pointermove/pointerup instead of the native drag API, which is
// unreliable in WebKit-based WebViews (Tauri macOS).

/// Drop indicator position: before (above item), after (below item), inside (folder)
export interface DropIndicator {
  path: string;
  position: "before" | "after" | "inside";
}

let _pdSrc: { path: string; isDir: boolean; name: string } | null = null;
let _pdActive = false;
let _pdGhost: HTMLElement | null = null;
let _pdOnChange: ((di: DropIndicator | null) => void) | null = null;
let _pdOnDrop: ((src: { path: string; isDir: boolean } | null, dest: string | null) => void) | null = null;
let _pdRoot: string | null = null;

// ── Types ─────────────────────────────────────────────────────────────────────

export interface FsNode {
  name: string;
  path: string;
  is_dir: boolean;
  size?: number;
  mtimeMs?: number;
  modifiedAt?: string;
  extension?: string;
  isBinary?: boolean;
  children?: FsNode[];
  childrenLoaded?: boolean;
  loadError?: string;
}

export interface FileTreeEditorStaticFile {
  path: string;
  content: string;
  size?: number;
  mtimeMs?: number;
  modifiedAt?: string;
}

export interface FileTreeEditorStateSnapshot {
  rootPath: string | null;
  loading: boolean;
  readOnly?: boolean;
  treeLoadError: string | null;
  partialLoadErrorCount: number;
  activeFile: string | null;
  selectedPaths: string[];
  dirtyFileCount: number;
  openFileCount: number;
  totalFiles: number;
  totalFolders: number;
  gitBranch: string | null;
  gitChangeCount: number;
  gitStatusLoading: boolean;
  gitStatusError: string | null;
  activeFileType: "text" | "pdf" | "image" | "office" | "binary" | "mermaid" | null;
  activeLanguageLabel: string | null;
  activeSaveStatus: "saved" | "dirty" | "saving" | "error" | null;
  cursorPosition: { line: number; column: number } | null;
  lineCount: number | null;
  sidebarCollapsed: boolean;
  sidebarPanel: SidebarPanelId;
}

export interface FileTreeEditorProps {
  /** Root directory to browse. Null = empty state. */
  rootPath: string | null;
  /** 额外命令(由父级注入,合并进命令面板)—— 如上线流水线的「体检 / 部署 / 调试」。 */
  extraCommands?: WorkspaceCommand[];
  /** Initial content for newly created text files. */
  newFileTemplate?: (stem: string) => string;
  /** How many directory levels to fetch. Default: 2 (lazy loading fetches more on expand) */
  treeDepth?: number;
  /** How many rendered directory levels are expanded by default. Default: 1. */
  autoExpandDepth?: number;
  /** Optional content rendered in the file tree toolbar (upper-left). */
  headerSlot?: React.ReactNode;
  /** Optional content rendered directly below the explorer search input (above the tree). */
  afterSearchSlot?: React.ReactNode;
  /**
   * Optional third activity-bar pane (peer of explorer / search). When
   * provided the activity bar shows an extra icon button; clicking it
   * swaps the sidebar body to `content`. Used by the asset editor to
   * expose the development board as a sibling tab rather than embedding
   * it inside the search pane. Only honored by the `vscode` variant.
   */
  extraSidebarPane?: {
    id: "board";
    label: string;
    icon: React.ComponentType<{ className?: string }>;
    content: React.ReactNode;
    /** Optional DOM target for content-owned actions rendered into the VS Code titlebar. */
    titlebarActionsPortalId?: string;
  };
  /**
   * Optional fourth activity-bar pane sibling—placed right below `extraSidebarPane`
   * (board) in the vertical activity bar. Used by the asset editor to expose the
   * agent debug surface (tool / agentic 一键临时部署 + 调试) as a peer of board.
   *
   * Kept separate from `extraSidebarPane` so the board's wiring (id literal,
   * sidebarPanelRequest target) stays untouched; this is a pure addition.
   * Only honored by the `vscode` variant.
   */
  debugSidebarPane?: {
    id: "debug";
    label: string;
    icon: React.ComponentType<{ className?: string }>;
    content: React.ReactNode;
  };
  /** Optional asset overview pane rendered as a first-class activity-bar view. */
  overviewSidebarPane?: {
    id: "assetOverview";
    label: string;
    icon: React.ComponentType<{ className?: string }>;
    content: React.ReactNode;
    /** Optional DOM target for content-owned actions rendered into the VS Code titlebar. */
    titlebarActionsPortalId?: string;
  };
  /**
   * Initial activity-bar pane. Only honored at mount; subsequent
   * user clicks own the state. Lets deep-links like `?board=open`
   * land on the right pane without an extra navigation step.
   */
  defaultSidebarPanel?: SidebarPanelId;
  /**
   * Imperative request from the host to force-switch the sidebar pane.
   * The change fires only when `nonce` changes (so the host can keep
   * passing the same target without retriggering). Used by the editor
   * shell to swing the sidebar to the board after enqueuing a
   * diagnose/optimize task.
   */
  sidebarPanelRequest?: {
    panel: SidebarPanelId;
    nonce: number;
  };
  /** Host-owned activity-bar panes rendered after the built-in WebIDE panes. */
  customSidebarPanes?: readonly FileTreeEditorCustomSidebarPane[];
  /** Sidebar width presets for embedded layouts. */
  sidebarDefaultSize?: number;
  sidebarMinSize?: number;
  sidebarMaxSize?: number;
  /** Read-only mode. Default: false */
  readOnly?: boolean;
  /** In-memory files for read-only previews. Paths are relative to rootPath. */
  staticFiles?: readonly FileTreeEditorStaticFile[];
  /** Enable non-VS Code local snapshot UI. Default: false */
  enableLocalSnapshots?: boolean;
  /** Use the rich Markdown editor instead of Monaco source editing. Default: false */
  enableRichMarkdown?: boolean;
  /** Asset id for the rich Markdown editor's `[[wikilink]]` autocomplete +
   * click-through. When absent, wikilink behavior is disabled. */
  assetId?: string | null;
  /** Use a plainer VS Code-like chrome for digital asset workspaces. */
  variant?: "default" | "vscode";
  /** Override whether per-file editor actions are shown in the breadcrumb bar. */
  showEditorActions?: boolean;
  /** Override whether the editor watermark exposes create/refresh quick actions. */
  showWatermarkActions?: boolean;
  /** Override whether the explorer shows its built-in filename filter. */
  showExplorerSearchFilter?: boolean;
  /** Override whether the built-in editor status bar is rendered. Default: true */
  showStatusBar?: boolean;
  /** Emits coarse editor state for host shells and status bars. */
  onStateChange?: (snapshot: FileTreeEditorStateSnapshot) => void;
  /** Fires after a text editor panel has successfully persisted a file. */
  onAfterSave?: (path: string) => void;
  /** Optional command scope so shared shells do not trigger every mounted editor. */
  commandScope?: string;
  /** Persist and restore open files/tree state for this root. Default: true. */
  persistSession?: boolean;
  className?: string;
}

type FileType = "text" | "pdf" | "image" | "office" | "binary" | "mermaid";

export type FileTreeEditorCustomSidebarPane = {
  id: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  content: React.ReactNode;
  /** Full-width panes temporarily replace the editor area, like the board view. */
  fullWidth?: boolean;
  bodyClassName?: string;
  /** Optional DOM target for content-owned actions rendered into the VS Code titlebar. */
  titlebarActionsPortalId?: string;
};

type BuiltinSidebarPanelId = "explorer" | "assetOverview" | "search" | "sourceControl" | "board" | "debug";
type CustomSidebarPanelId = `custom:${string}`;
type SidebarPanelId = BuiltinSidebarPanelId | CustomSidebarPanelId;

function toCustomSidebarPanelId(id: string): CustomSidebarPanelId {
  return `custom:${id}`;
}

type EditorSaveStatusValue = "saved" | "dirty" | "saving" | "error";

interface FileEditorStatusSnapshot {
  path: string;
  languageLabel: string;
  saveStatus: EditorSaveStatusValue;
  lastSavedAt: number | null;
  cursorPosition: { line: number; column: number };
  selectionLength: number;
  indentation: { tabSize: number; insertSpaces: boolean };
  eol: string;
  lineCount: number;
  characterCount: number;
  readOnly: boolean;
}

interface MenuItem {
  label: string;
  icon?: React.ReactNode;
  onClick: () => void;
  danger?: boolean;
  separator?: boolean;
  shortcut?: string;
  requiresNativeShell?: boolean;
}

interface CtxMenuState {
  x: number;
  y: number;
  items: MenuItem[];
  variant?: "default" | "vscode";
}

interface DragSrc {
  path: string;
  isDir: boolean;
}

interface MenuRuntimeCapabilities {
  nativeShell: boolean;
}

function normalizeMenuItems(items: MenuItem[], capabilities: MenuRuntimeCapabilities): MenuItem[] {
  const normalized: MenuItem[] = [];
  let previousWasSeparator = true;

  for (const item of items) {
    if (item.requiresNativeShell && !capabilities.nativeShell) continue;

    if (item.separator) {
      if (!previousWasSeparator) {
        normalized.push(item);
        previousWasSeparator = true;
      }
      continue;
    }

    normalized.push(item);
    previousWasSeparator = false;
  }

  while (normalized.at(-1)?.separator) {
    normalized.pop();
  }

  return normalized;
}

interface OpenFileOptions {
  line?: number;
  searchQuery?: string;
  preview?: boolean;
  pinned?: boolean;
}

interface TreeClipboardItem {
  path: string;
  isDir: boolean;
}

interface TreeClipboardState {
  mode: "copy" | "cut";
  items: TreeClipboardItem[];
}

interface TreeHistoryEntry {
  label: string;
  undo: () => Promise<void>;
  redo: () => Promise<void>;
}

function createHistoryId() {
  return createCompatId("history");
}

async function tauriInvoke<T = unknown>(command: string, args?: Record<string, unknown>): Promise<T> {
  if (!hasTauriCore()) {
    throw new Error("Tauri runtime is unavailable");
  }
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(command, args);
}

async function tauriJoin(...parts: string[]): Promise<string> {
  if (!hasTauriCore()) {
    return joinWorkspacePathParts(...parts);
  }
  const { join } = await import("@tauri-apps/api/path");
  return join(...parts);
}

// 可在 Monaco 中编辑的文本/代码/配置扩展名(白名单 —— 不在此且非 pdf/image/office/mermaid 的
// 文件会回落到「二进制·不可编辑」查看器)。覆盖绝大多数常见开发文件类型,让 WebIDE 支持编辑它们。
const TEXT_EXTS = new Set([
  // 文档 / 标记
  "md", "markdown", "mdx", "mkd", "txt", "text", "rst", "adoc", "asciidoc", "textile", "org", "tex", "ltx", "sty", "cls", "bib", "log",
  // 数据 / 配置
  "json", "jsonc", "json5", "ndjson", "jsonl", "yaml", "yml", "toml", "xml", "xsl", "xslt", "plist", "ini", "cfg", "conf", "config",
  "properties", "env", "editorconfig", "csv", "tsv", "lock", "diff", "patch", "resx", "ron", "cue",
  // Web 前端
  "html", "htm", "xhtml", "css", "scss", "sass", "less", "styl", "vue", "svelte", "astro",
  // JS / TS
  "js", "mjs", "cjs", "jsx", "ts", "mts", "cts", "tsx",
  // 后端 / 脚本语言
  "py", "pyi", "pyw", "rs", "go", "mod", "sum", "java", "kt", "kts", "scala", "groovy", "gradle", "clj", "cljs", "cljc", "edn",
  "rb", "erb", "rake", "php", "phtml", "lua", "r", "jl", "dart", "swift", "cs", "fs", "fsx", "fsi", "vb", "ex", "exs", "erl",
  "hrl", "hs", "lhs", "elm", "ml", "mli", "nim", "zig", "v", "sv", "vhd", "vhdl", "sol", "move", "cairo", "pl", "pm", "tcl",
  "awk", "sed", "ps1", "psm1", "bat", "cmd", "fish", "nu",
  // C / C++ / 原生
  "c", "h", "cc", "cpp", "cxx", "hpp", "hxx", "hh", "m", "mm", "asm", "s", "d", "pas", "f", "f90", "f95", "for",
  // Shell
  "sh", "bash", "zsh", "ksh",
  // 查询 / IDL / schema
  "sql", "graphql", "gql", "graphqls", "proto", "thrift", "avsc", "prisma",
  // 基础设施 / 构建
  "dockerfile", "containerfile", "mk", "cmake", "tf", "tfvars", "hcl", "nomad", "bicep", "nginx", "service", "desktop", "reg",
  // .acl(内置资产 manifest)按普通文本打开,而非回落到 binary 查看器。
  "acl",
  // 模板
  "hbs", "handlebars", "mustache", "ejs", "pug", "jade", "haml", "njk", "jinja", "jinja2", "j2", "tpl", "liquid", "twig",
  // 字幕 / 杂项文本
  "srt", "vtt", "http", "rest", "webmanifest", "map", "gitkeep",
]);

// 无扩展名 / 点文件的常见纯文本文件(按小写完整文件名匹配):Dockerfile、Makefile、.gitignore 等。
const TEXT_FILENAMES = new Set([
  "dockerfile", "containerfile", "makefile", "gnumakefile", "rakefile", "gemfile", "podfile", "brewfile", "vagrantfile",
  "procfile", "jenkinsfile", "justfile", "caddyfile", "berksfile", "guardfile", "capfile", "thorfile", "codeowners",
  "license", "licence", "readme", "changelog", "authors", "contributors", "notice", "copying", "install", "todo",
  ".gitignore", ".gitattributes", ".gitmodules", ".dockerignore", ".npmignore", ".eslintignore", ".prettierignore",
  ".editorconfig", ".npmrc", ".nvmrc", ".yarnrc", ".babelrc", ".prettierrc", ".eslintrc", ".browserslistrc", ".nojekyll",
  ".watchmanconfig", ".env", ".bashrc", ".zshrc", ".profile", ".bash_profile", ".vimrc",
]);

const IMAGE_EXTS = new Set(["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "ico", "avif"]);

const OFFICE_EXTS = new Set<string>(OFFICE_FILE_EXTENSIONS);

function getBaseName(path: string) {
  return getWorkspaceBaseName(path);
}

// Find a node by name prefix (for type-ahead navigation)
function findNodeByNamePrefix(root: FsNode | null, prefix: string): FsNode | null {
  if (!root || !prefix) return null;
  const lowerPrefix = prefix.toLowerCase();

  const visit = (node: FsNode): FsNode | null => {
    if (node.name.toLowerCase().startsWith(lowerPrefix)) {
      return node;
    }
    if (node.is_dir && node.children) {
      for (const child of node.children) {
        const found = visit(child);
        if (found) return found;
      }
    }
    return null;
  };

  if (root.children) {
    for (const child of root.children) {
      const found = visit(child);
      if (found) return found;
    }
  }
  return null;
}

function filterTreeByQuery(root: FsNode | null, query: string): FsNode | null {
  const normalized = query.trim().toLowerCase();
  if (!root || !normalized) return root;

  const visit = (node: FsNode): FsNode | null => {
    const selfMatches = node.name.toLowerCase().includes(normalized) || node.path.toLowerCase().includes(normalized);

    if (!node.is_dir) {
      return selfMatches ? node : null;
    }

    if (selfMatches) {
      return node;
    }

    const children = (node.children ?? []).map(visit).filter((child): child is FsNode => !!child);

    if (children.length === 0) {
      return null;
    }

    return { ...node, children };
  };

  const children = (root.children ?? []).map(visit).filter((child): child is FsNode => !!child);

  return { ...root, children };
}

function HighlightedName({ name, query }: { name: string; query?: string }) {
  const normalized = query?.trim();
  if (!normalized) return <>{name}</>;

  const lowerName = name.toLowerCase();
  const lowerQuery = normalized.toLowerCase();
  const parts: React.ReactNode[] = [];
  let cursor = 0;
  let matchIndex = lowerName.indexOf(lowerQuery);

  if (matchIndex === -1) return <>{name}</>;

  while (matchIndex !== -1) {
    if (matchIndex > cursor) {
      parts.push(name.slice(cursor, matchIndex));
    }

    const matchEnd = matchIndex + normalized.length;
    parts.push(
      <mark key={`${matchIndex}-${matchEnd}`} className="file-tree-search-highlight">
        {name.slice(matchIndex, matchEnd)}
      </mark>,
    );

    cursor = matchEnd;
    matchIndex = lowerName.indexOf(lowerQuery, cursor);
  }

  if (cursor < name.length) {
    parts.push(name.slice(cursor));
  }

  return <>{parts}</>;
}

function EditorPanelFrame({
  children,
  className,
  path,
}: {
  children: React.ReactNode;
  className?: string;
  path?: string;
}) {
  const fileName = path?.split("/").pop();

  return (
    <section
      className={cn("flex h-full min-h-0 min-w-0 flex-col overflow-hidden", className)}
      aria-label={fileName ? `文件编辑器：${fileName}` : "文件编辑器"}
    >
      <div className="min-h-0 min-w-0 flex-1 overflow-hidden">{children}</div>
    </section>
  );
}

function EditorBreadcrumbs({ segments, actions }: { segments: string[]; actions?: React.ReactNode }) {
  return (
    <div className="file-tree-editor-breadcrumbs">
      <div className="file-tree-editor-breadcrumb-path">
        {segments.map((segment, index) => (
          <React.Fragment key={`${segment}-${index}`}>
            {index > 0 && <ChevronRight className="file-tree-editor-breadcrumb-separator" aria-hidden="true" />}
            <span className={cn("file-tree-editor-breadcrumb-item", index === segments.length - 1 && "is-current")}>
              {segment}
            </span>
          </React.Fragment>
        ))}
      </div>
      {actions && <div className="file-tree-editor-breadcrumb-actions">{actions}</div>}
    </div>
  );
}

function EditorStatusDivider() {
  return <span className="file-tree-editor-status-divider" aria-hidden="true" />;
}

function EditorSaveStatus({ status, lastSavedAt }: { status: EditorSaveStatusValue; lastSavedAt?: number | null }) {
  const savedTime = lastSavedAt
    ? new Date(lastSavedAt).toLocaleTimeString(undefined, {
        hour: "2-digit",
        minute: "2-digit",
      })
    : null;

  if (status === "saving") {
    return (
      <output className="file-tree-editor-statusitem" aria-live="polite">
        <Loader2 className="mr-1 size-3 animate-spin" aria-hidden="true" />
        保存中…
      </output>
    );
  }
  if (status === "dirty") {
    return (
      <output className="file-tree-editor-statusitem is-dirty" aria-live="polite">
        未保存
      </output>
    );
  }
  if (status === "error") {
    return (
      <output className="file-tree-editor-statusitem is-error" aria-live="polite">
        保存失败
      </output>
    );
  }
  return (
    <output className="file-tree-editor-statusitem" aria-live="polite">
      {savedTime ? `已保存 ${savedTime}` : "已加载"}
    </output>
  );
}

function getFileTypeDisplayName(fileType: FileType | null, path: string | null) {
  if (!path) return "未打开文件";
  if (fileType === "text") return getLanguageDisplayName(getMonacoLanguage(path));
  const labels: Record<FileType, string> = {
    text: "文本",
    pdf: "PDF",
    image: "图片",
    office: "Office",
    binary: "二进制",
    mermaid: "Mermaid",
  };
  return fileType ? labels[fileType] : "文件";
}

function FileTreeIdeStatusBar({
  rootPath,
  activeFile,
  activeFileType,
  activeStatus,
  gitStatus,
  gitStatusLoading,
  gitStatusError,
  dirtyFileCount,
  readOnly,
  onOpenSourceControl,
}: {
  rootPath: string | null;
  activeFile: string | null;
  activeFileType: FileType | null;
  activeStatus: FileEditorStatusSnapshot | null;
  gitStatus: GitStatusResult | null;
  gitStatusLoading: boolean;
  gitStatusError: string | null;
  dirtyFileCount: number;
  readOnly: boolean;
  onOpenSourceControl: () => void;
}) {
  const relativePath = activeFile ? getWorkspaceRelativePath(rootPath, activeFile) : "";
  const branchLabel = gitStatusLoading
    ? "Git..."
    : gitStatusError
      ? "Git 状态异常"
      : gitStatus?.isGitRepo
        ? (gitStatus.branch ?? "HEAD")
        : "非 Git";
  const fileTypeLabel = getFileTypeDisplayName(activeFileType, activeFile);

  return (
    <footer className="file-tree-ide-statusbar" aria-label="IDE 状态栏">
      <button
        type="button"
        className="file-tree-editor-statusitem file-tree-ide-statusbutton"
        onClick={onOpenSourceControl}
        title="打开源代码管理"
      >
        {gitStatusLoading ? (
          <Loader2 className="mr-1 size-3 animate-spin" aria-hidden="true" />
        ) : (
          <GitBranch className="mr-1 size-3" aria-hidden="true" />
        )}
        <span>{branchLabel}</span>
      </button>
      {dirtyFileCount > 0 ? (
        <>
          <EditorStatusDivider />
          <span className="file-tree-editor-statusitem is-dirty">{dirtyFileCount} 未保存</span>
        </>
      ) : null}
      {activeStatus ? (
        <>
          <EditorStatusDivider />
          <EditorSaveStatus status={activeStatus.saveStatus} lastSavedAt={activeStatus.lastSavedAt} />
        </>
      ) : null}
      {readOnly ? (
        <>
          <EditorStatusDivider />
          <span className="file-tree-editor-statusitem">只读</span>
        </>
      ) : null}
      <span className="file-tree-editor-statusitem file-tree-ide-statusfile">{relativePath || "就绪"}</span>
      <div className="flex-1" />
      <div className="file-tree-editor-statusgroup">
        {activeStatus ? (
          <>
            <span className="file-tree-editor-statusitem is-secondary">{activeStatus.lineCount} 行</span>
            <EditorStatusDivider />
            <span className="file-tree-editor-statusitem is-secondary">{activeStatus.characterCount} 字符</span>
            <EditorStatusDivider />
            {activeStatus.selectionLength > 0 ? (
              <>
                <span className="file-tree-editor-statusitem">{activeStatus.selectionLength} 已选</span>
                <EditorStatusDivider />
              </>
            ) : null}
            <span className="file-tree-editor-statusitem">
              行 {activeStatus.cursorPosition.line}, 列 {activeStatus.cursorPosition.column}
            </span>
            <EditorStatusDivider />
            <span className="file-tree-editor-statusitem is-secondary">
              {activeStatus.indentation.insertSpaces
                ? `空格: ${activeStatus.indentation.tabSize}`
                : `制表符: ${activeStatus.indentation.tabSize}`}
            </span>
            <EditorStatusDivider />
            <span className="file-tree-editor-statusitem is-secondary">{activeStatus.eol}</span>
            <EditorStatusDivider />
            <span className="file-tree-editor-statusitem is-secondary">UTF-8</span>
            <EditorStatusDivider />
            <span className="file-tree-editor-statusitem">{activeStatus.languageLabel}</span>
          </>
        ) : (
          <span className="file-tree-editor-statusitem">{fileTypeLabel}</span>
        )}
      </div>
    </footer>
  );
}

function getEditorStatusSignature(status: FileEditorStatusSnapshot) {
  return [
    status.languageLabel,
    status.saveStatus,
    status.lastSavedAt ?? "",
    status.cursorPosition.line,
    status.cursorPosition.column,
    status.selectionLength,
    status.indentation.tabSize,
    status.indentation.insertSpaces ? "spaces" : "tabs",
    status.eol,
    status.lineCount,
    status.characterCount,
    status.readOnly ? "readonly" : "writeable",
  ].join("|");
}

function getContentMetrics(content: string) {
  let lineCount = 1;
  for (let index = 0; index < content.length; index++) {
    if (content.charCodeAt(index) === 10) {
      lineCount += 1;
    }
  }
  return {
    lineCount,
    characterCount: content.length,
  };
}

function supportsCssEscape() {
  return typeof CSS !== "undefined" && typeof CSS.escape === "function";
}

function getDataPathSelector(path: string) {
  if (supportsCssEscape()) {
    return `[data-item-path="${CSS.escape(path)}"]`;
  }
  return `[data-item-path="${path.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\]/g, "\\]")}"]`;
}

interface ExplorerPaneParams {
  variant?: "default" | "vscode";
  headerSlot?: React.ReactNode;
  afterSearchSlot?: React.ReactNode;
  rootPath: string | null;
  loading: boolean;
  readOnly: boolean;
  treeLoadError: string | null;
  partialLoadErrorCount: number;
  tree: FsNode | null;
  nodeByPath: Map<string, FsNode>;
  activeFile: string | null;
  selectedPaths: string[];
  selectedPathSet: Set<string>;
  searchQuery: string;
  totalFiles: number;
  totalFolders: number;
  openNodes?: Set<string>;
  autoExpandDepth?: number;
  collapseAllVersion?: number;
  showSearchFilter?: boolean;
  showFooter?: boolean;
  dirtyPaths?: Set<string>;
  dragSrc: DragSrc | null;
  dropTarget: string | null;
  dropIndicator: DropIndicator | null;
  renamingPath: string | null;
  cutPaths: Set<string>;
  treeFocusRef: React.RefObject<HTMLDivElement | null>;
  emptyAreaItems: MenuItem[];
  onActivateTreeScope: () => void;
  onSelectSinglePath: (path: string | null) => void;
  onShowMenu: (e: React.MouseEvent, items: MenuItem[]) => void;
  onFileClick: (path: string, options?: OpenFileOptions) => void;
  onSelectNode: (path: string, options?: { additive?: boolean }) => void;
  onDelete: (path: string, isDir: boolean) => void;
  onRename: (path: string, isDir: boolean) => void;
  onStartRename: (path: string) => void;
  onInlineRename: (path: string, isDir: boolean, newName: string) => void;
  onCreateFile: (parentPath?: string) => void;
  onCreateFolder: (parentPath?: string) => void;
  onCopyNode: (path: string, isDir: boolean) => void;
  onCutNode: (path: string, isDir: boolean) => void;
  onPasteNode: (path?: string) => void;
  onCopyPath: (path: string) => void;
  onCopyRelativePath: (path: string) => void;
  onOpenNative: (path: string, options?: NativeOpenOptions) => void;
  onRefreshTree: () => void;
  onOpenRootInFinder: () => void;
  onCollapseSidebar: () => void;
  onTypeAhead: (char: string) => void;
  onOpenChange: (path: string, isOpen: boolean) => void;
  onNavigateTree: (direction: "up" | "down") => void;
  onShiftArrow: (direction: "up" | "down") => void;
  onHomeEnd: (direction: "home" | "end") => void;
  onSelectAll: () => void;
  onEnter: () => void;
  onToggleSelect: (path: string) => void;
  onCollapseAll: () => void;
  onRenameSelected: () => void;
  onDeleteSelection: () => void;
  onSearchFilter: (query: string) => void;
  onViewFileHistory?: (path: string) => void;
  inlineCreate?: { parentPath: string; type: "file" | "folder" } | null;
  onInlineCreateConfirm?: (name: string) => void;
  onInlineCreateCancel?: () => void;
}

const fallbackTreeFocusRef: React.RefObject<HTMLDivElement | null> = {
  current: null,
};

type CachedPaneviewLayout = ReturnType<PaneviewReadyEvent["api"]["toJSON"]>;

const FILE_TREE_LAYOUT_STORAGE_PREFIX = "internshannon:file-tree-editor:layout:v3";
const FILE_TREE_EDITOR_SESSION_STORAGE_PREFIX = "internshannon:file-tree-editor:session";
let activeFileTreeRoot: HTMLElement | null = null;

function shallowEqualObjectParams(left: Record<string, unknown> | undefined, right: Record<string, unknown>) {
  if (!left) {
    return false;
  }
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  if (leftKeys.length !== rightKeys.length) {
    return false;
  }
  return leftKeys.every((key) => Object.is(left[key], right[key]));
}

function updatePanelParametersIfChanged<T extends Record<string, unknown>>(
  panel:
    | {
        params?: Record<string, unknown>;
        api: { updateParameters: (params: T) => void };
      }
    | undefined,
  params: T,
) {
  if (!panel || shallowEqualObjectParams(panel.params, params)) {
    return;
  }
  panel.api.updateParameters(params);
}

function useLatestRef<T>(value: T) {
  const ref = useRef(value);
  useEffect(() => {
    ref.current = value;
  }, [value]);
  return ref;
}

interface EditorSessionFile {
  path: string;
  pinned: boolean;
}

interface EditorSessionState {
  version: 1;
  openFiles: EditorSessionFile[];
  activeFile: string | null;
  openNodes: string[];
  selectedPath: string | null;
  recentFiles: string[];
}

function buildPaneviewLayoutStorageKey(rootPath: string | undefined, area: "sidebar" | "history") {
  return `${FILE_TREE_LAYOUT_STORAGE_PREFIX}:${area}:${rootPath ?? "unknown"}`;
}

function buildEditorSessionStorageKey(rootPath: string | undefined) {
  return `${FILE_TREE_EDITOR_SESSION_STORAGE_PREFIX}:${rootPath ?? "unknown"}`;
}

function readEditorSession(rootPath: string | undefined): EditorSessionState | null {
  if (!rootPath) {
    return null;
  }

  try {
    const parsed = readUserJsonStorage<Partial<EditorSessionState> | null>(
      buildEditorSessionStorageKey(rootPath),
      null,
    );
    if (!parsed) return null;
    if (parsed.version !== 1 || !Array.isArray(parsed.openFiles)) {
      return null;
    }
    return {
      version: 1,
      openFiles: parsed.openFiles
        .filter(
          (file): file is EditorSessionFile =>
            !!file && typeof file.path === "string" && typeof file.pinned === "boolean",
        )
        .slice(0, 20),
      activeFile: typeof parsed.activeFile === "string" ? parsed.activeFile : null,
      openNodes: Array.isArray(parsed.openNodes)
        ? parsed.openNodes.filter((path): path is string => typeof path === "string")
        : [],
      selectedPath: typeof parsed.selectedPath === "string" ? parsed.selectedPath : null,
      recentFiles: Array.isArray(parsed.recentFiles)
        ? parsed.recentFiles.filter((path): path is string => typeof path === "string").slice(0, 30)
        : [],
    };
  } catch {
    return null;
  }
}

function hashSnapshotPath(path: string) {
  let hash = 5381;
  for (let index = 0; index < path.length; index++) {
    hash = (hash * 33) ^ path.charCodeAt(index);
  }
  return (hash >>> 0).toString(36);
}

async function getSnapshotManifestPath(filePath: string) {
  if (!hasTauriCore()) {
    return joinWorkspacePath(
      getParentPath(filePath),
      ".shuan-os-snapshots",
      hashSnapshotPath(filePath),
      "manifest.json",
    );
  }
  const { appCacheDir } = await import("@tauri-apps/api/path");
  const cacheDir = await appCacheDir();
  return tauriJoin(cacheDir, "internshannon-file-snapshots", hashSnapshotPath(filePath), "manifest.json");
}

async function getSnapshotContentPath(filePath: string, snapshotId: string) {
  if (!hasTauriCore()) {
    return joinWorkspacePath(
      getParentPath(filePath),
      ".shuan-os-snapshots",
      hashSnapshotPath(filePath),
      `${snapshotId}.txt`,
    );
  }
  const { appCacheDir } = await import("@tauri-apps/api/path");
  const cacheDir = await appCacheDir();
  return tauriJoin(cacheDir, "internshannon-file-snapshots", hashSnapshotPath(filePath), `${snapshotId}.txt`);
}

async function readLocalSnapshots(filePath: string) {
  try {
    const manifestPath = await getSnapshotManifestPath(filePath);
    const content = await workspaceApi.readFile(manifestPath);
    const parsed = JSON.parse(content) as Partial<LocalFileSnapshot>[];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (snapshot): snapshot is LocalFileSnapshot =>
          !!snapshot &&
          typeof snapshot.id === "string" &&
          typeof snapshot.date === "string" &&
          typeof snapshot.label === "string" &&
          typeof snapshot.size === "number" &&
          typeof snapshot.snapshotPath === "string",
      )
      .sort((left, right) => new Date(right.date).getTime() - new Date(left.date).getTime());
  } catch {
    return [];
  }
}

async function writeLocalSnapshots(filePath: string, snapshots: LocalFileSnapshot[]) {
  const manifestPath = await getSnapshotManifestPath(filePath);
  const parentPath = getParentPath(manifestPath);
  if (parentPath) {
    await workspaceApi.mkdir(parentPath);
  }
  await workspaceApi.writeFile(manifestPath, JSON.stringify(snapshots, null, 2));
}

async function createLocalSnapshot(filePath: string, content: string, label = "手动保存") {
  const existing = await readLocalSnapshots(filePath);
  const latest = existing[0];
  if (latest) {
    try {
      const latestContent = await workspaceApi.readFile(latest.snapshotPath);
      if (latestContent === content) return latest;
    } catch {
      // Keep creating a fresh snapshot if the content file is missing.
    }
  }

  const id = createHistoryId();
  const snapshotPath = await getSnapshotContentPath(filePath, id);
  const parentPath = getParentPath(snapshotPath);
  if (parentPath) {
    await workspaceApi.mkdir(parentPath);
  }
  await workspaceApi.writeFile(snapshotPath, content);
  const snapshot: LocalFileSnapshot = {
    id,
    date: new Date().toISOString(),
    label,
    size: new Blob([content]).size,
    snapshotPath,
  };
  const snapshots = [snapshot, ...existing].slice(0, 60);
  await writeLocalSnapshots(filePath, snapshots);
  return snapshot;
}

async function updateLocalSnapshotLabel(filePath: string, snapshotId: string, label: string) {
  const snapshots = await readLocalSnapshots(filePath);
  const next = snapshots.map((snapshot) => (snapshot.id === snapshotId ? { ...snapshot, label } : snapshot));
  await writeLocalSnapshots(filePath, next);
  return next;
}

async function deleteLocalSnapshot(filePath: string, snapshotId: string) {
  const snapshots = await readLocalSnapshots(filePath);
  const target = snapshots.find((snapshot) => snapshot.id === snapshotId);
  const next = snapshots.filter((snapshot) => snapshot.id !== snapshotId);
  await writeLocalSnapshots(filePath, next);
  if (target) {
    await workspaceApi.remove(target.snapshotPath).catch(() => undefined);
  }
  return next;
}

function writeEditorSession(rootPath: string | undefined, session: EditorSessionState) {
  if (!rootPath) {
    return;
  }

  try {
    writeUserJsonStorage(buildEditorSessionStorageKey(rootPath), session);
  } catch (e) {
    console.warn("[file-tree] Failed to persist editor session:", e);
  }
}

function readCachedPaneviewLayout(
  rootPath: string | undefined,
  area: "sidebar" | "history",
): CachedPaneviewLayout | null {
  if (!rootPath) {
    return null;
  }

  try {
    return readUserJsonStorage<CachedPaneviewLayout | null>(buildPaneviewLayoutStorageKey(rootPath, area), null);
  } catch {
    return null;
  }
}

function writeCachedPaneviewLayout(
  rootPath: string | undefined,
  area: "sidebar" | "history",
  layout: CachedPaneviewLayout,
) {
  if (!rootPath) {
    return;
  }

  try {
    writeUserJsonStorage(buildPaneviewLayoutStorageKey(rootPath, area), stripPaneviewLayoutParams(layout));
  } catch (e) {
    console.warn("[file-tree] Failed to persist panel layout:", e);
  }
}

function stripPaneviewLayoutParams<T>(layout: T): T {
  const visit = (value: unknown): unknown => {
    if (Array.isArray(value)) {
      return value.map(visit);
    }
    if (!value || typeof value !== "object") {
      return value;
    }
    const input = value as Record<string, unknown>;
    const output: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(input)) {
      if (key === "params") continue;
      output[key] = visit(child);
    }
    return output;
  };
  return visit(layout) as T;
}

function PaneHeader({ title, params, api }: IPaneviewPanelProps<ExplorerPaneParams>) {
  const isExplorer = api.id === "explorer";
  const explorerParams = isExplorer && params ? (params as ExplorerPaneParams) : null;

  const toggleExpanded = () => api.setExpanded(!api.isExpanded);

  return (
    <div className="file-tree-pane-header flex h-full items-center gap-1.5 px-2">
      <button
        type="button"
        className="file-tree-pane-trigger flex h-full min-w-0 flex-1 cursor-pointer items-center gap-1.5 border-0 bg-transparent p-0 text-left"
        aria-expanded={api.isExpanded}
        onClick={toggleExpanded}
      >
        <span
          className="file-tree-pane-toggle inline-flex size-5 shrink-0 items-center justify-center text-muted-foreground transition-colors hover:bg-muted/70 hover:text-foreground"
          aria-hidden="true"
        >
          {api.isExpanded ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
        </span>
        <span className="file-tree-pane-title min-w-0 flex-1 truncate">{title}</span>
      </button>
      {isExplorer && explorerParams ? (
        <div className="file-tree-pane-actions flex shrink-0 items-center gap-0.5 pl-1.5">
          {!explorerParams.readOnly && (
            <>
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      data-pane-action="true"
                      aria-label="新建文件"
                      onClick={() => explorerParams.onCreateFile()}
                      className="file-tree-pane-action flex size-6 items-center justify-center rounded transition-colors text-muted-foreground hover:bg-muted/70 hover:text-foreground"
                    >
                      <FilePlus className="size-3.5" aria-hidden="true" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>新建文件</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      data-pane-action="true"
                      aria-label="新建文件夹"
                      onClick={() => explorerParams.onCreateFolder()}
                      className="file-tree-pane-action flex size-6 items-center justify-center rounded transition-colors text-muted-foreground hover:bg-muted/70 hover:text-foreground"
                    >
                      <FolderPlus className="size-3.5" aria-hidden="true" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>新建文件夹</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </>
          )}
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  data-pane-action="true"
                  aria-label="刷新"
                  onClick={explorerParams.onRefreshTree}
                  className="file-tree-pane-action flex size-6 items-center justify-center rounded transition-colors text-muted-foreground hover:bg-muted/70 hover:text-foreground"
                >
                  <RefreshCw className="size-3.5" aria-hidden="true" />
                </button>
              </TooltipTrigger>
              <TooltipContent>
                <p>刷新</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  data-pane-action="true"
                  aria-label="全部折叠"
                  onClick={explorerParams.onCollapseAll}
                  className="file-tree-pane-action flex size-6 items-center justify-center rounded transition-colors text-muted-foreground hover:bg-muted/70 hover:text-foreground"
                >
                  <ChevronsUp className="size-3.5" aria-hidden="true" />
                </button>
              </TooltipTrigger>
              <TooltipContent>
                <p>全部折叠</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
          {(explorerParams.dirtyPaths?.size ?? 0) > 0 && (
            <span className="flex items-center gap-1 rounded bg-primary/10 px-1.5 py-0.5 text-[10px] text-primary">
              <span className="size-1.5 rounded-full bg-primary" />
              {explorerParams.dirtyPaths?.size}
            </span>
          )}
        </div>
      ) : null}
    </div>
  );
}

function SimplePaneHeader({ title, api }: IPaneviewPanelProps<Record<string, unknown>>) {
  const toggleExpanded = () => api.setExpanded(!api.isExpanded);

  return (
    <button
      type="button"
      className="file-tree-pane-header file-tree-pane-trigger flex h-full cursor-pointer items-center gap-1.5 border-0 bg-transparent px-2 text-left"
      aria-expanded={api.isExpanded}
      onClick={toggleExpanded}
    >
      <span
        className="file-tree-pane-toggle inline-flex size-5 shrink-0 items-center justify-center text-muted-foreground transition-colors hover:bg-muted/70 hover:text-foreground"
        aria-hidden="true"
      >
        {api.isExpanded ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
      </span>
      <span className="file-tree-pane-title min-w-0 flex-1 truncate">{title}</span>
    </button>
  );
}

function VscodeTooltipButton({
  label,
  active,
  ariaExpanded,
  ariaHasPopup,
  className,
  children,
  onClick,
}: {
  label: string;
  active?: boolean;
  ariaExpanded?: boolean;
  ariaHasPopup?: "menu";
  className?: string;
  children: React.ReactNode;
  onClick: (event: React.MouseEvent<HTMLButtonElement>) => void;
}) {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label={label}
            aria-expanded={ariaExpanded}
            aria-haspopup={ariaHasPopup}
            aria-pressed={active}
            onClick={onClick}
            className={cn(className, active && "is-active")}
          >
            {children}
          </button>
        </TooltipTrigger>
        <TooltipContent>
          <p>{label}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

function PanelLoadingState({ label }: { label: string }) {
  return (
    <div className="file-tree-panel-state" aria-live="polite">
      <Loader2 className="file-tree-panel-state-icon animate-spin" aria-hidden="true" />
      <p className="file-tree-panel-state-title">{label}</p>
    </div>
  );
}

function PanelErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="file-tree-panel-state file-tree-panel-state-error" role="alert">
      <XCircle className="file-tree-panel-state-icon" aria-hidden="true" />
      <p className="file-tree-panel-state-title">文件树加载失败</p>
      <p className="file-tree-panel-state-description">{message}</p>
      <button type="button" className="file-tree-panel-state-action" onClick={onRetry}>
        <RefreshCw className="size-3" aria-hidden="true" />
        重试
      </button>
    </div>
  );
}

function PanelEmptyState({
  icon: Icon,
  title,
  description,
  actions,
}: {
  icon: React.ElementType;
  title: string;
  description?: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="file-tree-panel-state">
      <Icon className="file-tree-panel-state-icon" aria-hidden="true" />
      <p className="file-tree-panel-state-title">{title}</p>
      {description && <p className="file-tree-panel-state-description">{description}</p>}
      {actions && <div className="file-tree-panel-state-actions">{actions}</div>}
    </div>
  );
}

function VscodeExplorerSectionHeader({
  title,
  meta,
  open = true,
  onToggle,
  onContextMenu,
}: {
  title: string;
  meta?: string;
  open?: boolean;
  onToggle?: () => void;
  onContextMenu?: (event: React.MouseEvent) => void;
}) {
  const content = (
    <>
      <ChevronDown className={cn("file-tree-vscode-section-chevron", !open && "is-collapsed")} aria-hidden="true" />
      <span className="file-tree-vscode-section-title">{title}</span>
      {meta && <span className="file-tree-vscode-section-meta">{meta}</span>}
    </>
  );

  if (onToggle) {
    return (
      <button
        type="button"
        className="file-tree-vscode-section-header"
        title={meta ? `${title} - ${meta}` : title}
        aria-expanded={open}
        onClick={onToggle}
        onContextMenu={onContextMenu}
      >
        {content}
      </button>
    );
  }

  return (
    <div className="file-tree-vscode-section-header" title={meta ? `${title} - ${meta}` : title}>
      {content}
    </div>
  );
}

function ExplorerPane({ params }: IPaneviewPanelProps<ExplorerPaneParams>) {
  const rawPane = params as Partial<ExplorerPaneParams> | undefined;
  const noop = () => undefined;
  const searchValue = typeof rawPane?.searchQuery === "string" ? rawPane.searchQuery : "";
  const selectedPaths = Array.isArray(rawPane?.selectedPaths) ? rawPane.selectedPaths : [];
  const tree = rawPane?.tree ?? null;
  const pane: ExplorerPaneParams = {
    variant: rawPane?.variant === "vscode" ? "vscode" : "default",
    headerSlot: rawPane?.headerSlot,
    afterSearchSlot: rawPane?.afterSearchSlot,
    rootPath: typeof rawPane?.rootPath === "string" ? rawPane.rootPath : null,
    loading: Boolean(rawPane?.loading),
    readOnly: rawPane?.readOnly === true,
    treeLoadError: typeof rawPane?.treeLoadError === "string" ? rawPane.treeLoadError : null,
    partialLoadErrorCount: typeof rawPane?.partialLoadErrorCount === "number" ? rawPane.partialLoadErrorCount : 0,
    tree,
    nodeByPath: rawPane?.nodeByPath instanceof Map ? rawPane.nodeByPath : buildTreeNodeIndex(tree),
    activeFile: typeof rawPane?.activeFile === "string" ? rawPane.activeFile : null,
    selectedPaths,
    selectedPathSet: rawPane?.selectedPathSet instanceof Set ? rawPane.selectedPathSet : new Set(selectedPaths),
    searchQuery: searchValue,
    totalFiles: typeof rawPane?.totalFiles === "number" ? rawPane.totalFiles : 0,
    totalFolders: typeof rawPane?.totalFolders === "number" ? rawPane.totalFolders : 0,
    openNodes: rawPane?.openNodes instanceof Set ? rawPane.openNodes : new Set(),
    autoExpandDepth: typeof rawPane?.autoExpandDepth === "number" ? rawPane.autoExpandDepth : 1,
    collapseAllVersion: typeof rawPane?.collapseAllVersion === "number" ? rawPane.collapseAllVersion : 0,
    showSearchFilter: rawPane?.showSearchFilter !== false,
    showFooter: rawPane?.showFooter !== false,
    dirtyPaths: rawPane?.dirtyPaths instanceof Set ? rawPane.dirtyPaths : new Set(),
    dragSrc: rawPane?.dragSrc ?? null,
    dropTarget: typeof rawPane?.dropTarget === "string" ? rawPane.dropTarget : null,
    dropIndicator: rawPane?.dropIndicator ?? null,
    renamingPath: typeof rawPane?.renamingPath === "string" ? rawPane.renamingPath : null,
    cutPaths: rawPane?.cutPaths instanceof Set ? rawPane.cutPaths : new Set(),
    treeFocusRef: rawPane?.treeFocusRef ?? fallbackTreeFocusRef,
    emptyAreaItems: Array.isArray(rawPane?.emptyAreaItems) ? rawPane.emptyAreaItems : [],
    onActivateTreeScope: rawPane?.onActivateTreeScope ?? noop,
    onSelectSinglePath: rawPane?.onSelectSinglePath ?? noop,
    onShowMenu: rawPane?.onShowMenu ?? noop,
    onFileClick: rawPane?.onFileClick ?? noop,
    onSelectNode: rawPane?.onSelectNode ?? noop,
    onDelete: rawPane?.onDelete ?? noop,
    onRename: rawPane?.onRename ?? noop,
    onStartRename: rawPane?.onStartRename ?? noop,
    onInlineRename: rawPane?.onInlineRename ?? noop,
    onCreateFile: rawPane?.onCreateFile ?? noop,
    onCreateFolder: rawPane?.onCreateFolder ?? noop,
    onCopyNode: rawPane?.onCopyNode ?? noop,
    onCutNode: rawPane?.onCutNode ?? noop,
    onPasteNode: rawPane?.onPasteNode ?? noop,
    onCopyPath: rawPane?.onCopyPath ?? noop,
    onCopyRelativePath: rawPane?.onCopyRelativePath ?? noop,
    onOpenNative: rawPane?.onOpenNative ?? noop,
    onRefreshTree: rawPane?.onRefreshTree ?? noop,
    onOpenRootInFinder: rawPane?.onOpenRootInFinder ?? noop,
    onCollapseSidebar: rawPane?.onCollapseSidebar ?? noop,
    onTypeAhead: rawPane?.onTypeAhead ?? noop,
    onOpenChange: rawPane?.onOpenChange ?? noop,
    onNavigateTree: rawPane?.onNavigateTree ?? noop,
    onShiftArrow: rawPane?.onShiftArrow ?? noop,
    onHomeEnd: rawPane?.onHomeEnd ?? noop,
    onSelectAll: rawPane?.onSelectAll ?? noop,
    onEnter: rawPane?.onEnter ?? noop,
    onToggleSelect: rawPane?.onToggleSelect ?? noop,
    onCollapseAll: rawPane?.onCollapseAll ?? noop,
    onRenameSelected: rawPane?.onRenameSelected ?? noop,
    onDeleteSelection: rawPane?.onDeleteSelection ?? noop,
    onSearchFilter: rawPane?.onSearchFilter ?? noop,
    onViewFileHistory: rawPane?.onViewFileHistory,
    inlineCreate: rawPane?.inlineCreate ?? null,
    onInlineCreateConfirm: rawPane?.onInlineCreateConfirm,
    onInlineCreateCancel: rawPane?.onInlineCreateCancel,
  };
  const searchQuery = pane.searchQuery.trim();
  const deferredSearchQuery = React.useDeferredValue(searchQuery);
  const isSearchPending = deferredSearchQuery !== searchQuery;
  const visibleTree = useMemo(
    () => filterTreeByQuery(pane.tree, deferredSearchQuery),
    [pane.tree, deferredSearchQuery],
  );
  const hasSearch = deferredSearchQuery.length > 0;
  const isVsCodePane = pane.variant === "vscode";
  const rootLabel = pane.rootPath ? getBaseName(pane.rootPath) || "工作区" : "工作区";
  const rootMeta = pane.rootPath && !pane.loading ? `${pane.totalFiles} 文件 / ${pane.totalFolders} 文件夹` : undefined;
  const [workspaceExpanded, setWorkspaceExpanded] = React.useState(true);
  const showWorkspaceTree = !isVsCodePane || workspaceExpanded;
  // Root-level inline-create input (new file/folder directly under the workspace
  // root). Rendered both inside the populated tree and in the empty-workspace
  // branch, so creating the first file/folder works when the tree has no children.
  const rootInlineCreate =
    pane.inlineCreate &&
    pane.inlineCreate.parentPath === pane.tree?.path &&
    pane.onInlineCreateConfirm &&
    pane.onInlineCreateCancel ? (
      <div className="file-tree-inline-create-row" style={{ paddingLeft: "14px" }}>
        {pane.inlineCreate.type === "folder" ? (
          <Folder className="file-tree-inline-create-icon text-[#eab308]" aria-hidden="true" />
        ) : (
          <File className="file-tree-inline-create-icon text-muted-foreground" aria-hidden="true" />
        )}
        <InlineCreationInput
          isFolder={pane.inlineCreate.type === "folder"}
          onConfirm={pane.onInlineCreateConfirm}
          onCancel={pane.onInlineCreateCancel}
        />
      </div>
    ) : null;

  return (
    <div
      className={cn("flex h-full min-h-0 flex-col bg-muted/[0.03]", isVsCodePane && "file-tree-explorer-pane-vscode")}
    >
      {pane.headerSlot && <div className="px-2 pt-2 pb-1">{pane.headerSlot}</div>}
      {pane.rootPath && pane.showSearchFilter && (
        <div className="file-tree-explorer-search">
          {isSearchPending ? (
            <Loader2 className="file-tree-explorer-search-icon animate-spin" aria-hidden="true" />
          ) : (
            <Search className="file-tree-explorer-search-icon" aria-hidden="true" />
          )}
          <input
            type="search"
            aria-label="筛选文件"
            aria-keyshortcuts="Escape"
            autoComplete="off"
            spellCheck={false}
            value={pane.searchQuery}
            onChange={(event) => pane.onSearchFilter(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape" && pane.searchQuery) {
                event.preventDefault();
                pane.onSearchFilter("");
              }
            }}
            placeholder="筛选文件…"
            className="file-tree-explorer-search-input"
          />
          {pane.searchQuery && (
            <button
              type="button"
              className="file-tree-explorer-search-clear"
              onClick={() => pane.onSearchFilter("")}
              aria-label="清除筛选"
            >
              <X className="size-3" aria-hidden="true" />
            </button>
          )}
        </div>
      )}
      {pane.afterSearchSlot && <div className="px-2 py-1.5">{pane.afterSearchSlot}</div>}
      {isVsCodePane && pane.rootPath && (
        <VscodeExplorerSectionHeader
          title={rootLabel}
          meta={rootMeta}
          open={workspaceExpanded}
          onToggle={() => setWorkspaceExpanded((value) => !value)}
        />
      )}
      {showWorkspaceTree && (
        <div
          ref={pane.treeFocusRef as React.RefObject<HTMLDivElement>}
          role="tree"
          aria-label="文件树"
          aria-multiselectable="true"
          aria-busy={pane.loading || isSearchPending}
          data-menu-shortcut-scope="file-tree"
          tabIndex={0}
          className="file-tree-explorer-tree min-h-0 flex-1 overflow-y-auto px-1 py-1 outline-none"
          onPointerDownCapture={pane.onActivateTreeScope}
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              pane.onSelectSinglePath(null);
            }
          }}
          onKeyDown={(e) => {
            // Shift+Arrow: range select
            if (e.shiftKey && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
              e.preventDefault();
              pane.onShiftArrow(e.key === "ArrowDown" ? "down" : "up");
              return;
            }
            // Clear selection anchor on non-shift navigation
            if (!e.shiftKey && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
              e.preventDefault();
              pane.onNavigateTree(e.key === "ArrowDown" ? "down" : "up");
              return;
            }
            const scopedShortcut = resolveFileTreeScopedShortcut(e, {
              platform: navigator.platform,
            });
            if (scopedShortcut === "select-all") {
              e.preventDefault();
              pane.onSelectAll();
              return;
            }
            if (scopedShortcut === "copy") {
              e.preventDefault();
              const path = pane.selectedPaths[pane.selectedPaths.length - 1];
              const node = path ? pane.nodeByPath.get(path) : null;
              if (node) pane.onCopyNode(node.path, node.is_dir);
              return;
            }
            if (scopedShortcut === "cut") {
              if (pane.readOnly) return;
              e.preventDefault();
              const path = pane.selectedPaths[pane.selectedPaths.length - 1];
              const node = path ? pane.nodeByPath.get(path) : null;
              if (node) pane.onCutNode(node.path, node.is_dir);
              return;
            }
            if (scopedShortcut === "paste") {
              if (pane.readOnly) return;
              e.preventDefault();
              const path = pane.selectedPaths[pane.selectedPaths.length - 1];
              const node = path ? pane.nodeByPath.get(path) : null;
              const pasteTarget = node?.is_dir
                ? node.path
                : node
                  ? getParentPath(node.path)
                  : pane.rootPath || undefined;
              pane.onPasteNode(pasteTarget);
              return;
            }
            if (e.key === "F2") {
              if (pane.readOnly) return;
              e.preventDefault();
              pane.onRenameSelected();
              return;
            }
            if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
              const path = pane.selectedPaths[pane.selectedPaths.length - 1];
              const node = path ? pane.nodeByPath.get(path) : null;
              if (!node) return;
              e.preventDefault();
              if (e.key === "ArrowRight" && node.is_dir) {
                if (!pane.openNodes?.has(node.path)) {
                  pane.onOpenChange(node.path, true);
                } else if (node.children?.[0]) {
                  pane.onSelectSinglePath(node.children[0].path);
                }
                return;
              }
              if (e.key === "ArrowLeft") {
                if (node.is_dir && pane.openNodes?.has(node.path)) {
                  pane.onOpenChange(node.path, false);
                  return;
                }
                const parentPath = getParentPath(node.path);
                if (parentPath && parentPath !== pane.rootPath && pane.nodeByPath.has(parentPath)) {
                  pane.onSelectSinglePath(parentPath);
                }
              }
              return;
            }
            if (e.key === "Delete" || e.key === "Backspace") {
              if (
                !shouldHandleFileTreeDeleteKey(e, {
                  editableTarget: isEditableKeyboardTarget(e.target),
                  readOnly: pane.readOnly,
                })
              ) {
                return;
              }
              e.preventDefault();
              pane.onDeleteSelection();
              return;
            }
            if (scopedShortcut === "collapse-all") {
              e.preventDefault();
              pane.onCollapseAll();
              return;
            }
            // Home/End: jump to first/last item
            if (e.key === "Home" || e.key === "End") {
              e.preventDefault();
              pane.onHomeEnd(e.key === "Home" ? "home" : "end");
              return;
            }
            // Enter: open selected file/folder
            if (e.key === "Enter" && !e.ctrlKey && !e.metaKey && !e.shiftKey && !e.altKey) {
              e.preventDefault();
              pane.onEnter();
              return;
            }
            // Type-ahead: single character keys
            if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {
              pane.onTypeAhead(e.key);
            }
            if ((e.key === "Enter" || e.key === " ") && e.target === e.currentTarget) {
              e.preventDefault();
              pane.onSelectSinglePath(null);
            }
          }}
          onContextMenu={(e) => {
            pane.onActivateTreeScope();
            const target = e.target as HTMLElement | null;
            // Tree rows stop propagation and open their own menu; any contextmenu
            // that reaches the container is an empty-area click — whitespace below
            // the tree or the "暂无文件" placeholder — so show the empty-area menu.
            // Skip inputs so the inline-create field keeps its native copy/paste menu.
            if (target?.closest("[data-item-path]")) return;
            if (target?.closest("input, textarea, [contenteditable='true']")) return;
            pane.onShowMenu(e, pane.emptyAreaItems);
          }}
        >
          {!pane.rootPath ? (
            <PanelEmptyState icon={FolderOpen} title="未选择目录" />
          ) : pane.loading ? (
            <PanelLoadingState label="正在加载文件…" />
          ) : pane.treeLoadError ? (
            <PanelErrorState message={pane.treeLoadError} onRetry={pane.onRefreshTree} />
          ) : !pane.tree?.children?.length ? (
            (rootInlineCreate ?? (
              <PanelEmptyState
                icon={File}
                title="暂无文件"
                description="工作区根目录为空"
                actions={
                  pane.readOnly || !pane.tree ? undefined : (
                    <React.Fragment>
                      <button
                        type="button"
                        className="file-tree-panel-state-action is-primary"
                        onClick={() => pane.onCreateFile(pane.tree?.path)}
                      >
                        <FilePlus className="size-3" aria-hidden="true" />
                        新建文件
                      </button>
                      <button
                        type="button"
                        className="file-tree-panel-state-action"
                        onClick={() => pane.onCreateFolder(pane.tree?.path)}
                      >
                        <FolderPlus className="size-3" aria-hidden="true" />
                        新建文件夹
                      </button>
                    </React.Fragment>
                  )
                }
              />
            ))
          ) : hasSearch && !visibleTree?.children?.length ? (
            <PanelEmptyState
              icon={Search}
              title="未找到匹配文件"
              description="当前筛选没有匹配结果"
              actions={
                <button type="button" className="file-tree-panel-state-action" onClick={() => pane.onSearchFilter("")}>
                  <X className="size-3" aria-hidden="true" />
                  清除筛选
                </button>
              }
            />
          ) : (
            <React.Fragment>
              {visibleTree?.children?.map((node) => (
                <TreeNode
                  key={node.path}
                  node={node}
                  depth={0}
                  activeFile={pane.activeFile}
                  selectedPathSet={pane.selectedPathSet}
                  readOnly={pane.readOnly}
                  searchQuery={deferredSearchQuery}
                  openNodes={pane.openNodes}
                  autoExpandDepth={pane.autoExpandDepth}
                  collapseAllVersion={pane.collapseAllVersion}
                  dirtyPaths={pane.dirtyPaths}
                  onFileClick={pane.onFileClick}
                  onSelectNode={pane.onSelectNode}
                  onDelete={pane.onDelete}
                  onRename={pane.onRename}
                  onInlineRename={pane.onInlineRename}
                  onCreateFile={pane.onCreateFile}
                  onCreateFolder={pane.onCreateFolder}
                  onCopyNode={pane.onCopyNode}
                  onCutNode={pane.onCutNode}
                  onPasteNode={pane.onPasteNode}
                  onCopyPath={pane.onCopyPath}
                  onCopyRelativePath={pane.onCopyRelativePath}
                  onOpenNative={pane.onOpenNative}
                  menuVariant={pane.variant}
                  showMenu={pane.onShowMenu}
                  dragSrc={pane.dragSrc}
                  dropTarget={pane.dropTarget}
                  dropIndicator={pane.dropIndicator}
                  renamingPath={pane.renamingPath}
                  cutPaths={pane.cutPaths}
                  onStartRename={pane.onStartRename}
                  onOpenChange={pane.onOpenChange}
                  onToggleSelect={pane.onToggleSelect}
                  onViewFileHistory={pane.onViewFileHistory}
                  inlineCreate={pane.inlineCreate}
                  onInlineCreateConfirm={pane.onInlineCreateConfirm}
                  onInlineCreateCancel={pane.onInlineCreateCancel}
                />
              ))}
              {/* Inline creation at root level (when parentPath matches tree root) - shown at bottom */}
              {rootInlineCreate}
            </React.Fragment>
          )}
        </div>
      )}
      {pane.showFooter && (
        <output
          className="file-tree-explorer-footer"
          aria-live="polite"
          aria-label={`${pane.totalFiles} 个文件，${pane.totalFolders} 个文件夹，${pane.selectedPaths.length} 个已选`}
        >
          <span>{pane.totalFiles} 文件</span>
          <span>{pane.totalFolders} 文件夹</span>
          {pane.selectedPaths.length > 0 && <span>{pane.selectedPaths.length} 已选</span>}
          {(pane.dirtyPaths?.size ?? 0) > 0 && <span className="is-dirty">{pane.dirtyPaths?.size} 未保存</span>}
          {pane.partialLoadErrorCount > 0 && (
            <span className="is-warning">{pane.partialLoadErrorCount} 个目录未加载</span>
          )}
        </output>
      )}
    </div>
  );
}

function getParentPath(path: string) {
  return getParentWorkspacePath(path);
}

function getWorkspaceRelativePath(rootPath: string | null, path: string) {
  return getRelativeWorkspacePath(rootPath, path);
}

function splitNameAndExt(name: string) {
  const index = name.lastIndexOf(".");
  if (index <= 0) return { stem: name, ext: "" };
  return {
    stem: name.slice(0, index),
    ext: name.slice(index),
  };
}

function buildTreeNodeIndex(root: FsNode | null): Map<string, FsNode> {
  const index = new Map<string, FsNode>();
  if (!root) return index;

  const stack = [root];
  while (stack.length > 0) {
    const node = stack.pop();
    if (!node) continue;
    index.set(node.path, node);
    if (node.children) {
      for (let cursor = node.children.length - 1; cursor >= 0; cursor -= 1) {
        stack.push(node.children[cursor]);
      }
    }
  }

  return index;
}

function collectTreePaths(node: FsNode | null, paths: string[] = []): string[] {
  if (!node) return paths;
  paths.push(`${node.is_dir ? "d" : "f"}:${node.path}`);
  for (const child of node.children ?? []) {
    collectTreePaths(child, paths);
  }
  return paths;
}

function getTreeSignature(node: FsNode | null): string {
  return collectTreePaths(node).join("|");
}

function getTreeStats(node: FsNode | null): { files: number; folders: number } {
  const stats = { files: 0, folders: 0 };
  const visit = (current: FsNode) => {
    if (current.is_dir) {
      if (current !== node) stats.folders += 1;
      current.children?.forEach(visit);
      return;
    }
    stats.files += 1;
  };
  if (node) visit(node);
  return stats;
}

function isMetaSelectionEvent(event: React.MouseEvent | React.KeyboardEvent | MouseEvent | KeyboardEvent) {
  return isApplePlatform() ? event.metaKey : event.ctrlKey;
}

function formatShortcut(...keys: string[]) {
  const isApple = isApplePlatform();
  if (!isApple) return keys.map((key) => (key === "Cmd" ? "Ctrl" : key)).join("+");

  const appleLabels: Record<string, string> = {
    Alt: "⌥",
    Cmd: "⌘",
    Ctrl: "⌘",
    Del: "⌫",
    Delete: "⌫",
    Shift: "⇧",
  };
  return keys.map((key) => appleLabels[key] ?? key).join("");
}

function getFileType(path: string): FileType {
  const base = (path.split("/").pop() ?? "").toLowerCase();
  // 无扩展名 / 点文件(Dockerfile、Makefile、.gitignore、LICENSE…)按完整文件名识别为文本。
  if (TEXT_FILENAMES.has(base)) return "text";
  // 扩展名 = 最后一个点之后;leading-dot 文件(.env)的点不算扩展分隔。
  const dot = base.lastIndexOf(".");
  const ext = dot > 0 ? base.slice(dot + 1) : "";
  if (ext === "pdf") return "pdf";
  if (ext === "mmd") return "mermaid";
  if (IMAGE_EXTS.has(ext)) return "image";
  if (OFFICE_EXTS.has(ext)) return "office";
  if (TEXT_EXTS.has(ext)) return "text";
  return "binary";
}

/**
 * Map file extension to Monaco language identifier for syntax highlighting
 */
const MONACO_FILENAME_LANG: Record<string, string> = {
  dockerfile: "dockerfile",
  containerfile: "dockerfile",
  makefile: "makefile",
  gnumakefile: "makefile",
  gemfile: "ruby",
  rakefile: "ruby",
  podfile: "ruby",
  vagrantfile: "ruby",
  ".bashrc": "shell",
  ".zshrc": "shell",
  ".profile": "shell",
  ".bash_profile": "shell",
};

const MONACO_LANG_MAP: Record<string, string> = {
  // JavaScript / TypeScript
  js: "javascript", mjs: "javascript", cjs: "javascript", jsx: "javascript",
  ts: "typescript", mts: "typescript", cts: "typescript", tsx: "typescript",
  // Python
  py: "python", pyi: "python", pyw: "python",
  // Rust / Go
  rs: "rust", go: "go", mod: "go", sum: "go",
  // JVM
  java: "java", kt: "kotlin", kts: "kotlin", scala: "scala", groovy: "groovy", gradle: "groovy", clj: "clojure", cljs: "clojure", cljc: "clojure",
  // C / C++ / native
  c: "c", h: "c", cc: "cpp", cpp: "cpp", cxx: "cpp", hpp: "cpp", hxx: "cpp", hh: "cpp", m: "objective-c", mm: "objective-c", asm: "asm", s: "asm", pas: "pascal",
  // Other backend
  cs: "csharp", fs: "fsharp", fsx: "fsharp", vb: "vb", rb: "ruby", erb: "ruby", rake: "ruby", php: "php", phtml: "php",
  lua: "lua", r: "r", jl: "julia", dart: "dart", swift: "swift", ex: "elixir", exs: "elixir", erl: "erlang", hrl: "erlang",
  hs: "haskell", lhs: "haskell", elm: "elm", ml: "ocaml", mli: "ocaml", nim: "nim", zig: "zig", sol: "sol", pl: "perl", pm: "perl", tcl: "tcl",
  // Web
  html: "html", htm: "html", xhtml: "html", css: "css", scss: "scss", sass: "scss", less: "less", styl: "stylus", vue: "html", svelte: "html", astro: "html",
  // Data / config
  json: "json", jsonc: "json", json5: "json", ndjson: "json", jsonl: "json", map: "json", webmanifest: "json",
  yaml: "yaml", yml: "yaml", toml: "toml", xml: "xml", xsl: "xml", xslt: "xml", plist: "xml", svg: "xml", resx: "xml",
  ini: "ini", cfg: "ini", conf: "ini", config: "ini", properties: "ini", env: "shell", editorconfig: "ini",
  // Shell / scripts
  sh: "shell", bash: "shell", zsh: "shell", ksh: "shell", fish: "shell", ps1: "powershell", psm1: "powershell", bat: "bat", cmd: "bat",
  // Query / IDL / infra
  sql: "sql", graphql: "graphql", gql: "graphql", graphqls: "graphql", proto: "proto", prisma: "prisma",
  tf: "hcl", tfvars: "hcl", hcl: "hcl", nomad: "hcl",
  // Markdown / docs
  md: "markdown", markdown: "markdown", mdx: "markdown", mmd: "markdown", rst: "restructuredtext", tex: "latex", ltx: "latex",
  // Templates / misc
  hbs: "handlebars", handlebars: "handlebars", ejs: "html", pug: "pug", twig: "twig", liquid: "html",
  diff: "diff", patch: "diff", log: "log",
  // .acl(内置资产 manifest,HCL 式但 Monaco 无对应语言)按普通文本展示。
  acl: "plaintext", txt: "plaintext", csv: "plaintext", tsv: "plaintext",
};

function getMonacoLanguage(path: string): string {
  const base = (path.split("/").pop() ?? "").toLowerCase();
  if (MONACO_FILENAME_LANG[base]) return MONACO_FILENAME_LANG[base];
  const dot = base.lastIndexOf(".");
  const ext = dot > 0 ? base.slice(dot + 1) : "";
  return MONACO_LANG_MAP[ext] ?? "plaintext";
}

/**
 * Get human-readable language name for display in status bar
 */
function getLanguageDisplayName(languageId: string): string {
  const displayNames: Record<string, string> = {
    javascript: "JavaScript",
    typescript: "TypeScript",
    python: "Python",
    rust: "Rust",
    go: "Go",
    java: "Java",
    c: "C",
    cpp: "C++",
    html: "HTML",
    css: "CSS",
    scss: "SCSS",
    sass: "Sass",
    less: "Less",
    json: "JSON",
    yaml: "YAML",
    yml: "YAML",
    toml: "TOML",
    xml: "XML",
    shell: "Shell",
    sql: "SQL",
    markdown: "Markdown",
    ini: "Ini",
    graphql: "GraphQL",
    plaintext: "Plain Text",
  };
  return displayNames[languageId] ?? languageId;
}

// ── FS API helpers ─────────────────────────────────────────────────────────────

function joinWorkspacePath(...parts: string[]): string {
  return joinWorkspacePathParts(...parts);
}

function formatUnknownError(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (error && typeof error === "object" && "message" in error) {
    return String((error as { message?: unknown }).message ?? "Unknown error");
  }
  return String(error || "Unknown error");
}

function compactErrorMessage(message: string, maxLength = 220): string {
  return message.length > maxLength ? `${message.slice(0, maxLength - 1)}…` : message;
}

function isFileTreeDebugEnabled(): boolean {
  try {
    return globalThis.localStorage?.getItem("internshannon-file-tree-debug") === "true";
  } catch {
    return false;
  }
}

function debugFileTree(...args: unknown[]) {
  if (isFileTreeDebugEnabled()) {
    console.debug(...args);
  }
}

type WorkspaceTreeDiagnostics = {
  partialLoadErrorCount: number;
  partialLoadErrorSamples: string[];
};

type WorkspaceTreeBuildResult = WorkspaceTreeDiagnostics & {
  tree: FsNode;
};

type WorkspaceTreeBuildOptions = {
  childConcurrency: number;
  maxErrorSamples: number;
};

const DEFAULT_TREE_BUILD_OPTIONS: WorkspaceTreeBuildOptions = {
  childConcurrency: 6,
  maxErrorSamples: 3,
};

function normalizeStaticFilePath(path: string) {
  return path
    .replace(/\\/g, "/")
    .split("/")
    .map((segment) => segment.trim())
    .filter(Boolean)
    .join("/");
}

function getUtf8ByteSize(content: string) {
  if (typeof TextEncoder === "undefined") return content.length;
  return new TextEncoder().encode(content).byteLength;
}

function getFileExtension(name: string) {
  const index = name.lastIndexOf(".");
  if (index <= 0 || index === name.length - 1) return undefined;
  return name.slice(index + 1).toLowerCase();
}

function sortStaticTreeChildren(node: FsNode) {
  if (!node.children) return;
  node.children.sort((a, b) => {
    if (a.is_dir !== b.is_dir) return a.is_dir ? -1 : 1;
    return a.name.localeCompare(b.name, "zh-CN");
  });
  node.children.forEach(sortStaticTreeChildren);
}

function buildStaticFilesTree(rootPath: string, files: readonly FileTreeEditorStaticFile[]): WorkspaceTreeBuildResult {
  const root: FsNode = {
    name: getBaseName(rootPath) || rootPath || "模板",
    path: rootPath,
    is_dir: true,
    children: [],
    childrenLoaded: true,
  };
  const directories = new Map<string, FsNode>([[rootPath, root]]);

  for (const file of files) {
    const relativePath = normalizeStaticFilePath(file.path);
    if (!relativePath) continue;

    const segments = relativePath.split("/");
    const fileName = segments.at(-1);
    if (!fileName) continue;

    let parent = root;
    let currentPath = rootPath;
    for (const segment of segments.slice(0, -1)) {
      currentPath = joinWorkspacePath(currentPath, segment);
      let directory = directories.get(currentPath);
      if (!directory) {
        directory = {
          name: segment,
          path: currentPath,
          is_dir: true,
          children: [],
          childrenLoaded: true,
        };
        directories.set(currentPath, directory);
        parent.children = [...(parent.children ?? []), directory];
      }
      parent = directory;
    }

    parent.children = [
      ...(parent.children ?? []).filter((child) => !(child.path === joinWorkspacePath(currentPath, fileName))),
      {
        name: fileName,
        path: joinWorkspacePath(currentPath, fileName),
        is_dir: false,
        size: file.size ?? getUtf8ByteSize(file.content),
        mtimeMs: file.mtimeMs,
        modifiedAt: file.modifiedAt,
        extension: getFileExtension(fileName),
        isBinary: false,
      },
    ];
  }

  sortStaticTreeChildren(root);
  return {
    tree: root,
    partialLoadErrorCount: 0,
    partialLoadErrorSamples: [],
  };
}

function buildStaticFileContentMap(rootPath: string, files: readonly FileTreeEditorStaticFile[]) {
  const contentByPath = new Map<string, string>();
  for (const file of files) {
    const relativePath = normalizeStaticFilePath(file.path);
    if (!relativePath) continue;
    contentByPath.set(joinWorkspacePath(rootPath, relativePath), file.content);
  }
  return contentByPath;
}

async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  const workerCount = Math.max(1, Math.min(concurrency, items.length));

  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (nextIndex < items.length) {
        const currentIndex = nextIndex;
        nextIndex += 1;
        results[currentIndex] = await mapper(items[currentIndex], currentIndex);
      }
    }),
  );

  return results;
}

function appendErrorSample(samples: string[], sample: string, maxSamples: number) {
  if (samples.length < maxSamples) {
    samples.push(sample);
  }
}

async function buildWorkspaceTree(
  path: string,
  depth: number,
  options: WorkspaceTreeBuildOptions = DEFAULT_TREE_BUILD_OPTIONS,
): Promise<WorkspaceTreeBuildResult> {
  debugFileTree("[FileTree] build", { path, depth });
  const name = getBaseName(path);
  if (depth <= 0) {
    return {
      tree: { name, path, is_dir: true, children: [], childrenLoaded: false },
      partialLoadErrorCount: 0,
      partialLoadErrorSamples: [],
    };
  }

  const entries = await workspaceApi.readDir(path);
  const visibleEntries = entries.filter((entry) => entry.name !== ".shuan-os-trash");
  const diagnostics: WorkspaceTreeDiagnostics = {
    partialLoadErrorCount: 0,
    partialLoadErrorSamples: [],
  };

  const children = await mapWithConcurrency(visibleEntries, options.childConcurrency, async (entry) => {
    const childPath = joinWorkspacePath(path, entry.name);
    if (!entry.isDirectory) {
      return {
        name: entry.name,
        path: childPath,
        is_dir: false,
        size: entry.size,
        mtimeMs: entry.mtimeMs,
        modifiedAt: entry.modifiedAt,
        extension: entry.extension,
        isBinary: entry.isBinary,
      } satisfies FsNode;
    }

    try {
      const child = await buildWorkspaceTree(childPath, depth - 1, options);
      diagnostics.partialLoadErrorCount += child.partialLoadErrorCount;
      for (const sample of child.partialLoadErrorSamples) {
        appendErrorSample(diagnostics.partialLoadErrorSamples, sample, options.maxErrorSamples);
      }
      return {
        ...child.tree,
        mtimeMs: entry.mtimeMs,
        modifiedAt: entry.modifiedAt,
      };
    } catch (error) {
      const message = compactErrorMessage(formatUnknownError(error));
      diagnostics.partialLoadErrorCount += 1;
      appendErrorSample(diagnostics.partialLoadErrorSamples, `${childPath}: ${message}`, options.maxErrorSamples);
      return {
        name: entry.name,
        path: childPath,
        is_dir: true,
        children: [],
        childrenLoaded: false,
        mtimeMs: entry.mtimeMs,
        modifiedAt: entry.modifiedAt,
        loadError: message,
      } satisfies FsNode;
    }
  });

  return {
    tree: {
      name,
      path,
      is_dir: true,
      childrenLoaded: true,
      children: children.sort((a, b) => {
        if (a.is_dir !== b.is_dir) return a.is_dir ? -1 : 1;
        return a.name.localeCompare(b.name, "zh-CN");
      }),
    },
    ...diagnostics,
  };
}

async function fetchTreeWithDiagnostics(path: string, depth = 6): Promise<WorkspaceTreeBuildResult> {
  const result = await buildWorkspaceTree(path, depth);
  if (result.partialLoadErrorCount > 0) {
    console.warn("[FileTree] Some directories failed to load", {
      rootPath: path,
      partialLoadErrorCount: result.partialLoadErrorCount,
      samples: result.partialLoadErrorSamples,
    });
  }
  debugFileTree("[FileTree] loaded", {
    path,
    depth,
    children: result.tree.children?.length ?? 0,
    partialLoadErrorCount: result.partialLoadErrorCount,
  });
  return result;
}

export async function fetchTree(path: string, depth = 6): Promise<FsNode> {
  return (await fetchTreeWithDiagnostics(path, depth)).tree;
}

export async function fetchFile(path: string): Promise<string> {
  return workspaceApi.readFile(path);
}

export async function writeFile(path: string, content: string): Promise<void> {
  await workspaceApi.writeFile(path, content);
}

export async function deleteNode(path: string): Promise<void> {
  await workspaceApi.remove(path);
}

export async function createNode(path: string, is_dir: boolean): Promise<void> {
  if (is_dir) {
    await workspaceApi.mkdir(path);
    return;
  }
  await workspaceApi.writeFile(path, "");
}

// ── Context menu portal ────────────────────────────────────────────────────────

function ContextMenuPortal({
  menu,
  onClose,
  portalContainer,
}: {
  menu: CtxMenuState;
  onClose: () => void;
  portalContainer?: HTMLElement | null;
}) {
  const menuRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const [position, setPosition] = React.useState({ left: menu.x, top: menu.y });
  const actionableIndexes = useMemo(
    () => menu.items.flatMap((item, index) => (item.separator ? [] : [index])),
    [menu.items],
  );
  const [activeIndex, setActiveIndex] = React.useState(actionableIndexes[0] ?? -1);

  // Stable close handler via ref
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    setActiveIndex(actionableIndexes[0] ?? -1);
  }, [actionableIndexes]);

  useEffect(() => {
    if (activeIndex < 0) {
      menuRef.current?.focus();
      return;
    }
    itemRefs.current[activeIndex]?.focus();
  }, [activeIndex]);

  const moveActiveIndex = useCallback(
    (direction: "next" | "previous" | "first" | "last") => {
      if (!actionableIndexes.length) return;
      if (direction === "first") {
        setActiveIndex(actionableIndexes[0]);
        return;
      }
      if (direction === "last") {
        setActiveIndex(actionableIndexes[actionableIndexes.length - 1]);
        return;
      }
      const currentPosition = Math.max(0, actionableIndexes.indexOf(activeIndex));
      const delta = direction === "next" ? 1 : -1;
      const nextPosition = (currentPosition + delta + actionableIndexes.length) % actionableIndexes.length;
      setActiveIndex(actionableIndexes[nextPosition]);
    },
    [actionableIndexes, activeIndex],
  );

  const executeItem = useCallback((item: MenuItem) => {
    item.onClick();
    closeRef.current();
  }, []);

  useEffect(() => {
    const menuNode = menuRef.current;
    if (!menuNode) return;
    const rect = menuNode.getBoundingClientRect();
    setPosition({
      left: Math.max(8, Math.min(menu.x, window.innerWidth - rect.width - 8)),
      top: Math.max(8, Math.min(menu.y, window.innerHeight - rect.height - 8)),
    });
  }, [menu.x, menu.y]);

  useEffect(() => {
    const handlePointerDown = (e: MouseEvent) => {
      // Close on any click outside the menu
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        closeRef.current();
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        closeRef.current();
      }
    };

    // Use a small delay to ensure menu item clicks are processed first
    const timeoutId = setTimeout(() => {
      document.addEventListener("pointerdown", handlePointerDown);
      document.addEventListener("keydown", handleKeyDown);
    }, 0);

    return () => {
      clearTimeout(timeoutId);
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  return createPortal(
    <div
      ref={menuRef}
      role="menu"
      tabIndex={-1}
      aria-label="上下文菜单"
      style={{
        position: "fixed",
        left: position.left,
        top: position.top,
        zIndex: 9999,
      }}
      className={cn("file-tree-context-menu", menu.variant === "vscode" && "is-vscode")}
      onClick={(e) => {
        e.stopPropagation();
      }}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "ArrowDown") {
          e.preventDefault();
          moveActiveIndex("next");
          return;
        }
        if (e.key === "ArrowUp") {
          e.preventDefault();
          moveActiveIndex("previous");
          return;
        }
        if (e.key === "Home") {
          e.preventDefault();
          moveActiveIndex("first");
          return;
        }
        if (e.key === "End") {
          e.preventDefault();
          moveActiveIndex("last");
          return;
        }
        if (e.key === "Tab") {
          e.preventDefault();
          closeRef.current();
          return;
        }
        if ((e.key === "Enter" || e.key === " ") && activeIndex >= 0) {
          const item = menu.items[activeIndex];
          if (!item?.separator) {
            e.preventDefault();
            executeItem(item);
          }
        }
      }}
      onMouseDown={(e) => {
        e.stopPropagation();
      }}
      onPointerDown={(e) => {
        e.stopPropagation();
      }}
    >
      {menu.items.map((item, i) =>
        item.separator ? (
          // biome-ignore lint/suspicious/noArrayIndexKey: static list
          <hr key={`sep-${i}`} className="file-tree-context-menu-separator" />
        ) : (
          <button
            // biome-ignore lint/suspicious/noArrayIndexKey: static list
            key={i}
            ref={(node) => {
              itemRefs.current[i] = node;
            }}
            type="button"
            role="menuitem"
            tabIndex={activeIndex === i ? 0 : -1}
            onClick={(e) => {
              e.stopPropagation();
              executeItem(item);
            }}
            onMouseDown={(e) => {
              e.stopPropagation();
            }}
            onPointerDown={(e) => {
              e.stopPropagation();
            }}
            onMouseEnter={() => {
              setActiveIndex(i);
            }}
            className={cn(
              "file-tree-context-menu-item",
              activeIndex === i && "is-keyboard-active",
              item.danger && "is-danger",
            )}
          >
            {item.icon && (
              <span className="file-tree-context-menu-icon" aria-hidden="true">
                {item.icon}
              </span>
            )}
            <span className="min-w-0 flex-1 truncate">{item.label}</span>
            {item.shortcut && <span className="file-tree-context-menu-shortcut">{item.shortcut}</span>}
          </button>
        ),
      )}
    </div>,
    portalContainer ?? document.body,
  );
}

// ── Icon badge wrapper ─────────────────────────────────────────────────────────

function IconBadge({ bg, children }: { bg: string; children: React.ReactNode }) {
  return (
    <span
      className={`file-tree-icon-badge inline-flex size-[18px] items-center justify-center rounded-sm shrink-0 ${bg}`}
      aria-hidden="true"
    >
      {children}
    </span>
  );
}

// ── File icon with Material Design icons ──────────────────────────────────────

export function FileIcon({ name }: { name: string }) {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";

  // JavaScript / TypeScript
  if (["js", "jsx"].includes(ext))
    return (
      <IconBadge bg="bg-yellow-400/15">
        <FileCode2 className="size-4 text-[#f0db4f]" />
      </IconBadge>
    );
  if (["ts", "tsx"].includes(ext))
    return (
      <IconBadge bg="bg-primary/15">
        <FileCode2 className="size-4 text-[#3178c6]" />
      </IconBadge>
    );
  if (["vue"].includes(ext))
    return (
      <IconBadge bg="bg-emerald-400/15">
        <Code className="size-4 text-[#42b883]" />
      </IconBadge>
    );
  if (["svelte"].includes(ext))
    return (
      <IconBadge bg="bg-orange-500/15">
        <Code className="size-4 text-[#ff3e00]" />
      </IconBadge>
    );

  // Backend languages
  if (["py"].includes(ext))
    return (
      <IconBadge bg="bg-blue-400/15">
        <Code className="size-4 text-[#3776ab]" />
      </IconBadge>
    );
  if (["rs"].includes(ext))
    return (
      <IconBadge bg="bg-orange-600/15">
        <Code className="size-4 text-[#ce422b]" />
      </IconBadge>
    );
  if (["go"].includes(ext))
    return (
      <IconBadge bg="bg-cyan-500/15">
        <Code className="size-4 text-[#00add8]" />
      </IconBadge>
    );
  if (["rb", "java", "c", "cpp", "h", "hpp"].includes(ext))
    return (
      <IconBadge bg="bg-red-500/15">
        <Code className="size-4 text-[#dc143c]" />
      </IconBadge>
    );

  // Web
  if (["html", "htm"].includes(ext))
    return (
      <IconBadge bg="bg-orange-500/15">
        <Globe className="size-4 text-[#e34c26]" />
      </IconBadge>
    );
  if (["css", "scss", "sass", "less"].includes(ext))
    return (
      <IconBadge bg="bg-primary/15">
        <FileCode className="size-4 text-[#264de4]" />
      </IconBadge>
    );

  // Config / Data
  if (["json", "jsonc"].includes(ext))
    return (
      <IconBadge bg="bg-amber-500/15">
        <Braces className="size-4 text-[#f59e0b]" />
      </IconBadge>
    );
  if (["yaml", "yml"].includes(ext))
    return (
      <IconBadge bg="bg-purple-500/15">
        <FileText className="size-4 text-[#a855f7]" />
      </IconBadge>
    );
  if (["toml", "ini", "conf", "env"].includes(ext))
    return (
      <IconBadge bg="bg-slate-400/15">
        <FileText className="size-4 text-muted-foreground" />
      </IconBadge>
    );
  if (["xml"].includes(ext))
    return (
      <IconBadge bg="bg-green-500/15">
        <Code className="size-4 text-[#16a34a]" />
      </IconBadge>
    );
  if (["svg"].includes(ext))
    return (
      <IconBadge bg="bg-amber-400/15">
        <Image className="size-4 text-[#f59e0b]" />
      </IconBadge>
    );

  // Documents
  if (["md", "mdx"].includes(ext))
    return (
      <IconBadge bg="bg-blue-400/15">
        <FileText className="size-4 text-primary" />
      </IconBadge>
    );
  // Mermaid diagrams (.mmd) - used for experience library
  if (["mmd"].includes(ext))
    return (
      <IconBadge bg="bg-violet-400/15">
        <Braces className="size-4 text-[#8b5cf6]" />
      </IconBadge>
    );
  if (["txt"].includes(ext))
    return (
      <IconBadge bg="bg-slate-400/15">
        <FileText className="size-4 text-muted-foreground" />
      </IconBadge>
    );
  if (["pdf"].includes(ext))
    return (
      <IconBadge bg="bg-red-500/15">
        <FileText className="size-4 text-[#dc2626]" />
      </IconBadge>
    );
  if (["doc", "docx"].includes(ext))
    return (
      <IconBadge bg="bg-primary/15">
        <FileText className="size-4 text-[#2563eb]" />
      </IconBadge>
    );
  if (["xls", "xlsx", "csv"].includes(ext))
    return (
      <IconBadge bg="bg-emerald-500/15">
        <Table className="size-4 text-[#059669]" />
      </IconBadge>
    );
  if (["ppt", "pptx"].includes(ext))
    return (
      <IconBadge bg="bg-orange-500/15">
        <Presentation className="size-4 text-[#ea580c]" />
      </IconBadge>
    );

  // Media
  if (["png", "jpg", "jpeg", "gif", "webp", "bmp", "ico", "avif"].includes(ext))
    return (
      <IconBadge bg="bg-purple-500/15">
        <Image className="size-4 text-[#a855f7]" />
      </IconBadge>
    );
  if (["mp4", "mov", "avi", "mkv", "webm"].includes(ext))
    return (
      <IconBadge bg="bg-pink-500/15">
        <Video className="size-4 text-[#ec4899]" />
      </IconBadge>
    );

  // Archives
  if (["zip", "tar", "gz", "rar", "7z", "bz2"].includes(ext))
    return (
      <IconBadge bg="bg-amber-600/15">
        <Archive className="size-4 text-[#d97706]" />
      </IconBadge>
    );

  // Database
  if (["db", "sqlite", "sql"].includes(ext))
    return (
      <IconBadge bg="bg-cyan-600/15">
        <Database className="size-4 text-[#0891b2]" />
      </IconBadge>
    );

  // Default
  return (
    <IconBadge bg="bg-muted/80">
      <File className="size-4 text-muted-foreground" />
    </IconBadge>
  );
}

// ── Pointer drag initiator ────────────────────────────────────────────────────
// Called from onPointerDown on any draggable tree row.
// Tracks pointermove/pointerup on the document to bypass Tauri WebKit's
// broken HTML5 drag API.

function startPointerDrag(e: React.PointerEvent, path: string, isDir: boolean, name: string) {
  if (e.button !== 0) return;
  e.stopPropagation();

  const startX = e.clientX;
  const startY = e.clientY;

  const onMove = (me: PointerEvent) => {
    const dx = me.clientX - startX;
    const dy = me.clientY - startY;

    if (!_pdActive) {
      if (dx * dx + dy * dy < 36) return; // 6px threshold
      _pdActive = true;
      _pdSrc = { path, isDir, name };

      // Create floating ghost element
      const ghost = document.createElement("div");
      ghost.setAttribute("aria-hidden", "true");
      ghost.style.cssText = [
        "position:fixed",
        "pointer-events:none",
        "z-index:99999",
        "padding:3px 10px",
        "border-radius:6px",
        "font-size:12px",
        "white-space:nowrap",
        "max-width:280px",
        "overflow:hidden",
        "text-overflow:ellipsis",
        "opacity:0.92",
        "background:hsl(var(--popover))",
        "color:hsl(var(--popover-foreground))",
        "border:1px solid hsl(var(--border))",
        "box-shadow:0 4px 16px rgba(0,0,0,0.25)",
      ].join(";");
      ghost.textContent = `${isDir ? "文件夹" : "文件"} ${name}`;
      document.body.appendChild(ghost);
      _pdGhost = ghost;
    }

    if (_pdActive && _pdGhost) {
      _pdGhost.style.left = `${me.clientX + 14}px`;
      _pdGhost.style.top = `${me.clientY + 6}px`;

      // Hide ghost temporarily so elementFromPoint works
      _pdGhost.style.visibility = "hidden";
      const el = document.elementFromPoint(me.clientX, me.clientY) as HTMLElement | null;
      _pdGhost.style.visibility = "";

      // Find the item being hovered (file or folder button)
      const itemEl = el?.closest("[data-item-path]") as HTMLElement | null;
      const itemPath = itemEl?.getAttribute("data-item-path") ?? null;

      // Find the folder element for drop target (parent folder if dragging into nested)
      const folderEl = el?.closest("[data-dir-path]") as HTMLElement | null;
      const candidate = folderEl?.getAttribute("data-dir-path") ?? _pdRoot ?? null;

      // Determine drop indicator position
      if (itemEl && itemPath && itemPath !== path) {
        // Check if cursor is inside a folder item (not in top/bottom half)
        const isFolder = itemEl.hasAttribute("data-dir-path");
        if (isFolder) {
          // For folders, show "inside" indicator
          const rect = itemEl.getBoundingClientRect();
          const relY = me.clientY - rect.top;
          const relYRatio = relY / rect.height;
          // If in middle 60% of folder row, show inside; otherwise before/after
          if (relYRatio > 0.2 && relYRatio < 0.8) {
            _pdOnChange?.({ path: itemPath, position: "inside" });
          } else if (relYRatio <= 0.2) {
            _pdOnChange?.({ path: itemPath, position: "before" });
          } else {
            _pdOnChange?.({ path: itemPath, position: "after" });
          }
        } else {
          // For files, determine before/after based on cursor position
          const rect = itemEl.getBoundingClientRect();
          const relY = me.clientY - rect.top;
          const relYRatio = relY / rect.height;
          _pdOnChange?.({
            path: itemPath,
            position: relYRatio <= 0.5 ? "before" : "after",
          });
        }
      } else if (candidate && candidate !== path && !(isDir && candidate.startsWith(`${path}/`))) {
        _pdOnChange?.({ path: candidate, position: "inside" });
      } else {
        _pdOnChange?.(null);
      }
    }
  };

  const onUp = (ue: PointerEvent) => {
    document.removeEventListener("pointermove", onMove);
    document.removeEventListener("pointerup", onUp);

    if (_pdGhost) {
      _pdGhost.remove();
      _pdGhost = null;
    }

    if (_pdActive && _pdSrc) {
      const el = document.elementFromPoint(ue.clientX, ue.clientY) as HTMLElement | null;
      const folderEl = el?.closest("[data-dir-path]") as HTMLElement | null;
      const dest = folderEl?.getAttribute("data-dir-path") ?? _pdRoot ?? null;
      _pdOnDrop?.(_pdSrc, dest);
    }

    _pdActive = false;
    _pdSrc = null;
    _pdOnChange?.(null);
  };

  document.addEventListener("pointermove", onMove);
  document.addEventListener("pointerup", onUp);
}

// ── TreeNode ──────────────────────────────────────────────────────────────────

const TreeNode = React.memo(function TreeNode({
  node,
  depth,
  activeFile,
  selectedPathSet,
  readOnly = false,
  searchQuery,
  openNodes,
  autoExpandDepth = 1,
  collapseAllVersion,
  dirtyPaths,
  onFileClick,
  onSelectNode,
  onDelete,
  onRename,
  onInlineRename,
  onCreateFile,
  onCreateFolder,
  onCopyNode,
  onCutNode,
  onPasteNode,
  onCopyPath,
  onCopyRelativePath,
  onOpenNative,
  menuVariant = "default",
  showMenu,
  dragSrc,
  dropTarget,
  dropIndicator,
  renamingPath,
  cutPaths,
  onStartRename,
  onOpenChange,
  onToggleSelect,
  onViewFileHistory,
  inlineCreate,
  onInlineCreateConfirm,
  onInlineCreateCancel,
}: {
  node: FsNode;
  depth: number;
  activeFile: string | null;
  selectedPathSet: Set<string>;
  readOnly?: boolean;
  searchQuery: string;
  openNodes?: Set<string>;
  autoExpandDepth?: number;
  collapseAllVersion?: number;
  dirtyPaths?: Set<string>;
  onFileClick: (path: string, options?: OpenFileOptions) => void;
  onSelectNode: (path: string, options?: { additive?: boolean }) => void;
  onDelete: (path: string, isDir: boolean) => void;
  onRename: (path: string, isDir: boolean) => void;
  onInlineRename: (path: string, isDir: boolean, newName: string) => void;
  onCreateFile: (parentPath: string) => void;
  onCreateFolder: (parentPath: string) => void;
  onCopyNode: (path: string, isDir: boolean) => void;
  onCutNode: (path: string, isDir: boolean) => void;
  onPasteNode: (path: string) => void;
  onCopyPath: (path: string) => void;
  onCopyRelativePath: (path: string) => void;
  onOpenNative: (path: string, options?: NativeOpenOptions) => void;
  menuVariant?: "default" | "vscode";
  showMenu: (e: React.MouseEvent, items: MenuItem[]) => void;
  dragSrc: DragSrc | null;
  dropTarget: string | null;
  dropIndicator?: DropIndicator | null;
  renamingPath?: string | null;
  cutPaths?: Set<string>;
  onStartRename?: (path: string) => void;
  onOpenChange?: (path: string, isOpen: boolean) => void;
  onToggleSelect?: (path: string) => void;
  onViewFileHistory?: (path: string) => void;
  inlineCreate?: { parentPath: string; type: "file" | "folder" } | null;
  onInlineCreateConfirm?: (name: string) => void;
  onInlineCreateCancel?: () => void;
}) {
  const state = useReactive({
    open: depth < autoExpandDepth || openNodes?.has(node.path) === true,
    children: node.children ?? (null as FsNode[] | null),
    childLoading: false,
    childError: node.loadError ?? (null as string | null),
  });
  const iconCls = "size-3.5 shrink-0";

  // Lazy load children when directory is opened
  // Use a ref to track whether we've attempted to load children for this node
  const loadAttemptedRef = useRef<Set<string>>(new Set());
  const loadAttempted = loadAttemptedRef.current.has(node.path);
  const lastCollapseAllVersionRef = useRef(collapseAllVersion);

  useEffect(() => {
    // 仅在 node 自身已携带「加载完成」的子节点时,才用 node.children 覆盖本地 state.children。
    // 否则(node 是懒加载边界节点:childrenLoaded=false,children 多为陈旧空数组),
    // 保留懒加载已写入 state.children 的结果——否则每次因 openNodes/树重建导致本 effect
    // 重跑都会把已加载的子节点清回陈旧空值,触发子树重挂载 + 重复拉取同一目录(无限循环)。
    if (node.childrenLoaded || state.children === null) {
      state.children = node.children ?? null;
    }
    state.childError = node.loadError ?? null;
    if (openNodes?.has(node.path)) {
      state.open = true;
    }
  }, [node.children, node.childrenLoaded, node.loadError, node.path, openNodes]);

  useEffect(() => {
    if (lastCollapseAllVersionRef.current === collapseAllVersion) {
      return;
    }
    lastCollapseAllVersionRef.current = collapseAllVersion;
    state.open = false;
    loadAttemptedRef.current.delete(node.path);
  }, [collapseAllVersion, node.path]);

  useEffect(() => {
    const selected = selectedPathSet.has(node.path) || activeFile === node.path;
    if (!selected) return;

    let frame = 0;
    frame = window.requestAnimationFrame(() => {
      document.querySelector<HTMLElement>(getDataPathSelector(node.path))?.scrollIntoView({
        block: "nearest",
        inline: "nearest",
      });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [activeFile, node.path, selectedPathSet]);

  useEffect(() => {
    // Skip if: not open, not a dir, OR we've already attempted to load.
    // 直接读 ref(而非 render 期算得的 loadAttempted 快照),避免在「effect 已把路径
    // 加入 ref、但组件尚未重渲染刷新 loadAttempted」的时间窗内被同一目录重复拉取。
    if (
      !state.open ||
      !node.is_dir ||
      loadAttemptedRef.current.has(node.path) ||
      (node.childrenLoaded && !node.loadError)
    ) {
      return;
    }
    loadAttemptedRef.current.add(node.path);
    state.childLoading = true;
    state.childError = null;
    fetchTree(node.path, 1)
      .then((sub) => {
        state.children = sub.children ?? [];
      })
      .catch((error) => {
        state.childError = compactErrorMessage(formatUnknownError(error));
        state.children = [];
      })
      .finally(() => {
        state.childLoading = false;
      });
  }, [state.open, node.is_dir, node.path, node.name, node.childrenLoaded, node.loadError, loadAttempted]);

  const isSelected = selectedPathSet.has(node.path);
  const isDragging = dragSrc?.path === node.path;
  const isCut = cutPaths?.has(node.path) ?? false;
  const forceOpen = !!searchQuery.trim();
  const isVsCodeMenu = menuVariant === "vscode";

  if (node.is_dir) {
    const isOver = dropTarget === node.path && dragSrc?.path !== node.path;
    const toggleDirectoryOpen = (next = !state.open) => {
      state.open = next;
      onOpenChange?.(node.path, next);
    };
    const readOnlyDirItems: MenuItem[] = [
      {
        label: "在系统中显示",
        icon: <ExternalLink className={iconCls} />,
        onClick: () => onOpenNative(node.path, { isDirectory: true }),
        requiresNativeShell: true,
      },
      { separator: true, label: "", onClick: () => {} },
      {
        label: "复制路径",
        icon: <Copy className={iconCls} />,
        onClick: () => onCopyPath(node.path),
      },
      {
        label: "复制相对路径",
        icon: <Copy className={iconCls} />,
        onClick: () => onCopyRelativePath(node.path),
      },
    ];
    const dirItems: MenuItem[] = readOnly
      ? readOnlyDirItems
      : isVsCodeMenu
        ? [
            {
              label: "新建文件…",
              icon: <FilePlus className={iconCls} />,
              onClick: () => onCreateFile(node.path),
            },
            {
              label: "新建文件夹…",
              icon: <FolderPlus className={iconCls} />,
              onClick: () => onCreateFolder(node.path),
            },
            { separator: true, label: "", onClick: () => {} },
            {
              label: "在系统中显示",
              icon: <ExternalLink className={iconCls} />,
              onClick: () => onOpenNative(node.path, { isDirectory: true }),
              requiresNativeShell: true,
            },
            { separator: true, label: "", onClick: () => {} },
            {
              label: "剪切",
              icon: <Scissors className={iconCls} />,
              onClick: () => onCutNode(node.path, true),
              shortcut: formatShortcut("Ctrl", "X"),
            },
            {
              label: "复制",
              icon: <Copy className={iconCls} />,
              onClick: () => onCopyNode(node.path, true),
              shortcut: formatShortcut("Ctrl", "C"),
            },
            {
              label: "粘贴",
              icon: <ClipboardPaste className={iconCls} />,
              onClick: () => onPasteNode(node.path),
              shortcut: formatShortcut("Ctrl", "V"),
            },
            { separator: true, label: "", onClick: () => {} },
            {
              label: "复制路径",
              icon: <Copy className={iconCls} />,
              onClick: () => onCopyPath(node.path),
            },
            {
              label: "复制相对路径",
              icon: <Copy className={iconCls} />,
              onClick: () => onCopyRelativePath(node.path),
            },
            { separator: true, label: "", onClick: () => {} },
            {
              label: "重命名",
              icon: <Pencil className={iconCls} />,
              onClick: () => {
                onStartRename?.(node.path);
              },
              shortcut: "F2",
            },
            {
              label: "删除",
              icon: <Trash2 className={iconCls} />,
              onClick: () => onDelete(node.path, true),
              danger: true,
              shortcut: formatShortcut("Del"),
            },
          ]
        : [
            {
              label: "新建文件",
              icon: <FilePlus className={iconCls} />,
              onClick: () => onCreateFile(node.path),
            },
            {
              label: "新建文件夹",
              icon: <FolderPlus className={iconCls} />,
              onClick: () => onCreateFolder(node.path),
            },
            { separator: true, label: "", onClick: () => {} },
            {
              label: "复制",
              icon: <Copy className={iconCls} />,
              onClick: () => onCopyNode(node.path, true),
              shortcut: formatShortcut("Ctrl", "C"),
            },
            {
              label: "剪切",
              icon: <Scissors className={iconCls} />,
              onClick: () => onCutNode(node.path, true),
              shortcut: formatShortcut("Ctrl", "X"),
            },
            {
              label: "粘贴",
              icon: <ClipboardPaste className={iconCls} />,
              onClick: () => onPasteNode(node.path),
              shortcut: formatShortcut("Ctrl", "V"),
            },
            { separator: true, label: "", onClick: () => {} },
            {
              label: "复制路径",
              icon: <Copy className={iconCls} />,
              onClick: () => onCopyPath(node.path),
            },
            {
              label: "在系统中显示",
              icon: <ExternalLink className={iconCls} />,
              onClick: () => onOpenNative(node.path, { isDirectory: true }),
              requiresNativeShell: true,
            },
            { separator: true, label: "", onClick: () => {} },
            {
              label: "重命名",
              icon: <Pencil className={iconCls} />,
              onClick: () => {
                onStartRename?.(node.path);
              },
              shortcut: "F2",
            },
            {
              label: "删除文件夹",
              icon: <Trash2 className={iconCls} />,
              onClick: () => onDelete(node.path, true),
              danger: true,
              shortcut: formatShortcut("Del"),
            },
          ];

    return (
      <div className="file-tree-node" data-dir-path={node.path}>
        <button
          type="button"
          data-item-path={node.path}
          role="treeitem"
          aria-expanded={forceOpen || state.open}
          aria-selected={isSelected}
          aria-level={depth + 1}
          aria-label={`${node.name}${state.childError ? "，目录加载失败" : ""}`}
          title={node.path}
          className={cn(
            "file-tree-row",
            isSelected && "is-selected",
            isOver && "is-drop-target",
            isDragging && "is-dragging",
            isCut && "is-cut",
          )}
          onContextMenu={(e) => {
            onSelectNode(node.path);
            showMenu(e, dirItems);
          }}
          onClick={(e) => {
            const clickedDisclosure = (e.target as HTMLElement | null)?.closest("[data-tree-disclosure]");
            if (clickedDisclosure || e.altKey) {
              e.preventDefault();
              toggleDirectoryOpen();
              return;
            }
            // Ctrl+Click: toggle individual item in selection (multi-select)
            if (e.ctrlKey || e.metaKey) {
              e.preventDefault();
              onToggleSelect?.(node.path);
              return;
            }
            const additive = isMetaSelectionEvent(e);
            onSelectNode(node.path, { additive });
          }}
          onDoubleClick={(e) => {
            e.preventDefault();
            const clickedDisclosure = (e.target as HTMLElement | null)?.closest("[data-tree-disclosure]");
            if (clickedDisclosure) return;
            toggleDirectoryOpen();
          }}
          onKeyDown={(e) => {
            const additive = isMetaSelectionEvent(e);
            if (e.key === "F2") {
              if (readOnly) return;
              e.preventDefault();
              onStartRename?.(node.path);
              return;
            }
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              onSelectNode(node.path, { additive });
              if (!additive) {
                toggleDirectoryOpen();
              }
              return;
            }
            if (e.key === "ArrowRight" && !state.open) {
              e.preventDefault();
              toggleDirectoryOpen(true);
              return;
            }
            if (e.key === "ArrowLeft" && state.open) {
              e.preventDefault();
              toggleDirectoryOpen(false);
            }
          }}
          onPointerDown={(e) => {
            const clickedDisclosure = (e.target as HTMLElement | null)?.closest("[data-tree-disclosure]");
            if (clickedDisclosure) return;
            if (readOnly) return;
            startPointerDrag(e, node.path, true, node.name);
          }}
          style={{ paddingLeft: `${depth * 14}px` }}
        >
          <span className="file-tree-row-content">
            <span className="file-tree-row-disclosure" data-tree-disclosure="true" aria-hidden="true">
              {state.childLoading ? (
                <Loader2 className="size-3 shrink-0 animate-spin text-muted-foreground/70" />
              ) : (
                <ChevronDown
                  className={cn(
                    "size-3 shrink-0 text-muted-foreground/70 transition-transform duration-150",
                    !(forceOpen || state.open) && "-rotate-90",
                  )}
                />
              )}
            </span>
            <IconBadge bg="bg-amber-400/15">
              {forceOpen || state.open ? (
                <FolderOpen className="size-[13px] text-[#f59e0b]" />
              ) : (
                <Folder className="size-[13px] text-[#eab308]" />
              )}
            </IconBadge>
            {renamingPath === node.path ? (
              <InlineRenameInput
                initialValue={node.name}
                isDirectory={true}
                onConfirm={async (newName) => {
                  if (newName && newName !== node.name) {
                    await onInlineRename(node.path, true, newName);
                  }
                  onStartRename?.("");
                }}
                onCancel={() => onStartRename?.("")}
              />
            ) : (
              <span className="file-tree-row-label is-directory">
                <HighlightedName name={node.name} query={searchQuery} />
              </span>
            )}
            {state.childError && (
              <XCircle className="ml-auto size-3 shrink-0 text-destructive/70" aria-label="目录加载失败" />
            )}
            {dropIndicator?.path === node.path && dropIndicator.position !== "inside" && (
              <span
                className={cn(
                  "file-tree-drop-indicator",
                  dropIndicator.position === "before"
                    ? "file-tree-drop-indicator-before"
                    : "file-tree-drop-indicator-after",
                )}
              />
            )}
          </span>
        </button>
        {(forceOpen || state.open) && state.children !== null ? (
          <div className="file-tree-node-children" role="group" aria-label={`${node.name} 的子项`}>
            {state.children.map((child) => (
              <TreeNode
                key={child.path}
                node={child}
                depth={depth + 1}
                activeFile={activeFile}
                selectedPathSet={selectedPathSet}
                readOnly={readOnly}
                searchQuery={searchQuery}
                openNodes={openNodes}
                autoExpandDepth={autoExpandDepth}
                collapseAllVersion={collapseAllVersion}
                dirtyPaths={dirtyPaths}
                onFileClick={onFileClick}
                onSelectNode={onSelectNode}
                onDelete={onDelete}
                onRename={onRename}
                onInlineRename={onInlineRename}
                onCreateFile={onCreateFile}
                onCreateFolder={onCreateFolder}
                onCopyNode={onCopyNode}
                onCutNode={onCutNode}
                onPasteNode={onPasteNode}
                onCopyPath={onCopyPath}
                onCopyRelativePath={onCopyRelativePath}
                onOpenNative={onOpenNative}
                menuVariant={menuVariant}
                showMenu={showMenu}
                dragSrc={dragSrc}
                dropTarget={dropTarget}
                dropIndicator={dropIndicator}
                renamingPath={renamingPath}
                cutPaths={cutPaths}
                onStartRename={onStartRename}
                onOpenChange={onOpenChange}
                onToggleSelect={onToggleSelect}
                onViewFileHistory={onViewFileHistory}
                inlineCreate={inlineCreate}
                onInlineCreateConfirm={onInlineCreateConfirm}
                onInlineCreateCancel={onInlineCreateCancel}
              />
            ))}
            {state.childError && (
              <div className="file-tree-inline-error" style={{ marginLeft: `${(depth + 1) * 14 + 18}px` }}>
                {state.childError}
              </div>
            )}
            {/* Inline creation input - at bottom of folder */}
            {inlineCreate?.parentPath === node.path && (
              <div className="file-tree-inline-create-row" style={{ paddingLeft: `${(depth + 1) * 14 + 14}px` }}>
                {inlineCreate.type === "folder" ? (
                  <Folder className="file-tree-inline-create-icon text-[#eab308]" aria-hidden="true" />
                ) : (
                  <File className="file-tree-inline-create-icon text-muted-foreground" aria-hidden="true" />
                )}
                <InlineCreationInput
                  isFolder={inlineCreate.type === "folder"}
                  onConfirm={(name) => onInlineCreateConfirm?.(name)}
                  onCancel={() => onInlineCreateCancel?.()}
                />
              </div>
            )}
          </div>
        ) : null}
      </div>
    );
  }

  const isActive = activeFile === node.path;
  const isOffice = OFFICE_EXTS.has(node.path.split(".").pop()?.toLowerCase() ?? "");
  const parentPath = getParentPath(node.path);
  const isDirtyFile = dirtyPaths?.has(node.path) ?? false;
  const readOnlyFileItems: MenuItem[] = [
    {
      label: isVsCodeMenu ? "打开" : "打开文件",
      icon: <Eye className={iconCls} />,
      onClick: () => onFileClick(node.path, { pinned: true }),
    },
    ...(isOffice
      ? [
          {
            label: "用系统应用打开",
            icon: <ExternalLink className={iconCls} />,
            onClick: () => onOpenNative(node.path, { mode: "open-file" }),
            requiresNativeShell: true,
          },
        ]
      : []),
    {
      label: "在系统中显示",
      icon: <ExternalLink className={iconCls} />,
      onClick: () => onOpenNative(node.path, { isDirectory: false }),
      requiresNativeShell: true,
    },
    { separator: true, label: "", onClick: () => {} },
    {
      label: "复制路径",
      icon: <Copy className={iconCls} />,
      onClick: () => onCopyPath(node.path),
    },
    {
      label: "复制相对路径",
      icon: <Copy className={iconCls} />,
      onClick: () => onCopyRelativePath(node.path),
    },
    ...(onViewFileHistory
      ? [
          {
            label: "文件历史",
            icon: <History className={iconCls} />,
            onClick: () => onViewFileHistory(node.path),
          },
        ]
      : []),
  ];
  const fileItems: MenuItem[] = readOnly
    ? readOnlyFileItems
    : isVsCodeMenu
      ? [
          {
            label: "打开",
            icon: <Eye className={iconCls} />,
            onClick: () => onFileClick(node.path, { pinned: true }),
          },
          ...(isOffice
            ? [
                {
                  label: "用系统应用打开",
                  icon: <ExternalLink className={iconCls} />,
                  onClick: () => onOpenNative(node.path, { mode: "open-file" }),
                  requiresNativeShell: true,
                },
              ]
            : []),
          {
            label: "在系统中显示",
            icon: <ExternalLink className={iconCls} />,
            onClick: () => onOpenNative(node.path, { isDirectory: false }),
            requiresNativeShell: true,
          },
          { separator: true, label: "", onClick: () => {} },
          {
            label: "剪切",
            icon: <Scissors className={iconCls} />,
            onClick: () => onCutNode(node.path, false),
            shortcut: formatShortcut("Ctrl", "X"),
          },
          {
            label: "复制",
            icon: <Copy className={iconCls} />,
            onClick: () => onCopyNode(node.path, false),
            shortcut: formatShortcut("Ctrl", "C"),
          },
          {
            label: "粘贴",
            icon: <ClipboardPaste className={iconCls} />,
            onClick: () => onPasteNode(parentPath),
            shortcut: formatShortcut("Ctrl", "V"),
          },
          { separator: true, label: "", onClick: () => {} },
          {
            label: "复制路径",
            icon: <Copy className={iconCls} />,
            onClick: () => onCopyPath(node.path),
          },
          {
            label: "复制相对路径",
            icon: <Copy className={iconCls} />,
            onClick: () => onCopyRelativePath(node.path),
          },
          { separator: true, label: "", onClick: () => {} },
          {
            label: "重命名",
            icon: <Pencil className={iconCls} />,
            onClick: () => onStartRename?.(node.path),
            shortcut: "F2",
          },
          {
            label: "删除",
            icon: <Trash2 className={iconCls} />,
            onClick: () => onDelete(node.path, false),
            danger: true,
            shortcut: formatShortcut("Del"),
          },
        ]
      : [
          {
            label: "打开文件",
            icon: <Eye className={iconCls} />,
            onClick: () => onFileClick(node.path, { pinned: true }),
          },
          ...(isOffice
            ? [
                {
                  label: "用系统应用打开",
                  icon: <ExternalLink className={iconCls} />,
                  onClick: () => onOpenNative(node.path, { mode: "open-file" }),
                  requiresNativeShell: true,
                },
              ]
            : []),
          { separator: true, label: "", onClick: () => {} },
          {
            label: "重命名",
            icon: <Pencil className={iconCls} />,
            onClick: () => onStartRename?.(node.path),
            shortcut: "F2",
          },
          {
            label: "复制",
            icon: <Copy className={iconCls} />,
            onClick: () => onCopyNode(node.path, false),
            shortcut: formatShortcut("Ctrl", "C"),
          },
          {
            label: "剪切",
            icon: <Scissors className={iconCls} />,
            onClick: () => onCutNode(node.path, false),
            shortcut: formatShortcut("Ctrl", "X"),
          },
          {
            label: "复制路径",
            icon: <Copy className={iconCls} />,
            onClick: () => onCopyPath(node.path),
          },
          ...(onViewFileHistory
            ? [
                {
                  label: "文件历史",
                  icon: <History className={iconCls} />,
                  onClick: () => onViewFileHistory(node.path),
                },
              ]
            : []),
          {
            label: "在系统中显示",
            icon: <ExternalLink className={iconCls} />,
            onClick: () => onOpenNative(node.path, { isDirectory: false }),
            requiresNativeShell: true,
          },
          { separator: true, label: "", onClick: () => {} },
          {
            label: "删除文件",
            icon: <Trash2 className={iconCls} />,
            onClick: () => onDelete(node.path, false),
            danger: true,
            shortcut: formatShortcut("Del"),
          },
        ];

  return (
    <button
      type="button"
      data-item-path={node.path}
      role="treeitem"
      aria-selected={isSelected}
      aria-level={depth + 1}
      aria-label={`${node.name}${isDirtyFile ? "，已修改" : ""}${isActive ? "，当前打开" : ""}`}
      title={node.path}
      className={cn(
        "file-tree-row",
        isSelected && "is-selected",
        isActive && "is-active",
        isDragging && "is-dragging",
        isCut && "is-cut",
      )}
      onContextMenu={(e) => {
        onSelectNode(node.path);
        showMenu(e, fileItems);
      }}
      onClick={(e) => {
        // Ctrl+Click: toggle individual item in selection (multi-select)
        if (e.ctrlKey || e.metaKey) {
          e.preventDefault();
          onToggleSelect?.(node.path);
          return;
        }
        const additive = isMetaSelectionEvent(e);
        onSelectNode(node.path, { additive });
        if (!additive) {
          onFileClick(node.path, { preview: true });
        }
      }}
      onDoubleClick={(e) => {
        e.preventDefault();
        onFileClick(node.path, { pinned: true });
      }}
      onKeyDown={(e) => {
        const additive = isMetaSelectionEvent(e);
        if (e.key === "F2") {
          if (readOnly) return;
          e.preventDefault();
          onStartRename?.(node.path);
          return;
        }
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelectNode(node.path, { additive });
          if (!additive) {
            onFileClick(node.path, { pinned: true });
          }
        }
      }}
      onPointerDown={(e) => {
        if (readOnly) return;
        startPointerDrag(e, node.path, false, node.name);
      }}
      style={{ paddingLeft: `${depth * 14 + 14}px` }}
    >
      <span className="file-tree-row-content is-file">
        <FileIcon name={node.name} />
        {renamingPath === node.path ? (
          <InlineRenameInput
            initialValue={node.name}
            isDirectory={false}
            onConfirm={async (newName) => {
              if (newName && newName !== node.name) {
                await onInlineRename(node.path, false, newName);
              }
              onStartRename?.("");
            }}
            onCancel={() => onStartRename?.("")}
          />
        ) : (
          <span className={cn("file-tree-row-label", isActive && "is-active")}>
            <HighlightedName name={node.name} query={searchQuery} />
          </span>
        )}
        {isDirtyFile && <span className="file-tree-dirty-dot" title="已修改" aria-hidden="true" />}
        {dropIndicator?.path === node.path && dropIndicator.position !== "inside" && (
          <span
            className={cn(
              "file-tree-drop-indicator",
              dropIndicator.position === "before"
                ? "file-tree-drop-indicator-before"
                : "file-tree-drop-indicator-after",
            )}
          />
        )}
      </span>
    </button>
  );
});

// ── Panel components ──────────────────────────────────────────────────────────

function TextEditorPanel({
  params,
  api,
}: IDockviewPanelProps<{
  path: string;
  line?: number;
  searchQuery?: string;
  autoSaveDelay?: number; // Auto-save delay in ms, 0 = disabled
  commandScope?: string;
  enableLocalSnapshots?: boolean;
  enableRichMarkdown?: boolean;
  assetId?: string | null;
  onOpenWikiLink?: (repoRelativePath: string) => void;
  isDirty?: boolean;
  showEditorActions?: boolean;
  showPreviewIndicator?: boolean;
  workbenchVariant?: "default" | "vscode";
  rootPath?: string | null;
  readOnly?: boolean;
  readFile?: (path: string) => Promise<string>;
  contentVersion?: string;
  externalContent?: { version: string; content: string };
  onDirtyChange?: (path: string, isDirty: boolean, baseContent?: string) => void;
  onContentChange?: (path: string, content: string) => void;
  onExternalChange?: (path: string, oldContent: string, newContent: string) => void;
  onAfterSave?: (path: string) => void;
  onEditorStatusChange?: (path: string, status: FileEditorStatusSnapshot | null) => void;
  onCopyPath?: (path: string) => void;
  onOpenNative?: (path: string, options?: NativeOpenOptions) => void;
  onViewFileHistory?: (path: string) => void;
  onViewStateChange?: (path: string, viewState: unknown) => void;
  initialViewState?: unknown;
  /** 注册/注销该面板的 Monaco 实例(供命令面板触发格式化等编辑器内动作);editor=null 为注销。 */
  onEditorInstance?: (path: string, editor: monacoEditor.editor.IStandaloneCodeEditor | null) => void;
}>) {
  const state = useReactive({
    content: "",
    loading: true,
    cursorPosition: { line: 1, column: 1 },
    selectionLength: 0,
    indentation: { tabSize: 4, insertSpaces: true },
    eol: "LF" as string,
    minimapEnabled: false,
    wordWrapEnabled: false,
    metricsVersion: 0,
    saveStatus: "saved" as EditorSaveStatusValue,
    lastSavedAt: null as number | null,
  });
  const contentRef = useRef("");
  const pathRef = useRef<string | undefined>(undefined);
  const apiRef = useRef<any>(null);
  const isDirtyRef = useRef(false);
  const focusRef = useRef<HTMLDivElement>(null);
  const monacoEditorRef = useRef<monacoEditor.editor.IStandaloneCodeEditor | null>(null);
  const monacoRef = useRef<import("@monaco-editor/react").Monaco | null>(null);
  const monacoDisposablesRef = useRef<Array<string | monacoEditor.IDisposable>>([]);
  const decorationIdsRef = useRef<string[]>([]);
  const markdownEditorRef = useRef<TiptapEditor | null>(null);
  const metricsUpdateTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Ref to access handleSave without dependency issues
  const handleSaveRef = useRef<(() => Promise<void>) | null>(null);
  const flushMetricsRefresh = useCallback(() => {
    if (metricsUpdateTimerRef.current) {
      clearTimeout(metricsUpdateTimerRef.current);
      metricsUpdateTimerRef.current = null;
    }
    state.metricsVersion++;
  }, []);
  const scheduleMetricsRefresh = useCallback(() => {
    if (metricsUpdateTimerRef.current) return;
    metricsUpdateTimerRef.current = setTimeout(() => {
      metricsUpdateTimerRef.current = null;
      state.metricsVersion++;
    }, 250);
  }, []);
  const fileName = params?.path?.split("/").pop() || "未命名";
  const languageId = getMonacoLanguage(params?.path ?? "");
  const editorPath = params?.path ?? "";
  const parentPath = editorPath ? getParentPath(editorPath) : "";
  const showEditorActions = params?.showEditorActions !== false;
  const isVsCodeVariant = params?.workbenchVariant === "vscode";
  const readOnly = params?.readOnly === true;
  const pathSegments = isVsCodeVariant
    ? getWorkspaceRelativePath(params?.rootPath ?? null, editorPath)
        .split("/")
        .filter(Boolean)
    : (params?.path?.split("/").filter(Boolean) ?? []);

  useEffect(() => {
    if (!params?.path) return;
    state.loading = true;
    state.saveStatus = "saved";
    state.lastSavedAt = null;
    isDirtyRef.current = false;
    pathRef.current = params.path;
    apiRef.current = api;
    api.setTitle(fileName);
    api.updateParameters({
      ...(params ?? {}),
      ...api.getParameters(),
      isDirty: false,
    });
    const readTextFile = params.readFile ?? fetchFile;
    const loadContent = params.externalContent
      ? Promise.resolve(params.externalContent.content)
      : readTextFile(params.path);
    loadContent
      .then((c) => {
        state.content = c;
        contentRef.current = c;
        params.onContentChange?.(params.path, c);
        flushMetricsRefresh();
      })
      .catch((e) => console.error("[FileTreeEditor] Failed to load file content", e))
      .finally(() => {
        state.loading = false;
      });
  }, [
    params?.path,
    params?.contentVersion,
    params?.externalContent?.version,
    params?.readFile,
    params?.onContentChange,
    api,
    fileName,
    flushMetricsRefresh,
  ]);

  // Cleanup: dispose Monaco editor + event listeners on panel close (SideX pattern)
  // This prevents "TextModel got disposed" errors when the panel is closed
  // while other editors (e.g., DiffEditor) still reference the same models.
  useEffect(() => {
    return () => {
      for (const d of monacoDisposablesRef.current) {
        // Only dispose actual IDisposable objects, not string command IDs
        if (typeof d === "object" && d && typeof (d as monacoEditor.IDisposable).dispose === "function") {
          (d as monacoEditor.IDisposable).dispose();
        }
      }
      monacoDisposablesRef.current = [];
      if (metricsUpdateTimerRef.current) {
        clearTimeout(metricsUpdateTimerRef.current);
        metricsUpdateTimerRef.current = null;
      }
      // Guard against RxJS errors during Monaco disposal
      try {
        monacoEditorRef.current?.dispose();
      } catch {
        // Ignore disposal errors from Monaco's internal RxJS
      }
      monacoEditorRef.current = null;
      monacoRef.current = null;
      markdownEditorRef.current?.destroy();
      markdownEditorRef.current = null;
    };
  }, []);

  // Auto-save: periodically save dirty files (SideX pattern)
  useEffect(() => {
    if (!params?.autoSaveDelay || params.autoSaveDelay <= 0) return;
  }, [params?.autoSaveDelay]);

  useInterval(
    () => {
      if (isDirtyRef.current && pathRef.current && handleSaveRef.current) {
        void handleSaveRef.current();
      }
    },
    params?.autoSaveDelay && params.autoSaveDelay > 0 ? params.autoSaveDelay : undefined,
  );

  // Auto-save on blur (when editor loses focus)
  useEffect(() => {
    if (!params?.autoSaveDelay || params.autoSaveDelay <= 0) return;

    const handleBlur = () => {
      if (isDirtyRef.current && pathRef.current && handleSaveRef.current) {
        void handleSaveRef.current();
      }
    };

    const editorEl = focusRef.current;
    editorEl?.addEventListener("blur", handleBlur);
    return () => editorEl?.removeEventListener("blur", handleBlur);
  }, [params?.autoSaveDelay]);

  const handleSave = useCallback(async () => {
    if (readOnly) return;
    const currentPath = pathRef.current;
    const currentApi = apiRef.current;
    if (!currentPath || !currentApi) return;
    const currentFileName = currentPath.split("/").pop() || "未命名";
    const contentToSave = contentRef.current;
    try {
      state.saveStatus = "saving";
      await writeFile(currentPath, contentToSave);
      if (params?.enableLocalSnapshots) {
        await createLocalSnapshot(currentPath, contentToSave, "保存快照");
      }
      flushMetricsRefresh();
      if (contentRef.current !== contentToSave) {
        state.saveStatus = "dirty";
        return;
      }
      isDirtyRef.current = false;
      currentApi.setTitle(currentFileName);
      currentApi.updateParameters({
        ...(params ?? {}),
        ...currentApi.getParameters(),
        isDirty: false,
      });
      state.saveStatus = "saved";
      state.lastSavedAt = Date.now();
      params?.onContentChange?.(currentPath, contentToSave);
      params?.onDirtyChange?.(currentPath, false);
      params?.onAfterSave?.(currentPath);
    } catch (e) {
      state.saveStatus = "error";
      console.error("[FileTreeEditor] Failed to save file", e);
    }
  }, [readOnly]);

  // Keep handleSaveRef in sync with handleSave
  handleSaveRef.current = handleSave;

  // .md/.markdown/.mkd 都走富文本 Markdown 编辑器;.mdx 含 JSX 留给 Monaco 更稳。
  const isMarkdown = params?.enableRichMarkdown === true && /\.(md|markdown|mkd)$/i.test(params?.path ?? "");

  const handleChange = (v: string | undefined) => {
    if (readOnly) return;
    const c = v ?? "";
    const baseContent = contentRef.current;
    contentRef.current = c;
    if (params?.path) {
      params.onContentChange?.(params.path, c);
    }
    scheduleMetricsRefresh();
    if (!isDirtyRef.current) {
      isDirtyRef.current = true;
      state.saveStatus = "dirty";
      api.setTitle(isVsCodeVariant ? fileName : `${fileName} *`);
      api.updateParameters({
        ...(params ?? {}),
        ...api.getParameters(),
        isDirty: true,
      });
      params?.onDirtyChange?.(params.path, true, baseContent);
    } else if (state.saveStatus !== "dirty") {
      state.saveStatus = "dirty";
    }
  };

  const handleMount: import("@monaco-editor/react").EditorProps["onMount"] = (editor, monaco) => {
    monacoEditorRef.current = editor;
    monacoRef.current = monaco;

    // 注册到宿主的活动编辑器表(供命令面板「格式化文档」等);卸载时注销。
    if (params?.path) {
      params.onEditorInstance?.(params.path, editor);
      monacoDisposablesRef.current.push({
        dispose: () => params.path && params.onEditorInstance?.(params.path, null),
      });
    }

    // Makefile recipes 必须用 Tab 缩进(空格缩进会让 make 报 "missing separator")——
    // 无视全局 insertSpaces,强制该模型用 Tab,避免在 WebIDE 里编辑后静默写坏 Makefile。
    if (languageId === "makefile") editor.getModel()?.updateOptions({ insertSpaces: false });

    // Restore editor memento (cursor/scroll position) if available
    if (params?.initialViewState && params.path) {
      try {
        editor.restoreViewState(params.initialViewState as monacoEditor.editor.ICodeEditorViewState);
      } catch {
        // Ignore restoration errors
      }
    }

    // Save editor memento when cursor position changes (debounced)
    let saveMementoTimeout: ReturnType<typeof setTimeout> | null = null;
    monacoDisposablesRef.current.push({
      dispose: () => {
        if (saveMementoTimeout) {
          clearTimeout(saveMementoTimeout);
          saveMementoTimeout = null;
        }
      },
    });
    monacoDisposablesRef.current.push(
      editor.onDidChangeCursorPosition(() => {
        if (saveMementoTimeout) clearTimeout(saveMementoTimeout);
        saveMementoTimeout = setTimeout(() => {
          if (params.path && params.onViewStateChange) {
            const state = editor.saveViewState();
            params.onViewStateChange(params.path, state);
          }
        }, 500);
      }),
    );

    // Save: Ctrl/Cmd + S
    // Note: editor.addCommand returns string ID or null, cannot be disposed individually
    const saveId = editor.addCommand(monacoEditor.KeyMod.CtrlCmd | monacoEditor.KeyCode.KeyS, () => handleSave());
    if (saveId) monacoDisposablesRef.current.push(saveId);

    // Toggle minimap: Ctrl/Cmd + Shift + M
    const minimapId = editor.addCommand(
      monacoEditor.KeyMod.CtrlCmd | monacoEditor.KeyMod.Shift | monacoEditor.KeyCode.KeyM,
      () => {
        const newValue = !editor.getOption(monacoEditor.editor.EditorOption.minimap).enabled;
        editor.updateOptions({ minimap: { enabled: newValue } });
        state.minimapEnabled = newValue;
      },
    );
    if (minimapId) monacoDisposablesRef.current.push(minimapId);

    // Toggle word wrap: Alt + Z
    const wordWrapId = editor.addCommand(monacoEditor.KeyMod.Alt | monacoEditor.KeyCode.KeyZ, () => {
      const newValue = editor.getOption(monacoEditor.editor.EditorOption.wordWrap) === "on" ? "off" : "on";
      editor.updateOptions({ wordWrap: newValue });
      state.wordWrapEnabled = newValue === "on";
    });
    if (wordWrapId) monacoDisposablesRef.current.push(wordWrapId);

    // Go to line: Ctrl/Cmd + G
    const gotoId = editor.addCommand(monacoEditor.KeyMod.CtrlCmd | monacoEditor.KeyCode.KeyG, () => {
      // Use Monaco's built-in Go to Line dialog
      editor.getAction("editor.action.gotoLine")?.run();
    });
    if (gotoId) monacoDisposablesRef.current.push(gotoId);

    const findId = editor.addCommand(monacoEditor.KeyMod.CtrlCmd | monacoEditor.KeyCode.KeyF, () => {
      editor.getAction("actions.find")?.run();
    });
    if (findId) monacoDisposablesRef.current.push(findId);

    const formatId = editor.addCommand(
      monacoEditor.KeyMod.Shift | monacoEditor.KeyMod.Alt | monacoEditor.KeyCode.KeyF,
      () => {
        editor.getAction("editor.action.formatDocument")?.run();
      },
    );
    if (formatId) monacoDisposablesRef.current.push(formatId);

    const replaceId = editor.addCommand(monacoEditor.KeyMod.CtrlCmd | monacoEditor.KeyCode.KeyH, () => {
      editor.getAction("editor.action.startFindReplaceAction")?.run();
    });
    if (replaceId) monacoDisposablesRef.current.push(replaceId);

    // Track cursor position
    monacoDisposablesRef.current.push(
      editor.onDidChangeCursorPosition((e) => {
        if (state.cursorPosition.line === e.position.lineNumber && state.cursorPosition.column === e.position.column) {
          return;
        }
        state.cursorPosition = {
          line: e.position.lineNumber,
          column: e.position.column,
        };
      }),
    );

    // Track selection
    monacoDisposablesRef.current.push(
      editor.onDidChangeCursorSelection((e) => {
        const selection = e.selection;
        const model = editor.getModel();
        if (!model) return;

        const nextSelectionLength = selection.isEmpty() ? 0 : model.getValueLengthInRange(selection);
        if (state.selectionLength !== nextSelectionLength) {
          state.selectionLength = nextSelectionLength;
        }
      }),
    );

    // Set initial values
    const position = editor.getPosition();
    state.cursorPosition = {
      line: position?.lineNumber ?? 1,
      column: position?.column ?? 1,
    };
    const model = editor.getModel();
    if (model) {
      const modelOptions = model.getOptions();
      state.indentation = {
        tabSize: modelOptions.tabSize,
        insertSpaces: modelOptions.insertSpaces,
      };
    }
    state.minimapEnabled = editor.getOption(monacoEditor.editor.EditorOption.minimap).enabled;
    state.wordWrapEnabled = editor.getOption(monacoEditor.editor.EditorOption.wordWrap) === "on";

    // Get EOL
    if (model) {
      state.eol = model.getEOL() === "\n" ? "LF" : "CRLF";
    }
  };

  useEffect(() => {
    if (state.loading || !params?.line || isMarkdown) return;
    const editor = monacoEditorRef.current;
    if (!editor) return;

    const targetLine = Math.max(1, params.line);
    editor.revealLineInCenter(targetLine);
    const model = editor.getModel();
    const lineLength = model?.getLineLength(targetLine) ?? 1;
    editor.setSelection({
      startLineNumber: targetLine,
      startColumn: 1,
      endLineNumber: targetLine,
      endColumn: Math.max(2, lineLength + 1),
    });
    editor.setPosition({ lineNumber: targetLine, column: 1 });
    editor.focus();
  }, [isMarkdown, state.loading, params?.line]);

  useEffect(() => {
    if (state.loading || isMarkdown) return;
    const editor = monacoEditorRef.current;
    const monaco = monacoRef.current;
    const model = editor?.getModel();
    if (!editor || !monaco || !model) return;

    const query = params?.searchQuery?.trim();
    if (!query) {
      decorationIdsRef.current = editor.deltaDecorations(decorationIdsRef.current, []);
      return;
    }

    const matches = model.findMatches(query, false, false, false, null, true);
    decorationIdsRef.current = editor.deltaDecorations(
      decorationIdsRef.current,
      matches.map((match) => ({
        range: match.range,
        options: {
          className: "rounded-sm bg-yellow-400/20",
          inlineClassName: "bg-yellow-400/25",
        },
      })),
    );
  }, [isMarkdown, state.loading, params?.searchQuery]);

  const runMarkdownCommand = useCallback((command: string) => {
    const root = focusRef.current;
    if (!root || !root.contains(document.activeElement as Node)) return false;

    const activeElement = document.activeElement as HTMLElement | null;
    const monacoEditor = monacoEditorRef.current;
    const tiptapEditor = markdownEditorRef.current;
    const inMonaco = !!activeElement?.closest(".monaco-editor");
    const inProseMirror = !!activeElement?.closest(".ProseMirror");

    if (inMonaco && monacoEditor) {
      switch (command) {
        case "undo":
          void monacoEditor.getAction("undo")?.run();
          return true;
        case "redo":
          void monacoEditor.getAction("redo")?.run();
          return true;
        case "copy":
          void monacoEditor.getAction("editor.action.clipboardCopyAction")?.run();
          return true;
        case "cut":
          void monacoEditor.getAction("editor.action.clipboardCutAction")?.run();
          return true;
        case "paste":
          void monacoEditor.getAction("editor.action.clipboardPasteAction")?.run();
          return true;
        case "select-all":
          void monacoEditor.getAction("editor.action.selectAll")?.run();
          return true;
        case "find":
          void monacoEditor.getAction("actions.find")?.run();
          return true;
        case "replace":
          void monacoEditor.getAction("editor.action.startFindReplaceAction")?.run();
          return true;
      }
    }

    if ((inProseMirror || tiptapEditor) && tiptapEditor) {
      switch (command) {
        case "undo":
          tiptapEditor.chain().focus().undo().run();
          return true;
        case "redo":
          tiptapEditor.chain().focus().redo().run();
          return true;
        case "copy":
          tiptapEditor.commands.focus();
          document.execCommand("copy");
          return true;
        case "cut":
          tiptapEditor.commands.focus();
          document.execCommand("cut");
          return true;
        case "paste":
          tiptapEditor.commands.focus();
          document.execCommand("paste");
          return true;
        case "select-all":
          tiptapEditor.chain().focus().selectAll().run();
          return true;
        case "find":
          document.execCommand("find");
          return true;
      }
    }

    return false;
  }, []);

  // Listen for save-all event (SideX pattern: saves all dirty files regardless of focus)
  useEffect(() => {
    const handleBrowserSaveAll = (event: Event) => {
      const scope = (event as CustomEvent<FileEditorSaveAllDetail>).detail?.scope;
      if (scope && scope !== params?.commandScope) return;
      if (isDirtyRef.current && handleSaveRef.current) {
        void handleSaveRef.current();
      }
    };
    document.addEventListener(FILE_EDITOR_SAVE_ALL_EVENT, handleBrowserSaveAll);
    if (!hasTauriCore()) {
      return () => document.removeEventListener(FILE_EDITOR_SAVE_ALL_EVENT, handleBrowserSaveAll);
    }

    const setupSaveAllListener = async () => {
      const { listen } = await import("@tauri-apps/api/event");
      return listen("save-all", () => {
        if (isDirtyRef.current && handleSaveRef.current) {
          void handleSaveRef.current();
        }
      });
    };

    let cleanup: (() => void) | undefined;
    setupSaveAllListener().then((unlisten) => {
      cleanup = unlisten;
    });
    return () => {
      document.removeEventListener(FILE_EDITOR_SAVE_ALL_EVENT, handleBrowserSaveAll);
      cleanup?.();
    };
  }, [params?.commandScope]);

  useEffect(() => {
    if (state.loading) return;
    if (!hasTauriCore()) return;

    const setupMenuListener = async () => {
      const { listen } = await import("@tauri-apps/api/event");
      return listen<string>("menu-event", (event) => {
        if (!focusRef.current?.contains(document.activeElement as Element)) return;
        if (event.payload === "save") {
          handleSave();
          return;
        }

        const commandMap: Record<string, string> = {
          undo: "undo",
          redo: "redo",
          cut: "cut",
          copy: "copy",
          paste: "paste",
          "select-all": "select-all",
          find: "find",
          replace: "replace",
        };

        const command = commandMap[event.payload];
        if (!command) return;
        runMarkdownCommand(command);
      });
    };

    let cleanup: (() => void) | undefined;
    setupMenuListener().then((unlisten) => {
      cleanup = unlisten;
    });

    return () => {
      cleanup?.();
    };
  }, [handleSave, state.loading, runMarkdownCommand]);

  useEffect(() => {
    const handleEditorCommand = (event: Event) => {
      if (!api.isActive) return;
      const command = (event as CustomEvent<{ command?: string }>).detail?.command;
      if (!command) return;
      if (command === "save") {
        void handleSave();
        return;
      }
      runMarkdownCommand(command);
    };

    document.addEventListener("internshannon:file-editor-command", handleEditorCommand);
    return () => document.removeEventListener("internshannon:file-editor-command", handleEditorCommand);
  }, [api, handleSave, runMarkdownCommand]);

  const toggleMinimap = useCallback(() => {
    const editor = monacoEditorRef.current;
    if (!editor) return;
    const newValue = !editor.getOption(monacoEditor.editor.EditorOption.minimap).enabled;
    editor.updateOptions({ minimap: { enabled: newValue } });
    state.minimapEnabled = newValue;
  }, []);

  const toggleWordWrap = useCallback(() => {
    const editor = monacoEditorRef.current;
    if (!editor) return;
    const newValue = editor.getOption(monacoEditor.editor.EditorOption.wordWrap) === "on" ? "off" : "on";
    editor.updateOptions({ wordWrap: newValue });
    state.wordWrapEnabled = newValue === "on";
  }, []);

  const formatDocument = useCallback(() => {
    const editor = monacoEditorRef.current;
    if (editor) {
      void editor.getAction("editor.action.formatDocument")?.run();
      return;
    }
    toast.info("Markdown 可在源码模式下使用格式化");
  }, []);

  const revealFind = useCallback(() => {
    const editor = monacoEditorRef.current;
    if (editor) {
      void editor.getAction("actions.find")?.run();
      return;
    }
    runMarkdownCommand("find");
  }, [runMarkdownCommand]);

  const contentMetrics = useMemo(() => getContentMetrics(contentRef.current), [state.metricsVersion]);
  const statusLanguageLabel = isMarkdown ? "Markdown" : getLanguageDisplayName(languageId);
  const onEditorStatusChange = params?.onEditorStatusChange;

  useEffect(() => {
    if (state.loading || !editorPath) return;
    onEditorStatusChange?.(editorPath, {
      path: editorPath,
      languageLabel: statusLanguageLabel,
      saveStatus: state.saveStatus,
      lastSavedAt: state.lastSavedAt,
      cursorPosition: {
        line: state.cursorPosition.line,
        column: state.cursorPosition.column,
      },
      selectionLength: state.selectionLength,
      indentation: {
        tabSize: state.indentation.tabSize,
        insertSpaces: state.indentation.insertSpaces,
      },
      eol: state.eol,
      lineCount: contentMetrics.lineCount,
      characterCount: contentMetrics.characterCount,
      readOnly,
    });
  }, [
    contentMetrics.characterCount,
    contentMetrics.lineCount,
    editorPath,
    onEditorStatusChange,
    readOnly,
    state.cursorPosition.column,
    state.cursorPosition.line,
    state.eol,
    state.indentation.insertSpaces,
    state.indentation.tabSize,
    state.lastSavedAt,
    state.loading,
    state.saveStatus,
    state.selectionLength,
    statusLanguageLabel,
  ]);

  useEffect(() => {
    if (!editorPath) return;
    return () => {
      onEditorStatusChange?.(editorPath, null);
    };
  }, [editorPath, onEditorStatusChange]);

  const iconButtonLabelClassName = "sr-only";

  const breadcrumbActions = showEditorActions ? (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={() => editorPath && params?.onCopyPath?.(editorPath)}
            disabled={!editorPath}
            className="file-tree-editor-iconbutton"
          >
            <Copy className="size-3.5" aria-hidden="true" />
            <span className={iconButtonLabelClassName}>复制路径</span>
          </button>
        </TooltipTrigger>
        <TooltipContent>
          <p>复制当前文件完整路径</p>
        </TooltipContent>
      </Tooltip>
      {params?.onOpenNative && parentPath && (
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={() => params.onOpenNative?.(parentPath, { isDirectory: true })}
              className="file-tree-editor-iconbutton"
            >
              <ExternalLink className="size-3.5" aria-hidden="true" />
              <span className={iconButtonLabelClassName}>在系统中显示</span>
            </button>
          </TooltipTrigger>
          <TooltipContent>
            <p>在系统中显示</p>
          </TooltipContent>
        </Tooltip>
      )}
      {params?.onViewFileHistory && editorPath && (
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={() => params.onViewFileHistory?.(editorPath)}
              className="file-tree-editor-iconbutton"
            >
              <History className="size-3.5" aria-hidden="true" />
              <span className={iconButtonLabelClassName}>打开文件历史</span>
            </button>
          </TooltipTrigger>
          <TooltipContent>
            <p>打开文件历史</p>
          </TooltipContent>
        </Tooltip>
      )}
      <Tooltip>
        <TooltipTrigger asChild>
          <button type="button" onClick={revealFind} className="file-tree-editor-iconbutton">
            <Search className="size-3.5" aria-hidden="true" />
            <span className={iconButtonLabelClassName}>查找当前文件</span>
          </button>
        </TooltipTrigger>
        <TooltipContent>
          <p>查找当前文件 (Ctrl+F)</p>
        </TooltipContent>
      </Tooltip>
      {!isMarkdown && (
        <>
          <Tooltip>
            <TooltipTrigger asChild>
              <button type="button" onClick={formatDocument} className="file-tree-editor-iconbutton">
                <Braces className="size-3.5" aria-hidden="true" />
                <span className={iconButtonLabelClassName}>格式化当前文件</span>
              </button>
            </TooltipTrigger>
            <TooltipContent>
              <p>格式化当前文件 (Shift+Alt+F)</p>
            </TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={toggleWordWrap}
                className={cn("file-tree-editor-iconbutton", state.wordWrapEnabled && "is-active")}
              >
                <WrapText className="size-3.5" aria-hidden="true" />
                <span className={iconButtonLabelClassName}>切换自动换行</span>
              </button>
            </TooltipTrigger>
            <TooltipContent>
              <p>切换自动换行 (Alt+Z)</p>
            </TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={toggleMinimap}
                className={cn("file-tree-editor-iconbutton", state.minimapEnabled && "is-active")}
              >
                <Minimize2 className="size-3.5" aria-hidden="true" />
                <span className={iconButtonLabelClassName}>切换 Minimap</span>
              </button>
            </TooltipTrigger>
            <TooltipContent>
              <p>切换 Minimap (Ctrl+Shift+M)</p>
            </TooltipContent>
          </Tooltip>
        </>
      )}
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={readOnly || state.saveStatus === "saving"}
            className={cn(
              "file-tree-editor-iconbutton",
              state.saveStatus === "dirty" && "is-primary",
              state.saveStatus === "error" && "is-error",
            )}
          >
            {state.saveStatus === "saving" ? (
              <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
            ) : (
              <Save className="size-3.5" aria-hidden="true" />
            )}
            <span className={iconButtonLabelClassName}>保存当前文件</span>
            {state.saveStatus === "dirty" && <span className="file-tree-editor-button-dot" aria-hidden="true" />}
          </button>
        </TooltipTrigger>
        <TooltipContent>
          <p>保存当前文件 (Ctrl+S)</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  ) : null;

  if (state.loading) {
    return (
      <EditorPanelFrame path={params?.path}>
        <div className="file-tree-editor-loading" aria-live="polite">
          <Loader2 className="size-5 animate-spin text-muted-foreground" aria-hidden="true" />
          <span className="sr-only">正在加载文件</span>
        </div>
      </EditorPanelFrame>
    );
  }

  if (isMarkdown) {
    return (
      <EditorPanelFrame path={params?.path}>
        <div className="flex h-full min-w-0 flex-col overflow-hidden">
          <EditorBreadcrumbs segments={pathSegments} actions={breadcrumbActions} />

          {/* Editor content */}
          <div
            ref={focusRef}
            tabIndex={-1}
            data-menu-shortcut-scope="custom-editor"
            className="min-h-0 min-w-0 flex-1 overflow-hidden outline-none"
            onPointerDown={() => focusRef.current?.focus()}
          >
            <MarkdownEditor
              value={contentRef.current}
              onChange={(v) => handleChange(v)}
              onMount={handleMount}
              onSave={handleSave}
              editable={!readOnly}
              assetId={params?.assetId ?? null}
              onOpenWikiLink={params?.onOpenWikiLink}
              onEditorReady={(editor) => {
                markdownEditorRef.current = editor;
              }}
              className="h-full"
            />
          </div>
        </div>
      </EditorPanelFrame>
    );
  }

  return (
    <EditorPanelFrame path={params?.path}>
      <div className="flex h-full min-w-0 flex-col overflow-hidden">
        <EditorBreadcrumbs segments={pathSegments} actions={breadcrumbActions} />

        {/* Editor content */}
        <div
          ref={focusRef}
          tabIndex={-1}
          data-menu-shortcut-scope="custom-editor"
          className="min-h-0 min-w-0 flex-1 overflow-hidden outline-none"
          onPointerDown={() => focusRef.current?.focus()}
        >
          <CodeEditor
            value={contentRef.current}
            language={languageId}
            onChange={handleChange}
            onMount={handleMount}
            options={{ readOnly }}
          />
        </div>
      </div>
    </EditorPanelFrame>
  );
}

const PANEL_COMPONENTS = {
  text: TextEditorPanel,
  pdf: PdfViewerPanel,
  image: ImageViewerPanel,
  office: OfficeViewerPanel,
  binary: BinaryFilePanel,
  mermaid: MermaidViewerPanel,
};

const SIDEBAR_PANE_COMPONENTS = {
  explorer: ExplorerPane,
};

const SIDEBAR_PANE_HEADER_COMPONENTS = {
  sidebarHeader: PaneHeader,
  simpleHeader: SimplePaneHeader,
};

// ── FileTreeEditor ─────────────────────────────────────────────────────────────

export function FileTreeEditor({
  rootPath,
  extraCommands,
  newFileTemplate,
  treeDepth = 4,
  autoExpandDepth = 1,
  headerSlot,
  afterSearchSlot,
  extraSidebarPane,
  debugSidebarPane,
  overviewSidebarPane,
  customSidebarPanes,
  defaultSidebarPanel,
  sidebarPanelRequest,
  sidebarDefaultSize = 22,
  sidebarMinSize = 14,
  sidebarMaxSize = 45,
  readOnly = false,
  staticFiles,
  enableLocalSnapshots = false,
  enableRichMarkdown = false,
  assetId,
  variant = "default",
  showEditorActions,
  showWatermarkActions,
  showExplorerSearchFilter,
  showStatusBar = true,
  onStateChange,
  onAfterSave,
  commandScope,
  persistSession = true,
  className,
}: FileTreeEditorProps) {
  const isVsCodeVariant = variant === "vscode";
  const isStaticFileSource = staticFiles !== undefined;
  const supportsNativeShell = hasTauriCore();
  const supportsFileSystemShell = supportsNativeShell && !isStaticFileSource;
  const contextMenuCapabilities = useMemo<MenuRuntimeCapabilities>(
    () => ({ nativeShell: supportsFileSystemShell }),
    [supportsFileSystemShell],
  );
  const showEditorTitleActions = showEditorActions ?? !isVsCodeVariant;
  const showWatermarkActionButtons = showWatermarkActions ?? !isVsCodeVariant;
  const showExplorerSearchFilterInput = showExplorerSearchFilter ?? !isVsCodeVariant;
  const showPreviewIndicator = !isVsCodeVariant;
  const workbenchVariant = isVsCodeVariant ? "vscode" : "default";
  const showGlobalSearchPanel = !isStaticFileSource;
  const staticTreeResult = useMemo(
    () => (rootPath && isStaticFileSource ? buildStaticFilesTree(rootPath, staticFiles ?? []) : null),
    [isStaticFileSource, rootPath, staticFiles],
  );
  const staticFileContentMap = useMemo(
    () => (rootPath && isStaticFileSource ? buildStaticFileContentMap(rootPath, staticFiles ?? []) : null),
    [isStaticFileSource, rootPath, staticFiles],
  );
  const staticFilesVersion = useMemo(
    () =>
      isStaticFileSource
        ? (staticFiles ?? [])
            .map((file) => `${normalizeStaticFilePath(file.path)}:${file.size ?? getUtf8ByteSize(file.content)}`)
            .join("|")
        : undefined,
    [isStaticFileSource, staticFiles],
  );
  const readTextFile = useCallback(
    async (path: string) => {
      if (!staticFileContentMap) return fetchFile(path);
      const content = staticFileContentMap.get(path);
      if (content === undefined) {
        throw new Error(`模板文件不存在: ${getWorkspaceRelativePath(rootPath, path)}`);
      }
      return content;
    },
    [rootPath, staticFileContentMap],
  );
  const state = useReactive({
    tree: null as FsNode | null,
    loading: false,
    treeLoadError: null as string | null,
    partialLoadErrorCount: 0,
    activeFile: null as string | null,
    selectedPath: null as string | null,
    selectedPaths: [] as string[],
    renamingPath: null as string | null,
    cutPaths: new Set<string>(),
    openNodes: new Set<string>(),
    sidebarCollapsed: false,
    sidebarPanel: (defaultSidebarPanel ?? "explorer") as SidebarPanelId,
    terminalCollapsed: true,
    gitStatus: null as GitStatusResult | null,
    gitStatusLoading: false,
    gitStatusError: null as string | null,
    ctxMenu: null as CtxMenuState | null,
    dragSrc: null as DragSrc | null,
    dropTarget: null as string | null,
    dropIndicator: null as DropIndicator | null,
    recentFiles: [] as string[],
    explorerSearchQuery: "",
    collapseAllVersion: 0,
    inlineCreate: null as {
      parentPath: string;
      type: "file" | "folder";
    } | null,
    typeAheadBuffer: "",
    dirtyVersion: 0,
    editorTabsVersion: 0,
    autoSaveDelayMs: 30000,
    inputDialog: null as { title: string } | null,
    inputValue: "",
    confirmDialog: null as { message: string } | null,
    diffDialog: null as {
      path: string;
      originalContent: string;
      modifiedContent: string;
      staged: boolean;
      language?: string;
      originalLabel?: string;
      modifiedLabel?: string;
      description?: string;
    } | null,
    externalChangeDialog: null as {
      path: string;
      originalContent: string;
      newContent: string;
      localContent: string;
    } | null,
    fileHistoryDialog: null as {
      path: string;
      snapshots: LocalFileSnapshot[];
    } | null,
    snapshotPreviewDialog: null as {
      path: string;
      snapshot: LocalFileSnapshot;
      content: string;
    } | null,
    snapshotCompareDialog: null as {
      path: string;
      snapshot: LocalFileSnapshot;
      snapshotContent: string;
      currentContent: string;
    } | null,
    historyVersion: 0,
  });
  // Selection anchor for Shift+Arrow range select
  const selectionAnchorRef = useRef<number | null>(null);
  const sidebarPanelRef = useRef<ImperativePanelHandle>(null);
  const sidebarPaneviewRef = useRef<PaneviewReadyEvent | null>(null);
  const dockviewRef = useRef<DockviewReadyEvent | null>(null);
  const sidebarPaneviewLayoutCleanupRef = useRef<(() => void) | null>(null);
  const dockviewSessionCleanupRef = useRef<(() => void) | null>(null);
  const lastRootPathRef = useRef(rootPath ?? "");
  const restoredEditorSessionRootRef = useRef<string | null>(null);
  const pendingFileRef = useRef<{
    path: string;
    line?: number;
    searchQuery?: string;
    preview?: boolean;
    pinned?: boolean;
  } | null>(null);
  const tabCtxCleanupRef = useRef<(() => void) | null>(null);
  const treeFocusRef = useRef<HTMLDivElement>(null);
  const clipboardRef = useRef<TreeClipboardState | null>(null);
  const historyRef = useRef<TreeHistoryEntry[]>([]);
  const historyIndexRef = useRef(-1);
  const treeSignatureRef = useRef("");
  const treeSyncInFlightRef = useRef(false);
  const treeShortcutScopeRef = useRef(false);
  const previewPanelPathRef = useRef<string | null>(null);
  const pinnedPathsRef = useRef<Set<string>>(new Set());

  const rootContainerRef = useRef<HTMLDivElement>(null);
  const dockviewHostRef = useRef<HTMLDivElement>(null);
  const dockviewLayoutTimeoutsRef = useRef<number[]>([]);
  const typeAheadTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [containerWidth, setContainerWidth] = React.useState<number | null>(null);
  // Dirty files registry (SideX pattern: track all unsaved files)
  const dirtyFilesRef = useRef<Set<string>>(new Set());
  // Editor mementos: stores cursor/scroll state per file path
  const editorMementosRef = useRef<Map<string, unknown>>(new Map());
  const currentEditorContentRef = useRef<Map<string, string>>(new Map());
  // Store original content of dirty files before external changes
  const originalContentRef = useRef<Map<string, string>>(new Map());
  const externalContentVersionRef = useRef(0);
  const gitStatusRequestIdRef = useRef(0);
  const editorStatusByPathRef = useRef<Map<string, FileEditorStatusSnapshot>>(new Map());
  const [editorStatusVersion, setEditorStatusVersion] = React.useState(0);

  const activateEditorScope = useCallback(() => {
    const root = rootContainerRef.current;
    if (root) {
      activeFileTreeRoot = root;
    }
  }, []);

  const isEditorScopeActive = useCallback((event?: Event) => {
    const root = rootContainerRef.current;
    if (!root || typeof document === "undefined") return false;

    const target = event?.target;
    if (target instanceof Node && root.contains(target)) {
      return true;
    }

    const activeElement = document.activeElement;
    if (activeElement && root.contains(activeElement)) {
      return true;
    }

    if (activeElement === document.body && activeFileTreeRoot === root) {
      return true;
    }

    if (activeFileTreeRoot !== root) {
      return false;
    }

    return !target || target === document || (typeof window !== "undefined" && target === window);
  }, []);

  const isTreeScopeActive = useCallback(
    (event?: Event) => {
      const tree = treeFocusRef.current;
      if (!tree || typeof document === "undefined") return false;

      const target = event?.target;
      if (target instanceof Node && tree.contains(target)) {
        return true;
      }

      const activeElement = document.activeElement;
      if (activeElement && tree.contains(activeElement)) {
        return true;
      }

      return treeShortcutScopeRef.current && isEditorScopeActive(event);
    },
    [isEditorScopeActive],
  );

  // Load editor config from backend on mount
  useEffect(() => {
    if (!hasTauriCore()) return;
    tauriInvoke<{ auto_save_delay_ms: number }>("get_editor_config")
      .then((config) => {
        if (config?.auto_save_delay_ms !== undefined) {
          state.autoSaveDelayMs = config.auto_save_delay_ms;
        }
      })
      .catch(() => {
        // Use default on error
      });
  }, []);

  const pinEditorPanel = useCallback((path: string) => {
    pinnedPathsRef.current.add(path);
    if (previewPanelPathRef.current === path) {
      previewPanelPathRef.current = null;
    }
    const panel = dockviewRef.current?.api.getPanel(path);
    updatePanelParametersIfChanged(panel, {
      ...(panel?.params ?? {}),
      isPreview: false,
      isPinned: true,
    });
  }, []);

  const getEditorSessionSnapshot = useCallback((): EditorSessionState => {
    const panels = dockviewRef.current?.api.panels ?? [];
    return {
      version: 1,
      openFiles: panels.map((panel) => ({
        path: panel.id,
        pinned:
          pinnedPathsRef.current.has(panel.id) || !(panel.params as { isPreview?: boolean } | undefined)?.isPreview,
      })),
      activeFile: dockviewRef.current?.api.activePanel?.id ?? state.activeFile,
      openNodes: Array.from(state.openNodes),
      selectedPath: state.selectedPath,
      recentFiles: state.recentFiles,
    };
  }, [state.activeFile, state.openNodes, state.recentFiles, state.selectedPath]);

  const persistEditorSession = useCallback(() => {
    if (!rootPath || !persistSession) return;
    writeEditorSession(rootPath, getEditorSessionSnapshot());
  }, [getEditorSessionSnapshot, persistSession, rootPath]);

  const clearDockviewLayoutTimers = useCallback(() => {
    for (const timeoutId of dockviewLayoutTimeoutsRef.current) {
      window.clearTimeout(timeoutId);
    }
    dockviewLayoutTimeoutsRef.current = [];
  }, []);

  const layoutDockview = useCallback((reason: string, force = false) => {
    const api = dockviewRef.current?.api;
    const host = dockviewHostRef.current;
    if (!api || !host) {
      debugFileTree("[FileTreeEditor] skip dockview layout", {
        reason,
        hasApi: !!api,
        hasHost: !!host,
      });
      return false;
    }

    const rect = host.getBoundingClientRect();
    const width = Math.floor(host.clientWidth || rect.width);
    const height = Math.floor(host.clientHeight || rect.height);

    debugFileTree("[FileTreeEditor] dockview layout", {
      reason,
      width,
      height,
      force,
      panelCount: api.panels.length,
      groupCount: api.groups.length,
      activePanel: api.activePanel?.id ?? null,
    });

    if (width <= 0 || height <= 0) {
      return false;
    }

    api.layout(width, height, force);
    return true;
  }, []);

  const scheduleDockviewLayout = useCallback(
    (reason: string) => {
      clearDockviewLayoutTimers();
      const delays = [0, 16, 48, 96, 160, 240, 360];
      for (const delay of delays) {
        const timeoutId = window.setTimeout(() => {
          layoutDockview(reason, true);
          dockviewLayoutTimeoutsRef.current = dockviewLayoutTimeoutsRef.current.filter((id) => id !== timeoutId);
        }, delay);
        dockviewLayoutTimeoutsRef.current.push(timeoutId);
      }
    },
    [clearDockviewLayoutTimers, layoutDockview],
  );

  const revealDockviewPanel = useCallback(
    (panel: { id: string; api: { setActive: () => void } }, reason: string) => {
      const activateAndLayout = (nextReason: string) => {
        try {
          panel.api.setActive();
        } catch (error) {
          debugFileTree("[FileTreeEditor] activate panel failed", {
            reason: nextReason,
            panelId: panel.id,
            error,
          });
        }
        layoutDockview(nextReason, true);
      };

      state.activeFile = panel.id;
      state.editorTabsVersion++;
      activateAndLayout(reason);
      scheduleDockviewLayout(reason);
      requestAnimationFrame(() => activateAndLayout(`${reason}:raf`));
      window.setTimeout(() => activateAndLayout(`${reason}:settled`), 80);
    },
    [layoutDockview, scheduleDockviewLayout],
  );

  useEffect(() => {
    return () => {
      clearDockviewLayoutTimers();
    };
  }, [clearDockviewLayoutTimers]);

  useEffect(() => {
    const host = dockviewHostRef.current;
    if (!host || typeof ResizeObserver === "undefined") return;

    const resizeObserver = new ResizeObserver(() => {
      scheduleDockviewLayout("dockview host resize");
    });
    resizeObserver.observe(host);

    return () => {
      resizeObserver.disconnect();
    };
  }, [scheduleDockviewLayout]);

  useEffect(() => {
    const root = rootContainerRef.current;
    if (!root) return;

    const syncContainerWidth = () => {
      const rect = root.getBoundingClientRect();
      const nextWidth = Math.floor(root.clientWidth || rect.width);
      setContainerWidth((current) => (current === nextWidth ? current : nextWidth));
    };

    syncContainerWidth();

    if (typeof ResizeObserver === "undefined") return;

    const resizeObserver = new ResizeObserver(syncContainerWidth);
    resizeObserver.observe(root);

    return () => {
      resizeObserver.disconnect();
    };
  }, []);

  // Handle dirty state change from panels
  const handleDirtyReport = useCallback(
    (path: string, isDirty: boolean, baseContent?: string) => {
      if (isDirty) {
        dirtyFilesRef.current.add(path);
        if (!originalContentRef.current.has(path) && baseContent !== undefined) {
          originalContentRef.current.set(path, baseContent);
        }
        pinEditorPanel(path);
      } else {
        dirtyFilesRef.current.delete(path);
        originalContentRef.current.delete(path);
      }
      const panel = dockviewRef.current?.api.getPanel(path);
      updatePanelParametersIfChanged(panel, {
        ...(panel?.params ?? {}),
        isDirty,
        ...(isDirty ? { isPreview: false, isPinned: true } : {}),
      });
      state.dirtyVersion++;
      persistEditorSession();
    },
    [persistEditorSession, pinEditorPanel],
  );

  const handleEditorContentReport = useCallback((path: string, content: string) => {
    currentEditorContentRef.current.set(path, content);
  }, []);

  const handleEditorStatusChange = useCallback((path: string, status: FileEditorStatusSnapshot | null) => {
    const registry = editorStatusByPathRef.current;
    if (!status) {
      if (registry.delete(path)) {
        setEditorStatusVersion((version) => version + 1);
      }
      return;
    }

    const previous = registry.get(path);
    if (previous && getEditorStatusSignature(previous) === getEditorStatusSignature(status)) {
      return;
    }
    registry.set(path, status);
    setEditorStatusVersion((version) => version + 1);
  }, []);

  const replaceEditorPanelContent = useCallback(
    (path: string, content: string) => {
      currentEditorContentRef.current.set(path, content);
      originalContentRef.current.delete(path);
      const wasDirty = dirtyFilesRef.current.delete(path);
      const panel = dockviewRef.current?.api.getPanel(path);
      const version = `external-resolution:${++externalContentVersionRef.current}`;
      updatePanelParametersIfChanged(panel, {
        ...(panel?.params ?? {}),
        path,
        isDirty: false,
        externalContent: { version, content },
        contentVersion: version,
      });
      if (wasDirty) {
        state.dirtyVersion++;
      }
      state.editorTabsVersion++;
      persistEditorSession();
    },
    [persistEditorSession],
  );

  // Handle editor view state changes (cursor/scroll position) for memento
  const handleEditorViewStateChange = useCallback((path: string, viewState: unknown) => {
    editorMementosRef.current.set(path, viewState);
  }, []);

  // Handle close request from FileTab —— 按用户要求:关闭文件不再弹「是否关闭」确认框,直接关闭。
  // (需要保留的改动用 Cmd+S 显式保存;标准编辑器的 tab 关闭即丢弃未保存缓冲区。)
  const handleCloseRequest = useCallback((path: string) => {
    const panel = dockviewRef.current?.api.getPanel(path);
    panel?.api.close();
  }, []);
  const pendingClosePathRef = useRef<string | null>(null);
  const waitForDirtyFilesToSave = useCallback((paths: string[], timeoutMs = 6000) => {
    const pendingPaths = Array.from(new Set(paths));
    if (pendingPaths.length === 0) return Promise.resolve([] as string[]);

    return new Promise<string[]>((resolve) => {
      const startedAt = Date.now();
      const interval = window.setInterval(() => {
        const remaining = pendingPaths.filter((path) => dirtyFilesRef.current.has(path));
        if (remaining.length === 0 || Date.now() - startedAt >= timeoutMs) {
          window.clearInterval(interval);
          resolve(remaining);
        }
      }, 80);
    });
  }, []);
  // Save all dirty files
  const saveAllDirty = useCallback(async () => {
    const dirtyPaths = Array.from(dirtyFilesRef.current);
    if (dirtyPaths.length === 0) {
      toast.info("没有需要保存的文件");
      return true;
    }

    document.dispatchEvent(
      new CustomEvent(FILE_EDITOR_SAVE_ALL_EVENT, {
        detail: { scope: commandScope },
      }),
    );

    const remainingPaths = await waitForDirtyFilesToSave(dirtyPaths);
    if (remainingPaths.length === 0) {
      toast.success(`已保存 ${dirtyPaths.length} 个文件`);
      return true;
    }

    toast.error(`仍有 ${remainingPaths.length} 个文件未保存，请检查保存失败的编辑器`);
    return false;
  }, [commandScope, waitForDirtyFilesToSave]);
  const rootPathKey = rootPath ?? "";

  const resolveInputRef = useRef<((v: string | null) => void) | null>(null);
  const resolveConfirmRef = useRef<((v: boolean) => void) | null>(null);

  useEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      const root = rootContainerRef.current;
      if (target && root?.contains(target)) {
        activeFileTreeRoot = root;
      }
      treeShortcutScopeRef.current = !!(target && treeFocusRef.current?.contains(target));
    };

    document.addEventListener("pointerdown", handlePointerDown, true);
    return () => {
      if (tabCtxCleanupRef.current) tabCtxCleanupRef.current();
      if (activeFileTreeRoot === rootContainerRef.current) {
        activeFileTreeRoot = null;
      }
      document.removeEventListener("pointerdown", handlePointerDown, true);
    };
  }, []);

  const showMenu = useCallback(
    (e: React.MouseEvent, items: MenuItem[]) => {
      e.preventDefault();
      e.stopPropagation();
      const visibleItems = normalizeMenuItems(items, contextMenuCapabilities);
      if (visibleItems.length === 0) {
        state.ctxMenu = null;
        return;
      }
      state.ctxMenu = {
        x: e.clientX,
        y: e.clientY,
        items: visibleItems,
        variant: isVsCodeVariant ? "vscode" : "default",
      };
    },
    [contextMenuCapabilities, isVsCodeVariant],
  );

  const askName = useCallback(
    (title: string, defaultValue = ""): Promise<string | null> =>
      new Promise((resolve) => {
        resolveInputRef.current = resolve;
        state.inputValue = defaultValue;
        state.inputDialog = { title };
      }),
    [],
  );

  const askConfirm = useCallback(
    (message: string): Promise<boolean> =>
      new Promise((resolve) => {
        resolveConfirmRef.current = resolve;
        state.confirmDialog = { message };
      }),
    [],
  );

  const getDirtyPathsUnderPath = useCallback((path: string) => {
    return Array.from(dirtyFilesRef.current).filter(
      (dirtyPath) => dirtyPath === path || dirtyPath.startsWith(`${path}/`),
    );
  }, []);

  const confirmDiscardDirtyPaths = useCallback(
    async (dirtyPaths: string[], actionLabel: string) => {
      const uniquePaths = Array.from(new Set(dirtyPaths));
      if (uniquePaths.length === 0) return true;
      const preview = uniquePaths
        .slice(0, 3)
        .map((path) => getRelativeWorkspacePath(rootPath, path))
        .join("、");
      const suffix = uniquePaths.length > 3 ? ` 等 ${uniquePaths.length} 个文件` : "";
      return askConfirm(
        `${actionLabel}包含未保存的文件：${preview}${suffix}。继续操作会丢失这些未保存内容，是否继续？`,
      );
    },
    [askConfirm, rootPath],
  );

  const confirmDiscardDirtyPath = useCallback(
    (path: string, actionLabel: string) => confirmDiscardDirtyPaths(getDirtyPathsUnderPath(path), actionLabel),
    [confirmDiscardDirtyPaths, getDirtyPathsUnderPath],
  );

  const closeInputDialog = (value: string | null) => {
    resolveInputRef.current?.(value);
    resolveInputRef.current = null;
    state.inputDialog = null;
  };

  const closeConfirmDialog = (confirmed: boolean) => {
    resolveConfirmRef.current?.(confirmed);
    resolveConfirmRef.current = null;
    state.confirmDialog = null;
    // If this was a close confirmation and user confirmed, close the panel
    if (confirmed && pendingClosePathRef.current) {
      const panel = dockviewRef.current?.api.getPanel(pendingClosePathRef.current);
      if (panel) {
        panel.api.close();
      }
      pendingClosePathRef.current = null;
    }
  };

  const assertWritable = useCallback(() => {
    if (!readOnly) return true;
    toast.info("当前工作区只读，不能修改文件");
    return false;
  }, [readOnly]);

  const loadTree = useCallback(
    async ({ silent = false, force = true }: { silent?: boolean; force?: boolean } = {}) => {
      debugFileTree("[FileTreeEditor] loadTree", {
        rootPath,
        silent,
        force,
        inFlight: treeSyncInFlightRef.current,
      });

      if (!rootPath) {
        debugFileTree("[FileTreeEditor] loadTree skipped: no rootPath");
        return;
      }

      if (staticTreeResult) {
        if (!silent) {
          state.loading = true;
        }
        try {
          const nextTree = staticTreeResult.tree;
          const nextSignature = getTreeSignature(nextTree);
          state.treeLoadError = null;
          state.partialLoadErrorCount = staticTreeResult.partialLoadErrorCount;
          if (force || treeSignatureRef.current !== nextSignature) {
            treeSignatureRef.current = nextSignature;
            const nextNodeByPath = buildTreeNodeIndex(nextTree);
            state.tree = nextTree;
            state.selectedPaths = state.selectedPaths.filter((path) => nextNodeByPath.has(path));
            state.selectedPath =
              state.selectedPath && nextNodeByPath.has(state.selectedPath) ? state.selectedPath : null;
          }
        } finally {
          if (!silent) {
            state.loading = false;
          }
        }
        return;
      }

      if (treeSyncInFlightRef.current) {
        debugFileTree("[FileTreeEditor] loadTree skipped: sync already in flight");
        return;
      }

      treeSyncInFlightRef.current = true;
      if (!silent) {
        state.loading = true;
      }

      try {
        const nextResult = await fetchTreeWithDiagnostics(rootPath, treeDepth);
        const nextTree = nextResult.tree;

        if (!nextTree.children?.length) {
          const rootExists = await workspaceApi.fileExists(rootPath).catch(() => true);
          if (!rootExists) {
            throw new Error(`工作区路径不存在或不可访问: ${rootPath}`);
          }
        }

        const nextSignature = getTreeSignature(nextTree);
        state.treeLoadError = null;
        state.partialLoadErrorCount = nextResult.partialLoadErrorCount;
        if (force || treeSignatureRef.current !== nextSignature) {
          treeSignatureRef.current = nextSignature;
          const nextNodeByPath = buildTreeNodeIndex(nextTree);
          state.tree = nextTree;
          {
            const next = state.selectedPaths.filter((path) => nextNodeByPath.has(path));
            state.selectedPaths = next;
          }
          {
            const next = state.selectedPath && nextNodeByPath.has(state.selectedPath) ? state.selectedPath : null;
            state.selectedPath = next;
          }
        }
        if (!silent && nextResult.partialLoadErrorCount > 0) {
          toast.warning(`文件树已加载，但有 ${nextResult.partialLoadErrorCount} 个目录读取失败`);
        }
      } catch (e) {
        const errorMessage = compactErrorMessage(formatUnknownError(e));
        state.treeLoadError = errorMessage;
        state.partialLoadErrorCount = 0;
        if (!silent || !state.tree) {
          state.tree = null;
        }
        console.error("[FileTreeEditor] Failed to load workspace tree", {
          rootPath,
          treeDepth,
          error: e,
        });
        // AppError = a workspaceApi/apiFetch failure already surfaced by the
        // global interceptor; only toast the locally-thrown cases (e.g. the
        // "工作区路径不存在" Error above) so we don't double-toast.
        if (!silent && !(e instanceof AppError)) {
          toast.error(`加载文件树失败: ${errorMessage}`);
        }
      } finally {
        treeSyncInFlightRef.current = false;
        if (!silent) {
          state.loading = false;
        }
      }
    },
    [rootPath, staticTreeResult, treeDepth],
  );

  const registerHistory = useCallback((entry: TreeHistoryEntry) => {
    historyRef.current = historyRef.current.slice(0, historyIndexRef.current + 1);
    historyRef.current.push(entry);
    historyIndexRef.current = historyRef.current.length - 1;
    state.historyVersion++;
  }, []);

  const activateTreeScope = useCallback(() => {
    activateEditorScope();
    treeShortcutScopeRef.current = true;
  }, [activateEditorScope]);

  const treeStats = useMemo(() => getTreeStats(state.tree), [state.tree]);
  const nodeByPath = useMemo(() => buildTreeNodeIndex(state.tree), [state.tree]);
  const selectedPathSet = useMemo(() => new Set(state.selectedPaths), [state.selectedPaths]);
  const dirtyPathSet = useMemo(() => new Set(dirtyFilesRef.current), [state.dirtyVersion]);
  const refreshGitStatus = useCallback(async () => {
    const requestId = ++gitStatusRequestIdRef.current;
    if (!rootPath || isStaticFileSource) {
      state.gitStatus = null;
      state.gitStatusLoading = false;
      state.gitStatusError = null;
      return;
    }

    state.gitStatusLoading = true;
    state.gitStatusError = null;
    try {
      const status = await workspaceApi.getGitStatus(rootPath);
      if (gitStatusRequestIdRef.current !== requestId) return;
      state.gitStatus = status;
    } catch (error) {
      if (gitStatusRequestIdRef.current !== requestId) return;
      state.gitStatus = null;
      state.gitStatusError = error instanceof Error ? error.message : "Git 状态读取失败";
    } finally {
      if (gitStatusRequestIdRef.current === requestId) {
        state.gitStatusLoading = false;
      }
    }
  }, [isStaticFileSource, rootPath]);

  useEffect(() => {
    void refreshGitStatus();
  }, [refreshGitStatus, state.dirtyVersion]);

  const activeEditorStatus = useMemo(() => {
    void editorStatusVersion;
    return state.activeFile ? (editorStatusByPathRef.current.get(state.activeFile) ?? null) : null;
  }, [editorStatusVersion, state.activeFile]);

  const activeFileType = useMemo(() => (state.activeFile ? getFileType(state.activeFile) : null), [state.activeFile]);

  useEffect(() => {
    if (!onStateChange) return;
    onStateChange({
      rootPath,
      loading: state.loading,
      treeLoadError: state.treeLoadError,
      partialLoadErrorCount: state.partialLoadErrorCount,
      activeFile: state.activeFile,
      selectedPaths: [...state.selectedPaths],
      dirtyFileCount: dirtyFilesRef.current.size,
      openFileCount: dockviewRef.current?.api.panels.length ?? 0,
      totalFiles: treeStats.files,
      totalFolders: treeStats.folders,
      gitBranch: state.gitStatus?.branch ?? null,
      gitChangeCount: (state.gitStatus?.files.length ?? 0) + dirtyFilesRef.current.size,
      gitStatusLoading: state.gitStatusLoading,
      gitStatusError: state.gitStatusError,
      activeFileType,
      activeLanguageLabel: activeEditorStatus?.languageLabel ?? null,
      activeSaveStatus: activeEditorStatus?.saveStatus ?? null,
      cursorPosition: activeEditorStatus?.cursorPosition ?? null,
      lineCount: activeEditorStatus?.lineCount ?? null,
      sidebarCollapsed: state.sidebarCollapsed,
      sidebarPanel: state.sidebarPanel,
    });
  }, [
    onStateChange,
    rootPath,
    state.loading,
    state.treeLoadError,
    state.partialLoadErrorCount,
    state.activeFile,
    state.selectedPaths,
    state.dirtyVersion,
    state.editorTabsVersion,
    state.gitStatus,
    state.gitStatusError,
    state.gitStatusLoading,
    state.sidebarCollapsed,
    state.sidebarPanel,
    activeEditorStatus,
    activeFileType,
    treeStats.files,
    treeStats.folders,
  ]);

  const isTreeShortcutScopeActive = useCallback(() => {
    return isTreeScopeActive();
  }, [isTreeScopeActive]);

  const selectSinglePath = useCallback(
    (path: string | null) => {
      state.selectedPath = path;
      state.selectedPaths = path ? [path] : [];
      // Clear selection anchor on non-shift navigation
      selectionAnchorRef.current = null;
      window.setTimeout(() => persistEditorSession(), 0);
    },
    [persistEditorSession],
  );

  // Type-ahead navigation handler
  const handleTypeAhead = useCallback(
    (char: string) => {
      // Clear previous timeout
      if (typeAheadTimeoutRef.current) {
        clearTimeout(typeAheadTimeoutRef.current);
      }

      // Add char to buffer
      const newBuffer = state.typeAheadBuffer + char.toLowerCase();

      // Set timeout to clear buffer after 500ms
      typeAheadTimeoutRef.current = setTimeout(() => {
        state.typeAheadBuffer = "";
      }, 500);

      // Find matching node
      const match = findNodeByNamePrefix(state.tree, newBuffer);
      if (match) {
        state.typeAheadBuffer = newBuffer;
        selectSinglePath(match.path);
      } else {
        // No match, clear buffer
        state.typeAheadBuffer = "";
      }
    },
    [state.typeAheadBuffer, state.tree, selectSinglePath],
  );

  const handleOpenChange = useCallback(
    (path: string, isOpen: boolean) => {
      {
        const next = new Set(state.openNodes);
        if (isOpen) {
          next.add(path);
        } else {
          next.delete(path);
        }
        state.openNodes = next;
      }
      window.setTimeout(() => persistEditorSession(), 0);
    },
    [persistEditorSession],
  );

  const getVisibleNodes = useCallback((): FsNode[] => {
    const result: FsNode[] = [];
    const filterActive = !!state.explorerSearchQuery.trim();
    const tree = filterActive ? filterTreeByQuery(state.tree, state.explorerSearchQuery) : state.tree;
    const visit = (node: FsNode) => {
      result.push(node);
      if (node.is_dir && (filterActive || state.openNodes.has(node.path)) && node.children) {
        for (const child of node.children) {
          visit(child);
        }
      }
    };
    if (tree?.children) {
      for (const child of tree.children) {
        visit(child);
      }
    }
    return result;
  }, []);

  const handleNavigateTree = useCallback(
    (direction: "up" | "down") => {
      const visibleNodes = getVisibleNodes();
      if (visibleNodes.length === 0) return;

      const currentIndex = state.selectedPath ? visibleNodes.findIndex((node) => node.path === state.selectedPath) : -1;
      const fallbackIndex = direction === "down" ? 0 : visibleNodes.length - 1;
      const targetIndex =
        currentIndex === -1
          ? fallbackIndex
          : direction === "down"
            ? Math.min(currentIndex + 1, visibleNodes.length - 1)
            : Math.max(currentIndex - 1, 0);

      selectSinglePath(visibleNodes[targetIndex].path);
    },
    [getVisibleNodes, selectSinglePath, state.selectedPath],
  );

  const handleShiftArrow = useCallback(
    (direction: "up" | "down") => {
      const visibleNodes = getVisibleNodes();
      if (visibleNodes.length === 0) return;

      const currentIndex = state.selectedPath ? visibleNodes.findIndex((n) => n.path === state.selectedPath) : -1;

      if (currentIndex === -1) {
        // No selection - select first or last based on direction
        const targetIndex = direction === "down" ? 0 : visibleNodes.length - 1;
        selectSinglePath(visibleNodes[targetIndex].path);
        selectionAnchorRef.current = targetIndex;
        return;
      }

      // Set anchor if not set
      if (selectionAnchorRef.current === null) {
        selectionAnchorRef.current = currentIndex;
      }

      const anchor = selectionAnchorRef.current;
      let newIndex = currentIndex + (direction === "down" ? 1 : -1);
      if (newIndex < 0) newIndex = 0;
      if (newIndex >= visibleNodes.length) newIndex = visibleNodes.length - 1;

      // Range select from anchor to new index
      const start = Math.min(anchor, newIndex);
      const end = Math.max(anchor, newIndex);
      const rangePaths = visibleNodes.slice(start, end + 1).map((n) => n.path);
      state.selectedPaths = rangePaths;
      state.selectedPath = visibleNodes[newIndex].path;
      window.setTimeout(() => persistEditorSession(), 0);
    },
    [getVisibleNodes, persistEditorSession, selectSinglePath],
  );

  // Home/End navigation - jump to first or last item
  const handleHomeEnd = useCallback(
    (direction: "home" | "end") => {
      const visibleNodes = getVisibleNodes();
      if (visibleNodes.length === 0) return;

      const targetIndex = direction === "home" ? 0 : visibleNodes.length - 1;
      selectSinglePath(visibleNodes[targetIndex].path);
    },
    [getVisibleNodes, selectSinglePath],
  );

  // Ctrl+A - select all visible items
  const handleSelectAll = useCallback(() => {
    const visibleNodes = getVisibleNodes();
    if (visibleNodes.length === 0) return;
    const allPaths = visibleNodes.map((n) => n.path);
    state.selectedPaths = allPaths;
    state.selectedPath = allPaths.at(-1) ?? null;
    // Set anchor to first item
    selectionAnchorRef.current = 0;
  }, [getVisibleNodes]);

  // Ctrl+Click - toggle individual item in selection
  const handleToggleSelect = useCallback(
    (path: string) => {
      if (selectedPathSet.has(path)) {
        // Remove from selection
        const next = state.selectedPaths.filter((p) => p !== path);
        state.selectedPaths = next;
        // Clear selection if nothing left
        if (next.length === 0) {
          state.selectedPath = null;
        } else if (state.selectedPath === path) {
          state.selectedPath = next.at(-1) ?? null;
        }
      } else {
        // Add to selection
        state.selectedPaths = [...state.selectedPaths, path];
        state.selectedPath = path;
      }
    },
    [selectedPathSet],
  );

  // Ctrl+Shift+H - collapse all folders
  const handleCollapseAll = useCallback(() => {
    state.openNodes = new Set();
    state.collapseAllVersion++;
  }, []);

  const revealInExplorer = useCallback(
    (path: string | null | undefined) => {
      if (!path) return;
      state.sidebarPanel = "explorer";
      state.explorerSearchQuery = "";
      if (state.sidebarCollapsed) {
        sidebarPanelRef.current?.expand();
      }

      const parents: string[] = [];
      let parent = getParentPath(path);
      while (parent && parent !== rootPath) {
        parents.push(parent);
        parent = getParentPath(parent);
      }
      if (rootPath) {
        parents.push(rootPath);
      }
      if (parents.length > 0) {
        state.openNodes = new Set([...state.openNodes, ...parents]);
      }
      selectSinglePath(path);
      activateTreeScope();
      treeFocusRef.current?.focus();
    },
    [activateTreeScope, rootPath, selectSinglePath, state.openNodes],
  );

  const getSelectionItems = useCallback(
    (path?: string, isDir?: boolean): TreeClipboardItem[] => {
      if (state.selectedPaths.length > 0 && path && selectedPathSet.has(path)) {
        const items: TreeClipboardItem[] = [];
        for (const selected of state.selectedPaths) {
          const node = nodeByPath.get(selected);
          if (node) {
            items.push({ path: node.path, isDir: node.is_dir });
          }
        }
        return items;
      }

      if (path) {
        return [{ path, isDir: !!isDir }];
      }

      if (state.selectedPaths.length > 0) {
        const items: TreeClipboardItem[] = [];
        for (const selected of state.selectedPaths) {
          const node = nodeByPath.get(selected);
          if (node) {
            items.push({ path: node.path, isDir: node.is_dir });
          }
        }
        return items;
      }

      return [];
    },
    [nodeByPath, selectedPathSet, state.selectedPaths],
  );

  const getUniquePath = useCallback(async (destDir: string, originalName: string) => {
    const { stem, ext } = splitNameAndExt(originalName);
    let candidateName = originalName;
    let index = 0;
    while (true) {
      const candidatePath = joinWorkspacePath(destDir, candidateName);
      if (!(await workspaceApi.fileExists(candidatePath))) {
        return candidatePath;
      }
      index += 1;
      candidateName = index === 1 ? `${stem} copy${ext}` : `${stem} copy ${index}${ext}`;
    }
  }, []);

  const copyDirRecursive = useCallback(async (srcDir: string, destDir: string): Promise<void> => {
    await workspaceApi.mkdir(destDir);
    const entries = await workspaceApi.readDir(srcDir);
    for (const entry of entries) {
      const fromPath = joinWorkspacePath(srcDir, entry.name);
      const toPath = joinWorkspacePath(destDir, entry.name);
      if (entry.isDirectory) {
        await copyDirRecursive(fromPath, toPath);
        continue;
      }
      if (entry.isFile) {
        await workspaceApi.copyFile(fromPath, toPath);
      }
    }
  }, []);

  const copyNodeToPath = useCallback(
    async (srcPath: string, srcIsDir: boolean, destPath: string) => {
      if (!srcIsDir) {
        const parentPath = getParentPath(destPath);
        if (parentPath) {
          await workspaceApi.mkdir(parentPath);
        }
        await workspaceApi.copyFile(srcPath, destPath);
        return;
      }
      await copyDirRecursive(srcPath, destPath);
    },
    [copyDirRecursive],
  );

  const moveNodeToPath = useCallback(
    async (srcPath: string, srcIsDir: boolean, destPath: string) => {
      if (srcPath === destPath) return;
      const parentPath = getParentPath(destPath);
      if (parentPath) {
        await workspaceApi.mkdir(parentPath);
      }
      try {
        await workspaceApi.rename(srcPath, destPath);
      } catch {
        await copyNodeToPath(srcPath, srcIsDir, destPath);
        await workspaceApi.remove(srcPath);
      }
    },
    [copyNodeToPath],
  );

  const getTrashPath = useCallback(
    async (path: string) => {
      const trashRoot = joinWorkspacePath(rootPath || getParentPath(path), ".shuan-os-trash");
      const trashDir = joinWorkspacePath(trashRoot, createHistoryId());
      await workspaceApi.mkdir(trashDir);
      return joinWorkspacePath(trashDir, getBaseName(path));
    },
    [rootPath],
  );

  const undoTreeAction = useCallback(async () => {
    if (historyIndexRef.current < 0) return false;
    const entry = historyRef.current[historyIndexRef.current];
    historyIndexRef.current -= 1;
    await entry.undo();
    state.historyVersion++;
    return true;
  }, []);

  const redoTreeAction = useCallback(async () => {
    if (historyIndexRef.current >= historyRef.current.length - 1) return false;
    historyIndexRef.current += 1;
    const entry = historyRef.current[historyIndexRef.current];
    await entry.redo();
    state.historyVersion++;
    return true;
  }, []);

  useEffect(() => {
    const session = persistSession ? readEditorSession(rootPath ?? undefined) : null;
    state.tree = null;
    state.treeLoadError = null;
    state.partialLoadErrorCount = 0;
    state.activeFile = session?.activeFile ?? null;
    state.explorerSearchQuery = "";
    state.collapseAllVersion = 0;
    state.recentFiles = session?.recentFiles ?? [];
    state.openNodes = new Set(session?.openNodes ?? []);
    state.selectedPath = session?.selectedPath ?? null;
    state.selectedPaths = session?.selectedPath ? [session.selectedPath] : [];
    selectionAnchorRef.current = null;
    treeSignatureRef.current = "";
    previewPanelPathRef.current = null;
    pinnedPathsRef.current = new Set(session?.openFiles.filter((file) => file.pinned).map((file) => file.path) ?? []);
    restoredEditorSessionRootRef.current = null;
    loadTree();
  }, [loadTree, persistSession, rootPath]);

  // Watch files for changes using native file system watcher.
  useEffect(() => {
    if (!rootPath) return;
    if (isStaticFileSource) return;
    if (!hasTauriCore()) return;

    // Skip watching certain directories that are too large or noisy
    const skipPaths = ["/target/", "\\target\\", "node_modules", ".git"];
    if (skipPaths.some((p) => rootPath.includes(p))) {
      console.warn("[FileTree] Skipping file watcher for:", rootPath);
      return;
    }

    let cancelled = false;
    let unlistenFileChange: (() => void) | null = null;
    const currentRootPath = rootPath;

    const setupWatcher = async () => {
      const { listen } = await import("@tauri-apps/api/event");

      // Start the file watcher on the backend
      // Backend deduplicates watchers by path, so multiple calls are safe
      try {
        await tauriInvoke("start_file_watcher", { path: currentRootPath });
      } catch (e) {
        console.error("[FileTree] Failed to start watcher:", e);
        return;
      }
      if (cancelled || currentRootPath !== rootPath) {
        // Root path changed, clean up this watcher
        try {
          await tauriInvoke("stop_file_watcher", { path: currentRootPath });
        } catch (e) {
          console.warn("[file-tree] Failed to stop file watcher:", e);
        }
        return;
      }

      // Listen for file change events and detect external edits.
      unlistenFileChange = await listen<{ path: string }>("file-change", async (event) => {
        void loadTree({ silent: true, force: false });

        // Check if this path is a dirty file with unsaved changes
        const changedPath = event.payload.path;
        if (!dirtyFilesRef.current.has(changedPath)) return;

        // File has unsaved changes AND was modified externally
        // Store original content and prompt user
        try {
          const newContent = await workspaceApi.readFile(changedPath);
          const originalContent = originalContentRef.current.get(changedPath) || "";
          const localContent = currentEditorContentRef.current.get(changedPath) ?? originalContent;

          // Only show dialog if content actually differs
          if (newContent !== originalContent) {
            originalContentRef.current.set(changedPath, originalContent);
            state.externalChangeDialog = {
              path: changedPath,
              originalContent,
              newContent,
              localContent,
            };
          }
        } catch {
          // Ignore read errors
        }
      });
    };

    setupWatcher();

    return () => {
      cancelled = true;
      if (unlistenFileChange) {
        unlistenFileChange();
      }
      // Always try to stop the watcher, but don't await
      void tauriInvoke("stop_file_watcher", { path: currentRootPath }).catch(() => {});
    };
  }, [rootPath, isStaticFileSource, loadTree]);

  const handleExternalReload = useCallback(async () => {
    const dialog = state.externalChangeDialog;
    if (!dialog) return;
    try {
      const latestContent = await workspaceApi.readFile(dialog.path).catch(() => dialog.newContent);
      replaceEditorPanelContent(dialog.path, latestContent);
      state.externalChangeDialog = null;
      toast.success("已重新加载外部版本");
    } catch (error) {
      toast.error(`重新加载失败: ${compactErrorMessage(formatUnknownError(error))}`);
    }
  }, [replaceEditorPanelContent]);

  const handleExternalKeepLocal = useCallback(async () => {
    const dialog = state.externalChangeDialog;
    if (!dialog) return;
    const localContent = currentEditorContentRef.current.get(dialog.path) ?? dialog.localContent;
    try {
      await writeFile(dialog.path, localContent);
      replaceEditorPanelContent(dialog.path, localContent);
      state.externalChangeDialog = null;
      toast.success("已保留本地内容并覆盖外部版本");
    } catch (error) {
      toast.error(`保留本地失败: ${compactErrorMessage(formatUnknownError(error))}`);
    }
  }, [replaceEditorPanelContent]);

  const handleExternalMerge = useCallback(() => {
    const dialog = state.externalChangeDialog;
    if (!dialog) return;
    const localContent = currentEditorContentRef.current.get(dialog.path) ?? dialog.localContent;
    state.diffDialog = {
      path: dialog.path,
      originalContent: dialog.newContent,
      modifiedContent: localContent,
      staged: false,
      language: getMonacoLanguage(dialog.path),
      originalLabel: "外部磁盘版本",
      modifiedLabel: "本地未保存版本",
      description: getRelativeWorkspacePath(rootPath, dialog.path),
    };
    state.externalChangeDialog = null;
  }, [rootPath]);

  const handleOpenNative = useCallback(async (path: string, options: NativeOpenOptions = {}) => {
    const mode = options.mode ?? "reveal";
    const targetPath =
      mode === "open-file"
        ? path.trim()
        : resolveNativeRevealPath(path, {
            isDirectory: options.isDirectory,
            rootPath,
          });
    if (!targetPath) {
      toast.error("没有可打开的路径");
      return;
    }
    if (!hasTauriCore()) {
      await writeClipboardText(targetPath).catch(() => undefined);
      toast.info(mode === "open-file" ? "当前浏览器不能打开系统文件，已复制路径" : "当前浏览器不能显示系统位置，已复制路径");
      return;
    }
    try {
      if (mode === "open-file") {
        await tauriInvoke("plugin:shell|open", { path: targetPath });
        return;
      }
      await tauriInvoke("open_folder", { path: targetPath });
    } catch {
      if (mode === "open-file") {
        toast.error("无法打开文件");
        return;
      }
      await writeClipboardText(targetPath).catch(() => undefined);
      toast.error("无法在系统中显示，已复制路径");
    }
  }, [rootPath]);

  const handleCopyPath = useCallback((path: string) => {
    writeClipboardText(path)
      .then(() => toast.success("路径已复制"))
      .catch((error) => toast.error(error instanceof Error ? error.message : "复制失败"));
  }, []);

  const handleCopyRelativePath = useCallback(
    (path: string) => {
      writeClipboardText(getWorkspaceRelativePath(rootPath, path))
        .then(() => toast.success("相对路径已复制"))
        .catch((error) => toast.error(error instanceof Error ? error.message : "复制失败"));
    },
    [rootPath],
  );

  const handleViewFileHistory = useCallback(async (filePath: string) => {
    try {
      const snapshots = await readLocalSnapshots(filePath);
      state.fileHistoryDialog = { path: filePath, snapshots };
    } catch (error) {
      console.error("[FileTreeEditor] Failed to load file history", error);
    }
  }, []);

  const recordRecentFile = useCallback((path: string) => {
    state.recentFiles = [path, ...state.recentFiles.filter((item) => item !== path)].slice(0, 30);
  }, []);

  // Stable wrapper for the rich Markdown editor's `[[wikilink]]` click-through.
  // The real handler (handleOpenWikiLink) is defined after handleFileClick (it
  // delegates to it); this ref-backed wrapper keeps the panel params closure
  // stable and avoids a use-before-declaration cycle in handleFileClick's deps.
  const handleOpenWikiLinkRef = useRef<(repoRelativePath: string) => void>(() => {});
  const openWikiLinkStable = useCallback((repoRelativePath: string) => {
    handleOpenWikiLinkRef.current(repoRelativePath);
  }, []);

  // 「以文本方式打开」逃生口:用户选择把某个落到二进制查看器的文件强制用 Monaco 文本编辑器打开。
  // 覆盖整个长尾(任意未识别扩展名),无需穷举 TEXT_EXTS。按 path 记住选择(会话内持久)。
  const openAsTextRef = useRef<Set<string>>(new Set());
  // 面板组件解析:命中逃生口集合 → "text",否则按扩展名/文件名路由。dockview 缓存以稳定身份为前提。
  const resolveFileComponent = useCallback(
    (path: string): FileType => (openAsTextRef.current.has(path) ? "text" : getFileType(path)),
    [],
  );
  // 与 wikilink 同款 ref-backed 稳定包装:真实处理器(handleOpenAsText)在 handleFileClick 之后定义
  // (它要调 handleFileClick 重开),稳定包装避免 handleFileClick 依赖里的 use-before-declaration 环。
  const handleOpenAsTextRef = useRef<(path: string) => void>(() => {});
  const openAsTextStable = useCallback((path: string) => {
    handleOpenAsTextRef.current(path);
  }, []);

  // 活动编辑器实例表(path→Monaco editor),由 TextEditorPanel 在 mount/unmount 维护;
  // 供命令面板对当前活动编辑器触发格式化/转到行等内置动作(键位仍由 Monaco 直接处理)。
  const editorInstancesRef = useRef<Map<string, monacoEditor.editor.IStandaloneCodeEditor>>(new Map());
  const setEditorInstance = useCallback(
    (path: string, editor: monacoEditor.editor.IStandaloneCodeEditor | null) => {
      if (editor) editorInstancesRef.current.set(path, editor);
      else editorInstancesRef.current.delete(path);
    },
    [],
  );

  const handleFileClick = useCallback(
    (path: string, options?: OpenFileOptions) => {
      selectSinglePath(path);
      state.activeFile = path;
      recordRecentFile(path);
      const isPreview = !!options?.preview && !options?.pinned;
      const isPinned = !!options?.pinned || !isPreview;
      if (!dockviewRef.current) {
        pendingFileRef.current = {
          path,
          line: options?.line,
          searchQuery: options?.searchQuery,
          preview: isPreview,
          pinned: isPinned,
        };
        return;
      }
      if (isPinned) {
        pinnedPathsRef.current.add(path);
        if (previewPanelPathRef.current === path) {
          previewPanelPathRef.current = null;
        }
      }
      const existing = dockviewRef.current.api.getPanel(path);
      if (existing) {
        updatePanelParametersIfChanged(existing, {
          ...(existing.params ?? {}),
          path,
          ...(options?.line ? { line: options.line } : {}),
          ...(options?.searchQuery ? { searchQuery: options.searchQuery } : {}),
          isPreview: isPreview && !pinnedPathsRef.current.has(path),
          isPinned: pinnedPathsRef.current.has(path) || isPinned,
          isDirty: dirtyFilesRef.current.has(path),
          commandScope,
          workbenchVariant,
          rootPath,
          readFile: readTextFile,
          contentVersion: staticFilesVersion,
          onDirtyChange: handleDirtyReport,
          onContentChange: handleEditorContentReport,
          onAfterSave,
          onEditorStatusChange: handleEditorStatusChange,
        });
        revealDockviewPanel(existing, "activate existing file");
        persistEditorSession();
        return;
      }
      if (isPreview && previewPanelPathRef.current) {
        const previewPath = previewPanelPathRef.current;
        const previewPanel = dockviewRef.current.api.getPanel(previewPath);
        if (previewPanel && !dirtyFilesRef.current.has(previewPath)) {
          previewPanel.api.close();
        } else if (previewPanel) {
          pinEditorPanel(previewPath);
        }
        previewPanelPathRef.current = null;
      }
      if (isPreview) {
        previewPanelPathRef.current = path;
      }
      const groups = dockviewRef.current.api.groups;
      try {
        const panel = dockviewRef.current.api.addPanel({
          id: path,
          component: resolveFileComponent(path),
          params: {
            path,
            ...(options?.line ? { line: options.line } : {}),
            ...(options?.searchQuery ? { searchQuery: options.searchQuery } : {}),
            isPreview,
            isPinned,
            autoSaveDelay: state.autoSaveDelayMs,
            commandScope,
            enableLocalSnapshots,
            enableRichMarkdown,
            assetId,
            onOpenWikiLink: openWikiLinkStable,
            readOnly,
            readFile: readTextFile,
            contentVersion: staticFilesVersion,
            showEditorActions: showEditorTitleActions,
            showPreviewIndicator,
            isDirty: false,
            workbenchVariant,
            rootPath,
            onDirtyChange: handleDirtyReport,
            onContentChange: handleEditorContentReport,
            onAfterSave,
            onEditorStatusChange: handleEditorStatusChange,
            onCopyPath: handleCopyPath,
            onOpenNative: supportsFileSystemShell ? handleOpenNative : undefined,
            onViewFileHistory: enableLocalSnapshots ? handleViewFileHistory : undefined,
            onCloseRequest: handleCloseRequest,
            onPinRequest: pinEditorPanel,
            onViewStateChange: handleEditorViewStateChange,
            initialViewState: editorMementosRef.current.get(path),
            onOpenAsText: openAsTextStable,
            onEditorInstance: setEditorInstance,
          },
          title: path.split("/").pop() || "未命名",
          position: groups.length > 0 ? { referenceGroup: groups[0], direction: "within" } : undefined,
        });
        revealDockviewPanel(panel, "open file");
        persistEditorSession();
      } catch (error) {
        console.error("[FileTreeEditor] Failed to open file panel", {
          path,
          error,
        });
        toast.error(`打开文件失败: ${formatUnknownError(error)}`);
      }
    },
    [
      selectSinglePath,
      handleDirtyReport,
      handleEditorContentReport,
      handleEditorStatusChange,
      handleCloseRequest,
      handleEditorViewStateChange,
      commandScope,
      enableLocalSnapshots,
      enableRichMarkdown,
      assetId,
      openWikiLinkStable,
      openAsTextStable,
      resolveFileComponent,
      setEditorInstance,
      readOnly,
      readTextFile,
      showEditorTitleActions,
      showPreviewIndicator,
      staticFilesVersion,
      workbenchVariant,
      rootPath,
      onAfterSave,
      persistEditorSession,
      pinEditorPanel,
      recordRecentFile,
      handleCopyPath,
      handleOpenNative,
      handleViewFileHistory,
      revealDockviewPanel,
      supportsFileSystemShell,
    ],
  );

  // 「以文本方式打开」真实处理器:记住该 path 走文本,关掉旧(二进制)面板再以文本重开。
  const handleOpenAsText = useCallback(
    (path: string) => {
      if (!path) return;
      openAsTextRef.current.add(path);
      // dockview 不能原地换 component:先关、再开;此时 resolveFileComponent(path) → "text"。
      dockviewRef.current?.api.getPanel(path)?.api.close();
      handleFileClick(path, { pinned: true });
    },
    [handleFileClick],
  );
  useEffect(() => {
    handleOpenAsTextRef.current = handleOpenAsText;
  }, [handleOpenAsText]);

  // Opens a `[[wikilink]]` target from the rich Markdown editor. The target is a
  // repo-relative wiki page path (e.g. `wiki/Foo.md`); join it with rootPath and
  // pin-open it via the normal file-open path. Kept in a ref (see
  // openWikiLinkStable) so the panel params closure stays stable.
  const handleOpenWikiLink = useCallback(
    (repoRelativePath: string) => {
      if (!repoRelativePath) return;
      const fullPath = rootPath ? joinWorkspacePath(rootPath, repoRelativePath) : repoRelativePath;
      handleFileClick(fullPath, { pinned: true });
    },
    [handleFileClick, rootPath],
  );
  useEffect(() => {
    handleOpenWikiLinkRef.current = handleOpenWikiLink;
  }, [handleOpenWikiLink]);

  useEffect(() => {
    const dockview = dockviewRef.current?.api;
    if (!dockview) return;
    for (const panel of dockview.panels) {
      updatePanelParametersIfChanged(panel, {
        ...(panel.params ?? {}),
        readOnly,
        readFile: readTextFile,
        contentVersion: staticFilesVersion,
        rootPath,
        onAfterSave,
        onEditorStatusChange: handleEditorStatusChange,
      });
    }
  }, [handleEditorStatusChange, onAfterSave, readOnly, readTextFile, rootPath, staticFilesVersion]);

  // Enter - open the currently selected file
  const handleEnterOpen = useCallback(() => {
    if (state.selectedPath) {
      const node = nodeByPath.get(state.selectedPath);
      if (node && !node.is_dir) {
        // Open the file (same as clicking it)
        handleFileClick(state.selectedPath);
      } else if (node && node.is_dir) {
        // Toggle folder open/close
        handleOpenChange(state.selectedPath, !state.openNodes.has(state.selectedPath));
      }
    }
  }, [handleFileClick, handleOpenChange, nodeByPath, state.openNodes, state.selectedPath]);

  const handleCreateSnapshot = useCallback(
    async (filePath?: string) => {
      const path = filePath ?? dockviewRef.current?.api.activePanel?.id;
      if (!path) return;
      try {
        const content = await fetchFile(path);
        const label = (await askName("快照备注", "手动快照"))?.trim() || "手动快照";
        await createLocalSnapshot(path, content, label);
        toast.success("已创建本地快照");
        if (state.fileHistoryDialog?.path === path) {
          state.fileHistoryDialog = {
            path,
            snapshots: await readLocalSnapshots(path),
          };
        }
      } catch (error) {
        console.error("[FileTreeEditor] Failed to create snapshot", error);
      }
    },
    [askName],
  );

  const handlePreviewSnapshot = useCallback(async (snapshot: LocalFileSnapshot) => {
    const path = state.fileHistoryDialog?.path;
    if (!path) return;
    try {
      const content = await workspaceApi.readFile(snapshot.snapshotPath);
      state.snapshotPreviewDialog = { path, snapshot, content };
    } catch (error) {
      console.error("[FileTreeEditor] Failed to read snapshot", error);
    }
  }, []);

  const handleCompareSnapshot = useCallback(async (snapshot: LocalFileSnapshot) => {
    const path = state.fileHistoryDialog?.path;
    if (!path) return;
    try {
      const [snapshotContent, currentContent] = await Promise.all([
        workspaceApi.readFile(snapshot.snapshotPath),
        fetchFile(path),
      ]);
      state.snapshotCompareDialog = {
        path,
        snapshot,
        snapshotContent,
        currentContent,
      };
    } catch (error) {
      console.error("[FileTreeEditor] Failed to compare snapshot", error);
    }
  }, []);

  const handleRenameSnapshot = useCallback(
    async (snapshot: LocalFileSnapshot) => {
      const path = state.fileHistoryDialog?.path;
      if (!path) return;
      const label = await askName("修改快照备注", snapshot.label);
      if (!label?.trim() || label.trim() === snapshot.label) return;
      try {
        const snapshots = await updateLocalSnapshotLabel(path, snapshot.id, label.trim());
        state.fileHistoryDialog = { path, snapshots };
        if (state.snapshotPreviewDialog?.snapshot.id === snapshot.id) {
          state.snapshotPreviewDialog.snapshot = {
            ...state.snapshotPreviewDialog.snapshot,
            label: label.trim(),
          };
        }
        if (state.snapshotCompareDialog?.snapshot.id === snapshot.id) {
          state.snapshotCompareDialog.snapshot = {
            ...state.snapshotCompareDialog.snapshot,
            label: label.trim(),
          };
        }
        toast.success("已更新快照备注");
      } catch (error) {
        console.error("[FileTreeEditor] Failed to rename snapshot", error);
      }
    },
    [askName],
  );

  const handleDeleteSnapshot = useCallback(
    async (snapshot: LocalFileSnapshot) => {
      const path = state.fileHistoryDialog?.path;
      if (!path) return;
      const ok = await askConfirm(`确定要删除 "${snapshot.label}" 这个本地快照吗？`);
      if (!ok) return;
      try {
        const snapshots = await deleteLocalSnapshot(path, snapshot.id);
        state.fileHistoryDialog = { path, snapshots };
        if (state.snapshotPreviewDialog?.snapshot.id === snapshot.id) {
          state.snapshotPreviewDialog = null;
        }
        if (state.snapshotCompareDialog?.snapshot.id === snapshot.id) {
          state.snapshotCompareDialog = null;
        }
        toast.success("已删除快照");
      } catch (error) {
        console.error("[FileTreeEditor] Failed to delete snapshot", error);
      }
    },
    [askConfirm],
  );

  const handleRestoreSnapshot = useCallback(
    async (snapshot: LocalFileSnapshot) => {
      const path =
        state.snapshotCompareDialog?.path ?? state.snapshotPreviewDialog?.path ?? state.fileHistoryDialog?.path;
      if (!path) return;
      const ok = await askConfirm(
        `确定要将 "${getBaseName(path)}" 恢复到 ${snapshot.date} 的快照吗？当前内容会先保存为一个快照。`,
      );
      if (!ok) return;
      try {
        const currentContent = await fetchFile(path);
        await createLocalSnapshot(path, currentContent, "恢复前自动快照");
        const snapshotContent = await workspaceApi.readFile(snapshot.snapshotPath);
        await writeFile(path, snapshotContent);
        if (dirtyFilesRef.current.delete(path)) {
          state.dirtyVersion++;
        }
        const panel = dockviewRef.current?.api.getPanel(path);
        if (panel) {
          panel.api.close();
          handleFileClick(path, { pinned: true });
        }
        state.fileHistoryDialog = {
          path,
          snapshots: await readLocalSnapshots(path),
        };
        state.snapshotPreviewDialog = null;
        state.snapshotCompareDialog = null;
        toast.success("已恢复快照");
      } catch (error) {
        console.error("[FileTreeEditor] Failed to restore snapshot", error);
      }
    },
    [askConfirm, handleFileClick],
  );

  useEffect(() => {
    if (lastRootPathRef.current === rootPathKey) {
      return;
    }
    lastRootPathRef.current = rootPathKey;
  }, [rootPathKey]);

  useEffect(() => {
    return () => {
      sidebarPaneviewLayoutCleanupRef.current?.();
      dockviewSessionCleanupRef.current?.();
    };
  }, []);

  const pasteClipboardItems = useCallback(
    async (destinationPath?: string) => {
      if (!assertWritable()) return false;
      const clipboard = clipboardRef.current;
      if (!clipboard?.items.length || !rootPath) return false;
      const destDir = destinationPath || rootPath;
      const pasted: Array<{
        srcPath: string;
        srcIsDir: boolean;
        destPath: string;
        mode: "copy" | "cut";
      }> = [];
      if (clipboard.mode === "cut") {
        const dirtyPaths = clipboard.items.flatMap((item) => getDirtyPathsUnderPath(item.path));
        const ok = await confirmDiscardDirtyPaths(dirtyPaths, "移动剪切的项目");
        if (!ok) return false;
      }

      for (const item of clipboard.items) {
        if (clipboard.mode === "cut") {
          if (item.path === destDir || getParentPath(item.path) === destDir) {
            continue;
          }
          if (item.isDir && (destDir === item.path || destDir.startsWith(`${item.path}/`))) {
            continue;
          }
        }

        const destPath = await getUniquePath(destDir, getBaseName(item.path));
        if (clipboard.mode === "copy") {
          await copyNodeToPath(item.path, item.isDir, destPath);
        } else {
          await moveNodeToPath(item.path, item.isDir, destPath);
          for (const panel of dockviewRef.current?.api.panels ?? []) {
            if (panel.id === item.path || panel.id.startsWith(`${item.path}/`)) {
              panel.api.close();
            }
          }
        }
        pasted.push({
          srcPath: item.path,
          srcIsDir: item.isDir,
          destPath,
          mode: clipboard.mode,
        });
      }

      if (!pasted.length) return false;

      registerHistory({
        label: clipboard.mode === "copy" ? "paste-copy" : "paste-cut",
        undo: async () => {
          for (const item of [...pasted].reverse()) {
            if (item.mode === "copy") {
              await workspaceApi.remove(item.destPath);
            } else {
              await moveNodeToPath(item.destPath, item.srcIsDir, item.srcPath);
            }
          }
          await loadTree();
          selectSinglePath(pasted[0].srcPath);
        },
        redo: async () => {
          for (const item of pasted) {
            if (item.mode === "copy") {
              await copyNodeToPath(item.srcPath, item.srcIsDir, item.destPath);
            } else {
              await moveNodeToPath(item.srcPath, item.srcIsDir, item.destPath);
            }
          }
          await loadTree();
          selectSinglePath(pasted[0].destPath);
        },
      });

      if (clipboard.mode === "cut") {
        clipboardRef.current = null;
      }

      await loadTree();
      selectSinglePath(pasted[0].destPath);
      if (!pasted[0].srcIsDir) {
        handleFileClick(pasted[0].destPath);
      }
      return true;
    },
    [
      assertWritable,
      confirmDiscardDirtyPaths,
      copyNodeToPath,
      getDirtyPathsUnderPath,
      getUniquePath,
      handleFileClick,
      loadTree,
      moveNodeToPath,
      registerHistory,
      rootPath,
      selectSinglePath,
    ],
  );

  const handleSelectNode = useCallback(
    (path: string, options?: { additive?: boolean }) => {
      if (options?.additive) {
        if (selectedPathSet.has(path)) {
          const next = state.selectedPaths.filter((item) => item !== path);
          state.selectedPath = next.length > 0 ? next[next.length - 1] : null;
          state.selectedPaths = next;
        } else {
          const next = [...state.selectedPaths, path];
          state.selectedPath = path;
          state.selectedPaths = next;
        }
      } else {
        selectSinglePath(path);
      }
      activateTreeScope();
    },
    [activateTreeScope, selectSinglePath, selectedPathSet],
  );

  const handleCopyNode = useCallback(
    (path: string, isDir: boolean) => {
      const items = getSelectionItems(path, isDir);
      if (!items.length) return;
      clipboardRef.current = {
        mode: "copy",
        items,
      };
      state.cutPaths = new Set();
      if (!selectedPathSet.has(path)) {
        selectSinglePath(path);
      }
      activateTreeScope();
    },
    [activateTreeScope, getSelectionItems, selectSinglePath, selectedPathSet],
  );

  const handleCutNode = useCallback(
    (path: string, isDir: boolean) => {
      if (!assertWritable()) return;
      const items = getSelectionItems(path, isDir);
      if (!items.length) return;
      clipboardRef.current = {
        mode: "cut",
        items,
      };
      state.cutPaths = new Set(items.map((i) => i.path));
      if (!selectedPathSet.has(path)) {
        selectSinglePath(path);
      }
      activateTreeScope();
    },
    [activateTreeScope, assertWritable, getSelectionItems, selectSinglePath, selectedPathSet],
  );

  const handlePasteNode = useCallback(
    async (path?: string) => {
      try {
        activateTreeScope();
        const result = await pasteClipboardItems(path);
        if (result) {
          state.cutPaths = new Set();
        }
      } catch (e) {
        console.error("[FileTreeEditor] Failed to paste", e);
        toast.error(`粘贴失败: ${compactErrorMessage(formatUnknownError(e))}`);
      }
    },
    [activateTreeScope, pasteClipboardItems],
  );

  const handleTreeDocumentKeyDown = useCallback(
    (event: KeyboardEvent) => {
      const shortcut = resolveFileTreeScopedShortcut(event, {
        platform: navigator.platform,
      });
      if (!shortcut) return;
      if (!isEditorScopeActive(event) || !isTreeScopeActive(event) || isEditableKeyboardTarget(event.target)) {
        return;
      }

      if (shortcut === "copy" && state.selectedPath) {
        event.preventDefault();
        const items = getSelectionItems(state.selectedPath);
        if (items.length > 0) {
          handleCopyNode(state.selectedPath, items[0]?.isDir ?? false);
        }
        return;
      }

      if (shortcut === "cut" && state.selectedPath) {
        event.preventDefault();
        const items = getSelectionItems(state.selectedPath);
        if (items.length > 0) {
          handleCutNode(state.selectedPath, items[0]?.isDir ?? false);
        }
        return;
      }

      if (shortcut === "paste") {
        event.preventDefault();
        const selectedNode = state.selectedPath ? nodeByPath.get(state.selectedPath) : null;
        const pasteTarget = selectedNode?.is_dir
          ? selectedNode.path
          : selectedNode
            ? getParentPath(selectedNode.path)
            : rootPath || undefined;
        void handlePasteNode(pasteTarget);
        return;
      }

      if (shortcut === "select-all") {
        event.preventDefault();
        handleSelectAll();
        return;
      }

      if (shortcut === "collapse-all") {
        event.preventDefault();
        handleCollapseAll();
        return;
      }

      if (shortcut === "undo") {
        event.preventDefault();
        void undoTreeAction();
        return;
      }

      if (shortcut === "redo") {
        event.preventDefault();
        void redoTreeAction();
      }
    },
    [
      getSelectionItems,
      handleCopyNode,
      handleCutNode,
      handleCollapseAll,
      handlePasteNode,
      handleSelectAll,
      isEditorScopeActive,
      isTreeScopeActive,
      redoTreeAction,
      rootPath,
      state.selectedPath,
      nodeByPath,
      undoTreeAction,
    ],
  );
  const handleTreeDocumentKeyDownRef = useLatestRef(handleTreeDocumentKeyDown);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => handleTreeDocumentKeyDownRef.current(event);
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [handleTreeDocumentKeyDownRef]);

  const handleCreateFile = useCallback(
    async (parentPath?: string) => {
      if (!assertWritable()) return;
      const basePath = parentPath || rootPath;
      if (!basePath) return;
      state.openNodes = new Set([...state.openNodes, basePath]);
      selectSinglePath(basePath);
      // Use inline creation mode - will show input in tree
      state.inlineCreate = { parentPath: basePath, type: "file" };
    },
    [assertWritable, rootPath, selectSinglePath, state.openNodes],
  );

  // Confirm inline file creation
  const confirmInlineCreate = useCallback(
    async (name: string) => {
      if (!assertWritable()) return;
      if (!state.inlineCreate) return;
      const { parentPath, type } = state.inlineCreate;

      // Empty name = cancel: clear the inline input and stop.
      if (!name) {
        state.inlineCreate = null;
        return;
      }

      if (type === "file") {
        const filename = name.includes(".") ? name : `${name}.md`;
        const stem = filename.replace(/\.[^.]+$/, "");
        const content = newFileTemplate ? newFileTemplate(stem) : "";
        try {
          const fullPath = joinWorkspacePath(parentPath, filename);
          await writeFile(fullPath, content);
          registerHistory({
            label: "create-file",
            undo: async () => {
              await deleteNode(fullPath);
              await loadTree();
              selectSinglePath(parentPath);
            },
            redo: async () => {
              await writeFile(fullPath, content);
              await loadTree();
              selectSinglePath(fullPath);
            },
          });
          await loadTree();
          // Only dismiss the inline input once the file actually exists.
          state.inlineCreate = null;
          selectSinglePath(fullPath);
          handleFileClick(fullPath);
        } catch (e) {
          // Keep the inline input open so the user can fix the name and retry.
          console.error("[FileTreeEditor] Failed to create file", e);
          toast.error(`新建文件失败: ${compactErrorMessage(formatUnknownError(e))}`);
        }
      } else {
        // folder
        try {
          const folderPath = joinWorkspacePath(parentPath, name);
          await createNode(folderPath, true);
          registerHistory({
            label: "create-folder",
            undo: async () => {
              await deleteNode(folderPath);
              await loadTree();
              selectSinglePath(parentPath);
            },
            redo: async () => {
              await createNode(folderPath, true);
              await loadTree();
              selectSinglePath(folderPath);
            },
          });
          await loadTree();
          // Only dismiss the inline input once the folder actually exists.
          state.inlineCreate = null;
          selectSinglePath(folderPath);
        } catch (e) {
          // Keep the inline input open so the user can fix the name and retry.
          console.error("[FileTreeEditor] Failed to create folder", e);
          toast.error(`新建文件夹失败: ${compactErrorMessage(formatUnknownError(e))}`);
        }
      }
    },
    [assertWritable, state.inlineCreate, newFileTemplate, loadTree, handleFileClick, registerHistory, selectSinglePath],
  );

  const handleCreateFolder = useCallback(
    async (parentPath?: string) => {
      if (!assertWritable()) return;
      const basePath = parentPath || rootPath;
      if (!basePath) return;
      state.openNodes = new Set([...state.openNodes, basePath]);
      selectSinglePath(basePath);
      // Use inline creation mode - will show input in tree
      state.inlineCreate = { parentPath: basePath, type: "folder" };
    },
    [assertWritable, rootPath, selectSinglePath, state.openNodes],
  );

  const handleRename = useCallback(
    async (path: string, isDir: boolean) => {
      if (!assertWritable()) return;
      const oldName = path.split("/").pop() || "";
      const newName = await askName("重命名", oldName);
      if (!newName || newName === oldName) return;
      const newPath = `${path.substring(0, path.lastIndexOf("/"))}/${newName}`;
      const canDiscardDirty = await confirmDiscardDirtyPath(path, `重命名 "${oldName}"`);
      if (!canDiscardDirty) return;
      try {
        await moveNodeToPath(path, isDir, newPath);
        registerHistory({
          label: "rename",
          undo: async () => {
            await moveNodeToPath(newPath, isDir, path);
            await loadTree();
            selectSinglePath(path);
          },
          redo: async () => {
            await moveNodeToPath(path, isDir, newPath);
            await loadTree();
            selectSinglePath(newPath);
          },
        });
        await loadTree();
        selectSinglePath(newPath);
        if (dockviewRef.current) {
          for (const panel of dockviewRef.current.api.panels) {
            if (panel.id === path || panel.id.startsWith(`${path}/`)) {
              panel.api.close();
            }
          }
          if (!isDir) {
            handleFileClick(newPath);
          }
        }
      } catch (e) {
        console.error("[FileTreeEditor] Failed to rename", e);
        toast.error(`重命名失败: ${compactErrorMessage(formatUnknownError(e))}`);
      }
    },
    [
      askName,
      assertWritable,
      confirmDiscardDirtyPath,
      loadTree,
      handleFileClick,
      moveNodeToPath,
      registerHistory,
      selectSinglePath,
    ],
  );

  // Inline rename handler - called directly with new name (no dialog)
  const handleInlineRename = useCallback(
    async (path: string, isDir: boolean, newName: string) => {
      if (!assertWritable()) return;
      if (!newName || newName === path.split("/").pop()) return;
      const newPath = `${path.substring(0, path.lastIndexOf("/"))}/${newName}`;
      const canDiscardDirty = await confirmDiscardDirtyPath(path, `重命名 "${path.split("/").pop() ?? ""}"`);
      if (!canDiscardDirty) return;
      try {
        await moveNodeToPath(path, isDir, newPath);
        registerHistory({
          label: "rename",
          undo: async () => {
            await moveNodeToPath(newPath, isDir, path);
            await loadTree();
            selectSinglePath(path);
          },
          redo: async () => {
            await moveNodeToPath(path, isDir, newPath);
            await loadTree();
            selectSinglePath(newPath);
          },
        });
        await loadTree();
        selectSinglePath(newPath);
        if (dockviewRef.current) {
          for (const panel of dockviewRef.current.api.panels) {
            if (panel.id === path || panel.id.startsWith(`${path}/`)) {
              panel.api.close();
            }
          }
          if (!isDir) {
            handleFileClick(newPath);
          }
        }
      } catch (e) {
        console.error("[FileTreeEditor] Failed to inline rename", e);
      }
    },
    [
      assertWritable,
      confirmDiscardDirtyPath,
      loadTree,
      handleFileClick,
      moveNodeToPath,
      registerHistory,
      selectSinglePath,
    ],
  );

  const handleStartRename = useCallback((path: string) => {
    state.renamingPath = path || null;
  }, []);

  const closeEditorPanelsUnderPath = useCallback((path: string) => {
    if (!dockviewRef.current) return;
    for (const panel of dockviewRef.current.api.panels) {
      if (panel.id === path || panel.id.startsWith(`${path}/`)) {
        panel.api.close();
      }
    }
  }, []);

  const handleDelete = useCallback(
    async (path: string, isDir: boolean) => {
      if (!assertWritable()) return;
      const name = path.split("/").pop() ?? "";
      const ok = await askConfirm(
        isDir ? `确定要删除文件夹 "${name}" 及其所有内容吗？` : `确定要删除文件 "${name}" 吗？`,
      );
      if (!ok) return;
      const canDiscardDirty = await confirmDiscardDirtyPath(path, `删除 "${name}"`);
      if (!canDiscardDirty) return;
      try {
        const parentPath = getParentPath(path);
        const snapshotIsDir = isDir;
        const snapshotPath = path;
        const trashPath = await getTrashPath(path);
        await moveNodeToPath(path, isDir, trashPath);
        registerHistory({
          label: "delete",
          undo: async () => {
            await moveNodeToPath(trashPath, snapshotIsDir, snapshotPath);
            await loadTree();
            selectSinglePath(snapshotPath);
          },
          redo: async () => {
            await moveNodeToPath(snapshotPath, snapshotIsDir, trashPath);
            await loadTree();
            selectSinglePath(parentPath || rootPath);
          },
        });
        await loadTree();
        selectSinglePath(parentPath || rootPath);
        closeEditorPanelsUnderPath(path);
        // Return keyboard focus to the tree so arrow-key navigation continues after a delete.
        requestAnimationFrame(() => treeFocusRef.current?.focus());
      } catch (e) {
        console.error("[FileTreeEditor] Failed to delete", e);
        toast.error(`删除失败: ${compactErrorMessage(formatUnknownError(e))}`);
      }
    },
    [
      askConfirm,
      assertWritable,
      getTrashPath,
      loadTree,
      moveNodeToPath,
      registerHistory,
      rootPath,
      selectSinglePath,
      closeEditorPanelsUnderPath,
      confirmDiscardDirtyPath,
    ],
  );

  const handleRenameSelected = useCallback(() => {
    const path = state.selectedPath ?? state.selectedPaths.at(-1);
    if (!path) return;
    handleStartRename(path);
  }, [handleStartRename, state.selectedPath, state.selectedPaths]);

  const handleDeleteSelection = useCallback(async () => {
    if (!assertWritable()) return;
    const rawItems = getSelectionItems(state.selectedPath ?? undefined);
    if (!rawItems.length) return;

    const items = rawItems.filter((item) => {
      return !rawItems.some(
        (other) => other.isDir && other.path !== item.path && item.path.startsWith(`${other.path}/`),
      );
    });
    const ok = await askConfirm(
      items.length === 1
        ? items[0].isDir
          ? `确定要删除文件夹 "${items[0].path.split("/").pop()}" 及其所有内容吗？`
          : `确定要删除文件 "${items[0].path.split("/").pop()}" 吗？`
        : `确定要删除选中的 ${items.length} 个项目吗？`,
    );
    if (!ok) return;
    const canDiscardDirty = await confirmDiscardDirtyPaths(
      items.flatMap((item) => getDirtyPathsUnderPath(item.path)),
      "删除选中项目",
    );
    if (!canDiscardDirty) return;

    try {
      const movedItems: Array<TreeClipboardItem & { trashPath: string }> = [];
      for (const item of items) {
        const trashPath = await getTrashPath(item.path);
        await moveNodeToPath(item.path, item.isDir, trashPath);
        movedItems.push({ ...item, trashPath });
        closeEditorPanelsUnderPath(item.path);
      }

      registerHistory({
        label: "delete-selection",
        undo: async () => {
          for (const item of [...movedItems].reverse()) {
            await moveNodeToPath(item.trashPath, item.isDir, item.path);
          }
          await loadTree();
          state.selectedPaths = movedItems.map((item) => item.path);
          state.selectedPath = movedItems.at(-1)?.path ?? null;
        },
        redo: async () => {
          for (const item of movedItems) {
            await moveNodeToPath(item.path, item.isDir, item.trashPath);
            closeEditorPanelsUnderPath(item.path);
          }
          await loadTree();
          selectSinglePath(rootPath);
        },
      });

      await loadTree();
      selectSinglePath(rootPath);
      toast.success(items.length === 1 ? "已删除" : `已删除 ${items.length} 个项目`);
    } catch (e) {
      console.error("[FileTreeEditor] Failed to delete selection", e);
      toast.error(`删除失败: ${compactErrorMessage(formatUnknownError(e))}`);
    }
  }, [
    askConfirm,
    assertWritable,
    closeEditorPanelsUnderPath,
    confirmDiscardDirtyPaths,
    getSelectionItems,
    getDirtyPathsUnderPath,
    getTrashPath,
    loadTree,
    moveNodeToPath,
    registerHistory,
    rootPath,
    selectSinglePath,
    state.selectedPath,
    state.selectedPaths,
  ]);

  const handleMove = useCallback(
    async (srcPath: string, srcIsDir: boolean, destDir: string) => {
      if (!assertWritable()) return;
      const name = srcPath.split("/").pop()!;
      const newPath = `${destDir}/${name}`;
      if (newPath === srcPath) return;
      if (srcPath.substring(0, srcPath.lastIndexOf("/")) === destDir) return;
      if (srcIsDir && (destDir === srcPath || destDir.startsWith(`${srcPath}/`))) return;
      const canDiscardDirty = await confirmDiscardDirtyPath(srcPath, `移动 "${name}"`);
      if (!canDiscardDirty) return;
      try {
        await moveNodeToPath(srcPath, srcIsDir, newPath);
        registerHistory({
          label: "move",
          undo: async () => {
            await moveNodeToPath(newPath, srcIsDir, srcPath);
            await loadTree();
            selectSinglePath(srcPath);
          },
          redo: async () => {
            await moveNodeToPath(srcPath, srcIsDir, newPath);
            await loadTree();
            selectSinglePath(newPath);
          },
        });
        await loadTree();
        selectSinglePath(newPath);
        closeEditorPanelsUnderPath(srcPath);
        if (!srcIsDir) {
          handleFileClick(newPath);
        }
      } catch (e) {
        console.error("[FileTreeEditor] Failed to move", e);
        toast.error(`移动失败: ${compactErrorMessage(formatUnknownError(e))}`);
      }
    },
    [
      assertWritable,
      confirmDiscardDirtyPath,
      closeEditorPanelsUnderPath,
      loadTree,
      handleFileClick,
      moveNodeToPath,
      registerHistory,
      selectSinglePath,
    ],
  );

  // Wire up pointer-drag callbacks. Runs after every render so handleMove is always fresh.
  // Module-level vars let startPointerDrag reach these without prop drilling.
  useEffect(() => {
    _pdRoot = rootPath;
    _pdOnChange = (di) => {
      state.dragSrc = di ? _pdSrc : null;
      // dropTarget is the folder path for highlighting (isOver)
      state.dropTarget = di?.position === "inside" ? di.path : null;
      state.dropIndicator = di;
    };
    _pdOnDrop = (src, dest) => {
      state.dragSrc = null;
      state.dropTarget = null;
      state.dropIndicator = null;
      if (!src || !dest) return;
      if (dest === src.path) return;
      if (src.isDir && dest.startsWith(`${src.path}/`)) return;
      handleMove(src.path, src.isDir, dest);
    };
    return () => {
      _pdRoot = null;
      _pdOnChange = null;
      _pdOnDrop = null;
    };
  });

  const openRootInFinder = useCallback(async () => {
    if (!rootPath) return;
    await handleOpenNative(rootPath, { isDirectory: true });
  }, [handleOpenNative, rootPath]);

  const iconCls = "size-3.5 shrink-0";

  const emptyAreaItems = useMemo<MenuItem[]>(() => {
    if (readOnly) {
      return [
        {
          label: isVsCodeVariant ? "刷新资源管理器" : "刷新",
          icon: <RefreshCw className={iconCls} />,
          onClick: () => loadTree({ force: true }),
        },
        ...(isVsCodeVariant
          ? [
              {
                label: "全部折叠",
                icon: <ChevronsUp className={iconCls} />,
                onClick: handleCollapseAll,
              },
            ]
          : []),
        { separator: true, label: "", onClick: () => {} },
        {
          label: "在系统中显示",
          icon: <ExternalLink className={iconCls} />,
          onClick: () => openRootInFinder(),
          requiresNativeShell: true,
        },
        {
          label: "复制路径",
          icon: <Copy className={iconCls} />,
          onClick: () => {
            if (rootPath) handleCopyPath(rootPath);
          },
        },
      ];
    }

    return isVsCodeVariant
      ? [
          {
            label: "新建文件…",
            icon: <FilePlus className={iconCls} />,
            onClick: () => handleCreateFile(),
          },
          {
            label: "新建文件夹…",
            icon: <FolderPlus className={iconCls} />,
            onClick: () => handleCreateFolder(),
          },
          { separator: true, label: "", onClick: () => {} },
          {
            label: "粘贴",
            icon: <ClipboardPaste className={iconCls} />,
            onClick: () => handlePasteNode(rootPath || undefined),
            shortcut: formatShortcut("Ctrl", "V"),
          },
          { separator: true, label: "", onClick: () => {} },
          {
            label: "在系统中显示",
            icon: <ExternalLink className={iconCls} />,
            onClick: () => openRootInFinder(),
            requiresNativeShell: true,
          },
          {
            label: "刷新资源管理器",
            icon: <RefreshCw className={iconCls} />,
            onClick: () => loadTree({ force: true }),
          },
          {
            label: "全部折叠",
            icon: <ChevronsUp className={iconCls} />,
            onClick: handleCollapseAll,
          },
        ]
      : [
          {
            label: "新建文件",
            icon: <FilePlus className={iconCls} />,
            onClick: () => handleCreateFile(),
          },
          {
            label: "新建文件夹",
            icon: <FolderPlus className={iconCls} />,
            onClick: () => handleCreateFolder(),
          },
          { separator: true, label: "", onClick: () => {} },
          {
            label: "粘贴",
            icon: <ClipboardPaste className={iconCls} />,
            onClick: () => handlePasteNode(rootPath || undefined),
            shortcut: formatShortcut("Ctrl", "V"),
          },
          {
            label: "撤销",
            icon: <RotateCcw className={iconCls} />,
            onClick: () => void undoTreeAction(),
            shortcut: formatShortcut("Ctrl", "Z"),
          },
          {
            label: "重做",
            icon: <RotateCw className={iconCls} />,
            onClick: () => void redoTreeAction(),
            shortcut: formatShortcut("Ctrl", "Shift", "Z"),
          },
          { separator: true, label: "", onClick: () => {} },
          {
            label: "在系统中显示",
            icon: <ExternalLink className={iconCls} />,
            onClick: () => openRootInFinder(),
            requiresNativeShell: true,
          },
          {
            label: "刷新",
            icon: <RefreshCw className={iconCls} />,
            onClick: () => loadTree(),
          },
        ];
  }, [
    isVsCodeVariant,
    handleCopyPath,
    handleCreateFile,
    handleCreateFolder,
    handlePasteNode,
    handleCollapseAll,
    loadTree,
    openRootInFinder,
    readOnly,
    redoTreeAction,
    rootPath,
    undoTreeAction,
  ]);

  const explorerMoreActions = useMemo<MenuItem[]>(
    () => [
      ...(!readOnly
        ? [
            {
              label: "新建文件…",
              icon: <FilePlus className={iconCls} />,
              onClick: () => handleCreateFile(rootPath || undefined),
            },
            {
              label: "新建文件夹…",
              icon: <FolderPlus className={iconCls} />,
              onClick: () => handleCreateFolder(rootPath || undefined),
            },
            { separator: true, label: "", onClick: () => {} },
          ]
        : []),
      {
        label: "刷新资源管理器",
        icon: <RefreshCw className={iconCls} />,
        onClick: () => loadTree({ force: true }),
      },
      {
        label: "全部折叠",
        icon: <ChevronsUp className={iconCls} />,
        onClick: handleCollapseAll,
      },
      { separator: true, label: "", onClick: () => {} },
      {
        label: "在系统中显示",
        icon: <ExternalLink className={iconCls} />,
        onClick: () => openRootInFinder(),
        requiresNativeShell: true,
      },
      {
        label: "复制路径",
        icon: <Copy className={iconCls} />,
        onClick: () => {
          if (rootPath) handleCopyPath(rootPath);
        },
      },
      {
        label: "复制相对路径",
        icon: <Copy className={iconCls} />,
        onClick: () => {
          if (rootPath) handleCopyRelativePath(rootPath);
        },
      },
    ],
    [
      handleCollapseAll,
      handleCopyPath,
      handleCopyRelativePath,
      handleCreateFile,
      handleCreateFolder,
      loadTree,
      openRootInFinder,
      readOnly,
      rootPath,
    ],
  );

  const showExplorerMoreActions = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      event.preventDefault();
      event.stopPropagation();
      const rect = event.currentTarget.getBoundingClientRect();
      const visibleItems = normalizeMenuItems(explorerMoreActions, contextMenuCapabilities);
      if (visibleItems.length === 0) {
        state.ctxMenu = null;
        return;
      }
      state.ctxMenu = {
        x: rect.left,
        y: rect.bottom + 2,
        items: visibleItems,
        variant: "vscode",
      };
    },
    [contextMenuCapabilities, explorerMoreActions],
  );

  const explorerPaneParams = useMemo<ExplorerPaneParams>(
    () => ({
      variant: isVsCodeVariant ? "vscode" : "default",
      headerSlot,
      afterSearchSlot,
      rootPath,
      loading: state.loading,
      readOnly,
      treeLoadError: state.treeLoadError,
      partialLoadErrorCount: state.partialLoadErrorCount,
      tree: state.tree,
      nodeByPath,
      activeFile: state.activeFile,
      selectedPaths: state.selectedPaths,
      selectedPathSet,
      searchQuery: state.explorerSearchQuery,
      totalFiles: treeStats.files,
      totalFolders: treeStats.folders,
      openNodes: state.openNodes,
      autoExpandDepth,
      collapseAllVersion: state.collapseAllVersion,
      showSearchFilter: showExplorerSearchFilterInput,
      showFooter: !isVsCodeVariant,
      dirtyPaths: dirtyPathSet,
      dragSrc: state.dragSrc,
      dropTarget: state.dropTarget,
      dropIndicator: state.dropIndicator,
      treeFocusRef,
      emptyAreaItems,
      onActivateTreeScope: activateTreeScope,
      onSelectSinglePath: selectSinglePath,
      onShowMenu: showMenu,
      onFileClick: handleFileClick,
      onSelectNode: handleSelectNode,
      onDelete: handleDelete,
      onRename: handleRename,
      onStartRename: handleStartRename,
      onInlineRename: handleInlineRename,
      onCreateFile: handleCreateFile,
      onCreateFolder: handleCreateFolder,
      onCopyNode: handleCopyNode,
      onCutNode: handleCutNode,
      onPasteNode: handlePasteNode,
      onCopyPath: handleCopyPath,
      onCopyRelativePath: handleCopyRelativePath,
      onOpenNative: handleOpenNative,
      onRefreshTree: () => loadTree({ force: true }),
      onOpenRootInFinder: openRootInFinder,
      onCollapseSidebar: () => sidebarPanelRef.current?.collapse(),
      renamingPath: state.renamingPath,
      cutPaths: state.cutPaths,
      onTypeAhead: handleTypeAhead,
      onOpenChange: handleOpenChange,
      onNavigateTree: handleNavigateTree,
      onShiftArrow: handleShiftArrow,
      onHomeEnd: handleHomeEnd,
      onSelectAll: handleSelectAll,
      onEnter: handleEnterOpen,
      onToggleSelect: handleToggleSelect,
      onCollapseAll: handleCollapseAll,
      onRenameSelected: handleRenameSelected,
      onDeleteSelection: handleDeleteSelection,
      onViewFileHistory: enableLocalSnapshots ? handleViewFileHistory : undefined,
      onSearchFilter: (query) => {
        state.explorerSearchQuery = query;
      },
      inlineCreate: state.inlineCreate,
      onInlineCreateConfirm: confirmInlineCreate,
      onInlineCreateCancel: () => {
        state.inlineCreate = null;
      },
    }),
    [
      headerSlot,
      afterSearchSlot,
      rootPath,
      readOnly,
      state.loading,
      state.treeLoadError,
      state.partialLoadErrorCount,
      state.tree,
      nodeByPath,
      state.activeFile,
      state.selectedPaths,
      selectedPathSet,
      state.explorerSearchQuery,
      state.openNodes,
      autoExpandDepth,
      state.collapseAllVersion,
      treeStats.files,
      treeStats.folders,
      showExplorerSearchFilterInput,
      isVsCodeVariant,
      state.dragSrc,
      state.dropTarget,
      state.dropIndicator,
      state.renamingPath,
      state.cutPaths,
      emptyAreaItems,
      activateTreeScope,
      selectSinglePath,
      showMenu,
      handleFileClick,
      handleSelectNode,
      handleDelete,
      handleRename,
      handleStartRename,
      handleInlineRename,
      handleCreateFile,
      handleCreateFolder,
      handleCopyNode,
      handleCutNode,
      handlePasteNode,
      handleCopyPath,
      handleCopyRelativePath,
      handleOpenNative,
      handleTypeAhead,
      handleOpenChange,
      handleNavigateTree,
      enableLocalSnapshots,
      handleShiftArrow,
      handleHomeEnd,
      handleSelectAll,
      handleEnterOpen,
      handleToggleSelect,
      handleCollapseAll,
      handleRenameSelected,
      handleDeleteSelection,
      loadTree,
      openRootInFinder,
      handleViewFileHistory,
      state.inlineCreate,
      confirmInlineCreate,
      dirtyPathSet,
    ],
  );

  useEffect(() => {
    if (isVsCodeVariant) return;
    const paneviewApi = sidebarPaneviewRef.current?.api;
    const explorerPanel = paneviewApi?.getPanel("explorer");
    updatePanelParametersIfChanged(explorerPanel, explorerPaneParams);
  }, [explorerPaneParams, isVsCodeVariant]);

  // One-time layout fix: after the tree first loads, ensure the paneview has
  // correct dimensions (handles dialog open animation timing).
  const paneviewLayoutFixedRef = useRef(false);
  useEffect(() => {
    if (isVsCodeVariant) return;
    if (paneviewLayoutFixedRef.current) return;
    if (!state.tree || state.loading) return;
    paneviewLayoutFixedRef.current = true;
    requestAnimationFrame(() => {
      const paneviewApi = sidebarPaneviewRef.current?.api;
      if (!paneviewApi) return;
      const container = rootContainerRef.current?.querySelector(".file-tree-paneview") as HTMLElement | null;
      if (container && container.clientHeight > 0 && paneviewApi.height === 0) {
        paneviewApi.layout(container.clientWidth, container.clientHeight);
      }
    });
  }, [state.tree, state.loading, isVsCodeVariant]);

  // Process pending file when dockview becomes ready
  useEffect(() => {
    if (!dockviewRef.current || !pendingFileRef.current) return;
    const pendingFile = pendingFileRef.current;
    pendingFileRef.current = null;

    if (pendingFile.pinned) {
      pinnedPathsRef.current.add(pendingFile.path);
    }

    const groups = dockviewRef.current.api.groups;
    if (pendingFile.preview) {
      previewPanelPathRef.current = pendingFile.path;
    }

    try {
      const panel = dockviewRef.current.api.addPanel({
        id: pendingFile.path,
        component: resolveFileComponent(pendingFile.path),
        params: {
          path: pendingFile.path,
          ...(pendingFile.line ? { line: pendingFile.line } : {}),
          ...(pendingFile.searchQuery ? { searchQuery: pendingFile.searchQuery } : {}),
          isPreview: !!pendingFile.preview,
          isPinned: !!pendingFile.pinned,
          autoSaveDelay: state.autoSaveDelayMs,
          commandScope,
          enableLocalSnapshots,
          enableRichMarkdown,
          assetId,
          onOpenWikiLink: openWikiLinkStable,
          readOnly,
          readFile: readTextFile,
          contentVersion: staticFilesVersion,
          showEditorActions: showEditorTitleActions,
          showPreviewIndicator,
          isDirty: false,
          workbenchVariant,
          rootPath,
          onDirtyChange: handleDirtyReport,
          onContentChange: handleEditorContentReport,
          onAfterSave,
          onEditorStatusChange: handleEditorStatusChange,
          onCopyPath: handleCopyPath,
          onOpenNative: supportsFileSystemShell ? handleOpenNative : undefined,
          onViewFileHistory: enableLocalSnapshots ? handleViewFileHistory : undefined,
          onCloseRequest: handleCloseRequest,
          onPinRequest: pinEditorPanel,
          onViewStateChange: handleEditorViewStateChange,
          initialViewState: editorMementosRef.current.get(pendingFile.path),
        },
        title: pendingFile.path.split("/").pop() || "未命名",
        position:
          groups.length > 0
            ? {
                referenceGroup: groups[0],
                direction: "within",
              }
            : undefined,
      });
      revealDockviewPanel(panel, "pending file effect");
      persistEditorSession();
    } catch (error) {
      console.error("[FileTreeEditor] Failed to open pending file panel", {
        path: pendingFile.path,
        error,
      });
      toast.error(`打开文件失败: ${formatUnknownError(error)}`);
    }
  }, [
    commandScope,
    enableLocalSnapshots,
    enableRichMarkdown,
    assetId,
    openWikiLinkStable,
    handleCloseRequest,
    handleCopyPath,
    handleDirtyReport,
    handleEditorContentReport,
    handleEditorStatusChange,
    handleOpenNative,
    handleEditorViewStateChange,
    handleViewFileHistory,
    persistEditorSession,
    pinEditorPanel,
    readOnly,
    readTextFile,
    showEditorTitleActions,
    showPreviewIndicator,
    staticFilesVersion,
    supportsFileSystemShell,
    workbenchVariant,
    rootPath,
    onAfterSave,
    state.autoSaveDelayMs,
    revealDockviewPanel,
  ]);

  // Listen for save-all event (SideX pattern: Ctrl+Alt+S)
  useEffect(() => {
    if (!hasTauriCore()) return;
    const setupSaveAllListener = async () => {
      const { listen } = await import("@tauri-apps/api/event");
      return listen<string>("menu-event", (event) => {
        if (event.payload === "save-all") {
          void saveAllDirty();
        }
      });
    };

    let cleanup: (() => void) | undefined;
    setupSaveAllListener().then((unlisten) => {
      cleanup = unlisten;
    });
    return () => cleanup?.();
  }, [saveAllDirty]);

  const handleTreeMenuEvent = useCallback(
    (payload: string) => {
      if (!isTreeShortcutScopeActive()) return;

      if (payload === "undo") {
        void undoTreeAction();
        return;
      }
      if (payload === "redo") {
        void redoTreeAction();
        return;
      }
      if (payload === "delete") {
        void handleDeleteSelection();
        return;
      }
      if (payload === "rename") {
        handleRenameSelected();
        return;
      }
      if (payload === "copy" && state.selectedPath) {
        const items = getSelectionItems(state.selectedPath);
        if (items.length > 0) {
          handleCopyNode(state.selectedPath, items[0]?.isDir ?? false);
        }
        return;
      }
      if (payload === "cut" && state.selectedPath) {
        const items = getSelectionItems(state.selectedPath);
        if (items.length > 0) {
          handleCutNode(state.selectedPath, items[0]?.isDir ?? false);
        }
        return;
      }
      if (payload === "paste") {
        const selectedNode = state.selectedPath ? nodeByPath.get(state.selectedPath) : null;
        const pasteTarget = selectedNode?.is_dir
          ? selectedNode.path
          : selectedNode
            ? getParentPath(selectedNode.path)
            : rootPath || undefined;
        void handlePasteNode(pasteTarget);
      }
    },
    [
      getSelectionItems,
      handleCopyNode,
      handleCutNode,
      handleDeleteSelection,
      handlePasteNode,
      handleRenameSelected,
      isTreeShortcutScopeActive,
      redoTreeAction,
      rootPath,
      state.selectedPath,
      nodeByPath,
      undoTreeAction,
    ],
  );
  const handleTreeMenuEventRef = useLatestRef(handleTreeMenuEvent);

  useEffect(() => {
    if (!hasTauriCore()) return;
    const setupMenuListener = async () => {
      const { listen } = await import("@tauri-apps/api/event");
      return listen<string>("menu-event", (event) => {
        handleTreeMenuEventRef.current(event.payload);
      });
    };

    let cleanup: (() => void) | undefined;
    setupMenuListener().then((unlisten) => {
      cleanup = unlisten;
    });

    return () => {
      cleanup?.();
    };
  }, [handleTreeMenuEventRef]);

  const focusExplorerTree = useCallback(() => {
    activateTreeScope();
    requestAnimationFrame(() => {
      treeFocusRef.current?.focus();
    });
  }, [activateTreeScope]);

  const focusSidebarSearchInput = useCallback(() => {
    activateEditorScope();
    treeShortcutScopeRef.current = false;
    requestAnimationFrame(() => {
      const input = rootContainerRef.current?.querySelector<HTMLInputElement>(
        isVsCodeVariant ? ".file-tree-vscode-search-panel input" : ".file-tree-explorer-search-input",
      );
      input?.focus();
      input?.select();
    });
  }, [activateEditorScope, isVsCodeVariant]);

  const showSidebarPanel = useCallback(
    (panel: SidebarPanelId) => {
      activateEditorScope();
      state.sidebarPanel = panel;
      state.sidebarCollapsed = false;
      sidebarPanelRef.current?.expand();
      if (panel === "search") {
        focusSidebarSearchInput();
        return;
      }
      if (
        panel === "assetOverview" ||
        panel === "sourceControl" ||
        panel === "board" ||
        panel === "debug" ||
        panel.startsWith("custom:")
      ) {
        // These panes own their own focus state (branch inputs, kanban
        // collapsibles, debug form inputs); don't steal focus into the file tree.
        return;
      }
      focusExplorerTree();
    },
    [activateEditorScope, focusExplorerTree, focusSidebarSearchInput],
  );

  // Honor host-side requests to swing the sidebar to a specific pane
  // (e.g. "I just enqueued a diagnose, please show the board"). Keyed
  // on nonce so the host can hold the same target steady without
  // re-triggering on every render.
  const lastSidebarRequestNonceRef = useRef<number | null>(null);
  useEffect(() => {
    if (!sidebarPanelRequest) return;
    if (lastSidebarRequestNonceRef.current === sidebarPanelRequest.nonce) return;
    lastSidebarRequestNonceRef.current = sidebarPanelRequest.nonce;
    showSidebarPanel(sidebarPanelRequest.panel);
  }, [sidebarPanelRequest, showSidebarPanel]);

  useEffect(() => {
    const handleExternalCommand = (event: Event) => {
      const detail = (event as CustomEvent<FileTreeEditorCommandDetail>).detail;
      if (detail?.scope && detail.scope !== commandScope) return;
      const command = detail?.command;
      if (command === "refresh") {
        void loadTree({ force: true });
        return;
      }
      if (command === "save-all") {
        void saveAllDirty();
        return;
      }
      if (command === "open-root") {
        void openRootInFinder();
        return;
      }
      if (command === "open-file") {
        if (detail.path) {
          showSidebarPanel("explorer");
          handleFileClick(detail.path, { pinned: true });
        }
        return;
      }
      if (command === "search") {
        if (showGlobalSearchPanel) {
          showSidebarPanel("search");
        }
        return;
      }
      if (command === "focus-explorer") {
        showSidebarPanel("explorer");
        return;
      }
      if (command === "new-file") {
        showSidebarPanel("explorer");
        void handleCreateFile(rootPath || undefined);
        return;
      }
      if (command === "new-folder") {
        showSidebarPanel("explorer");
        void handleCreateFolder(rootPath || undefined);
        return;
      }
      if (command === "reveal-active") {
        showSidebarPanel("explorer");
        revealInExplorer(state.activeFile || state.selectedPath);
      }
    };

    document.addEventListener(FILE_TREE_EDITOR_COMMAND_EVENT, handleExternalCommand);
    return () => document.removeEventListener(FILE_TREE_EDITOR_COMMAND_EVENT, handleExternalCommand);
  }, [
    commandScope,
    handleFileClick,
    handleCreateFile,
    handleCreateFolder,
    loadTree,
    openRootInFinder,
    revealInExplorer,
    rootPath,
    saveAllDirty,
    showGlobalSearchPanel,
    showSidebarPanel,
    state.activeFile,
    state.selectedPath,
  ]);

  // 命令面板(Cmd+Shift+P)。命令 = 文件树自身动作 + 父级注入的 extraCommands(上线流水线等)。
  // 单一事实源:keybinding 仅展示,真正派发仍在下方 keydown / Monaco;面板只调 run()。
  // 批量关闭标签页(命令面板用)。安全:跳过未保存(dirty)标签,不批量丢失改动 —— 这些仍由用户用 X 单独关。
  const closeTabs = useCallback((mode: "others" | "all") => {
    const api = dockviewRef.current?.api;
    if (!api) return;
    const activeId = api.activePanel?.id;
    let skippedDirty = 0;
    for (const panel of [...api.panels]) {
      if (mode === "others" && panel.id === activeId) continue;
      if (dirtyFilesRef.current.has(panel.id)) {
        skippedDirty += 1;
        continue;
      }
      panel.api.close();
    }
    if (skippedDirty > 0) toast.info(`已跳过 ${skippedDirty} 个未保存的标签页`);
  }, []);

  // 最近关闭的标签页栈(onDidRemovePanel 入栈)—— 供「重新打开关闭的标签页」。
  const closedTabsRef = useRef<string[]>([]);
  const reopenClosedTab = useCallback(() => {
    const open = new Set(dockviewRef.current?.api.panels.map((p) => p.id) ?? []);
    let path = closedTabsRef.current.pop();
    while (path && open.has(path)) path = closedTabsRef.current.pop(); // 跳过已重新打开的
    if (path) handleFileClick(path, { pinned: true });
    else toast.info("没有最近关闭的标签页");
  }, [handleFileClick]);

  // 让命令面板能对「当前活动编辑器」触发格式化等内置动作(实例表 editorInstancesRef 在 handleFileClick 前定义)。
  const runActiveEditorAction = useCallback((actionId: string, emptyHint: string) => {
    const activeId = dockviewRef.current?.api.activePanel?.id;
    const editor = activeId ? editorInstancesRef.current.get(activeId) : undefined;
    if (!editor) {
      toast.info(emptyHint);
      return;
    }
    void editor.getAction(actionId)?.run();
  }, []);

  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [cheatsheetOpen, setCheatsheetOpen] = useState(false);
  const [quickOpenOpen, setQuickOpenOpen] = useState(false);
  // 快速打开(Cmd+P)的候选文件:仅在弹窗打开时从已加载的 nodeByPath 现算(避免树展开时反复构建)。
  const quickOpenFiles = useMemo<QuickOpenFile[]>(() => {
    if (!quickOpenOpen) return [];
    const prefix = rootPath ? `${rootPath}/` : "";
    const files: QuickOpenFile[] = [];
    for (const node of nodeByPath.values()) {
      if (node.is_dir) continue;
      const rel = node.path.startsWith(prefix) ? node.path.slice(prefix.length) : node.path;
      const slash = rel.lastIndexOf("/");
      files.push({
        path: node.path,
        label: slash >= 0 ? rel.slice(slash + 1) : rel,
        dir: slash >= 0 ? rel.slice(0, slash) : "",
      });
    }
    // 最近打开的排前(MRU,空查询时即见最近文件),其余按相对路径字母序;输入后由 cmdk 按匹配度重排。
    const rank = new Map(state.recentFiles.map((path, index) => [path, index]));
    files.sort((a, b) => {
      const ra = rank.get(a.path) ?? Number.POSITIVE_INFINITY;
      const rb = rank.get(b.path) ?? Number.POSITIVE_INFINITY;
      return ra !== rb ? ra - rb : `${a.dir}/${a.label}`.localeCompare(`${b.dir}/${b.label}`);
    });
    return files;
  }, [quickOpenOpen, nodeByPath, rootPath, state.recentFiles]);
  const paletteCommands = useMemo<WorkspaceCommand[]>(() => {
    const list: WorkspaceCommand[] = [
      { id: "save-all", title: "保存全部", group: "文件", keybinding: DOCUMENT_KEYBINDINGS["save-all"], when: () => !readOnly, run: () => void saveAllDirty() },
      {
        id: "new-file",
        title: "新建文件",
        group: "文件",
        keybinding: DOCUMENT_KEYBINDINGS["new-file"],
        when: () => !readOnly,
        run: () => {
          showSidebarPanel("explorer");
          void handleCreateFile(rootPath || undefined);
        },
      },
      {
        id: "new-folder",
        title: "新建文件夹",
        group: "文件",
        keybinding: DOCUMENT_KEYBINDINGS["new-folder"],
        when: () => !readOnly,
        run: () => {
          showSidebarPanel("explorer");
          void handleCreateFolder(rootPath || undefined);
        },
      },
      { id: "quick-open", title: "快速打开文件", group: "导航", keybinding: DOCUMENT_KEYBINDINGS["quick-open"], run: () => setQuickOpenOpen(true) },
      { id: "focus-explorer", title: "聚焦资源管理器", group: "导航", keybinding: DOCUMENT_KEYBINDINGS["focus-explorer"], run: () => showSidebarPanel("explorer") },
      { id: "source-control", title: "源代码管理", group: "导航", run: () => showSidebarPanel("sourceControl") },
      {
        id: "git-refresh",
        title: "刷新 Git 状态",
        group: "源代码管理",
        run: () => {
          showSidebarPanel("sourceControl");
          void refreshGitStatus();
        },
      },
      {
        id: "close-other-tabs",
        title: "关闭其他标签页",
        group: "标签页",
        when: () => (dockviewRef.current?.api.panels.length ?? 0) > 1,
        run: () => closeTabs("others"),
      },
      {
        id: "close-all-tabs",
        title: "关闭全部标签页",
        group: "标签页",
        when: () => (dockviewRef.current?.api.panels.length ?? 0) > 0,
        run: () => closeTabs("all"),
      },
      {
        id: "close-active-tab",
        title: "关闭当前标签页",
        group: "标签页",
        when: () => Boolean(dockviewRef.current?.api.activePanel),
        run: () => {
          const active = dockviewRef.current?.api.activePanel;
          if (!active) return;
          if (dirtyFilesRef.current.has(active.id)) {
            toast.info("当前标签有未保存改动,请先保存(Ctrl+S)再关闭");
            return;
          }
          active.api.close();
        },
      },
      {
        id: "reopen-closed-tab",
        title: "重新打开关闭的标签页",
        group: "标签页",
        when: () => closedTabsRef.current.length > 0,
        run: reopenClosedTab,
      },
      { id: "show-shortcuts", title: "显示快捷键", group: "帮助", keybinding: DOCUMENT_KEYBINDINGS["show-shortcuts"], run: () => setCheatsheetOpen(true) },
      {
        id: "format-document",
        title: "格式化文档",
        group: "编辑器",
        keybinding: "shift+alt+f",
        run: () => runActiveEditorAction("editor.action.formatDocument", "请先打开一个可编辑文件再格式化"),
      },
      {
        id: "goto-line",
        title: "转到行",
        group: "编辑器",
        keybinding: "mod+g",
        run: () => runActiveEditorAction("editor.action.gotoLine", "请先打开一个可编辑文件"),
      },
      {
        id: "toggle-sidebar",
        title: "切换侧栏",
        group: "导航",
        keybinding: DOCUMENT_KEYBINDINGS["toggle-sidebar"],
        run: () => {
          if (state.sidebarCollapsed) sidebarPanelRef.current?.expand();
          else sidebarPanelRef.current?.collapse();
        },
      },
    ];
    if (showGlobalSearchPanel) {
      list.push({ id: "search", title: "全局搜索", group: "导航", keybinding: DOCUMENT_KEYBINDINGS["search"], run: () => showSidebarPanel("search") });
    }
    if (supportsNativeShell) {
      list.push({
        id: "toggle-terminal",
        title: "切换终端",
        group: "导航",
        keybinding: DOCUMENT_KEYBINDINGS["toggle-terminal"],
        run: () => {
          state.terminalCollapsed = !state.terminalCollapsed;
          activateEditorScope();
        },
      });
    }
    return list;
  }, [
    readOnly,
    saveAllDirty,
    showSidebarPanel,
    handleCreateFile,
    handleCreateFolder,
    rootPath,
    showGlobalSearchPanel,
    supportsNativeShell,
    activateEditorScope,
    closeTabs,
    reopenClosedTab,
    refreshGitStatus,
    runActiveEditorAction,
  ]);
  const allCommands = useMemo<WorkspaceCommand[]>(
    () => (extraCommands?.length ? [...extraCommands, ...paletteCommands] : paletteCommands),
    [extraCommands, paletteCommands],
  );

  // 有未保存改动时,关闭/刷新页面前弹浏览器原生确认 —— 避免静默丢失编辑。dirtyFilesRef 在事件触发时实时读。
  useEffect(() => {
    const handler = (event: BeforeUnloadEvent) => {
      if (dirtyFilesRef.current.size === 0) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const shortcut = resolveFileTreeDocumentShortcut(event, {
        platform: navigator.platform,
        supportsNativeShell,
      });
      if (!shortcut || !isEditorScopeActive(event)) return;

      const editableTarget = isEditableKeyboardTarget(event.target);
      if (event.defaultPrevented && !(shortcut === "save-all" && editableTarget)) {
        return;
      }
      if (
        (shortcut === "toggle-sidebar" ||
          shortcut === "new-file" ||
          shortcut === "new-folder" ||
          shortcut === "show-shortcuts") &&
        editableTarget
      ) {
        return; // 正在输入时让位:? 正常打字、其余不抢键
      }

      if (shortcut === "command-palette") {
        event.preventDefault();
        setCommandPaletteOpen((open) => !open);
        return;
      }

      if (shortcut === "quick-open") {
        event.preventDefault(); // 覆盖浏览器打印
        setQuickOpenOpen((open) => !open);
        return;
      }

      if (shortcut === "show-shortcuts") {
        event.preventDefault();
        setCheatsheetOpen(true);
        return;
      }

      if (shortcut === "toggle-terminal") {
        event.preventDefault();
        state.terminalCollapsed = !state.terminalCollapsed;
        activateEditorScope();
        return;
      }

      if (shortcut === "focus-explorer") {
        event.preventDefault();
        showSidebarPanel("explorer");
        return;
      }

      if (shortcut === "search") {
        event.preventDefault();
        if (showGlobalSearchPanel) {
          showSidebarPanel("search");
        }
        return;
      }

      if (shortcut === "toggle-sidebar") {
        event.preventDefault();
        if (state.sidebarCollapsed) sidebarPanelRef.current?.expand();
        else sidebarPanelRef.current?.collapse();
        return;
      }

      if (shortcut === "save-all") {
        event.preventDefault();
        void saveAllDirty();
        return;
      }

      if (shortcut === "new-file") {
        if (readOnly) return;
        event.preventDefault();
        showSidebarPanel("explorer");
        void handleCreateFile(rootPath || undefined);
        return;
      }

      if (shortcut === "new-folder") {
        if (readOnly) return;
        event.preventDefault();
        showSidebarPanel("explorer");
        void handleCreateFolder(rootPath || undefined);
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [
    activateEditorScope,
    handleCreateFile,
    handleCreateFolder,
    isEditorScopeActive,
    readOnly,
    rootPath,
    saveAllDirty,
    showGlobalSearchPanel,
    showSidebarPanel,
    state.sidebarCollapsed,
    supportsNativeShell,
  ]);

  const terminalVisible = supportsNativeShell && !state.terminalCollapsed;
  const sourceControlChangeCount = (state.gitStatus?.files.length ?? 0) + dirtyPathSet.size;
  // The board pane is a full-width view (peer of explorer/search). When
  // it's active we drop the resize handle + editor panel entirely so the
  // sidebar shell (activity bar + board body) takes the whole row.
  const fullWidthBoard = state.sidebarPanel === "board" && Boolean(extraSidebarPane);
  const fullWidthDebug = state.sidebarPanel === "debug" && Boolean(debugSidebarPane);
  const activeCustomSidebarPane = state.sidebarPanel.startsWith("custom:")
    ? customSidebarPanes?.find((pane) => toCustomSidebarPanelId(pane.id) === state.sidebarPanel)
    : undefined;
  const fullWidthCustomPane = Boolean(activeCustomSidebarPane?.fullWidth);
  const fullWidthActivityPane = fullWidthBoard || fullWidthDebug || fullWidthCustomPane;
  const panelLayout = useMemo(
    () =>
      resolveFileTreePanelLayout({
        variant,
        containerWidth,
        fullWidthSidebar: fullWidthActivityPane,
        sidebarDefaultSize,
        sidebarMinSize,
        sidebarMaxSize,
      }),
    [containerWidth, fullWidthActivityPane, sidebarDefaultSize, sidebarMaxSize, sidebarMinSize, variant],
  );

  const EditorWatermark = useMemo(() => {
    const Watermark = () => {
      if (isVsCodeVariant) {
        return (
          <div className="file-tree-editor-watermark is-vscode-watermark">
            <div className="file-tree-editor-vscode-watermark-mark">
              <Code className="size-10" />
            </div>
            {panelLayout.mode === "compact" ? null : (
              <div className="file-tree-editor-vscode-watermark-shortcuts" aria-hidden="true">
                <div className="file-tree-editor-vscode-watermark-row">
                  <span>快速打开文件</span>
                  <kbd>{formatShortcut("Ctrl", "P")}</kbd>
                </div>
                <div className="file-tree-editor-vscode-watermark-row">
                  <span>命令面板</span>
                  <kbd>{formatShortcut("Ctrl", "Shift", "P")}</kbd>
                </div>
                <div className="file-tree-editor-vscode-watermark-row">
                  <span>显示资源管理器</span>
                  <kbd>{formatShortcut("Ctrl", "Shift", "E")}</kbd>
                </div>
                <div className="file-tree-editor-vscode-watermark-row">
                  <span>在文件中搜索</span>
                  <kbd>{formatShortcut("Ctrl", "Shift", "F")}</kbd>
                </div>
                {supportsNativeShell && (
                  <div className="file-tree-editor-vscode-watermark-row">
                    <span>切换终端</span>
                    <kbd>Ctrl+`</kbd>
                  </div>
                )}
              </div>
            )}
          </div>
        );
      }

      return (
        <div className="file-tree-editor-watermark">
          <div className="file-tree-editor-watermark-mark">
            <Code className="size-7" />
          </div>
          <div className="file-tree-editor-watermark-title">打开文件开始编辑</div>
          <div className="file-tree-editor-watermark-description">从左侧资源管理器选择文件。</div>
          {showWatermarkActionButtons && (
            <div className="file-tree-editor-watermark-actions">
              {!readOnly && (
                <>
                  <button
                    type="button"
                    className="file-tree-editor-watermark-action"
                    onClick={() => handleCreateFile(rootPath || undefined)}
                  >
                    <FilePlus className="size-3.5" />
                    <span>新建文件</span>
                  </button>
                  <button
                    type="button"
                    className="file-tree-editor-watermark-action"
                    onClick={() => handleCreateFolder(rootPath || undefined)}
                  >
                    <FolderPlus className="size-3.5" />
                    <span>新建文件夹</span>
                  </button>
                </>
              )}
              <button
                type="button"
                className="file-tree-editor-watermark-action"
                onClick={() => loadTree({ force: true })}
              >
                <RefreshCw className="size-3.5" />
                <span>刷新资源</span>
              </button>
            </div>
          )}
        </div>
      );
    };
    Watermark.displayName = "FileTreeEditorWatermark";
    return Watermark;
  }, [
    handleCreateFile,
    handleCreateFolder,
    isVsCodeVariant,
    loadTree,
    panelLayout.mode,
    readOnly,
    rootPath,
    showWatermarkActionButtons,
    supportsNativeShell,
  ]);

  return (
    <div
      ref={rootContainerRef}
      onFocusCapture={activateEditorScope}
      onPointerDownCapture={activateEditorScope}
      className={cn(
        "file-tree-editor-root flex h-full min-h-0 w-full flex-col overflow-hidden",
        isVsCodeVariant && "file-tree-editor-vscode",
        panelLayout.mode === "compact" && "file-tree-editor-compact-workbench",
        className,
      )}
    >
      <ResizablePanelGroup direction="vertical" className="min-h-0 flex-1">
        {/* Main content area (horizontal: sidebar + editor) */}
        <ResizablePanel defaultSize={terminalVisible ? 70 : 100} minSize={30} className="min-h-0 overflow-hidden">
          {/* Two structurally different layouts share this slot — full-width
              board vs. sidebar+editor. We `key` on that so react-resizable-
              panels treats them as separate groups and never tries to map a
              cached layout for one onto the panel set of the other (that
              caused "Previous layout not found for panel index -1"). */}
          <ResizablePanelGroup
            key={
              fullWidthBoard
                ? "board-only"
                : fullWidthDebug
                  ? "debug-only"
                  : fullWidthCustomPane && activeCustomSidebarPane
                    ? `custom-${activeCustomSidebarPane.id}-only`
                    : `sidebar-editor-${panelLayout.mode}`
            }
            direction="horizontal"
            className="h-full min-h-0"
          >
            {/* Sidebar */}
            <ResizablePanel
              ref={sidebarPanelRef}
              id="file-tree-sidebar"
              order={1}
              defaultSize={fullWidthActivityPane ? 100 : panelLayout.sidebarDefaultSize}
              minSize={fullWidthActivityPane ? 100 : panelLayout.sidebarMinSize}
              maxSize={fullWidthActivityPane ? 100 : panelLayout.sidebarMaxSize}
              className="min-w-0 overflow-hidden"
              collapsible={!fullWidthActivityPane}
              collapsedSize={0}
              onCollapse={() => {
                if (!state.sidebarCollapsed) {
                  state.sidebarCollapsed = true;
                }
              }}
              onExpand={() => {
                if (state.sidebarCollapsed) {
                  state.sidebarCollapsed = false;
                }
              }}
            >
              {isVsCodeVariant ? (
                <div className="file-tree-vscode-sidebar-shell">
                  <nav className="file-tree-vscode-activitybar" aria-label="工作区活动栏">
                    <VscodeTooltipButton
                      label={`资源管理器 (${formatShortcut("Ctrl", "Shift", "E")})`}
                      active={state.sidebarPanel === "explorer"}
                      className="file-tree-vscode-activity-button"
                      onClick={() => showSidebarPanel("explorer")}
                    >
                      <FolderOpen className="size-5" />
                    </VscodeTooltipButton>
                    {overviewSidebarPane &&
                      (() => {
                        const OverviewIcon = overviewSidebarPane.icon;
                        return (
                          <VscodeTooltipButton
                            label={overviewSidebarPane.label}
                            active={state.sidebarPanel === "assetOverview"}
                            className="file-tree-vscode-activity-button"
                            onClick={() => showSidebarPanel("assetOverview")}
                          >
                            <OverviewIcon className="size-5" />
                          </VscodeTooltipButton>
                        );
                      })()}
                    {showGlobalSearchPanel && (
                      <VscodeTooltipButton
                        label={`搜索 (${formatShortcut("Ctrl", "Shift", "F")})`}
                        active={state.sidebarPanel === "search"}
                        className="file-tree-vscode-activity-button"
                        onClick={() => showSidebarPanel("search")}
                      >
                        <Search className="size-5" />
                      </VscodeTooltipButton>
                    )}
                    <VscodeTooltipButton
                      label="源代码管理"
                      active={state.sidebarPanel === "sourceControl"}
                      className="file-tree-vscode-activity-button"
                      onClick={() => showSidebarPanel("sourceControl")}
                    >
                      <GitBranch className="size-5" />
                      {sourceControlChangeCount > 0 ? (
                        <span className="file-tree-vscode-activity-badge">
                          {sourceControlChangeCount > 99 ? "99+" : sourceControlChangeCount}
                        </span>
                      ) : null}
                    </VscodeTooltipButton>
                    {extraSidebarPane &&
                      (() => {
                        const ExtraIcon = extraSidebarPane.icon;
                        return (
                          <VscodeTooltipButton
                            label={extraSidebarPane.label}
                            active={state.sidebarPanel === "board"}
                            className="file-tree-vscode-activity-button"
                            onClick={() => showSidebarPanel("board")}
                          >
                            <ExtraIcon className="size-5" />
                          </VscodeTooltipButton>
                        );
                      })()}
                    {debugSidebarPane &&
                      (() => {
                        const DebugIcon = debugSidebarPane.icon;
                        return (
                          <VscodeTooltipButton
                            label={debugSidebarPane.label}
                            active={state.sidebarPanel === "debug"}
                            className="file-tree-vscode-activity-button"
                            onClick={() => showSidebarPanel("debug")}
                          >
                            <DebugIcon className="size-5" />
                          </VscodeTooltipButton>
                        );
                      })()}
                    {customSidebarPanes?.map((pane) => {
                      const CustomIcon = pane.icon;
                      const panelId = toCustomSidebarPanelId(pane.id);
                      return (
                        <VscodeTooltipButton
                          key={pane.id}
                          label={pane.label}
                          active={state.sidebarPanel === panelId}
                          className="file-tree-vscode-activity-button"
                          onClick={() => showSidebarPanel(panelId)}
                        >
                          <CustomIcon className="size-5" />
                        </VscodeTooltipButton>
                      );
                    })}
                  </nav>
                  <div className="file-tree-vscode-sidebar-panel">
                    <div className="file-tree-vscode-sidebar-titlebar">
                      <span className="file-tree-vscode-sidebar-title">
                        {state.sidebarPanel === "board" && extraSidebarPane
                          ? extraSidebarPane.label
                          : state.sidebarPanel === "debug" && debugSidebarPane
                            ? debugSidebarPane.label
                            : state.sidebarPanel === "assetOverview" && overviewSidebarPane
                              ? overviewSidebarPane.label
                              : activeCustomSidebarPane
                                ? activeCustomSidebarPane.label
                                : state.sidebarPanel === "sourceControl"
                                  ? "源代码管理"
                                  : state.sidebarPanel === "search" && showGlobalSearchPanel
                                    ? "搜索"
                                    : "资源管理器"}
                      </span>
                      {state.sidebarPanel === "explorer" && (
                        <output
                          className="file-tree-vscode-sidebar-meta"
                          aria-label={`${treeStats.files} 个文件，${treeStats.folders} 个文件夹，${dirtyPathSet.size} 个未保存`}
                        >
                          {!state.loading && <span className="file-tree-vscode-sidebar-chip">{treeStats.files}</span>}
                          {dirtyPathSet.size > 0 && (
                            <span className="file-tree-vscode-sidebar-chip is-dirty">{dirtyPathSet.size} 未保存</span>
                          )}
                          {state.partialLoadErrorCount > 0 && (
                            <span className="file-tree-vscode-sidebar-chip is-warning">
                              {state.partialLoadErrorCount} 失败
                            </span>
                          )}
                        </output>
                      )}
                      {state.sidebarPanel === "board" && extraSidebarPane?.titlebarActionsPortalId ? (
                        <div
                          id={extraSidebarPane.titlebarActionsPortalId}
                          className="file-tree-vscode-sidebar-actions"
                        />
                      ) : null}
                      {state.sidebarPanel === "assetOverview" && overviewSidebarPane?.titlebarActionsPortalId ? (
                        <div
                          id={overviewSidebarPane.titlebarActionsPortalId}
                          className="file-tree-vscode-sidebar-actions"
                        />
                      ) : null}
                      {activeCustomSidebarPane?.titlebarActionsPortalId ? (
                        <div
                          id={activeCustomSidebarPane.titlebarActionsPortalId}
                          className="file-tree-vscode-sidebar-actions"
                        />
                      ) : null}
                      {state.sidebarPanel !== "board" &&
                        state.sidebarPanel !== "debug" &&
                        state.sidebarPanel !== "assetOverview" &&
                        !activeCustomSidebarPane &&
                        state.sidebarPanel !== "sourceControl" &&
                        (state.sidebarPanel === "explorer" || !showGlobalSearchPanel) && (
                          <div className="file-tree-vscode-sidebar-actions">
                            {!readOnly && (
                              <>
                                <VscodeTooltipButton
                                  label="新建文件"
                                  className="file-tree-vscode-title-action"
                                  onClick={() => handleCreateFile()}
                                >
                                  <FilePlus className="size-3.5" />
                                </VscodeTooltipButton>
                                <VscodeTooltipButton
                                  label="新建文件夹"
                                  className="file-tree-vscode-title-action"
                                  onClick={() => handleCreateFolder()}
                                >
                                  <FolderPlus className="size-3.5" />
                                </VscodeTooltipButton>
                              </>
                            )}
                            <VscodeTooltipButton
                              label="刷新资源管理器"
                              className="file-tree-vscode-title-action"
                              onClick={() => loadTree({ force: true })}
                            >
                              <RefreshCw className="size-3.5" />
                            </VscodeTooltipButton>
                            <VscodeTooltipButton
                              label="全部折叠"
                              className="file-tree-vscode-title-action"
                              onClick={handleCollapseAll}
                            >
                              <ChevronsUp className="size-3.5" />
                            </VscodeTooltipButton>
                            <VscodeTooltipButton
                              label="更多操作…"
                              ariaExpanded={state.ctxMenu?.items === explorerMoreActions}
                              ariaHasPopup="menu"
                              className="file-tree-vscode-title-action"
                              onClick={showExplorerMoreActions}
                            >
                              <MoreHorizontal className="size-3.5" />
                            </VscodeTooltipButton>
                          </div>
                        )}
                    </div>
                    {state.sidebarPanel === "board" && extraSidebarPane ? (
                      <div className="file-tree-vscode-board-panel min-h-0 flex-1 overflow-y-auto p-2">
                        {extraSidebarPane.content}
                      </div>
                    ) : state.sidebarPanel === "debug" && debugSidebarPane ? (
                      <div className="file-tree-vscode-debug-panel min-h-0 flex-1 overflow-y-auto p-2">
                        {debugSidebarPane.content}
                      </div>
                    ) : state.sidebarPanel === "assetOverview" && overviewSidebarPane ? (
                      <div className="file-tree-vscode-overview-panel min-h-0 flex-1 overflow-y-auto">
                        {overviewSidebarPane.content}
                      </div>
                    ) : activeCustomSidebarPane ? (
                      <div
                        className={cn(
                          "file-tree-vscode-custom-panel min-h-0 flex-1 overflow-hidden",
                          activeCustomSidebarPane.bodyClassName,
                        )}
                      >
                        {activeCustomSidebarPane.content}
                      </div>
                    ) : state.sidebarPanel === "sourceControl" ? (
                      <SourceControlPanel
                        rootPath={rootPath}
                        gitStatus={state.gitStatus}
                        gitStatusLoading={state.gitStatusLoading}
                        gitStatusError={state.gitStatusError}
                        dirtyPaths={dirtyPathSet}
                        readOnly={readOnly}
                        onRefresh={() => void refreshGitStatus()}
                        onOpenFile={(path) => handleFileClick(path, { pinned: true })}
                      />
                    ) : state.sidebarPanel === "explorer" || !showGlobalSearchPanel ? (
                      <ExplorerPane
                        params={explorerPaneParams}
                        api={null as unknown as import("@/desktop/components/dockview-core").PaneviewPanelApi}
                        containerApi={null as unknown as import("@/desktop/components/dockview-core").PaneviewApi}
                        title="资源管理器"
                      />
                    ) : (
                      <div className="file-tree-vscode-search-panel">
                        <GlobalSearch
                          rootPath={rootPath ?? undefined}
                          variant="vscode"
                          className="file-tree-vscode-search"
                          onFileClick={(path, line) => handleFileClick(path, { line, pinned: true })}
                        />
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <div className="h-full bg-muted/[0.03]">
                  <PaneviewReact
                    className="file-tree-paneview h-full w-full"
                    components={SIDEBAR_PANE_COMPONENTS}
                    headerComponents={SIDEBAR_PANE_HEADER_COMPONENTS}
                    onReady={(event) => {
                      sidebarPaneviewRef.current = event;
                      sidebarPaneviewLayoutCleanupRef.current?.();

                      const cachedLayout = readCachedPaneviewLayout(rootPath ?? undefined, "sidebar");
                      if (cachedLayout) {
                        try {
                          event.api.fromJSON(cachedLayout);
                        } catch (e) {
                          console.warn("[file-tree] Failed to restore panel layout:", e);
                        }
                      }

                      if (!event.api.getPanel("explorer")) {
                        event.api.addPanel({
                          id: "explorer",
                          component: "explorer",
                          headerComponent: "sidebarHeader",
                          title: "资源管理器",
                          minimumBodySize: 220,
                          size: 460,
                          isExpanded: true,
                          params: explorerPaneParams,
                        });
                      } else {
                        updatePanelParametersIfChanged(event.api.getPanel("explorer"), explorerPaneParams);
                      }
                      // Ensure layout is correct after panel creation — handles dialog
                      // open animations where the container may not have final dimensions yet.
                      const scheduleLayoutCheck = () => {
                        requestAnimationFrame(() => {
                          const container = rootContainerRef.current?.querySelector(
                            ".file-tree-paneview",
                          ) as HTMLElement | null;
                          if (container && container.clientHeight > 0 && event.api.height === 0) {
                            event.api.layout(container.clientWidth, container.clientHeight);
                          }
                        });
                      };
                      scheduleLayoutCheck();
                      setTimeout(scheduleLayoutCheck, 150);
                      const disposable = event.api.onDidLayoutChange(() => {
                        writeCachedPaneviewLayout(rootPathKey, "sidebar", event.api.toJSON());
                      });
                      sidebarPaneviewLayoutCleanupRef.current = () => {
                        disposable.dispose();
                      };
                    }}
                  />
                </div>
              )}
            </ResizablePanel>

            {!fullWidthActivityPane && (
              <ResizableHandle className={isVsCodeVariant ? "file-tree-vscode-resize-handle" : undefined} />
            )}

            {/* Editor — hidden when the activity bar swung to the board pane;
                board mode lets the sidebar take the full width because the
                board is its own primary view, not a sidekick to the editor. */}
            {!fullWidthActivityPane && (
              <ResizablePanel
                id="file-tree-editor"
                order={2}
                defaultSize={panelLayout.editorDefaultSize}
                minSize={panelLayout.editorMinSize}
                className="min-w-0 overflow-hidden"
              >
                <div className="relative flex h-full min-w-0 flex-col overflow-hidden">
                  {state.sidebarCollapsed && !isVsCodeVariant && (
                    <button
                      type="button"
                      onClick={() => sidebarPanelRef.current?.expand()}
                      title="展开文件管理器"
                      className="absolute left-0 top-1/2 -translate-y-1/2 z-10 flex items-center justify-center w-5 h-10 bg-muted/80 hover:bg-muted border border-l-0 border-border/50 rounded-r-md transition-colors text-muted-foreground hover:text-foreground"
                    >
                      <PanelLeftOpen className="size-3.5" />
                    </button>
                  )}
                  <div ref={dockviewHostRef} className="relative h-full min-h-0 min-w-0 flex-1 overflow-hidden">
                    <DockviewReact
                      onReady={(event) => {
                        dockviewRef.current = event;
                        dockviewSessionCleanupRef.current?.();
                        scheduleDockviewLayout("dockview ready");
                        const restoreSession = () => {
                          if (!persistSession) {
                            return;
                          }
                          if (!rootPath || restoredEditorSessionRootRef.current === rootPath) {
                            return;
                          }
                          restoredEditorSessionRootRef.current = rootPath;
                          const session = readEditorSession(rootPath);
                          if (!session?.openFiles.length) return;
                          pinnedPathsRef.current = new Set(
                            session.openFiles.filter((file) => file.pinned).map((file) => file.path),
                          );
                          const groups = event.api.groups;
                          for (const file of session.openFiles) {
                            if (event.api.getPanel(file.path)) continue;
                            const isPreview = !file.pinned;
                            if (isPreview) {
                              previewPanelPathRef.current = file.path;
                            }
                            const panel = event.api.addPanel({
                              id: file.path,
                              component: resolveFileComponent(file.path),
                              params: {
                                path: file.path,
                                isPreview,
                                isPinned: file.pinned,
                                autoSaveDelay: state.autoSaveDelayMs,
                                commandScope,
                                enableLocalSnapshots,
                                enableRichMarkdown,
                                assetId,
                                onOpenWikiLink: openWikiLinkStable,
                                readOnly,
                                readFile: readTextFile,
                                contentVersion: staticFilesVersion,
                                showEditorActions: showEditorTitleActions,
                                showPreviewIndicator,
                                isDirty: false,
                                workbenchVariant,
                                rootPath,
                                onDirtyChange: handleDirtyReport,
                                onContentChange: handleEditorContentReport,
                                onAfterSave,
                                onEditorStatusChange: handleEditorStatusChange,
                                onCopyPath: handleCopyPath,
                                onOpenNative: supportsFileSystemShell ? handleOpenNative : undefined,
                                onViewFileHistory: enableLocalSnapshots ? handleViewFileHistory : undefined,
                                onCloseRequest: handleCloseRequest,
                                onPinRequest: pinEditorPanel,
                                onViewStateChange: handleEditorViewStateChange,
                                initialViewState: editorMementosRef.current.get(file.path),
                              },
                              title: file.path.split("/").pop() || "未命名",
                              position:
                                groups.length > 0
                                  ? {
                                      referenceGroup: groups[0],
                                      direction: "within",
                                    }
                                  : undefined,
                            });
                            if (session.activeFile === file.path) {
                              revealDockviewPanel(panel, "restore active file");
                            }
                          }
                          if (session.activeFile) {
                            const activePanel = event.api.getPanel(session.activeFile);
                            if (activePanel) {
                              revealDockviewPanel(activePanel, "restore session active file");
                            }
                          }
                        };

                        restoreSession();
                        if (pendingFileRef.current) {
                          const pendingFile = pendingFileRef.current;
                          pendingFileRef.current = null;
                          const groups = event.api.groups;
                          const panel = event.api.addPanel({
                            id: pendingFile.path,
                            component: resolveFileComponent(pendingFile.path),
                            params: {
                              path: pendingFile.path,
                              ...(pendingFile.line ? { line: pendingFile.line } : {}),
                              ...(pendingFile.searchQuery ? { searchQuery: pendingFile.searchQuery } : {}),
                              isPreview: !!pendingFile.preview,
                              isPinned: !!pendingFile.pinned,
                              autoSaveDelay: state.autoSaveDelayMs,
                              commandScope,
                              enableLocalSnapshots,
                              enableRichMarkdown,
                              readOnly,
                              readFile: readTextFile,
                              contentVersion: staticFilesVersion,
                              showEditorActions: showEditorTitleActions,
                              showPreviewIndicator,
                              isDirty: false,
                              workbenchVariant,
                              rootPath,
                              onDirtyChange: handleDirtyReport,
                              onContentChange: handleEditorContentReport,
                              onAfterSave,
                              onEditorStatusChange: handleEditorStatusChange,
                              onCopyPath: handleCopyPath,
                              onOpenNative: supportsFileSystemShell ? handleOpenNative : undefined,
                              onViewFileHistory: enableLocalSnapshots ? handleViewFileHistory : undefined,
                              onCloseRequest: handleCloseRequest,
                              onPinRequest: pinEditorPanel,
                              onViewStateChange: handleEditorViewStateChange,
                              initialViewState: editorMementosRef.current.get(pendingFile.path),
                            },
                            title: pendingFile.path.split("/").pop() || "未命名",
                            position:
                              groups.length > 0
                                ? {
                                    referenceGroup: groups[0],
                                    direction: "within",
                                  }
                                : undefined,
                          });
                          revealDockviewPanel(panel, "dockview ready pending file");
                        }
                        scheduleDockviewLayout("dockview ready panels restored");

                        const updateActiveFileFromPanel = () => {
                          const panel = event.api.activePanel;
                          const nextActiveFile = panel?.id ?? null;
                          if (state.activeFile !== nextActiveFile) {
                            state.activeFile = nextActiveFile;
                          }
                        };

                        updateActiveFileFromPanel();
                        const activeChangeDisposable = event.api.onDidActivePanelChange(() => {
                          updateActiveFileFromPanel();
                          state.editorTabsVersion++;
                          scheduleDockviewLayout("active panel change");
                          persistEditorSession();
                        });
                        const addPanelDisposable = event.api.onDidAddPanel(() => {
                          state.editorTabsVersion++;
                          scheduleDockviewLayout("panel added");
                          persistEditorSession();
                        });
                        const removePanelDisposable = event.api.onDidRemovePanel((panel) => {
                          // 记入「最近关闭」栈(供重新打开);栈深上限 25。
                          closedTabsRef.current.push(panel.id);
                          if (closedTabsRef.current.length > 25) closedTabsRef.current.shift();
                          if (dirtyFilesRef.current.delete(panel.id)) {
                            state.dirtyVersion++;
                          }
                          currentEditorContentRef.current.delete(panel.id);
                          originalContentRef.current.delete(panel.id);
                          pinnedPathsRef.current.delete(panel.id);
                          if (previewPanelPathRef.current === panel.id) {
                            previewPanelPathRef.current = null;
                          }
                          state.editorTabsVersion++;
                          scheduleDockviewLayout("panel removed");
                          persistEditorSession();
                        });
                        const layoutDisposable = event.api.onDidLayoutChange(() => {
                          persistEditorSession();
                        });

                        const closePanelSafely = (panel: (typeof event.api.panels)[number]) => {
                          if (dirtyFilesRef.current.has(panel.id)) {
                            handleCloseRequest(panel.id);
                            return false;
                          }
                          panel.api.close();
                          return true;
                        };

                        const closePanelsSafely = (panels: Array<(typeof event.api.panels)[number]>) => {
                          for (const panel of [...panels]) {
                            if (!closePanelSafely(panel)) return;
                          }
                        };

                        const closeSavedPanels = (panels: Array<(typeof event.api.panels)[number]>) => {
                          for (const panel of [...panels]) {
                            if (!dirtyFilesRef.current.has(panel.id)) {
                              panel.api.close();
                            }
                          }
                        };

                        const handleTabCtx = (e: MouseEvent) => {
                          const target = e.target as HTMLElement;
                          const tab =
                            target.closest(".dv-default-tab") ||
                            target.closest("[role='tab']") ||
                            target.closest(".tab");
                          const tabStrip = target.closest(".dv-tabs-and-actions-container, .dv-tabs-container");
                          if (!tab && !tabStrip) return;
                          e.preventDefault();
                          e.stopPropagation();

                          // Try multiple ways to find panel ID
                          let panelId: string | null =
                            tab?.getAttribute("data-panel-id") || tab?.getAttribute("data-id") || null;

                          if (!panelId && tab) {
                            const tabContent =
                              tab.querySelector(".dv-default-tab-content") ||
                              tab.querySelector(".dv-tab-content") ||
                              tab.querySelector(".tab-label");
                            if (tabContent) {
                              const title = tabContent.textContent?.trim().replace(/\s+/g, " ");
                              if (title) {
                                const panel = event.api.panels.find(
                                  (p) => p.title === title || p.title === title.replace(/\s+/g, " "),
                                );
                                if (panel) panelId = panel.id;
                              }
                            }
                          }

                          // Get all panels for the menu
                          const allPanels = dockviewRef.current?.api.panels || [];
                          const otherPanels = allPanels.filter((p) => p.id !== panelId);
                          const separatorItem: MenuItem = {
                            separator: true,
                            label: "",
                            onClick: () => {},
                          };

                          let items: MenuItem[] = [];

                          if (panelId) {
                            const targetPanel = allPanels.find((p) => p.id === panelId);
                            const targetIsPreview = !!(targetPanel?.params as { isPreview?: boolean } | undefined)
                              ?.isPreview;

                            if (isVsCodeVariant) {
                              items = [
                                ...(targetIsPreview
                                  ? [
                                      {
                                        label: "保持打开",
                                        icon: <Pin className="size-3.5 shrink-0" />,
                                        onClick: () => pinEditorPanel(panelId),
                                      },
                                      separatorItem,
                                    ]
                                  : []),
                                {
                                  label: supportsNativeShell ? "在资源管理器中显示" : "在文件树中定位",
                                  icon: <FolderOpen className="size-3.5 shrink-0" />,
                                  onClick: () => revealInExplorer(panelId),
                                },
                                {
                                  label: "在系统中显示",
                                  icon: <ExternalLink className="size-3.5 shrink-0" />,
                                  onClick: () => void handleOpenNative(panelId, { isDirectory: false }),
                                  requiresNativeShell: true,
                                },
                                {
                                  label: "复制路径",
                                  icon: <Copy className="size-3.5 shrink-0" />,
                                  onClick: () => handleCopyPath(panelId),
                                },
                                {
                                  label: "复制相对路径",
                                  icon: <Copy className="size-3.5 shrink-0" />,
                                  onClick: () => handleCopyRelativePath(panelId),
                                },
                                separatorItem,
                                {
                                  label: "关闭",
                                  icon: <X className="size-3.5 shrink-0" />,
                                  onClick: () => closePanelsSafely(allPanels.filter((panel) => panel.id === panelId)),
                                  shortcut: formatShortcut("Ctrl", "W"),
                                },
                                {
                                  label: "关闭其他",
                                  icon: <XCircle className="size-3.5 shrink-0" />,
                                  onClick: () => closePanelsSafely(otherPanels),
                                },
                                {
                                  label: "关闭右侧",
                                  icon: <ArrowRightToLine className="size-3.5 shrink-0" />,
                                  onClick: () => {
                                    const index = allPanels.findIndex((p) => p.id === panelId);
                                    if (index !== -1) {
                                      closePanelsSafely(allPanels.slice(index + 1));
                                    }
                                  },
                                },
                                {
                                  label: "关闭已保存",
                                  icon: <Check className="size-3.5 shrink-0" />,
                                  onClick: () => closeSavedPanels(allPanels),
                                },
                                {
                                  label: "关闭所有",
                                  icon: <Layers className="size-3.5 shrink-0" />,
                                  onClick: () => closePanelsSafely(allPanels),
                                },
                              ];
                            } else {
                              items = [
                                ...(targetIsPreview
                                  ? [
                                      {
                                        label: "保持打开",
                                        icon: <Pin className="size-3.5 shrink-0" />,
                                        onClick: () => pinEditorPanel(panelId),
                                      },
                                      separatorItem,
                                    ]
                                  : []),
                                {
                                  label: "关闭",
                                  icon: <X className="size-3.5 shrink-0" />,
                                  onClick: () => closePanelsSafely(allPanels.filter((panel) => panel.id === panelId)),
                                  shortcut: formatShortcut("Ctrl", "W"),
                                },
                                {
                                  label: "关闭其他",
                                  icon: <XCircle className="size-3.5 shrink-0" />,
                                  onClick: () => {
                                    closePanelsSafely(otherPanels);
                                  },
                                },
                                {
                                  label: "关闭所有",
                                  icon: <Layers className="size-3.5 shrink-0" />,
                                  onClick: () => {
                                    closePanelsSafely(allPanels);
                                  },
                                },
                                {
                                  label: "关闭已保存",
                                  icon: <Check className="size-3.5 shrink-0" />,
                                  onClick: () => {
                                    closeSavedPanels(allPanels);
                                  },
                                },
                                {
                                  label: "关闭右侧",
                                  icon: <ArrowRightToLine className="size-3.5 shrink-0" />,
                                  onClick: () => {
                                    const index = allPanels.findIndex((p) => p.id === panelId);
                                    if (index !== -1) {
                                      closePanelsSafely(allPanels.slice(index + 1));
                                    }
                                  },
                                },
                              ];
                            }
                          } else if (allPanels.length > 0) {
                            items = [
                              {
                                label: "关闭已保存",
                                icon: <Check className="size-3.5 shrink-0" />,
                                onClick: () => {
                                  closeSavedPanels(allPanels);
                                },
                              },
                              {
                                label: "关闭所有",
                                icon: <Layers className="size-3.5 shrink-0" />,
                                onClick: () => {
                                  closePanelsSafely(allPanels);
                                },
                              },
                            ];
                          }

                          const visibleItems = normalizeMenuItems(items, contextMenuCapabilities);
                          if (visibleItems.length > 0) {
                            state.ctxMenu = {
                              x: e.clientX,
                              y: e.clientY,
                              items: visibleItems,
                              variant: isVsCodeVariant ? "vscode" : "default",
                            };
                          }
                        };

                        document.addEventListener("contextmenu", handleTabCtx);
                        tabCtxCleanupRef.current = () => {
                          activeChangeDisposable.dispose();
                          addPanelDisposable.dispose();
                          removePanelDisposable.dispose();
                          layoutDisposable.dispose();
                          document.removeEventListener("contextmenu", handleTabCtx);
                        };
                        dockviewSessionCleanupRef.current = () => {
                          addPanelDisposable.dispose();
                          removePanelDisposable.dispose();
                          layoutDisposable.dispose();
                        };
                      }}
                      components={PANEL_COMPONENTS}
                      defaultTabComponent={FileTab as React.FunctionComponent<IDockviewPanelHeaderProps>}
                      watermarkComponent={EditorWatermark}
                      className="dockview-theme-light h-full w-full min-w-0 overflow-hidden"
                    />
                  </div>
                </div>
              </ResizablePanel>
            )}
          </ResizablePanelGroup>
        </ResizablePanel>

        {/* Terminal panel */}
        {terminalVisible && (
          <>
            <ResizableHandle className={isVsCodeVariant ? "file-tree-vscode-resize-handle" : undefined} />
            <ResizablePanel defaultSize={30} minSize={15} maxSize={60} collapsible={true} collapsedSize={0}>
              <IntegratedTerminal onClose={() => (state.terminalCollapsed = true)} />
            </ResizablePanel>
          </>
        )}
      </ResizablePanelGroup>

      {showStatusBar ? (
        <FileTreeIdeStatusBar
          rootPath={rootPath}
          activeFile={state.activeFile}
          activeFileType={activeFileType}
          activeStatus={activeEditorStatus}
          gitStatus={state.gitStatus}
          gitStatusLoading={state.gitStatusLoading}
          gitStatusError={state.gitStatusError}
          dirtyFileCount={dirtyPathSet.size}
          readOnly={readOnly}
          onOpenSourceControl={() => showSidebarPanel("sourceControl")}
        />
      ) : null}

      {state.ctxMenu && (
        <ContextMenuPortal
          menu={state.ctxMenu}
          onClose={() => (state.ctxMenu = null)}
          portalContainer={rootContainerRef.current?.closest<HTMLElement>("[role='dialog']") ?? null}
        />
      )}

      {/* Input dialog */}
      <InputDialog
        open={!!state.inputDialog}
        title={state.inputDialog?.title ?? ""}
        value={state.inputValue}
        onChange={(v) => (state.inputValue = v)}
        onConfirm={(v) => closeInputDialog(v)}
        onCancel={() => closeInputDialog(null)}
      />

      {/* Confirm dialog */}
      <ConfirmDialog
        open={!!state.confirmDialog}
        message={state.confirmDialog?.message ?? ""}
        onConfirm={() => closeConfirmDialog(true)}
        onCancel={() => closeConfirmDialog(false)}
      />

      <DiffDialog
        open={!!state.diffDialog}
        diff={state.diffDialog}
        onClose={() => {
          state.diffDialog = null;
        }}
      />

      {/* External File Change Dialog (SideX pattern: conflict detection) */}
      <ExternalChangeDialog
        open={!!state.externalChangeDialog}
        filePath={state.externalChangeDialog?.path ?? null}
        onReload={() => void handleExternalReload()}
        onKeepLocal={() => void handleExternalKeepLocal()}
        onMerge={handleExternalMerge}
        onClose={() => {
          state.externalChangeDialog = null;
        }}
      />

      {/* File History Dialog */}
      <FileHistoryDialog
        open={!!state.fileHistoryDialog}
        filePath={state.fileHistoryDialog?.path ?? null}
        snapshots={state.fileHistoryDialog?.snapshots ?? []}
        onCreateSnapshot={() => {
          const path = state.fileHistoryDialog?.path;
          if (path) void handleCreateSnapshot(path);
        }}
        onPreviewSnapshot={(snapshot) => void handlePreviewSnapshot(snapshot)}
        onCompareSnapshot={(snapshot) => void handleCompareSnapshot(snapshot)}
        onRenameSnapshot={(snapshot) => void handleRenameSnapshot(snapshot)}
        onDeleteSnapshot={(snapshot) => void handleDeleteSnapshot(snapshot)}
        onRestoreSnapshot={(snapshot) => void handleRestoreSnapshot(snapshot)}
        onClose={() => {
          state.fileHistoryDialog = null;
        }}
      />

      <FileSnapshotPreviewDialog
        open={!!state.snapshotPreviewDialog}
        filePath={state.snapshotPreviewDialog?.path ?? null}
        snapshot={state.snapshotPreviewDialog?.snapshot ?? null}
        content={state.snapshotPreviewDialog?.content ?? ""}
        onRestore={() => {
          const snapshot = state.snapshotPreviewDialog?.snapshot;
          if (snapshot) void handleRestoreSnapshot(snapshot);
        }}
        onClose={() => {
          state.snapshotPreviewDialog = null;
        }}
      />

      <FileSnapshotCompareDialog
        open={!!state.snapshotCompareDialog}
        filePath={state.snapshotCompareDialog?.path ?? null}
        snapshot={state.snapshotCompareDialog?.snapshot ?? null}
        snapshotContent={state.snapshotCompareDialog?.snapshotContent ?? ""}
        currentContent={state.snapshotCompareDialog?.currentContent ?? ""}
        onRestore={() => {
          const snapshot = state.snapshotCompareDialog?.snapshot;
          if (snapshot) void handleRestoreSnapshot(snapshot);
        }}
        onClose={() => {
          state.snapshotCompareDialog = null;
        }}
      />

      <CommandPalette open={commandPaletteOpen} onOpenChange={setCommandPaletteOpen} commands={allCommands} />
      <ShortcutsCheatsheet open={cheatsheetOpen} onOpenChange={setCheatsheetOpen} commands={allCommands} />
      <QuickOpen
        open={quickOpenOpen}
        onOpenChange={setQuickOpenOpen}
        files={quickOpenFiles}
        onOpen={(path) => handleFileClick(path, { pinned: true })}
      />
    </div>
  );
}
