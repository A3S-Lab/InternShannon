/**
 * Shared page layout components — reusable sidebar + section switching pattern.
 * Used by Settings, Security, and any future sidebar-based pages.
 */

import type { LucideIcon } from "lucide-react";
import { ChevronRight, ShieldCheck } from "lucide-react";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { cn } from "@/lib/utils";
import { sidebarSectionListClassName } from "./sidebar-layout-state";

// =============================================================================
// Types
// =============================================================================

export interface SidebarSection<T extends string = string> {
  id: T;
  label: string;
  icon: LucideIcon;
  description: string;
}

export interface SidebarLayoutProps<T extends string> {
  /** Page title shown in sidebar header */
  title: string;
  /** Subtitle shown below title */
  subtitle: string;
  /** Optional custom sidebar header content */
  headerSlot?: React.ReactNode;
  /** Navigation sections */
  sections: SidebarSection<T>[];
  /** Currently active section */
  current: T;
  /** Section change callback */
  onChange: (id: T) => void;
  /** Optional badge renderer per section (e.g. alert count) */
  badge?: (id: T) => React.ReactNode;
  /** Footer text (default: version string) */
  footer?: string;
  /** Hide sidebar footer */
  hideFooter?: boolean;
  /** Main content max-width class (default: "max-w-3xl") */
  contentMaxWidth?: string;
  /** Main content container class override */
  contentClassName?: string;
  /** Hide sidebar header (title and subtitle) */
  hideHeader?: boolean;
  /** Show sidebar right border */
  sidebarBorder?: boolean;
  /** Allow dragging sidebar width */
  sidebarResizable?: boolean;
  sidebarDefaultSize?: number;
  sidebarMinSize?: number;
  sidebarMaxSize?: number;
  /** Remove padding and make content fill full height (for full-screen components like FileTreeEditor) */
  noPadding?: boolean;
  /** Control content area overflow behavior (default: auto - allows scrolling) */
  contentOverflow?: "auto" | "hidden";
  /** Section content renderer */
  children: React.ReactNode;
}

// =============================================================================
// SidebarLayout — generic sidebar + content page
// =============================================================================

export function SidebarLayout<T extends string>({
  title,
  subtitle,
  headerSlot,
  sections,
  current,
  onChange,
  badge,
  footer = "InternShannon · a3s-code v0.9.0",
  hideFooter = false,
  contentMaxWidth = "max-w-3xl",
  contentClassName,
  hideHeader = false,
  sidebarBorder = true,
  sidebarResizable = false,
  sidebarDefaultSize = 18,
  sidebarMinSize = 12,
  sidebarMaxSize = 28,
  noPadding = false,
  contentOverflow = "auto",
  children,
}: SidebarLayoutProps<T>) {
  const sidebarContent = (
    <nav
      aria-label={`${title} sections`}
      className={cn(
        "min-w-0 flex flex-col bg-[var(--col-bg13)]",
        "h-auto w-full shrink-0 md:h-full",
        sidebarResizable ? "" : "md:w-56",
        sidebarBorder && "border-b border-[var(--col-border)] md:border-b-0 md:border-r",
      )}
    >
      {headerSlot ? (
        <div className="border-b border-[var(--col-border)]/60">{headerSlot}</div>
      ) : !hideHeader ? (
        <div className="px-4 pt-4 pb-3">
          <h1 className="text-sm font-semibold text-[var(--col-text01)] font-['Outfit',sans-serif]">{title}</h1>
          <p className="text-xs text-[var(--col-text04)] mt-0.5 font-['DM_Sans',sans-serif]">{subtitle}</p>
        </div>
      ) : null}
      <div className={sidebarSectionListClassName()}>
        {sections.map((s) => {
          const active = current === s.id;
          return (
            <button
              type="button"
              key={s.id}
              onClick={() => onChange(s.id)}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex w-auto shrink-0 items-center gap-2 whitespace-nowrap text-left px-2 py-1.5 rounded-md text-sm transition-all group font-['DM_Sans',sans-serif] md:w-full",
                active
                  ? "bg-primary text-white shadow-[var(--shadow-standard)]"
                  : "text-[var(--col-text04)] hover:text-[var(--col-text01)] hover:bg-[var(--col-bg14)]",
              )}
            >
              <div
                className={cn(
                  "flex items-center justify-center size-5 rounded-md shrink-0",
                  active ? "bg-white/20" : "bg-[var(--col-bg14)] group-hover:bg-[var(--col-border)]",
                )}
              >
                <s.icon
                  className={cn(
                    "size-3.5",
                    active ? "text-white" : "text-[var(--col-text04)] group-hover:text-[var(--col-text01)]",
                  )}
                />
              </div>
              <div className="min-w-0 md:flex-1">
                <div className="font-medium text-[13px] leading-tight">{s.label}</div>
              </div>
              {badge?.(s.id)}
              <ChevronRight
                className={cn(
                  "hidden size-3.5 shrink-0 transition-opacity md:block",
                  active ? "opacity-80" : "opacity-0 group-hover:opacity-50 text-[var(--col-text04)]",
                )}
              />
            </button>
          );
        })}
      </div>
      {!hideFooter ? (
        <div className="hidden px-4 py-3 border-t border-[var(--col-border)]/50 md:block">
          <div className="flex items-center gap-2 text-[10px] text-[var(--col-text05)]">
            <ShieldCheck className="size-3 text-primary" />
            <span className="font-['DM_Sans',sans-serif]">{footer}</span>
          </div>
        </div>
      ) : null}
    </nav>
  );

  const mainContent = (
    <main className="min-h-0 min-w-0 flex-1 overflow-hidden flex flex-col">
      <div className={cn("flex-1", contentOverflow === "hidden" ? "overflow-hidden" : "overflow-y-auto")}>
        {noPadding ? (
          <div className="h-full w-full">{children}</div>
        ) : (
          <div className={cn(contentMaxWidth, "mx-auto px-4 py-4", contentClassName)}>
            {children}
            <div className="h-5" />
          </div>
        )}
      </div>
    </main>
  );

  if (sidebarResizable) {
    return (
      <ResizablePanelGroup direction="horizontal" className="h-full w-full">
        <ResizablePanel
          defaultSize={sidebarDefaultSize}
          minSize={sidebarMinSize}
          maxSize={sidebarMaxSize}
          className="min-w-0 h-full"
        >
          {sidebarContent}
        </ResizablePanel>
        <ResizableHandle />
        <ResizablePanel defaultSize={100 - sidebarDefaultSize} minSize={50} className="min-w-0 h-full">
          {mainContent}
        </ResizablePanel>
      </ResizablePanelGroup>
    );
  }

  return (
    <div className="flex h-full w-full flex-col overflow-hidden md:flex-row">
      {sidebarContent}
      {mainContent}
    </div>
  );
}

// =============================================================================
// SectionHeader — shared section title with icon
// =============================================================================

export function SectionHeader({
  title,
  description,
  icon: Icon,
}: {
  title: string;
  description: string;
  icon: LucideIcon;
}) {
  return (
    <div className="flex items-start gap-2.5 mb-5">
      <div className="flex items-center justify-center size-8 rounded-[8px] bg-primary/10 shrink-0 mt-0.5">
        <Icon className="size-4 text-primary" />
      </div>
      <div>
        <h2 className="text-base font-semibold text-[var(--col-text01)] font-['Outfit',sans-serif]">{title}</h2>
        <p className="text-[13px] text-[var(--col-text04)] mt-0.5 font-['DM_Sans',sans-serif]">{description}</p>
      </div>
    </div>
  );
}

// =============================================================================
// StatCard — metric display card (used in security overview, diagnostics, etc.)
// =============================================================================

export function StatCard({
  icon: Icon,
  label,
  value,
  sub,
  color,
}: {
  icon: LucideIcon;
  label: string;
  value: string | number;
  sub?: string;
  color?: string;
}) {
  return (
    <div className="rounded-[8px] border border-[var(--col-border)] bg-[var(--col-bg13)] p-4 shadow-[var(--shadow-standard)]">
      <div className="flex items-center gap-2 mb-2">
        <Icon className={cn("size-4", color || "text-primary")} />
        <span className="text-xs text-[var(--col-text04)] font-['DM_Sans',sans-serif]">{label}</span>
      </div>
      <p className="text-xl font-semibold tabular-nums text-[var(--col-text01)] font-['Outfit',sans-serif]">{value}</p>
      {sub && <p className="text-[11px] text-[var(--col-text04)] mt-0.5 font-['DM_Sans',sans-serif]">{sub}</p>}
    </div>
  );
}

// =============================================================================
// SettingRow — label + hint + input row (used in settings sections)
// =============================================================================

export function SettingRow({
  label,
  hint,
  children,
  action,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 border-b border-[var(--col-border)]/50 py-3 last:border-b-0 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
      <div className="min-w-0 sm:min-w-[112px] sm:shrink-0">
        <div className="text-sm font-medium text-[var(--col-text01)] font-['DM_Sans',sans-serif]">{label}</div>
        {hint && (
          <p className="text-xs text-[var(--col-text04)] mt-0.5 leading-5 font-['DM_Sans',sans-serif]">{hint}</p>
        )}
      </div>
      <div className="flex w-full min-w-0 items-center gap-2 sm:max-w-sm sm:flex-1">
        <div className="flex-1">{children}</div>
        {action}
      </div>
    </div>
  );
}

// =============================================================================
// Provider color helpers
// =============================================================================

import { PROVIDER_COLORS, pColor } from "@/lib/constants";

export { PROVIDER_COLORS, pColor };
