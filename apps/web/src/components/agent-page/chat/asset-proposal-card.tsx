import { Bot, Check, MessageSquareText, X } from "lucide-react";
import { AGENT_KIND_SHORT_LABELS, AgentKindBadge } from "@/components/custom/agent-kind-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import agentModel from "@/models/agent.model";
import { useAgentSessionId } from "../agent-session-context";

type AssetProposalCategory = "agent" | "tool" | "skill" | "mcp" | "code";

type ProposalAgentKind = "tool" | "application" | "agentic";

const ALL_AGENT_KINDS: ProposalAgentKind[] = ["application", "tool", "agentic"];

interface AssetProposal {
  category: AssetProposalCategory;
  name: string;
  visibility: "public" | "private";
  description?: string;
  agentKind?: ProposalAgentKind;
  scaffoldTemplate?: string;
  summary?: string;
}

const CATEGORY_LABELS: Record<AssetProposalCategory, string> = {
  agent: "智能体",
  tool: "工具",
  skill: "技能",
  mcp: "MCP",
  code: "代码",
};

function isAgentKindValue(value: unknown): value is ProposalAgentKind {
  return value === "tool" || value === "application" || value === "agentic";
}

function parseProposal(raw: string): AssetProposal | null {
  try {
    const obj = JSON.parse(raw) as Record<string, unknown>;
    const category = obj.category;
    const name = obj.name;
    const visibility = obj.visibility;
    if (
      typeof category !== "string" ||
      !(category in CATEGORY_LABELS) ||
      typeof name !== "string" ||
      !name.trim() ||
      (visibility !== "public" && visibility !== "private")
    ) {
      return null;
    }
    const agentKindRaw = obj.agentKind;
    return {
      category: category as AssetProposalCategory,
      name: name.trim(),
      visibility,
      description: typeof obj.description === "string" ? obj.description : undefined,
      agentKind:
        category === "agent" && isAgentKindValue(agentKindRaw) ? agentKindRaw : undefined,
      scaffoldTemplate:
        typeof obj.scaffoldTemplate === "string" ? obj.scaffoldTemplate : undefined,
      summary: typeof obj.summary === "string" ? obj.summary : undefined,
    };
  } catch {
    return null;
  }
}

export function AssetProposalCard({ code }: { code: string }) {
  const sessionId = useAgentSessionId();
  const proposal = parseProposal(code);

  // 解析失败时回退到一个简单的提示块，不破坏聊天流。
  if (!proposal) {
    return (
      <div className="my-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
        Failed to parse asset-proposal block. Raw content:
        <pre className="mt-1 overflow-auto whitespace-pre-wrap break-words font-mono text-[11px]">{code}</pre>
      </div>
    );
  }

  const fillInput = (text: string, autoSend: boolean) => {
    if (!sessionId) return;
    agentModel.prefillChatInput(sessionId, text, autoSend);
  };

  const disabled = !sessionId;
  const isAgentProposal = proposal.category === "agent";
  const currentKind = proposal.agentKind;

  const switchKind = (next: ProposalAgentKind) => {
    if (!sessionId || next === currentKind) return;
    const reason =
      next === "agentic"
        ? "（自主型，要求结构化输出，可被本地工具化调用）"
        : next === "tool"
          ? "（专用型，遵循 a3s-code 工具协议，可被本地工具化调用）"
          : "（应用型，独立部署运行）";
    agentModel.prefillChatInput(
      sessionId,
      `请把方案的 agentKind 改成 ${next} ${reason}，并重新出一份 asset-proposal。`,
      true,
    );
  };

  return (
    <div className="my-3 rounded-lg border border-primary/20 bg-gradient-to-br from-primary/5 via-background to-background shadow-sm">
      <header className="flex items-center gap-2 border-b border-primary/10 px-4 py-2.5">
        <Bot className="size-4 text-primary" />
        <span className="text-sm font-semibold text-foreground">资产创建方案</span>
        <span className="text-xs text-muted-foreground">请确认 / 修改 / 取消</span>
      </header>

      <div className="space-y-3 px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary" className="text-xs">
            {CATEGORY_LABELS[proposal.category]}
          </Badge>
          {proposal.agentKind ? <AgentKindBadge kind={proposal.agentKind} short /> : null}
          <Badge
            variant="outline"
            className={
              proposal.visibility === "public"
                ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                : "border-zinc-200 bg-zinc-50 text-zinc-700"
            }
          >
            {proposal.visibility === "public" ? "公开" : "私有"}
          </Badge>
          {proposal.scaffoldTemplate ? (
            <Badge variant="outline" className="border-sky-200 bg-sky-50 text-sky-700">
              脚手架: {proposal.scaffoldTemplate}
            </Badge>
          ) : null}
        </div>

        {isAgentProposal ? (
          <div className="space-y-1.5">
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground">智能体类型</div>
            <div className="flex flex-wrap items-center gap-1.5">
              {ALL_AGENT_KINDS.map((kind) => {
                const active = currentKind === kind;
                return (
                  <Button
                    key={kind}
                    type="button"
                    size="sm"
                    variant={active ? "primary" : "outline"}
                    disabled={disabled}
                    onClick={() => switchKind(kind)}
                    className="h-7 px-2 text-xs"
                    title={
                      kind === "tool"
                        ? "专用型：可作为本地工具型能力调用"
                        : kind === "agentic"
                          ? "自主型：要求结构化输出后可被本地工具化调用"
                          : "应用型：独立部署运行"
                    }
                  >
                    {AGENT_KIND_SHORT_LABELS[kind]}
                  </Button>
                );
              })}
            </div>
            <p className="text-[11px] text-muted-foreground">
              点其它类型会要求智能体按新类型重新出方案；当前选中的不会重新生成。
            </p>
          </div>
        ) : null}

        <div className="space-y-1">
          <div className="text-[11px] uppercase tracking-wide text-muted-foreground">名称</div>
          <div className="font-mono text-sm text-foreground">{proposal.name}</div>
        </div>

        {proposal.description ? (
          <div className="space-y-1">
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground">描述</div>
            <div className="text-sm leading-5 text-foreground">{proposal.description}</div>
          </div>
        ) : null}

        {proposal.summary ? (
          <div className="rounded-md border border-border-light bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
            {proposal.summary}
          </div>
        ) : null}
      </div>

      <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-primary/10 bg-muted/20 px-4 py-2.5">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled}
          onClick={() => fillInput("取消，先不要创建。", true)}
        >
          <X className="size-4" />
          取消
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled}
          onClick={() => fillInput(`请按以下方向调整这份方案：\n- `, false)}
        >
          <MessageSquareText className="size-4" />
          修改
        </Button>
        <Button
          type="button"
          variant="primary"
          size="sm"
          disabled={disabled}
          onClick={() => fillInput("确认，请按这份方案创建。", true)}
        >
          <Check className="size-4" />
          确认创建
        </Button>
      </footer>
    </div>
  );
}
