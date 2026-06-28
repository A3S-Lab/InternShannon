import type React from "react";

import { cn } from "@/lib/utils";

interface SettingsSectionProps {
  title: string;
  description?: React.ReactNode;
  extra?: React.ReactNode;
  className?: string;
  contentClassName?: string;
  density?: "default" | "compact";
  children: React.ReactNode;
}

export function SettingsSection({
  title,
  description,
  extra,
  className,
  contentClassName,
  density = "default",
  children,
}: SettingsSectionProps) {
  const compact = density === "compact";

  return (
    <section className={cn("rounded-md border border-border-light bg-background", className)}>
      <div
        className={cn(
          "flex items-center justify-between gap-3 border-b border-border-light",
          compact ? "min-h-9 px-3 py-1.5" : "min-h-10 px-4 py-2",
        )}
      >
        <div>
          <h2 className="text-sm font-semibold text-foreground">{title}</h2>
          {description ? (
            <p className={cn("mt-0.5 text-xs text-muted-foreground", compact ? "leading-4" : undefined)}>
              {description}
            </p>
          ) : null}
        </div>
        {extra}
      </div>
      <div className={cn(compact ? "p-2" : "p-3", contentClassName)}>{children}</div>
    </section>
  );
}
