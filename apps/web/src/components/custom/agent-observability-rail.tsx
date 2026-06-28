import { Activity, AlertTriangle, Boxes, Cpu, GitBranch, HeartPulse, Network, Target, Timer, Waves, Zap } from "lucide-react";
import { useEffect, useState } from "react";
import { type AgentObservability, streamAgentObservability } from "@/lib/api/security-center";
import { cn } from "@/lib/utils";

/**
 * 智能体观测面板(应用弹窗外部右侧 dock)。Agent Observability = Infra Metrics + Behavior Analytics:
 * 传统监控只盯 CPU/内存/延迟/QPS,会完美错过 Agent 的「行为失控」。本面板额外突出「行为」层
 * (动作频率 / 决策模式 / 状态转换 / 目标进度)—— Agent 独有、最能提前暴露危险的信号。
 *
 * 指标经安全中台 SSE 实时推送(securityCenterApi 的 agentObservability/stream,服务端每 3s 一帧,
 * 前端订阅而非轮询);mock-first(无 per-agent 行为源时由后端 mock 生成)。断线自动重连。
 */
export function AgentObservabilityRail({ className }: { className?: string }) {
  const [m, setM] = useState<AgentObservability | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    streamAgentObservability({ timeType: "last_3h" }, setM, controller.signal);
    return () => controller.abort();
  }, []);

  const h = m?.health;
  const b = m?.behavioral;
  const sys = m?.system;
  const behaviorAlert = b?.decisionPattern === "drift" || (b?.actionRate ?? 0) > 80;

  return (
    <div className={cn("flex shrink-0 flex-col overflow-hidden rounded-md border border-border-light bg-background", className)}>
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border-light px-3">
        <Activity className="size-4 text-indigo-500" />
        <span className="text-sm font-medium text-foreground">智能体观测</span>
        <span className="relative ml-auto flex size-1.5" title="SSE 实时推送">
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-indigo-400/70" />
          <span className="relative inline-flex size-1.5 rounded-full bg-indigo-500" />
        </span>
        <span className="text-[10px] text-muted-foreground">Infra + Behavior</span>
      </div>

      <div className="flex flex-col gap-2.5 p-3">
        {/* Agent 健康 */}
        <div className="rounded-md border border-border-light bg-card p-2">
          <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Agent 健康</div>
          <Metric icon={HeartPulse} label="心跳" value={h ? (h.heartbeatOk ? "正常" : "丢失") : "--"} tone={h && !h.heartbeatOk ? "text-rose-500" : h ? "text-emerald-600 dark:text-emerald-400" : undefined} />
          <Metric icon={Cpu} label="资源利用率" value={h ? `${h.resourceUtil}%` : "--"} />
          <Metric icon={AlertTriangle} label="错误率" value={h ? `${h.errorRate}%` : "--"} tone={h && h.errorRate > 2 ? "text-amber-600 dark:text-amber-400" : undefined} />
          <Metric icon={Timer} label="决策延迟" value={h ? `${h.decisionLatencyMs}ms` : "--"} />
        </div>

        {/* 行为(Agent 独有)—— 着重高亮:这一层最能提前暴露「行为失控」。 */}
        <div className={cn("rounded-md border p-2", behaviorAlert ? "border-amber-400/60 bg-amber-50 dark:bg-amber-950/20" : "border-indigo-400/40 bg-indigo-50/40 dark:bg-indigo-950/20")}>
          <div className="mb-1 flex items-center gap-1.5">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-indigo-600 dark:text-indigo-300">行为</span>
            <span className="rounded bg-indigo-500/15 px-1 text-[9px] text-indigo-600 dark:text-indigo-300">Agent 独有</span>
            {behaviorAlert ? <span className="ml-auto text-[9px] font-medium text-amber-600 dark:text-amber-400">偏离基线</span> : null}
          </div>
          <Metric icon={Zap} label="动作频率" value={b ? `${b.actionRate}/min` : "--"} tone={b && b.actionRate > 80 ? "text-amber-600 dark:text-amber-400" : undefined} />
          <Metric
            icon={Waves}
            label="决策模式"
            value={b ? (b.decisionPattern === "baseline" ? "贴合基线" : "偏离") : "--"}
            tone={b ? (b.decisionPattern === "baseline" ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400") : undefined}
          />
          <Metric icon={GitBranch} label="状态转换" value={b ? `${b.stateTransitions}/min` : "--"} />
          <Metric icon={Target} label="目标进度" value={b ? `${b.goalProgress}%` : "--"} />
        </div>

        {/* 系统 */}
        <div className="rounded-md border border-border-light bg-card p-2">
          <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">系统</div>
          <Metric icon={Boxes} label="Agent 数量" value={sys ? String(sys.agentCount) : "--"} />
          <Metric icon={Network} label="通信量" value={sys ? `${sys.commThroughput}/s` : "--"} />
          <Metric icon={Activity} label="基础设施健康" value={sys ? (sys.infraHealthy ? "正常" : "异常") : "--"} tone={sys && !sys.infraHealthy ? "text-rose-500" : sys ? "text-emerald-600 dark:text-emerald-400" : undefined} />
        </div>
      </div>
    </div>
  );
}

function Metric({
  icon: Icon,
  label,
  value,
  tone,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  tone?: string;
}) {
  return (
    <div className="flex items-center gap-1.5 py-0.5">
      <Icon className="size-3 shrink-0 text-muted-foreground" />
      <span className="truncate text-[11px] text-muted-foreground">{label}</span>
      <span className={cn("ml-auto font-mono text-[11px] font-medium text-foreground", tone)}>{value}</span>
    </div>
  );
}
