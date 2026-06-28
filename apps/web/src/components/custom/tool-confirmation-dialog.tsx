import { AlertTriangle, CheckCircle2, Clock, Loader2, ShieldCheck, Sparkles } from "lucide-react";
import { type KeyboardEvent, useCallback, useEffect, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { ToolConfirmationRequest } from "@/lib/socket-types";
import { cn } from "@/lib/utils";
import { resolveToolConfirmationDialogFeedback } from "./tool-confirmation-dialog-state";

type AuthorizationScope = "once" | "task" | "session";

export interface ToolConfirmationDialogProps {
  request: ToolConfirmationRequest | null;
  pending?: boolean;
  deliveryError?: string | null;
  onConfirm: (scope: AuthorizationScope) => void | Promise<void>;
  onDeny: () => void | Promise<void>;
}

const scopeOptions = [
  {
    value: "once",
    title: "仅此一次",
    description: "下次仍需确认",
    icon: CheckCircle2,
  },
  {
    value: "task",
    title: "本次任务",
    description: "任务完成前自动授权",
    icon: Clock,
  },
  {
    value: "session",
    title: "整个会话",
    description: "会话期间自动授权",
    icon: ShieldCheck,
  },
] as const satisfies readonly {
  value: AuthorizationScope;
  title: string;
  description: string;
  icon: typeof CheckCircle2;
}[];

const scopeValues = scopeOptions.map((option) => option.value);

function formatToolInput(input: Record<string, unknown>): string {
  try {
    return JSON.stringify(input, null, 2);
  } catch {
    return String(input);
  }
}

export function ToolConfirmationDialog({
  request,
  pending = false,
  deliveryError,
  onConfirm,
  onDeny,
}: ToolConfirmationDialogProps) {
  const [selectedScope, setSelectedScope] = useState<AuthorizationScope>("once");
  const scopeButtonRefs = useRef<Record<AuthorizationScope, HTMLButtonElement | null>>({
    once: null,
    task: null,
    session: null,
  });
  const requestId = request?.requestId;

  const focusScope = useCallback((scope: AuthorizationScope) => {
    window.requestAnimationFrame(() => {
      scopeButtonRefs.current[scope]?.focus();
    });
  }, []);

  useEffect(() => {
    if (requestId) {
      setSelectedScope("once");
      focusScope("once");
    }
  }, [focusScope, requestId]);

  if (!request) {
    return null;
  }

  const deliveryFeedback = resolveToolConfirmationDialogFeedback({
    pending,
    deliveryError,
  });

  const handleConfirm = () => {
    if (pending) return;
    void onConfirm(selectedScope);
  };

  const handleDeny = () => {
    if (pending) return;
    void onDeny();
  };

  const moveScope = (direction: 1 | -1) => {
    setSelectedScope((current) => {
      const currentIndex = scopeValues.indexOf(current);
      const nextScope = scopeValues[(currentIndex + direction + scopeValues.length) % scopeValues.length];
      focusScope(nextScope);
      return nextScope;
    });
  };

  const handleScopeKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      event.preventDefault();
      moveScope(1);
      return;
    }
    if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      event.preventDefault();
      moveScope(-1);
      return;
    }
    if (event.key === "Home") {
      event.preventDefault();
      setSelectedScope(scopeValues[0]);
      focusScope(scopeValues[0]);
      return;
    }
    if (event.key === "End") {
      event.preventDefault();
      const lastScope = scopeValues[scopeValues.length - 1];
      setSelectedScope(lastScope);
      focusScope(lastScope);
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      handleConfirm();
    }
  };

  return (
    <Dialog open={!!request} onOpenChange={(open) => !open && !pending && handleDeny()}>
      <DialogContent
        className="flex max-h-[min(82dvh,540px)] w-[calc(100vw-1.5rem)] max-w-[500px] flex-col gap-0 overflow-hidden rounded-[12px] border-border-light bg-background p-0 shadow-brand-purple sm:w-[84vw]"
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          focusScope("once");
        }}
      >
        <DialogHeader className="shrink-0 border-b border-border-light bg-muted/20 px-3 py-2.5">
          <div className="flex items-start gap-2.5 pr-8">
            <div className="flex size-8 shrink-0 items-center justify-center rounded-[9px] bg-primary text-white shadow-[rgba(44,30,116,0.14)_0px_6px_14px_-8px]">
              <AlertTriangle className="size-3.5" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex min-w-0 items-center gap-2">
                <DialogTitle className="truncate font-display text-sm font-semibold leading-5 text-foreground">
                  工具执行确认
                </DialogTitle>
                <Badge className="shrink-0 rounded-full bg-background px-1.5 py-0 font-sans text-[9px] font-medium leading-4 text-muted-foreground shadow-[rgba(0,0,0,0.06)_0px_2px_4px]">
                  HITL
                </Badge>
              </div>
              <DialogDescription className="mt-0.5 line-clamp-1 font-sans text-[11px] leading-4 text-muted-foreground">
                检查参数并选择授权范围，Enter 确认。
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="min-h-0 min-w-0 flex-1 space-y-2.5 overflow-y-auto overscroll-contain px-3 py-2.5">
          <section className="min-w-0 rounded-[9px] border border-border-light bg-background p-2.5 shadow-[rgba(0,0,0,0.04)_0px_1px_3px]">
            <div className="mb-1 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.05em] text-muted-foreground">
              <Sparkles className="size-3 text-primary" />
              工具名称
            </div>
            <Badge
              variant="outline"
              className="max-w-full rounded-full border-border bg-muted/50 px-2 py-0 font-mono text-[10px] font-medium leading-5 text-[#181e25]"
              title={request.toolName}
            >
              <span className="block max-w-full truncate">{request.toolName}</span>
            </Badge>
          </section>

          <section className="min-w-0 rounded-[9px] border border-border-light bg-background p-2.5 shadow-[rgba(0,0,0,0.04)_0px_1px_3px]">
            <div className="mb-1.5 flex items-center justify-between gap-3">
              <div className="text-[10px] font-semibold uppercase tracking-[0.05em] text-muted-foreground">
                工具参数
              </div>
              <div className="rounded-full bg-muted px-1.5 py-0 text-[9px] font-medium leading-4 text-muted-foreground">
                JSON
              </div>
            </div>
            <pre className="max-h-28 min-w-0 max-w-full overflow-auto whitespace-pre-wrap break-words rounded-[7px] border border-border-light bg-muted/50 p-2 font-mono text-[10px] leading-4 text-muted-foreground [overflow-wrap:anywhere]">
              {formatToolInput(request.toolInput)}
            </pre>
          </section>

          <fieldset className="min-w-0 border-0 p-0">
            <legend className="mb-1.5 p-0 text-[11px] font-semibold text-foreground">授权范围</legend>
            <div className="grid min-w-0 gap-1.5 sm:grid-cols-3">
              {scopeOptions.map((option) => {
                const Icon = option.icon;
                const active = selectedScope === option.value;

                return (
                  <button
                    key={option.value}
                    type="button"
                    ref={(node) => {
                      scopeButtonRefs.current[option.value] = node;
                    }}
                    aria-pressed={active}
                    disabled={pending}
                    tabIndex={active ? 0 : -1}
                    onClick={() => setSelectedScope(option.value)}
                    onFocus={() => setSelectedScope(option.value)}
                    onKeyDown={handleScopeKeyDown}
                    className={cn(
                      "group h-full w-full min-w-0 rounded-[8px] border bg-background p-2 text-left transition-all duration-150 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/45",
                      active
                        ? "border-primary bg-primary/5 shadow-[rgba(44,30,116,0.10)_0px_4px_10px_-6px]"
                        : "border-border-light shadow-[rgba(0,0,0,0.04)_0px_1px_3px] hover:border-primary/30",
                    )}
                  >
                    <div className="flex min-w-0 items-start gap-1.5">
                      <span
                        className={cn(
                          "mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full transition-colors",
                          active ? "bg-primary text-white" : "bg-muted text-muted-foreground group-hover:text-primary",
                        )}
                      >
                        <Icon className="size-3" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-sans text-[11px] font-semibold leading-4 text-foreground">
                          {option.title}
                        </span>
                        <span className="mt-0.5 block break-words font-sans text-[10px] leading-4 text-muted-foreground sm:line-clamp-1">
                          {option.description}
                        </span>
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          </fieldset>
        </div>

        <DialogFooter className="flex-col items-stretch gap-2 border-t border-border-light bg-[#fbfcff] px-3 py-2.5 sm:flex-row sm:items-center sm:justify-end">
          {deliveryFeedback ? (
            <div
              role={deliveryFeedback.role}
              aria-live={deliveryFeedback.ariaLive}
              className={cn(
                "flex w-full min-w-0 items-start gap-1.5 rounded-[7px] border px-2 py-1.5 text-left text-[10px] leading-4 sm:mr-auto sm:flex-1",
                deliveryFeedback.tone === "error"
                  ? "border-red-500/10 bg-red-500/[0.04] text-red-700"
                  : "border-primary/10 bg-primary/[0.05] text-primary",
              )}
            >
              {deliveryFeedback.tone === "error" ? (
                <AlertTriangle className="mt-0.5 size-3 shrink-0" />
              ) : (
                <Loader2 className="mt-0.5 size-3 shrink-0 animate-spin" />
              )}
              <span className="min-w-0 flex-1">
                <span className="block font-medium">{deliveryFeedback.title}</span>
                <span className="block break-words">{deliveryFeedback.message}</span>
              </span>
            </div>
          ) : null}
          <Button
            variant="outline"
            onClick={handleDeny}
            disabled={pending}
            className="h-7 rounded-full border-border bg-background px-3 text-xs text-foreground hover:border-primary/30 hover:bg-muted/50"
          >
            拒绝
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={pending}
            className="h-7 min-w-20 rounded-full bg-[#181e25] px-3 text-xs text-white hover:bg-[#181e25]/85"
          >
            {pending ? <Loader2 className="size-3 animate-spin" /> : null}
            {pending ? "发送中" : "确认授权"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
