import {
  FilePlus,
  FolderOpen,
  FolderPlus,
  Loader2,
  RefreshCw,
  Save,
  Search,
  X,
} from "lucide-react";
import { useEffect, useId, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  dispatchFileTreeEditorCommand,
  type FileTreeEditorCommand,
} from "@/components/workspace/file-tree-editor/events";
import {
  isEditableKeyboardTarget,
  resolveFileTreeDocumentShortcut,
} from "@/components/workspace/file-tree-editor/keyboard-shortcuts";
import {
  FileTreeEditor,
  type FileTreeEditorStateSnapshot,
} from "@/components/workspace/file-tree-editor/FileTreeEditor";
import { allowsLocalWorkspacePaths } from "@/lib/runtime-environment";
import { exposeWorkspacePath, getWorkspaceBaseName } from "@/lib/workspace-path";

interface WorkspaceFileManagerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  rootPath: string;
  /**
   * "dialog"(默认)= 居中模态弹窗;"embedded" = 平铺填满父容器(InternShannon悬浮窗把工作区
   * 作为内嵌视图打开,避免弹窗套弹窗)。embedded 下 onOpenChange(false) 表示返回上一视图。
   */
  variant?: "dialog" | "embedded";
}

function isWorkspaceDialogDebugEnabled(): boolean {
  try {
    return (
      globalThis.localStorage?.getItem("internshannon-file-tree-debug") ===
      "true"
    );
  } catch {
    return false;
  }
}

function debugWorkspaceDialog(...args: unknown[]) {
  if (isWorkspaceDialogDebugEnabled()) {
    console.debug(...args);
  }
}

function getWorkspaceName(rootPath: string) {
  return getWorkspaceBaseName(rootPath) || rootPath;
}

export function WorkspaceFileManagerDialog({
  open,
  onOpenChange,
  rootPath,
  variant = "dialog",
}: WorkspaceFileManagerDialogProps) {
  const embedded = variant === "embedded";
  const visibleRootPath = useMemo(
    () => exposeWorkspacePath(rootPath, { allowLocal: allowsLocalWorkspacePaths() }),
    [rootPath],
  );
  const [editorState, setEditorState] =
    useState<FileTreeEditorStateSnapshot | null>(null);
  const [mounted, setMounted] = useState(false);
  const [closeWarningOpen, setCloseWarningOpen] = useState(false);
  const [savingBeforeClose, setSavingBeforeClose] = useState(false);
  const generatedCommandScope = useId();
  const commandScope = `workspace-file-manager:${generatedCommandScope}`;
  const workspaceName = useMemo(
    () => getWorkspaceName(visibleRootPath),
    [visibleRootPath]
  );
  const dirtyFileCount = editorState?.dirtyFileCount ?? 0;
  const statusText = editorState?.loading
    ? "正在加载工作区"
    : editorState
    ? `${editorState.totalFiles} 个文件 · ${editorState.totalFolders} 个文件夹`
    : "准备打开工作区";

  const runCommand = useMemo(
    () => (command: FileTreeEditorCommand) => {
      dispatchFileTreeEditorCommand(command, commandScope);
    },
    [commandScope]
  );

  const headerCommandButtonClass =
    "inline-flex size-8 items-center justify-center rounded-[4px] border border-transparent text-muted-foreground transition-colors hover:border-border-light hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 disabled:pointer-events-none disabled:opacity-45";

  const requestClose = () => {
    if (dirtyFileCount > 0) {
      setCloseWarningOpen(true);
      return;
    }
    onOpenChange(false);
  };

  const handleDialogOpenChange = (nextOpen: boolean) => {
    if (nextOpen) {
      onOpenChange(true);
      return;
    }
    requestClose();
  };

  const confirmClose = () => {
    setCloseWarningOpen(false);
    setSavingBeforeClose(false);
    onOpenChange(false);
  };

  const saveAllAndClose = () => {
    if (dirtyFileCount === 0) {
      confirmClose();
      return;
    }
    setSavingBeforeClose(true);
    runCommand("save-all");
  };

  useEffect(() => {
    if (!open) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      const shortcut = resolveFileTreeDocumentShortcut(event, {
        platform: navigator.platform,
        supportsNativeShell: false,
      });
      if (!shortcut) return;

      const editableTarget = isEditableKeyboardTarget(event.target);
      if (
        (shortcut === "new-file" || shortcut === "new-folder") &&
        editableTarget
      )
        return;

      const commandByShortcut: Partial<
        Record<typeof shortcut, FileTreeEditorCommand>
      > = {
        "new-file": "new-file",
        "new-folder": "new-folder",
        "save-all": "save-all",
        search: "search",
        "focus-explorer": "focus-explorer",
      };
      const command = commandByShortcut[shortcut];
      if (!command) return;

      event.preventDefault();
      runCommand(command);
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, runCommand]);

  useEffect(() => {
    if (open) {
      debugWorkspaceDialog("[WorkspaceFileManagerDialog] open", {
        rootPath: visibleRootPath,
        rootPathType: typeof visibleRootPath,
        rootPathLength: visibleRootPath?.length,
      });
      if (!visibleRootPath) {
        toast.error("工作区路径未设置，请先选择工作区");
      }
      // Delay mounting the file manager by one frame so the dialog content
      // has non-zero dimensions when the paneview initializes its layout.
      const raf = requestAnimationFrame(() => {
        setMounted(true);
      });
      return () => cancelAnimationFrame(raf);
    }
    setMounted(false);
    setEditorState(null);
    setCloseWarningOpen(false);
    setSavingBeforeClose(false);
  }, [open, visibleRootPath]);

  useEffect(() => {
    if (!savingBeforeClose) return;
    if (dirtyFileCount === 0) {
      setSavingBeforeClose(false);
      setCloseWarningOpen(false);
      onOpenChange(false);
      return;
    }

    const timeout = window.setTimeout(() => {
      setSavingBeforeClose(false);
      setCloseWarningOpen(true);
      toast.error(
        `仍有 ${dirtyFileCount} 个文件未保存，请检查保存失败的编辑器`
      );
    }, 6500);

    return () => window.clearTimeout(timeout);
  }, [dirtyFileCount, onOpenChange, savingBeforeClose]);

  useEffect(() => {
    if (editorState) {
      debugWorkspaceDialog("[WorkspaceFileManagerDialog] state", {
        loading: editorState.loading,
        treeLoadError: editorState.treeLoadError,
        partialLoadErrorCount: editorState.partialLoadErrorCount,
        totalFiles: editorState.totalFiles,
        totalFolders: editorState.totalFolders,
        openFileCount: editorState.openFileCount,
        activeFile: editorState.activeFile,
      });
    }
  }, [editorState]);

  if (open && !visibleRootPath) {
    if (embedded) {
      return (
        <div className="flex h-full min-h-0 items-center justify-center bg-white px-6 text-center">
          <div>
            <div className="text-sm font-medium text-foreground">工作区未设置</div>
            <div className="mt-1 text-xs text-muted-foreground">
              当前会话尚未返回工作区根目录。请确保智能体已经返回了工作区路径。
            </div>
          </div>
        </div>
      );
    }
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-md">
          <DialogTitle>工作区未设置</DialogTitle>
          <DialogDescription>
            当前会话尚未返回工作区根目录。请确保智能体已经返回了工作区路径。
          </DialogDescription>
        </DialogContent>
      </Dialog>
    );
  }

  // embedded 模式没有 Dialog 上下文,Radix 的 DialogTitle/Description 必须降级为普通元素。
  const TitleComp = embedded ? "div" : DialogTitle;
  const DescriptionComp = embedded ? "div" : DialogDescription;

  const panelContent = (
    <>
        <div className="flex shrink-0 flex-col border-b border-border-light bg-white">
          <div className="flex min-h-[44px] items-center justify-between gap-3 px-3 py-1.5">
            <div className="flex min-w-0 items-center gap-2">
              <div className="flex size-6 shrink-0 items-center justify-center rounded-[4px] bg-[#eef4ff] text-primary">
                <FolderOpen className="size-3.5" />
              </div>
              <div className="flex min-w-0 items-baseline gap-2">
                <TitleComp className="shrink-0 font-['Outfit','Helvetica_Neue',Helvetica,Arial,sans-serif] text-sm font-semibold leading-tight text-foreground">
                  工作区文件管理器
                </TitleComp>
                <DescriptionComp className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 font-['DM_Sans','Helvetica_Neue',Helvetica,Arial,sans-serif] text-[12px] leading-[1.5] text-foreground/80">
                  <span
                    className="max-w-[22rem] truncate font-medium text-[#181e25]"
                    title={workspaceName}
                  >
                    {workspaceName}
                  </span>
                  <span className="hidden text-muted-foreground sm:inline">
                    /
                  </span>
                  <span
                    className="max-w-[36rem] truncate text-muted-foreground"
                    title={visibleRootPath}
                  >
                    {visibleRootPath}
                  </span>
                </DescriptionComp>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <div className="hidden items-center gap-1 border-r border-border-light pr-2 md:flex">
                <button
                  type="button"
                  className={headerCommandButtonClass}
                  aria-label="保存全部"
                  title={dirtyFileCount > 0 ? "保存全部" : "没有需要保存的文件"}
                  disabled={dirtyFileCount === 0}
                  onClick={() => runCommand("save-all")}
                >
                  <Save className="size-4" aria-hidden="true" />
                </button>
                <button
                  type="button"
                  className={headerCommandButtonClass}
                  aria-label="在文件中搜索"
                  title="在文件中搜索"
                  onClick={() => runCommand("search")}
                >
                  <Search className="size-4" aria-hidden="true" />
                </button>
                <button
                  type="button"
                  className={headerCommandButtonClass}
                  aria-label="刷新资源管理器"
                  title="刷新资源管理器"
                  onClick={() => runCommand("refresh")}
                >
                  <RefreshCw className="size-4" aria-hidden="true" />
                </button>
                <button
                  type="button"
                  className={headerCommandButtonClass}
                  aria-label="新建文件"
                  title="新建文件"
                  onClick={() => runCommand("new-file")}
                >
                  <FilePlus className="size-4" aria-hidden="true" />
                </button>
                <button
                  type="button"
                  className={headerCommandButtonClass}
                  aria-label="新建文件夹"
                  title="新建文件夹"
                  onClick={() => runCommand("new-folder")}
                >
                  <FolderPlus className="size-4" aria-hidden="true" />
                </button>
              </div>
              <span className="hidden rounded-[4px] border border-border-light bg-[#fafafa] px-2 py-1 font-['DM_Sans','Helvetica_Neue',Helvetica,Arial,sans-serif] text-[11px] font-medium leading-none text-foreground/80 md:inline-flex">
                {statusText}
              </span>
              {dirtyFileCount > 0 && (
                <span className="rounded-[4px] border border-amber-200 bg-amber-50 px-2 py-1 font-['DM_Sans','Helvetica_Neue',Helvetica,Arial,sans-serif] text-[11px] font-semibold leading-none text-amber-700">
                  {dirtyFileCount} 个未保存
                </span>
              )}
              <button
                type="button"
                className="inline-flex size-8 items-center justify-center rounded-[4px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                aria-label="关闭工作区文件管理器"
                onClick={requestClose}
              >
                <X className="size-4" />
              </button>
            </div>
          </div>
        </div>
        {mounted ? (
          <FileTreeEditor
            key={visibleRootPath}
            rootPath={visibleRootPath}
            className="shuan-design-file-manager min-h-0 flex-1 w-full"
            variant="vscode"
            treeDepth={8}
            sidebarDefaultSize={28}
            sidebarMinSize={18}
            sidebarMaxSize={45}
            enableLocalSnapshots={true}
            enableRichMarkdown={true}
            commandScope={commandScope}
            onStateChange={setEditorState}
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-white text-foreground/80">
            <div className="flex items-center gap-2 rounded-[4px] border border-border-light bg-white px-4 py-2 text-sm shadow-[rgba(0,0,0,0.08)_0px_4px_6px]">
              <Loader2 className="size-4 animate-spin text-primary" />
              正在初始化编辑器...
            </div>
          </div>
        )}
    </>
  );

  const closeWarning = (
      <AlertDialog open={closeWarningOpen} onOpenChange={setCloseWarningOpen}>
        <AlertDialogContent className="max-w-md rounded-[4px] border-border-light bg-white shadow-[rgba(44,30,116,0.16)_0px_0px_15px]">
          <AlertDialogHeader>
            <AlertDialogTitle className="font-['Outfit','Helvetica_Neue',Helvetica,Arial,sans-serif] text-foreground">
              关闭文件管理器？
            </AlertDialogTitle>
            <AlertDialogDescription className="font-['DM_Sans','Helvetica_Neue',Helvetica,Arial,sans-serif] text-foreground/80">
              当前还有 {dirtyFileCount}{" "}
              个文件未保存。关闭弹窗会卸载编辑器，未保存内容可能丢失。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="rounded-[4px] border-border bg-white text-foreground/80 hover:bg-muted hover:text-foreground">
              继续编辑
            </AlertDialogCancel>
            <AlertDialogAction
              type="button"
              className="rounded-[4px] bg-[#181e25] text-white hover:bg-[#181e25]/85"
              disabled={savingBeforeClose}
              onClick={(event) => {
                event.preventDefault();
                saveAllAndClose();
              }}
            >
              {savingBeforeClose ? (
                <>
                  <Loader2 className="mr-1.5 size-3.5 animate-spin" />
                  保存中
                </>
              ) : (
                "保存全部"
              )}
            </AlertDialogAction>
            <AlertDialogAction
              type="button"
              className="rounded-[4px] bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={savingBeforeClose}
              onClick={confirmClose}
            >
              放弃并关闭
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
  );

  if (embedded) {
    return (
      <div className="flex h-full min-h-0 flex-col overflow-hidden bg-white">
        {panelContent}
        {closeWarning}
      </div>
    );
  }

  return (
    <Dialog open={open} onOpenChange={handleDialogOpenChange}>
      <DialogContent className="file-tree-workspace-dialog-content flex h-[min(92vh,900px)] w-[min(1280px,calc(100vw-24px))] max-w-none flex-col gap-0 overflow-hidden rounded-[4px] border border-border-light bg-white p-0 shadow-[rgba(44,30,116,0.16)_0px_0px_15px] [&>button]:hidden">
        {panelContent}
      </DialogContent>
      {closeWarning}
    </Dialog>
  );
}
