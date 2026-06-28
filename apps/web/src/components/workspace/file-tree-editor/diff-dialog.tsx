/**
 * DiffDialog - Displays file diff content
 */
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { DiffEditorPanel } from "@/desktop/components/diff-editor";

interface DiffDialogProps {
  open: boolean;
  diff: {
    path: string;
    originalContent: string;
    modifiedContent: string;
    staged: boolean;
    language?: string;
    originalLabel?: string;
    modifiedLabel?: string;
    description?: string;
  } | null;
  onClose: () => void;
}

export function DiffDialog({ open, diff, onClose }: DiffDialogProps) {
  const originalLines = diff?.originalContent.split("\n").length ?? 0;
  const modifiedLines = diff?.modifiedContent.split("\n").length ?? 0;
  const language = diff?.language ?? "plaintext";
  const originalLabel = diff?.originalLabel ?? "原始版本";
  const modifiedLabel = diff?.modifiedLabel ?? "当前版本";

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent className="flex max-h-[84vh] max-w-6xl flex-col">
        <DialogHeader>
          <DialogTitle className="min-w-0 truncate">
            {diff?.staged ? "已暂存的更改" : "工作区更改"}
          </DialogTitle>
          <DialogDescription
            className="min-w-0 truncate font-mono text-xs"
            title={diff?.path}
          >
            {diff?.description ?? diff?.path}
          </DialogDescription>
        </DialogHeader>
        <div className="flex min-h-[520px] flex-1 flex-col overflow-hidden rounded-md border border-border/60">
          <div className="grid h-9 grid-cols-2 border-b border-border/60 bg-muted/40 text-xs">
            <div className="flex items-center justify-between border-r border-border/60 px-3">
              <span className="min-w-0 truncate">{originalLabel}</span>
              <span className="text-muted-foreground">{originalLines} 行</span>
            </div>
            <div className="flex items-center justify-between px-3">
              <span className="min-w-0 truncate">{modifiedLabel}</span>
              <span className="text-muted-foreground">{modifiedLines} 行</span>
            </div>
          </div>
          <div className="min-h-0 flex-1">
            {diff ? (
              <DiffEditorPanel
                originalContent={diff.originalContent}
                modifiedContent={diff.modifiedContent}
                originalLanguage={language}
                modifiedLanguage={language}
                readOnly
              />
            ) : null}
          </div>
        </div>
        <DialogFooter>
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 text-sm rounded-md border hover:bg-muted transition-colors"
          >
            关闭
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default DiffDialog;
