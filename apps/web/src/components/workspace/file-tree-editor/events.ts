export type FileTreeEditorCommand =
  | "refresh"
  | "save-all"
  | "open-root"
  | "open-file"
  | "focus-explorer"
  | "search"
  | "new-file"
  | "new-folder"
  | "reveal-active";

export const FILE_TREE_EDITOR_COMMAND_EVENT = "internshannon:file-tree-editor-command";
export const FILE_EDITOR_SAVE_ALL_EVENT = "internshannon:file-editor-save-all";

export interface FileTreeEditorCommandDetail {
  command: FileTreeEditorCommand;
  scope?: string;
  path?: string;
}

export interface FileEditorSaveAllDetail {
  scope?: string;
}

export function dispatchFileTreeEditorCommand(command: FileTreeEditorCommand, scope?: string, path?: string): void {
  document.dispatchEvent(
    new CustomEvent(FILE_TREE_EDITOR_COMMAND_EVENT, {
      detail: { command, scope, path },
    }),
  );
}

export function dispatchFileEditorSaveAll(scope?: string): void {
  document.dispatchEvent(
    new CustomEvent(FILE_EDITOR_SAVE_ALL_EVENT, {
      detail: { scope },
    }),
  );
}
