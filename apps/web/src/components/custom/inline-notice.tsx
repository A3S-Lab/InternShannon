import type { ReactNode } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

export type InlineNoticeTone = "error" | "warning" | "success" | "info";

const TONE_CLASS: Record<InlineNoticeTone, string> = {
  error: "border-red-200 bg-red-50 text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-300",
  warning: "border-amber-100 bg-amber-50 text-amber-800 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-300",
  success:
    "border-emerald-100 bg-emerald-50 text-emerald-700 dark:border-emerald-900/40 dark:bg-emerald-950/30 dark:text-emerald-300",
  info: "border-border-light bg-muted/40 text-muted-foreground",
};

/**
 * 紧凑内联提示条:一行式 `rounded-md border px-3 py-2 text-sm` 彩色框,统一各处手搓的
 * `border-red-200 bg-red-50 …` / `border-emerald-100 …` 成败横幅（全局重复 30+ 次，且配色已漂移）。
 * 与 `ui/alert`（大号 callout + 图标 + 标题）区分：本组件是密集的瞬时反馈条。
 */
export function InlineNotice({
  tone = "info",
  className,
  children,
}: {
  tone?: InlineNoticeTone;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={cn("whitespace-pre-line rounded-md border px-3 py-2 text-sm", TONE_CLASS[tone], className)}>
      {children}
    </div>
  );
}

export interface InlineMessage {
  tone: InlineNoticeTone;
  text: string;
}

/**
 * 内联提示的状态 + 自动消失计时（默认 3s；传 0 关闭自动消失，提示常驻直到下次 notify/clear）。
 * 替代各 settings 面板里重复的 `useState<{type,text}>` + 3 秒清空 useEffect 模式。
 */
export function useInlineMessage(autoDismissMs = 3000) {
  const [message, setMessage] = useState<InlineMessage | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancel = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);
  useEffect(() => cancel, [cancel]);
  const notify = useCallback(
    (tone: InlineNoticeTone, text: string) => {
      cancel();
      setMessage({ tone, text });
      if (autoDismissMs > 0) {
        timerRef.current = setTimeout(() => setMessage(null), autoDismissMs);
      }
    },
    [autoDismissMs, cancel],
  );
  const clear = useCallback(() => {
    cancel();
    setMessage(null);
  }, [cancel]);
  return { message, notify, clear };
}
