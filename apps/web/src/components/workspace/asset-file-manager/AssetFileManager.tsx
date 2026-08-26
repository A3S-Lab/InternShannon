import { FileTreeEditor, type FileTreeEditorProps } from "@/components/workspace/file-tree-editor/FileTreeEditor";
import { cn } from "@/lib/utils";

export type AssetFileManagerProps = Pick<
  FileTreeEditorProps,
  | "rootPath"
  | "assetId"
  | "extraCommands"
  | "newFileTemplate"
  | "treeDepth"
  | "autoExpandDepth"
  | "headerSlot"
  | "afterSearchSlot"
  | "extraSidebarPane"
  | "debugSidebarPane"
  | "overviewSidebarPane"
  | "customSidebarPanes"
  | "defaultSidebarPanel"
  | "sidebarPanelRequest"
  | "readOnly"
  | "staticFiles"
  | "enableLocalSnapshots"
  | "enableRichMarkdown"
  | "manualSaveOnly"
  | "showStatusBar"
  | "onStateChange"
  | "onAfterSave"
  | "commandScope"
  | "openFileRequest"
  | "nativeRevealPaths"
  | "persistSession"
  | "className"
>;

export function AssetFileManager({
  className,
  enableLocalSnapshots = true,
  enableRichMarkdown = true,
  treeDepth = 8,
  autoExpandDepth,
  ...props
}: AssetFileManagerProps) {
  return (
    <FileTreeEditor
      {...props}
      className={cn("shuan-design-file-manager h-full w-full", className)}
      variant="vscode"
      treeDepth={treeDepth}
      autoExpandDepth={autoExpandDepth}
      sidebarDefaultSize={25}
      sidebarMinSize={15}
      sidebarMaxSize={50}
      enableLocalSnapshots={enableLocalSnapshots}
      enableRichMarkdown={enableRichMarkdown}
    />
  );
}
