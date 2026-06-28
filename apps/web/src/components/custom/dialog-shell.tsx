import type { ReactNode } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

export interface DialogShellProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  /** 传入时头部用「图标徽标 + 标题/描述」横排布局;不传则标题/描述竖排。 */
  icon?: ReactNode;
  maxWidth?: string;
  contentClassName?: string;
  headerClassName?: string;
  bodyClassName?: string;
  footer?: ReactNode;
  footerClassName?: string;
  children: ReactNode;
}

/**
 * 共享对话框外壳 —— 收口此前 IamDialogShell 与 ResourceDialogShell 近乎逐字同构的结构
 * (同 max-h-[88vh]/flex-col/p-0 容器、同 border-b 头部、同滚动 body、同 border-t 底栏)。
 * 唯一差异(资源版的图标徽标头部)用可选 icon 覆盖;body/footer 的细节差异(space-y、bg)
 * 由各 wrapper 通过 bodyClassName/footerClassName 传入。两个 wrapper 保留为薄封装,既有
 * 调用点 import 不变。
 */
export function DialogShell({
  open,
  onOpenChange,
  title,
  description,
  icon,
  maxWidth = "sm:max-w-[680px]",
  contentClassName,
  headerClassName,
  bodyClassName,
  footer,
  footerClassName,
  children,
}: DialogShellProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={cn("flex max-h-[88vh] flex-col gap-0 overflow-hidden p-0", maxWidth, contentClassName)}>
        <DialogHeader className={cn("shrink-0 border-b border-border-light px-4 pb-3 pt-4 pr-10", headerClassName)}>
          {icon ? (
            <div className="flex items-center gap-2.5">
              <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted/50 ring-1 ring-border">
                {icon}
              </div>
              <div className="min-w-0">
                <DialogTitle className="truncate text-base font-semibold">{title}</DialogTitle>
                {description ? (
                  <DialogDescription className="mt-0.5 text-xs leading-5 text-muted-foreground">
                    {description}
                  </DialogDescription>
                ) : null}
              </div>
            </div>
          ) : (
            <>
              <DialogTitle className="text-base font-semibold">{title}</DialogTitle>
              {description ? (
                <DialogDescription className="mt-1 text-xs leading-5 text-muted-foreground">
                  {description}
                </DialogDescription>
              ) : null}
            </>
          )}
        </DialogHeader>
        <div className={cn("min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-3", bodyClassName)}>{children}</div>
        {footer ? (
          <div className={cn("shrink-0 border-t border-border-light px-4 py-3", footerClassName)}>{footer}</div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
