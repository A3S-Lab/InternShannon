import type { LucideIcon } from "lucide-react";
import type React from "react";
import { cn } from "@/lib/utils";

interface AdminPageShellProps {
  title: string;
  description?: string;
  group?: string;
  icon?: LucideIcon;
  action?: React.ReactNode;
  navigation?: React.ReactNode;
  hideHeader?: boolean;
  showTitleWhenHidden?: boolean;
  headerClassName?: string;
  contentClassName?: string;
  children: React.ReactNode;
}

export function AdminPageShell({
  title,
  description,
  group,
  icon: Icon,
  action,
  navigation,
  hideHeader,
  showTitleWhenHidden,
  headerClassName,
  contentClassName,
  children,
}: AdminPageShellProps) {
  if (hideHeader) {
    const fallbackNavigation = showTitleWhenHidden ? (
      <div className="flex min-w-0 items-center gap-2 text-sm font-medium text-primary">
        {Icon && <Icon className="size-4 shrink-0" />}
        <span className="truncate">{title}</span>
      </div>
    ) : null;
    const headerNavigation = navigation ?? fallbackNavigation;

    return (
      <div className="flex h-full flex-col overflow-hidden bg-muted/20">
        {(headerNavigation || action) && (
          <div
            className={cn(
              "sticky top-0 z-20 flex shrink-0 flex-col gap-2 border-b border-border-light bg-background/95 px-3 py-2.5 shadow-[0_1px_2px_rgba(15,23,42,0.04)] backdrop-blur md:flex-row md:items-center md:justify-between md:px-4",
              headerClassName,
            )}
          >
            <div className="min-w-0">{headerNavigation}</div>
            {action}
          </div>
        )}
        <div className={cn("min-h-0 flex-1 overflow-auto p-3 md:p-4", contentClassName)}>{children}</div>
      </div>
    );
  }

  return (
    <div className={cn("h-full overflow-auto bg-muted/20 p-3 md:p-4", contentClassName)}>
      <div
        className={cn(
          "mb-4 flex flex-col gap-3 rounded-[8px] border border-border-light bg-background px-4 py-3 shadow-[0_1px_2px_rgba(15,23,42,0.04)] lg:flex-row lg:items-center lg:justify-between",
          headerClassName,
        )}
      >
        <div className="min-w-0">
          {navigation && <div className="mb-2">{navigation}</div>}
          <div className="flex min-w-0 items-center gap-2">
            {group && (
              <div className="flex shrink-0 items-center gap-1.5 rounded-[4px] border border-border-light bg-muted/35 px-2 py-1 text-[11px] font-medium text-muted-foreground">
                {Icon && <Icon className="size-3.5 text-primary" />}
                {group}
              </div>
            )}
            <h1 className="min-w-0 truncate text-lg font-semibold leading-6 text-foreground">{title}</h1>
          </div>
          {description && <p className="mt-1 max-w-3xl text-[13px] leading-5 text-muted-foreground">{description}</p>}
        </div>
        {action}
      </div>
      {children}
    </div>
  );
}
