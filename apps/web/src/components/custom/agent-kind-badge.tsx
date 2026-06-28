import { Bot, MessagesSquare, Wrench } from "lucide-react";
import { Badge } from "@/components/ui/badge";

export type AgentKind = "tool" | "application" | "agentic";

export const AGENT_KIND_LABELS: Record<AgentKind, string> = {
  tool: "专用型智能体",
  application: "应用型智能体",
  agentic: "自主型智能体",
};

export const AGENT_KIND_SHORT_LABELS: Record<AgentKind, string> = {
  tool: "专用型",
  application: "应用型",
  agentic: "自主型",
};

/**
 * 智能体子类型 badge。仅对 category=agent 的资产有意义。
 * - 专用型 (tool)：可作为本地工具型能力调用
 * - 应用型 (application)：只能独立部署运行
 * - 自主型 (agentic)：基于 a3s-code 或其它框架开发的自主交互智能体；
 *   要求产出结构化输出后，也可作为本地工具型能力调用
 */
export function AgentKindBadge({
  kind,
  short = false,
  className,
}: {
  kind: AgentKind;
  short?: boolean;
  className?: string;
}) {
  const label = short ? AGENT_KIND_SHORT_LABELS[kind] : AGENT_KIND_LABELS[kind];
  if (kind === "tool") {
    return (
      <Badge
        variant="outline"
        className={`border-violet-200 bg-violet-50 text-violet-700 ${className ?? ""}`}
        title="专用型：可作为本地工具型能力调用"
      >
        <Wrench className="mr-1 size-3" />
        {label}
      </Badge>
    );
  }
  if (kind === "agentic") {
    return (
      <Badge
        variant="outline"
        className={`border-emerald-200 bg-emerald-50 text-emerald-700 ${className ?? ""}`}
        title="自主型：基于 a3s-code 或其它框架的自主交互智能体；要求结构化输出后可工具化调用"
      >
        <MessagesSquare className="mr-1 size-3" />
        {label}
      </Badge>
    );
  }
  return (
    <Badge
      variant="outline"
      className={`border-sky-200 bg-sky-50 text-sky-700 ${className ?? ""}`}
      title="应用型：独立部署运行"
    >
      <Bot className="mr-1 size-3" />
      {label}
    </Badge>
  );
}
