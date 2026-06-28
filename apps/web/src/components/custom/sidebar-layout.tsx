import { cn } from "@/lib/utils";
import { ChevronRight, ShieldCheck } from "lucide-react";
import type { LucideIcon } from "lucide-react";

export interface SidebarSection<T extends string = string> {
  id: T;
  label: string;
  icon: LucideIcon;
}

export interface SidebarLayoutProps<T extends string> {
  title: string;
  subtitle?: string;
  sections: SidebarSection<T>[];
  current: T;
  onChange: (id: T) => void;
  footer?: string;
  hideFooter?: boolean;
  children: React.ReactNode;
}

export function SidebarLayout<T extends string>({
  title,
  subtitle,
  sections,
  current,
  onChange,
  footer,
  hideFooter = false,
  children,
}: SidebarLayoutProps<T>) {
  return (
    <div className="flex h-full overflow-hidden rounded-md border border-border-light bg-background shadow-[0_4px_6px_rgba(0,0,0,0.04)]">
      {/* Sidebar */}
      <aside className="w-52 shrink-0 flex flex-col bg-muted/50">
        <div className="px-4 pb-3 pt-4">
          <h1 className="text-sm font-semibold text-foreground">{title}</h1>
          {subtitle && <p className="text-[11px] text-muted-foreground mt-0.5">{subtitle}</p>}
        </div>

        <nav className="flex-1 space-y-0.5 px-2 py-2">
          {sections.map((section) => {
            const isActive = current === section.id;
            return (
              <button
                key={section.id}
                onClick={() => onChange(section.id)}
                className={cn(
                  "w-full flex items-center gap-2 px-2.5 py-2 rounded-md text-[13px] transition-all duration-200 font-medium",
                  isActive
                    ? "bg-primary/10 text-primary"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
              >
                <div
                  className={cn(
                    "flex size-6 shrink-0 items-center justify-center rounded-md transition-colors",
                    isActive ? "bg-primary/15" : "bg-border",
                  )}
                >
                  <section.icon className={cn("size-3.5", isActive ? "text-primary" : "text-muted-foreground")} />
                </div>
                <span className="truncate">{section.label}</span>
                <ChevronRight
                  className={cn("size-3 ml-auto shrink-0 transition-opacity", isActive ? "opacity-60" : "opacity-0")}
                />
              </button>
            );
          })}
        </nav>

        {!hideFooter && footer && (
          <div className="px-4 py-3">
            <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
              <ShieldCheck className="size-3" />
              <span>{footer}</span>
            </div>
          </div>
        )}
      </aside>

      {/* Divider */}
      <div className="w-px bg-border-light shrink-0" />

      {/* Main Content */}
      <main className="flex-1 overflow-y-auto">{children}</main>
    </div>
  );
}

export function SectionHeader({
  title,
  description,
  icon: Icon,
}: {
  title: string;
  description?: string;
  icon: LucideIcon;
}) {
  return (
    <div className="mb-4 flex items-center gap-2.5">
      <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10">
        <Icon className="size-4 text-primary" />
      </div>
      <div>
        <h2 className="text-sm font-semibold text-foreground">{title}</h2>
        {description && <p className="text-xs text-muted-foreground">{description}</p>}
      </div>
    </div>
  );
}

export function SettingRow({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-border-light py-3 last:border-b-0">
      <div className="shrink-0 min-w-[100px]">
        <div className="text-sm font-medium text-foreground">{label}</div>
        {hint && <p className="text-xs text-muted-foreground mt-0.5">{hint}</p>}
      </div>
      <div className="max-w-sm flex-1">{children}</div>
    </div>
  );
}
