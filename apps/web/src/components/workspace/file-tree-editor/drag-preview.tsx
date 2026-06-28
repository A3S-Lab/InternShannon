/**
 * Drag preview component
 * Shows a visual preview of the dragged item
 */

import { File, Folder, Copy, ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";

interface DragPreviewProps {
  fileName: string;
  isDir: boolean;
  mode: "move" | "copy";
  count?: number;
}

export function DragPreview({
  fileName,
  isDir,
  mode,
  count = 1,
}: DragPreviewProps) {
  return (
    <div
      className="pointer-events-none fixed z-50 opacity-95"
      aria-hidden="true"
    >
      <div className="flex max-w-[280px] items-center gap-2 rounded-md border border-border bg-background px-3 py-2 shadow-lg">
        {isDir ? (
          <Folder className="size-4 shrink-0 text-sky-500" />
        ) : (
          <File className="size-4 shrink-0 text-muted-foreground" />
        )}
        <span className="min-w-0 truncate text-sm font-medium" title={fileName}>
          {fileName}
        </span>
        {count > 1 && (
          <span className="shrink-0 rounded bg-primary px-1.5 py-0.5 text-xs text-primary-foreground">
            {count}
          </span>
        )}
        {mode === "copy" && (
          <Copy className="size-3.5 shrink-0 text-blue-500" />
        )}
        {mode === "move" && (
          <ArrowRight className="size-3.5 shrink-0 text-green-500" />
        )}
      </div>
    </div>
  );
}

/**
 * Drop indicator component
 * Shows where the item will be dropped
 */

interface DropIndicatorProps {
  position: "before" | "after" | "inside";
  targetName: string;
}

export function DropIndicator({ position, targetName }: DropIndicatorProps) {
  if (position === "inside") {
    return (
      <div
        className="pointer-events-none absolute inset-0 rounded border-2 border-dashed border-primary bg-primary/10"
        data-drop-position={position}
        data-target-name={targetName}
        aria-hidden="true"
      />
    );
  }

  return (
    <div
      className={cn(
        "pointer-events-none absolute left-0 right-0 h-0.5 bg-primary",
        position === "before" ? "top-0" : "bottom-0"
      )}
      data-drop-position={position}
      data-target-name={targetName}
      aria-hidden="true"
    >
      <div className="absolute left-0 top-1/2 size-1.5 -translate-y-1/2 rounded-full bg-primary" />
      <div className="absolute right-0 top-1/2 size-1.5 -translate-y-1/2 rounded-full bg-primary" />
    </div>
  );
}
