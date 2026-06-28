import type { LucideIcon } from "lucide-react";
import { AlertCircle, Loader2, RefreshCw, Save } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type OfficePanelStatus =
  | "loading"
  | "ready"
  | "dirty"
  | "saving"
  | "error";

function getOfficePanelStatusLabel(
  status: OfficePanelStatus,
  readOnly: boolean
) {
  if (status === "saving") return "保存中";
  if (status === "dirty") return "未保存";
  if (status === "error") return "错误";
  if (readOnly) return "只读";
  return "已保存";
}

interface OfficePanelShellProps {
  fileName: string;
  label: string;
  editorLabel: string;
  loadingLabel: string;
  icon: LucideIcon;
  iconClassName: string;
  status: OfficePanelStatus;
  readOnly: boolean;
  isDirty: boolean;
  error: string | null;
  onSave: () => void | Promise<void>;
  onRetry?: () => void;
  retryLabel?: string;
  children: ReactNode;
}

export function OfficePanelShell({
  fileName,
  label,
  editorLabel,
  loadingLabel,
  icon: Icon,
  iconClassName,
  status,
  readOnly,
  isDirty,
  error,
  onSave,
  onRetry,
  retryLabel = "重试",
  children,
}: OfficePanelShellProps) {
  const statusLabel = getOfficePanelStatusLabel(status, readOnly);
  const busy = status === "loading" || status === "saving";

  return (
    <section
      className="flex h-full min-h-0 flex-col bg-background"
      aria-label={`${label}：${fileName}`}
      aria-busy={busy}
    >
      <div className="flex h-10 shrink-0 items-center justify-between gap-3 border-b border-border/60 px-3">
        <div className="flex min-w-0 items-center gap-2">
          <Icon
            className={cn("size-4 shrink-0", iconClassName)}
            aria-hidden="true"
          />
          <span
            className="truncate text-sm font-medium text-foreground"
            title={fileName}
          >
            {fileName}
          </span>
          <span
            className={cn(
              "shrink-0 rounded px-1.5 py-0.5 text-xs",
              status === "error"
                ? "bg-destructive/10 text-destructive"
                : "bg-muted text-muted-foreground"
            )}
            aria-live="polite"
          >
            {statusLabel}
          </span>
        </div>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => void onSave()}
          disabled={
            readOnly || status === "loading" || status === "saving" || !isDirty
          }
          aria-label={`保存 ${fileName}`}
          aria-busy={status === "saving"}
        >
          {status === "saving" ? (
            <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
          ) : (
            <Save className="size-3.5" aria-hidden="true" />
          )}
          保存
        </Button>
      </div>
      <div
        className="relative min-h-0 flex-1"
        role="region"
        aria-label={editorLabel}
      >
        {children}
        {status === "loading" && (
          <div
            className="absolute inset-0 flex items-center justify-center gap-2 bg-background text-sm text-muted-foreground"
            aria-live="polite"
          >
            <Loader2 className="size-5 animate-spin" aria-hidden="true" />
            <span>{loadingLabel}</span>
          </div>
        )}
        {error && (
          <div
            className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-background px-6 text-center text-muted-foreground"
            role="alert"
          >
            <AlertCircle
              className="size-6 text-destructive"
              aria-hidden="true"
            />
            <div className="max-w-md text-sm">{error}</div>
            {onRetry && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={onRetry}
              >
                <RefreshCw className="size-3.5" aria-hidden="true" />
                {retryLabel}
              </Button>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
