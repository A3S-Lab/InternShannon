// 单一「状态语义 → 视觉」事实源。三页(资源/网关/监控)此前各写 4+ 套平行红黄绿配色
// (HealthBadge / statusVariant / phaseVariant / RiskBadge / RISK_TONE / StatTile tone …),
// 全部收敛到这四档语义 tone,再统一映射回 ui/badge 已有 variant 与点/文字色。各业务只声明
// 「业务值 → 语义档」,不再各拍配色。

export type StatusTone = "ok" | "warn" | "critical" | "neutral";

/** 语义档 → ui/badge.tsx 既有 variant(底层颜色单一来源)。 */
export const STATUS_TONE_VARIANT: Record<StatusTone, "success" | "warning" | "destructive" | "outline"> = {
  ok: "success",
  warn: "warning",
  critical: "destructive",
  neutral: "outline",
};

/** 语义档 → 圆点底色(行内状态点)。 */
export const STATUS_TONE_DOT: Record<StatusTone, string> = {
  ok: "bg-emerald-500",
  warn: "bg-amber-500",
  critical: "bg-destructive",
  neutral: "bg-muted-foreground",
};

/** 语义档 → 文字色(指标值/强调文案上色)。 */
export const STATUS_TONE_TEXT: Record<StatusTone, string> = {
  ok: "text-emerald-600",
  warn: "text-amber-600",
  critical: "text-destructive",
  neutral: "text-muted-foreground",
};
