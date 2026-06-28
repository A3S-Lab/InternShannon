import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { STATUS_TONE_VARIANT, type StatusTone } from "@/lib/status-tone";
import { cn } from "@/lib/utils";

export interface StatusBadgeProps {
  /** 语义档(由各业务把自己的状态值映射过来)。 */
  tone: StatusTone;
  children: ReactNode;
  /** 是否在文案前加一个状态圆点。 */
  dot?: boolean;
  className?: string;
}

/**
 * 统一状态徽章 —— 底层走 ui/badge 的 success/warning/destructive/outline,颜色语义由
 * {@link STATUS_TONE_VARIANT} 单一定义。收口此前网关 HealthBadge、资源 statusVariant/
 * phaseVariant、监控 RiskBadge/StatusPill 等各写一套的徽章。
 */
export function StatusBadge({ tone, children, dot, className }: StatusBadgeProps) {
  return (
    <Badge variant={STATUS_TONE_VARIANT[tone]} className={cn(dot && "gap-1", className)}>
      {dot ? <span className="inline-block size-1.5 rounded-full bg-current opacity-80" /> : null}
      {children}
    </Badge>
  );
}
