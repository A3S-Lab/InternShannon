import { AlertTriangle, CheckCircle2, Info, type LucideIcon, XCircle } from "lucide-react";
import { type ReactNode, useId } from "react";

import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

type StatusTone = "neutral" | "success" | "warning" | "error" | "info";

const statusToneClassName: Record<StatusTone, string> = {
  neutral: "border-border-light bg-muted/40 text-muted-foreground",
  success: "border-emerald-100 bg-emerald-50 text-emerald-700",
  warning: "border-amber-100 bg-amber-50 text-amber-700",
  error: "border-red-100 bg-red-50 text-red-600",
  info: "border-info/30 bg-info/10 text-primary",
};

const statusIconMap: Record<StatusTone, LucideIcon> = {
  neutral: Info,
  success: CheckCircle2,
  warning: AlertTriangle,
  error: XCircle,
  info: Info,
};

export function SettingsMessage({ type, text }: { type: "success" | "error"; text: string }) {
  return (
    <div
      role={type === "error" ? "alert" : "status"}
      aria-live={type === "error" ? "assertive" : "polite"}
      className={cn(
        "rounded-md border px-2.5 py-2 text-sm",
        type === "success" ? statusToneClassName.success : statusToneClassName.error,
      )}
    >
      {text}
    </div>
  );
}

export function SettingsStatusBanner({
  tone,
  title,
  description,
  icon,
}: {
  tone: StatusTone;
  title: string;
  description?: ReactNode;
  icon?: LucideIcon;
}) {
  const Icon = icon ?? statusIconMap[tone];

  return (
    <div className={cn("flex items-start gap-2.5 rounded-md border px-2.5 py-2", statusToneClassName[tone])}>
      <Icon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      <div className="min-w-0 text-sm">
        <div className="font-semibold text-foreground">{title}</div>
        {description ? <div className="mt-0.5 text-xs leading-5">{description}</div> : null}
      </div>
    </div>
  );
}

export function SettingsStatusPill({
  tone,
  children,
  icon,
  className,
}: {
  tone: StatusTone;
  children: ReactNode;
  icon?: LucideIcon;
  className?: string;
}) {
  const Icon = icon ?? statusIconMap[tone];

  return (
    <span
      className={cn(
        "inline-flex h-7 items-center gap-1.5 rounded-md border px-2.5 text-xs font-medium",
        statusToneClassName[tone],
        className,
      )}
    >
      <Icon className="size-3.5" aria-hidden="true" />
      {children}
    </span>
  );
}

export function SettingsFieldGroup({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("divide-y divide-border-light", className)}>{children}</div>;
}

export function SettingField({
  label,
  htmlFor,
  description,
  extra,
  className,
  compact,
  children,
}: {
  label: string;
  htmlFor: string;
  description?: ReactNode;
  extra?: ReactNode;
  className?: string;
  compact?: boolean;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        "grid md:items-start",
        compact
          ? "gap-1.5 px-3 py-2 md:grid-cols-[156px_minmax(0,520px)] lg:grid-cols-[168px_minmax(0,560px)]"
          : "gap-2.5 px-4 py-3 md:grid-cols-[176px_minmax(0,560px)] lg:grid-cols-[192px_minmax(0,640px)]",
        className,
      )}
    >
      <div className={cn(compact ? "min-h-8" : "min-h-9")}>
        <div
          className={cn("flex items-center justify-between gap-2 md:justify-start", compact ? "min-h-8" : "min-h-9")}
        >
          <Label htmlFor={htmlFor} className="text-sm font-medium text-foreground">
            {label}
          </Label>
          {extra}
        </div>
        {description ? (
          <div className={cn("mt-0.5 text-xs text-muted-foreground", compact ? "leading-4" : "leading-5")}>
            {description}
          </div>
        ) : null}
      </div>
      <div className={cn("min-w-0", compact ? "md:max-w-[560px]" : "md:max-w-[640px]")}>{children}</div>
    </div>
  );
}

export function SettingSwitchRow({
  title,
  description,
  checked,
  onCheckedChange,
  icon,
  className,
  compact,
}: {
  title: string;
  description?: ReactNode;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  icon?: ReactNode;
  className?: string;
  compact?: boolean;
}) {
  const titleId = useId();
  const descriptionId = useId();
  return (
    <div
      className={cn(
        "flex items-start justify-between rounded-md border border-border-light bg-muted/40",
        compact ? "gap-2.5 p-2" : "gap-3 p-2.5",
        className,
      )}
    >
      <div className={cn("flex min-w-0", compact ? "gap-2.5" : "gap-3")}>
        {icon ? (
          <div
            className={cn(
              "flex shrink-0 items-center justify-center rounded-md bg-background text-foreground ring-1 ring-border",
              compact ? "size-7" : "size-9",
            )}
          >
            {icon}
          </div>
        ) : null}
        <div className="min-w-0">
          <div id={titleId} className="text-sm font-medium text-foreground">
            {title}
          </div>
          {description ? (
            <div
              id={descriptionId}
              className={cn("mt-0.5 text-xs text-muted-foreground", compact ? "leading-4" : "leading-5")}
            >
              {description}
            </div>
          ) : null}
        </div>
      </div>
      <Switch
        checked={checked}
        onCheckedChange={onCheckedChange}
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
      />
    </div>
  );
}
