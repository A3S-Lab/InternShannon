/**
 * ExternalChangeDialog - Conflict resolution when file is modified externally
 */
import {
  AlertTriangle,
  FileDown,
  FileSearch,
  GitMerge,
  Save,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface ExternalChangeDialogProps {
  open: boolean;
  filePath: string | null;
  onReload: () => void;
  onKeepLocal: () => void;
  onMerge: () => void;
  onClose: () => void;
}

export function ExternalChangeDialog({
  open,
  filePath,
  onReload,
  onKeepLocal,
  onMerge,
  onClose,
}: ExternalChangeDialogProps) {
  const actionClassName =
    "group flex w-full items-start gap-3 rounded-[6px] border border-border bg-white p-3 text-left transition-colors hover:border-primary/35 hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/35";
  const iconClassName =
    "mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-[5px] border border-border bg-muted/45 text-muted-foreground transition-colors group-hover:border-primary/25 group-hover:text-primary";

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="size-4 text-amber-600" />
            文件已在外部修改
          </DialogTitle>
          <DialogDescription>
            当前文件在磁盘上发生变化，同时编辑器里还有未保存内容。
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-1">
          <div className="flex items-center gap-2 rounded-[6px] border border-border bg-muted/25 px-3 py-2">
            <FileSearch className="size-3.5 shrink-0 text-muted-foreground" />
            <span
              className="min-w-0 truncate font-mono text-xs"
              title={filePath ?? ""}
            >
              {filePath}
            </span>
          </div>
          <div className="grid gap-2">
            <button type="button" className={actionClassName} onClick={onMerge}>
              <span className={iconClassName}>
                <GitMerge className="size-4" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium text-foreground">
                  先对比更改
                </span>
                <span className="mt-0.5 block text-xs leading-5 text-muted-foreground">
                  并排查看外部版本和本地未保存版本，再决定保留哪一份。
                </span>
              </span>
            </button>
            <button
              type="button"
              className={actionClassName}
              onClick={onReload}
            >
              <span className={iconClassName}>
                <FileDown className="size-4" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium text-foreground">
                  使用外部版本
                </span>
                <span className="mt-0.5 block text-xs leading-5 text-muted-foreground">
                  放弃编辑器里的未保存内容，并重新加载磁盘上的文件。
                </span>
              </span>
            </button>
            <button
              type="button"
              className={actionClassName}
              onClick={onKeepLocal}
            >
              <span className={iconClassName}>
                <Save className="size-4" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium text-foreground">
                  覆盖为本地版本
                </span>
                <span className="mt-0.5 block text-xs leading-5 text-muted-foreground">
                  把当前未保存内容写回磁盘，覆盖外部修改后的文件。
                </span>
              </span>
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default ExternalChangeDialog;
