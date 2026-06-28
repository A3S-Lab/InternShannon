/**
 * FileHistoryDialog - Displays local file snapshots.
 */
import { useMemo, useState } from "react";
import {
  Eye,
  GitCompare,
  History,
  Pencil,
  Plus,
  RotateCcw,
  Search,
  Trash2,
  X,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { DiffEditorPanel } from "@/desktop/components/diff-editor";

export interface LocalFileSnapshot {
  id: string;
  date: string;
  label: string;
  size: number;
  snapshotPath: string;
}

interface FileHistoryDialogProps {
  open: boolean;
  filePath: string | null;
  snapshots: LocalFileSnapshot[];
  onCreateSnapshot: () => void;
  onPreviewSnapshot: (snapshot: LocalFileSnapshot) => void;
  onCompareSnapshot: (snapshot: LocalFileSnapshot) => void;
  onRenameSnapshot: (snapshot: LocalFileSnapshot) => void;
  onDeleteSnapshot: (snapshot: LocalFileSnapshot) => void;
  onRestoreSnapshot: (snapshot: LocalFileSnapshot) => void;
  onClose: () => void;
}

function getSnapshotLanguage(filePath: string | null) {
  const ext = filePath?.split(".").pop()?.toLowerCase() ?? "";
  const map: Record<string, string> = {
    css: "css",
    go: "go",
    html: "html",
    java: "java",
    js: "javascript",
    json: "json",
    jsx: "javascript",
    md: "markdown",
    mdx: "markdown",
    py: "python",
    rs: "rust",
    sql: "sql",
    ts: "typescript",
    tsx: "typescript",
    txt: "plaintext",
    xml: "xml",
    yaml: "yaml",
    yml: "yaml",
  };
  return map[ext] ?? "plaintext";
}

function formatSnapshotDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function formatSnapshotSize(size: number) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.max(1, Math.round(size / 1024))} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

export function FileHistoryDialog({
  open,
  filePath,
  snapshots,
  onCreateSnapshot,
  onPreviewSnapshot,
  onCompareSnapshot,
  onRenameSnapshot,
  onDeleteSnapshot,
  onRestoreSnapshot,
  onClose,
}: FileHistoryDialogProps) {
  const [query, setQuery] = useState("");
  const fileName = filePath?.split("/").pop() || "未选择文件";
  const filteredSnapshots = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return snapshots;
    return snapshots.filter((snapshot) => {
      return (
        snapshot.id.toLowerCase().includes(normalized) ||
        snapshot.label.toLowerCase().includes(normalized) ||
        formatSnapshotDate(snapshot.date).toLowerCase().includes(normalized)
      );
    });
  }, [query, snapshots]);
  const hasQuery = query.trim().length > 0;

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent className="flex max-h-[78vh] max-w-3xl flex-col gap-3">
        <DialogHeader className="pr-8">
          <div className="flex flex-wrap items-start gap-3">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-[8px] border border-border/70 bg-muted/40 text-muted-foreground">
              <History className="size-4" aria-hidden="true" />
            </div>
            <div className="min-w-0 flex-1">
              <DialogTitle className="truncate text-base">
                {fileName}
              </DialogTitle>
              <DialogDescription className="truncate">
                {filePath || "本地文件快照"}
              </DialogDescription>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <span className="rounded-[6px] border border-border/70 bg-muted/35 px-2 py-1 text-xs text-muted-foreground">
                {snapshots.length} 个快照
              </span>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={onCreateSnapshot}
              >
                <Plus className="size-3.5" aria-hidden="true" />
                创建快照
              </Button>
            </div>
          </div>
        </DialogHeader>
        <div className="relative">
          <Search
            className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <input
            type="search"
            aria-label="搜索快照"
            autoComplete="off"
            spellCheck={false}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索快照备注、时间或编号"
            className="h-8 w-full rounded-[7px] border border-border/70 bg-background pl-8 pr-9 text-sm outline-none transition-colors focus:border-primary/50 focus:ring-1 focus:ring-primary/20"
          />
          {hasQuery && (
            <button
              type="button"
              aria-label="清除快照搜索"
              className="absolute right-1.5 top-1/2 inline-flex size-5 -translate-y-1/2 items-center justify-center rounded-[5px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/40"
              onClick={() => setQuery("")}
            >
              <X className="size-3" aria-hidden="true" />
            </button>
          )}
        </div>
        <div className="min-h-0 flex-1 space-y-2 overflow-y-auto pr-1">
          {filteredSnapshots.length === 0 ? (
            <div className="flex min-h-[180px] flex-col items-center justify-center rounded-[8px] border border-dashed border-border/70 px-4 py-8 text-center">
              <History
                className="mb-2 size-7 text-muted-foreground/55"
                aria-hidden="true"
              />
              <div className="text-sm font-medium text-foreground">
                {snapshots.length === 0 ? "暂无本地快照" : "没有匹配的快照"}
              </div>
              {snapshots.length === 0 ? (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="mt-3"
                  onClick={onCreateSnapshot}
                >
                  <Plus className="size-3.5" aria-hidden="true" />
                  创建快照
                </Button>
              ) : (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="mt-2"
                  onClick={() => setQuery("")}
                >
                  <X className="size-3.5" aria-hidden="true" />
                  清除搜索
                </Button>
              )}
            </div>
          ) : (
            filteredSnapshots.map((snapshot) => (
              <article
                key={snapshot.id}
                className="flex items-center gap-3 rounded-[8px] border border-border/60 bg-background p-3 transition-colors hover:border-border hover:bg-muted/25"
              >
                <div className="min-w-0 flex-1">
                  <div className="mb-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="rounded-[5px] bg-primary/10 px-1.5 py-0.5 font-mono text-[11px] text-primary">
                      {snapshot.id.slice(0, 8)}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {formatSnapshotDate(snapshot.date)}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {formatSnapshotSize(snapshot.size)}
                    </span>
                  </div>
                  <div className="truncate text-sm font-medium">
                    {snapshot.label}
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`查看快照 ${snapshot.label}`}
                    onClick={() => onPreviewSnapshot(snapshot)}
                    title="查看快照"
                  >
                    <Eye className="size-3.5" aria-hidden="true" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`对比快照 ${snapshot.label}`}
                    onClick={() => onCompareSnapshot(snapshot)}
                    title="与当前文件对比"
                  >
                    <GitCompare className="size-3.5" aria-hidden="true" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`修改快照备注 ${snapshot.label}`}
                    onClick={() => onRenameSnapshot(snapshot)}
                    title="修改备注"
                  >
                    <Pencil className="size-3.5" aria-hidden="true" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`恢复快照 ${snapshot.label}`}
                    onClick={() => onRestoreSnapshot(snapshot)}
                    title="恢复到此快照"
                  >
                    <RotateCcw className="size-3.5" aria-hidden="true" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`删除快照 ${snapshot.label}`}
                    onClick={() => onDeleteSnapshot(snapshot)}
                    className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                    title="删除快照"
                  >
                    <Trash2 className="size-3.5" aria-hidden="true" />
                  </Button>
                </div>
              </article>
            ))
          )}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            关闭
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function FileSnapshotCompareDialog({
  open,
  filePath,
  snapshot,
  snapshotContent,
  currentContent,
  onRestore,
  onClose,
}: {
  open: boolean;
  filePath: string | null;
  snapshot: LocalFileSnapshot | null;
  snapshotContent: string;
  currentContent: string;
  onRestore: () => void;
  onClose: () => void;
}) {
  const formattedDate = snapshot ? formatSnapshotDate(snapshot.date) : "";
  const snapshotLines = snapshotContent.split("\n").length;
  const currentLines = currentContent.split("\n").length;
  const language = getSnapshotLanguage(filePath);

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent className="flex max-h-[84vh] max-w-6xl flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <GitCompare className="size-4" aria-hidden="true" />
            <span className="truncate text-sm">
              {filePath?.split("/").pop()} 本地历史对比
            </span>
          </DialogTitle>
          <DialogDescription className="truncate">
            {formattedDate} · {snapshot?.label}
          </DialogDescription>
        </DialogHeader>
        <div className="flex min-h-[520px] flex-1 flex-col overflow-hidden rounded-md border border-border/60">
          <div className="grid h-9 grid-cols-2 border-b border-border/60 bg-muted/40 text-xs">
            <div className="flex items-center justify-between border-r border-border/60 px-3">
              <span>快照版本</span>
              <span className="text-muted-foreground">{snapshotLines} 行</span>
            </div>
            <div className="flex items-center justify-between px-3">
              <span>当前文件</span>
              <span className="text-muted-foreground">{currentLines} 行</span>
            </div>
          </div>
          <div className="min-h-0 flex-1">
            <DiffEditorPanel
              originalContent={snapshotContent}
              modifiedContent={currentContent}
              originalLanguage={language}
              modifiedLanguage={language}
              readOnly
            />
          </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            关闭
          </Button>
          <Button type="button" variant="primary" onClick={onRestore}>
            <RotateCcw className="size-3.5" aria-hidden="true" />
            恢复快照版本
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function FileSnapshotPreviewDialog({
  open,
  filePath,
  snapshot,
  content,
  onRestore,
  onClose,
}: {
  open: boolean;
  filePath: string | null;
  snapshot: LocalFileSnapshot | null;
  content: string;
  onRestore: () => void;
  onClose: () => void;
}) {
  const formattedDate = snapshot ? formatSnapshotDate(snapshot.date) : "";

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent className="flex max-h-[80vh] max-w-4xl flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <History className="size-4" aria-hidden="true" />
            <span className="truncate text-sm">
              {filePath?.split("/").pop()} 快照
            </span>
          </DialogTitle>
          <DialogDescription className="truncate">
            {formattedDate} · {snapshot?.label}
          </DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-auto rounded-md border border-border/60 bg-muted/30">
          <pre className="p-4 text-xs leading-5 whitespace-pre-wrap">
            {content || "(空文件)"}
          </pre>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            关闭
          </Button>
          <Button type="button" variant="primary" onClick={onRestore}>
            <RotateCcw className="size-3.5" aria-hidden="true" />
            恢复此快照
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default FileHistoryDialog;
