import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * 标准空态占位组件。配合 DataTable.empty / 列表区域使用。
 * 强制 icon 提升可识别度；text 是主信息，description 可选用于补充指引。
 */
export function EmptyState({
  icon: Icon,
  text,
  description,
  action,
  className,
}: {
  icon: LucideIcon;
  text: string;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex min-h-40 flex-col items-center justify-center gap-2.5 px-4 py-8 text-center text-muted-foreground",
        className,
      )}
    >
      <div className="flex size-9 items-center justify-center rounded-[8px] border border-border-light bg-muted/40">
        <Icon className="size-[18px]" />
      </div>
      <span className="text-sm font-medium text-foreground">{text}</span>
      {description ? <span className="max-w-sm text-xs leading-5 text-muted-foreground">{description}</span> : null}
      {action ? <div className="mt-1">{action}</div> : null}
    </div>
  );
}
