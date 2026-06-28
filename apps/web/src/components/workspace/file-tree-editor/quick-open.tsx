import { File } from "lucide-react";
import { useMemo, useState } from "react";
import { Command as CommandPrimitive } from "cmdk";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { CommandEmpty, CommandInput, CommandItem, CommandList } from "@/components/ui/command";

export interface QuickOpenFile {
  /** 绝对路径(打开用)。 */
  path: string;
  /** 文件名(展示主体)。 */
  label: string;
  /** 相对目录(展示副文本,根目录为空)。 */
  dir: string;
}

const MAX_RENDERED = 200;

/**
 * 快速打开文件(Cmd+P)—— 对已加载的文件树做模糊查找直接打开,免去逐层展开。
 * 性能:自管过滤(shouldFilter=false)+ 截断渲染 ≤200 项,避免大仓库一次性挂载上千 DOM 卡顿
 * (cmdk 默认会渲染全部候选)——这是「虚拟化」的懒版本,对资产仓库规模足够。
 */
export function QuickOpen({
  open,
  onOpenChange,
  files,
  onOpen,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  files: QuickOpenFile[];
  onOpen: (path: string) => void;
}) {
  const [query, setQuery] = useState("");
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matched = q ? files.filter((file) => `${file.label} ${file.dir}`.toLowerCase().includes(q)) : files;
    return { rows: matched.slice(0, MAX_RENDERED), truncated: matched.length > MAX_RENDERED, total: matched.length };
  }, [files, query]);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setQuery("");
        onOpenChange(next);
      }}
    >
      <DialogContent className="overflow-hidden p-0">
        <DialogTitle className="sr-only">快速打开文件</DialogTitle>
        <CommandPrimitive shouldFilter={false} className="flex h-full w-full flex-col overflow-hidden">
          <CommandInput placeholder="按文件名快速打开…" value={query} onValueChange={setQuery} />
          <CommandList>
            <CommandEmpty>无匹配文件</CommandEmpty>
            {shown.rows.map((file) => (
              <CommandItem
                key={file.path}
                value={file.path}
                onSelect={() => {
                  onOpenChange(false);
                  onOpen(file.path);
                }}
              >
                <File className="text-muted-foreground" />
                <span className="min-w-0 truncate text-foreground">{file.label}</span>
                {file.dir ? (
                  <span className="ml-auto min-w-0 truncate pl-3 text-xs text-muted-foreground">{file.dir}</span>
                ) : null}
              </CommandItem>
            ))}
            {shown.truncated ? (
              <div className="px-3 py-1.5 text-center text-xs text-muted-foreground">
                仅显示前 {MAX_RENDERED} 项(共 {shown.total}),继续输入以缩小范围
              </div>
            ) : null}
          </CommandList>
        </CommandPrimitive>
      </DialogContent>
    </Dialog>
  );
}
