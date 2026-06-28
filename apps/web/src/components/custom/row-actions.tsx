import type { ReactNode } from "react";
import { MoreHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

/**
 * 表格行操作的统一标准（替代"全部塞进 ··· 下拉"）：
 * 常用操作以行内图标按钮直出（带 tooltip + 无障碍标签），其余进「···」溢出菜单。
 *
 * 用法：在数据表的 actions 列里
 *   cell: (row) => <RowActions actions={[
 *     { key: "edit", label: "编辑", icon: <Pencil className="size-4" />, onClick: () => edit(row) },
 *     { key: "delete", label: "删除", icon: <Trash2 className="size-4" />, onClick: () => del(row), destructive: true },
 *   ]} />
 *
 * - 前 `maxInline` 个（默认 3）非 overflow 的可见操作行内展示，多出的自动进溢出菜单。
 * - `overflow: true` 可把某个操作强制收进溢出菜单（即使数量没超 maxInline）。
 * - `hidden: true` 的操作不渲染；全部隐藏时整列返回 null。
 * - `destructive` 染红，破坏性操作仍应在 onClick 里自行二次确认。
 */
export interface RowAction {
  key: string;
  label: string;
  icon: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  hidden?: boolean;
  destructive?: boolean;
  /** 强制收进「···」溢出菜单，即使在 maxInline 之内。 */
  overflow?: boolean;
}

interface RowActionsProps {
  actions: RowAction[];
  /** 行内最多展示几个图标按钮，其余进溢出菜单。默认 3。 */
  maxInline?: number;
  className?: string;
}

export function RowActions({ actions, maxInline = 3, className }: RowActionsProps) {
  const visible = actions.filter((action) => !action.hidden);
  if (visible.length === 0) return null;

  const inlineCandidates = visible.filter((action) => !action.overflow);
  const inline = inlineCandidates.slice(0, maxInline);
  const overflow = [...inlineCandidates.slice(maxInline), ...visible.filter((action) => action.overflow)];

  return (
    <div className={cn("flex items-center justify-end gap-0.5", className)}>
      {inline.map((action) => (
        <Button
          key={action.key}
          type="button"
          variant="ghost"
          size="icon-sm"
          disabled={action.disabled}
          onClick={action.onClick}
          aria-label={action.label}
          title={action.label}
          className={cn(action.destructive && "text-red-600 hover:text-red-600 dark:text-red-400")}
        >
          {action.icon}
        </Button>
      ))}
      {overflow.length > 0 ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button type="button" variant="ghost" size="icon-sm" aria-label="更多操作">
              <MoreHorizontal className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {overflow.map((action) => (
              <DropdownMenuItem
                key={action.key}
                disabled={action.disabled}
                onClick={action.onClick}
                className={cn(action.destructive && "text-red-600 focus:text-red-600 dark:text-red-400")}
              >
                {action.icon}
                {action.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </div>
  );
}
