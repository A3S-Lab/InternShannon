import { useRequest } from "ahooks";
import { Loader2, Radar } from "lucide-react";
import { securityCenterApi } from "@/lib/api/security-center";
import { cn } from "@/lib/utils";

/**
 * 脑际可解释性雷达扫描(应用弹窗外部右侧悬挂的紧凑版)—— 复用安全中台「脑际可解释扫描」的
 * 圆形雷达表盘 + 实时数据(securityCenterApi.explainabilityScan,近 3h,6s 轮询,零新后端)。
 * 取自 SecurityMonitorPage.ExplainabilityPanel 的表盘视觉,缩小到 size-40 适配窄轨;省去波形图。
 * 静默降级:拉不到数据只显示占位。
 */
export function ExplainabilityRadarRail({ className }: { className?: string }) {
  const { data: scan, loading } = useRequest(
    () => securityCenterApi.explainabilityScan({ timeType: "last_3h", seriesPoints: 24 }),
    { pollingInterval: 6000, pollingWhenHidden: false },
  );
  const safeLatest = scan?.waveSeries?.[0]?.safeSeries?.at(-1)?.value ?? 0;

  return (
    <div className={cn("flex shrink-0 flex-col overflow-hidden rounded-md border border-border-light bg-background", className)}>
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border-light px-3">
        <Radar className="size-4 text-teal-500" />
        <span className="text-sm font-medium text-foreground">脑际可解释扫描</span>
        {loading && !scan ? <Loader2 className="ml-auto size-3 animate-spin text-muted-foreground" /> : null}
      </div>
      <div className="flex flex-col items-center gap-3 p-3">
        {/* 圆形雷达表盘:同心环 + 旋转扇形扫描 + 十字准星 + 中心安全感知值(深色"神经扫描"风,取自监控页)。 */}
        <div className="relative size-40 overflow-hidden rounded-full border border-teal-300/30 bg-[#08110d] shadow-[inset_0_0_30px_rgba(45,212,191,0.1)]">
          <div className="absolute inset-[10px] rounded-full border border-teal-300/15" />
          <div className="absolute inset-[30px] rounded-full border border-teal-300/15" />
          <div className="absolute inset-[52px] rounded-full border border-teal-300/15" />
          <div
            className="absolute inset-0 rounded-full bg-[conic-gradient(from_20deg,rgba(45,212,191,0.7)_0deg,rgba(45,212,191,0.2)_44deg,rgba(45,212,191,0)_92deg,rgba(45,212,191,0)_360deg)] animate-spin"
            style={{ animationDuration: "3.4s" }}
          />
          <div className="absolute inset-0 rounded-full bg-[radial-gradient(circle,rgba(8,17,13,0)_0%,rgba(8,17,13,0)_54%,rgba(8,17,13,0.65)_100%)]" />
          <div className="absolute left-1/2 top-0 h-full w-px -translate-x-1/2 bg-teal-300/15" />
          <div className="absolute left-0 top-1/2 h-px w-full -translate-y-1/2 bg-teal-300/15" />
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-[9px] font-semibold uppercase tracking-[0.2em] text-teal-200/80">safe water</span>
            <span className="mt-0.5 text-3xl font-semibold text-zinc-50">{Math.round(safeLatest)}</span>
            <span className="mt-0.5 text-[10px] text-zinc-500">安全感知</span>
          </div>
        </div>
        <div className="grid w-full grid-cols-2 gap-2 text-center">
          <div>
            <p className="text-[10px] text-muted-foreground">危险拦截</p>
            <p className="mt-0.5 text-base font-semibold text-rose-500">{scan?.threatInterception ?? "--"}</p>
          </div>
          <div>
            <p className="text-[10px] text-muted-foreground">活跃会话</p>
            <p className="mt-0.5 text-base font-semibold text-teal-500">{scan?.sessionActiveCount ?? "--"}</p>
          </div>
        </div>
      </div>
    </div>
  );
}
