import type { ReactNode } from "react";
import { ChevronDown, ChevronUp, type LucideIcon } from "lucide-react";

import { Button, cn } from "../../ui";

export function ProviderSettingsSection({
  title,
  description,
  extra,
  children,
  className,
  contentClassName,
  density = "default",
}: {
  title: string;
  description?: ReactNode;
  extra?: ReactNode;
  children: ReactNode;
  className?: string;
  contentClassName?: string;
  density?: "default" | "compact";
}) {
  const compact = density === "compact";

  return (
    <section className={cn("rounded-md border border-border-light bg-background", className)}>
      <div
        className={cn(
          "flex items-center justify-between gap-3 border-b border-border-light",
          compact ? "min-h-9 px-3 py-1.5" : "min-h-10 px-4 py-2",
        )}
      >
        <div className="min-w-0">
          <div className="text-sm font-semibold text-foreground">{title}</div>
          {description ? (
            <div className={cn("mt-0.5 text-xs text-muted-foreground", compact ? "leading-4" : "leading-5")}>
              {description}
            </div>
          ) : null}
        </div>
        {extra}
      </div>
      <div className={cn(compact ? "p-2" : "p-3", contentClassName)}>{children}</div>
    </section>
  );
}

export function ProviderSettingsToolbar({
  title,
  description,
  actions,
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="min-w-0">
        <div className="text-sm font-semibold text-foreground">{title}</div>
        {description ? <div className="mt-0.5 text-xs leading-5 text-muted-foreground">{description}</div> : null}
      </div>
      {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function ProviderTag({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex h-6 items-center rounded border border-border bg-[#fafafa] px-2 font-mono text-[11px] font-medium text-foreground">
      {children}
    </span>
  );
}

export function ProviderStatusPill({ configured }: { configured: boolean }) {
  return (
    <span
      className={cn(
        "inline-flex h-6 items-center rounded border px-2 text-[11px] font-medium",
        configured
          ? "border-emerald-200 bg-emerald-50 text-emerald-700"
          : "border-border bg-[#fafafa] text-muted-foreground",
      )}
    >
      {configured ? "已配置" : "未配置"}
    </span>
  );
}

export function ProviderDefaultPill() {
  return (
    <span className="inline-flex h-6 items-center rounded border border-sky-200 bg-sky-50 px-2 text-[11px] font-medium text-sky-700">
      默认
    </span>
  );
}

export function ProviderEmptyState({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon: LucideIcon;
  title: string;
  description: ReactNode;
  action: ReactNode;
}) {
  return (
    <div className="rounded-md border border-dashed border-[#dfe3e8] bg-[#fbfcfd] px-4 py-5 text-center">
      <div className="mx-auto mb-2.5 flex size-8 items-center justify-center rounded-md bg-white text-foreground ring-1 ring-border">
        <Icon className="size-4" />
      </div>
      <div className="text-sm font-medium text-foreground">{title}</div>
      <div className="mt-1 text-sm text-muted-foreground">{description}</div>
      <div className="mt-4">{action}</div>
    </div>
  );
}

export function ProviderDisclosure({
  title,
  description,
  configured,
  expanded,
  onToggle,
  children,
}: {
  title: string;
  description?: ReactNode;
  configured?: boolean;
  expanded: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <div className="rounded-md border border-border-light bg-white">
      <button
        type="button"
        className="flex min-h-10 w-full items-center justify-between gap-3 px-4 py-2.5 text-left"
        onClick={onToggle}
      >
        <div className="min-w-0">
          <div className="text-sm font-semibold text-foreground">{title}</div>
          {description ? <div className="mt-0.5 text-xs leading-5 text-muted-foreground">{description}</div> : null}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {typeof configured === "boolean" ? <ProviderStatusPill configured={configured} /> : null}
          {expanded ? (
            <ChevronUp className="size-4 text-muted-foreground" />
          ) : (
            <ChevronDown className="size-4 text-muted-foreground" />
          )}
        </div>
      </button>
      {expanded ? <div className="border-t border-border-light px-4 py-3">{children}</div> : null}
    </div>
  );
}

export function ProviderModelListShell({
  title,
  description,
  children,
}: {
  title: string;
  description?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="rounded-md border border-border-light bg-white">
      <div className="flex min-h-10 items-center justify-between gap-3 border-b border-border-light bg-[#fbfcfd] px-4 py-2.5">
        <div className="text-sm font-semibold text-foreground">{title}</div>
        {description ? <div className="text-xs text-muted-foreground">{description}</div> : null}
      </div>
      <div className="divide-y divide-[#f2f3f5]">{children}</div>
    </div>
  );
}

export function ProviderIconButton({
  label,
  children,
  className,
  onClick,
}: {
  label: string;
  children: ReactNode;
  className?: string;
  onClick: () => void;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className={cn("h-8 px-2", className)}
      onClick={onClick}
      aria-label={label}
    >
      {children}
    </Button>
  );
}
