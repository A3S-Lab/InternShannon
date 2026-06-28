import { useMemo } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { formatKeybinding, REFERENCE_SHORTCUTS, type WorkspaceCommand } from "./command-registry";

interface Row {
  title: string;
  group: string;
  keybinding: string;
}

/**
 * 快捷键速查表(?)—— 列出所有可发现的快捷键:可执行命令(带键位的) + 编辑器/文件树 reference。
 * 与命令面板共用同一份键位数据(formatKeybinding / REFERENCE_SHORTCUTS),不重复维护。
 */
export function ShortcutsCheatsheet({
  open,
  onOpenChange,
  commands,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  commands: WorkspaceCommand[];
}) {
  const groups = useMemo(() => {
    const rows: Row[] = [
      ...commands
        .filter((c) => c.keybinding && (!c.when || c.when()))
        .map((c) => ({ title: c.title, group: c.group, keybinding: c.keybinding as string })),
      ...REFERENCE_SHORTCUTS,
    ];
    const byGroup = new Map<string, Row[]>();
    for (const row of rows) {
      const bucket = byGroup.get(row.group);
      if (bucket) bucket.push(row);
      else byGroup.set(row.group, [row]);
    }
    return [...byGroup.entries()];
  }, [commands]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>键盘快捷键</DialogTitle>
        </DialogHeader>
        <div className="grid max-h-[60vh] grid-cols-1 gap-x-8 gap-y-4 overflow-y-auto sm:grid-cols-2">
          {groups.map(([group, rows]) => (
            <div key={group} className="min-w-0">
              <div className="mb-1.5 text-xs font-medium text-muted-foreground">{group}</div>
              <div className="flex flex-col gap-1">
                {rows.map((row) => (
                  <div key={`${group}:${row.title}`} className="flex items-center justify-between gap-3 text-[13px]">
                    <span className="min-w-0 truncate text-foreground">{row.title}</span>
                    <kbd className="shrink-0 rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
                      {formatKeybinding(row.keybinding)}
                    </kbd>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
