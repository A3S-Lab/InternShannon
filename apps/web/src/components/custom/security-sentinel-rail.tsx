import { useRequest } from "ahooks";
import { Loader2, ShieldAlert, ShieldCheck } from "lucide-react";
import { securityCenterApi } from "@/lib/api/security-center";
import { cn } from "@/lib/utils";

/**
 * 安全监控哨兵(应用弹窗外部右侧悬挂的卡片)—— 复用安全中台「决策漏斗」L1/L2/L3 实时数据
 * (securityCenterApi.decisionFunnel,近 3h,6s 轮询,零新后端),让打开任意应用时一眼可见平台当前
 * 实时风险分层。卡片形态,由外部 dock 容器决定位置/滚动;静默降级(拉不到只显示占位)。
 *
 * L1=快速决策(规则引擎)/ L2=模型·用户决策 / L3=人工决策;finalBlock=最终拦截。
 */

// 对齐安全中台监控页 funnelColors(L1/L2/L3 + 最终拦截)。
const TIER_COLORS = ["#2dd4bf", "#fbbf24", "#fb923c"];
const BLOCK_COLOR = "#fb7185";

function formatCount(n: number): string {
  if (!Number.isFinite(n)) return "0";
  if (n >= 10_000) return `${(n / 1000).toFixed(1)}k`;
  return n.toLocaleString();
}

function formatPct(n: number): string {
  return `${(Number.isFinite(n) ? n : 0).toFixed(1)}%`;
}

export function SecuritySentinelRail({ className }: { className?: string }) {
  // 固定看「近 3 小时」平台风险。静默降级:出错保留上次数据/占位。
  const { data, loading } = useRequest(() => securityCenterApi.decisionFunnel({ timeType: "last_3h" }), {
    pollingInterval: 6000,
    pollingWhenHidden: false,
  });

  const tiers = data?.tiers ?? [];
  const finalBlock = data?.finalBlock;

  return (
    <div className={cn("flex shrink-0 flex-col overflow-hidden rounded-md border border-border-light bg-background", className)}>
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border-light px-3">
        <ShieldCheck className="size-4 text-emerald-500" />
        <span className="text-sm font-medium text-foreground">安全哨兵</span>
        <span className="relative flex size-1.5">
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-400/70" />
          <span className="relative inline-flex size-1.5 rounded-full bg-emerald-500" />
        </span>
        {loading && !data ? <Loader2 className="ml-auto size-3 animate-spin text-muted-foreground" /> : null}
      </div>

      <div className="p-3">
        <div className="mb-2 text-[11px] font-medium text-muted-foreground">决策漏斗 · 实时风险(近 3h)</div>

        {tiers.length === 0 && !loading ? (
          <div className="py-6 text-center text-[11px] text-muted-foreground">暂无实时风险数据</div>
        ) : (
          <div className="flex flex-col gap-2.5">
            {tiers.map((tier, i) => {
              const color = TIER_COLORS[i] ?? TIER_COLORS[TIER_COLORS.length - 1];
              return (
                <div key={tier.tierCode} className="rounded-md border border-border-light bg-card p-2">
                  <div className="flex items-center gap-1.5">
                    <span className="rounded px-1 text-[10px] font-bold text-white" style={{ backgroundColor: color }}>
                      {tier.tierCode}
                    </span>
                    <span className="truncate text-xs font-medium text-foreground">{tier.tierName}</span>
                    <span className="ml-auto font-mono text-xs text-foreground">{formatCount(tier.count)}</span>
                  </div>
                  <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full transition-all"
                      style={{ width: `${Math.min(100, Math.max(0, tier.percentage))}%`, backgroundColor: color }}
                    />
                  </div>
                  <div className="mt-1 flex items-center justify-between text-[10px] text-muted-foreground">
                    <span className="truncate">{tier.slaDesc}</span>
                    <span className="shrink-0 font-mono">{formatPct(tier.percentage)}</span>
                  </div>
                </div>
              );
            })}

            {finalBlock ? (
              <div className="rounded-md border border-rose-500/30 bg-rose-500/5 p-2">
                <div className="flex items-center gap-1.5">
                  <ShieldAlert className="size-3.5" style={{ color: BLOCK_COLOR }} />
                  <span className="text-xs font-medium text-foreground">最终拦截</span>
                  <span className="ml-auto font-mono text-xs" style={{ color: BLOCK_COLOR }}>
                    {formatCount(finalBlock.count)}
                  </span>
                </div>
                <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full transition-all"
                    style={{ width: `${Math.min(100, Math.max(0, finalBlock.percentage))}%`, backgroundColor: BLOCK_COLOR }}
                  />
                </div>
                <div className="mt-1 text-right font-mono text-[10px] text-muted-foreground">
                  {formatPct(finalBlock.percentage)}
                </div>
              </div>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}
