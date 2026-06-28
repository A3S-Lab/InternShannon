import { Loader2, UploadCloud } from "lucide-react";
import { type ChangeEvent, type DragEvent, type ReactNode, useCallback, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { dispatchFileTreeEditorCommand } from "@/components/workspace/file-tree-editor/events";
import { importExternalSkillFiles, SUPPORTED_EXTERNAL_SKILL_ACCEPT } from "@/lib/skill-package-import";
import { cn } from "@/lib/utils";
import { type ExternalSkillImportStatus, formatExternalSkillImportError } from "./external-skill-import-state";

interface ExternalSkillImportContext {
  rootPath: string | null | undefined;
  commandScope: string;
  targetLabel: string;
  disabled?: boolean;
  disabledReason?: string;
  onImportStatusChange?: (status: ExternalSkillImportStatus) => void;
}

export interface ExternalSkillDropZoneProps extends ExternalSkillImportContext {
  children: ReactNode;
}

export interface ExternalSkillImportButtonProps extends ExternalSkillImportContext {
  className?: string;
}

function isExternalFileDrag(event: DragEvent<HTMLElement>): boolean {
  return Array.from(event.dataTransfer.types ?? []).includes("Files");
}

function rejectReason({ rootPath, disabled, disabledReason }: ExternalSkillImportContext): string | null {
  if (!rootPath) return "技能工作区路径不可用，无法导入";
  if (disabled) return disabledReason || "当前没有导入权限";
  return null;
}

async function importFilesWithFeedback(
  context: ExternalSkillImportContext,
  files: File[],
  setImporting: (value: boolean) => void,
) {
  if (files.length === 0) return;
  const reason = rejectReason(context);
  if (reason) {
    context.onImportStatusChange?.({ kind: "rejected", targetLabel: context.targetLabel, message: reason });
    toast.error(reason);
    return;
  }

  setImporting(true);
  context.onImportStatusChange?.({
    kind: "importing",
    targetLabel: context.targetLabel,
    pendingFileCount: files.length,
  });
  try {
    const targetRootPath = context.rootPath;
    if (!targetRootPath) return;
    const summary = await importExternalSkillFiles(targetRootPath, files);
    dispatchFileTreeEditorCommand("refresh", context.commandScope);
    context.onImportStatusChange?.({
      kind: "success",
      targetLabel: context.targetLabel,
      itemCount: summary.items.length,
      fileCount: summary.fileCount,
    });
    toast.success(`已导入 ${summary.items.length} 个技能，包含 ${summary.fileCount} 个文件`);
  } catch (error) {
    const message = formatExternalSkillImportError(error);
    context.onImportStatusChange?.({ kind: "error", targetLabel: context.targetLabel, message });
    toast.error(`导入失败: ${message}`);
  } finally {
    setImporting(false);
  }
}

export function ExternalSkillDropZone({
  rootPath,
  commandScope,
  targetLabel,
  disabled = false,
  disabledReason = "当前没有导入权限",
  onImportStatusChange,
  children,
}: ExternalSkillDropZoneProps) {
  const [dragging, setDragging] = useState(false);
  const [importing, setImporting] = useState(false);
  const dragDepthRef = useRef(0);
  const context = useMemo(
    () => ({ rootPath, commandScope, targetLabel, disabled, disabledReason, onImportStatusChange }),
    [commandScope, disabled, disabledReason, onImportStatusChange, rootPath, targetLabel],
  );

  const resetDragState = useCallback(() => {
    dragDepthRef.current = 0;
    setDragging(false);
  }, []);

  const importFiles = useCallback(
    async (files: File[]) => {
      await importFilesWithFeedback(context, files, setImporting);
    },
    [context],
  );

  const handleDragEnter = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      if (!isExternalFileDrag(event)) return;
      event.preventDefault();
      event.stopPropagation();
      event.dataTransfer.dropEffect = disabled ? "none" : "copy";
      dragDepthRef.current += 1;
      setDragging(true);
    },
    [disabled],
  );

  const handleDragOver = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      if (!isExternalFileDrag(event)) return;
      event.preventDefault();
      event.stopPropagation();
      event.dataTransfer.dropEffect = disabled ? "none" : "copy";
    },
    [disabled],
  );

  const handleDragLeave = useCallback((event: DragEvent<HTMLDivElement>) => {
    if (!isExternalFileDrag(event)) return;
    event.preventDefault();
    event.stopPropagation();
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) {
      setDragging(false);
    }
  }, []);

  const handleDrop = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      if (!isExternalFileDrag(event)) return;
      event.preventDefault();
      event.stopPropagation();
      resetDragState();
      void importFiles(Array.from(event.dataTransfer.files));
    },
    [importFiles, resetDragState],
  );

  const reason = rejectReason(context);

  return (
    <div
      className="relative h-full min-h-0"
      aria-busy={importing}
      aria-disabled={disabled || !rootPath}
      onDragEnterCapture={handleDragEnter}
      onDragOverCapture={handleDragOver}
      onDragLeaveCapture={handleDragLeave}
      onDropCapture={handleDrop}
    >
      {children}
      {dragging || importing ? (
        <div className="pointer-events-none absolute inset-2 z-30 flex items-center justify-center rounded-[4px] border border-dashed border-primary/40 bg-primary/[0.06] backdrop-blur-[2px]">
          <div className="rounded-[4px] border border-primary/15 bg-white px-4 py-3 text-center shadow-[var(--shadow-standard)]">
            {importing ? (
              <Loader2 className="mx-auto mb-2 size-6 animate-spin text-primary" />
            ) : (
              <UploadCloud className="mx-auto mb-2 size-7 text-primary" />
            )}
            <div className="text-sm font-medium text-foreground">
              {reason ? reason : importing ? "正在导入技能文件..." : `松开即可导入到${targetLabel}`}
            </div>
            <div className="mt-1 text-xs text-muted-foreground">
              {reason ? "共享技能由系统或管理员统一维护" : "支持 ZIP、Markdown 和文本技能文件"}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function ExternalSkillImportButton({
  rootPath,
  commandScope,
  targetLabel,
  disabled = false,
  disabledReason = "当前没有导入权限",
  onImportStatusChange,
  className,
}: ExternalSkillImportButtonProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [importing, setImporting] = useState(false);
  const context = useMemo(
    () => ({ rootPath, commandScope, targetLabel, disabled, disabledReason, onImportStatusChange }),
    [commandScope, disabled, disabledReason, onImportStatusChange, rootPath, targetLabel],
  );
  const reason = rejectReason(context);

  const handleClick = useCallback(() => {
    if (importing) return;
    if (reason) {
      onImportStatusChange?.({ kind: "rejected", targetLabel, message: reason });
      toast.error(reason);
      return;
    }
    inputRef.current?.click();
  }, [importing, onImportStatusChange, reason, targetLabel]);

  const handleFileChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(event.target.files ?? []);
      event.target.value = "";
      void importFilesWithFeedback(context, files, setImporting);
    },
    [context],
  );

  return (
    <>
      <Button
        type="button"
        size="sm"
        variant="outline"
        aria-disabled={!!reason || importing}
        title={reason || `导入到${targetLabel}`}
        onClick={handleClick}
        className={cn(
          "h-7 rounded-[4px] border-[#e5e7eb] bg-white px-2.5 text-xs",
          (reason || importing) && "opacity-70",
          className,
        )}
      >
        {importing ? <Loader2 className="size-3.5 animate-spin" /> : <UploadCloud className="size-3.5" />}
        导入外部技能
      </Button>
      <input
        ref={inputRef}
        type="file"
        multiple
        accept={SUPPORTED_EXTERNAL_SKILL_ACCEPT}
        className="hidden"
        onChange={handleFileChange}
      />
    </>
  );
}
