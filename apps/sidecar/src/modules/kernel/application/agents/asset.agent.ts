import type { WorkerAgentSpec } from "@a3s-lab/code";
import { Inject, Injectable, Logger } from "@nestjs/common";
import type {
  AgentSessionContext,
  AgentSpec,
  StreamEventContext,
} from "../../domain/services/agent-spec.interface";
import {
  type IKernelService,
  KERNEL_SERVICE,
} from "../../domain/services/kernel-service.interface";
import type { SessionRuntimeOverrides } from "../session-runtime.types";
import {
  ASSET_ADVISOR_PROMPT,
  ASSET_AGENT_GUIDELINES,
  ASSET_AGENT_ROLE,
} from "./prompts/asset-agent.prompts";
import { LOCKED_AGENT_POLICY } from "./locked-agent.policy";
import { LockedAgentSessionStore } from "./locked-agent-session.store";
import {
  type AssetAgentPhase,
  type AssetProposal,
  detectAssetCreatedMarker,
  detectAssetPhaseMarker,
  extractAssetProposalBlocks,
  parseAssetProposalDetailed,
} from "./asset-marker.util";

@Injectable()
export class AssetAgent implements AgentSpec {
  readonly id = "asset";
  private readonly logger = new Logger(AssetAgent.name);

  constructor(
    @Inject(KERNEL_SERVICE) private readonly kernelService: IKernelService,
    private readonly store: LockedAgentSessionStore,
  ) {}

  onSessionEnd(ctx: { sessionId: string }): void {
    this.store.delete(ctx.sessionId);
  }

  /**
   * Any user-authored turn after a proposal counts as engagement — the model is
   * responsible (per prompt) for re-reading what the user actually said and
   * either proceeding with createAsset or emitting a new proposal. The new
   * proposal resets the flag in onStreamText, so a "no, change X" path
   * naturally re-requires confirmation.
   */
  onUserMessage(ctx: { sessionId: string; agentId: string; userId: string }, _content: string): void {
    const session = this.store.get(ctx.sessionId);
    if (!session?.asset) return;
    if (session.asset.lastProposal && !session.asset.proposalConfirmed) {
      session.asset.proposalConfirmed = true;
    }
    this.store.touch(ctx.sessionId);
  }

  role(): string {
    return ASSET_AGENT_ROLE;
  }

  guidelines(): string {
    return ASSET_AGENT_GUIDELINES;
  }

  extra(ctx?: { sessionId?: string }): string {
    if (!ctx?.sessionId) return "";
    const session = this.store.get(ctx.sessionId);
    if (!session) return "";

    const phase = session.phase as AssetAgentPhase;
    const lines = [
      "## Current State",
      "",
      `Phase: **${PHASE_LABELS[phase] || phase}**`,
    ];
    const targetCategory = session.asset?.targetCategory;
    if (targetCategory && !session.assetId) {
      lines.push(
        "",
        `Target asset category (set by the create dialog): **${targetCategory}**. Use \`category: "${targetCategory}"\` when calling \`createAsset\` unless the user explicitly requests a different supported type.`
      );
    }
    const targetAgentKind = session.asset?.targetAgentKind;
    if (targetAgentKind && targetCategory === "agent" && !session.assetId) {
      const kindHints: Record<"tool" | "application" | "agentic", string> = {
        tool:
          "tool — 专用型智能体。需遵循 a3s-code 工具协议、暴露结构化 input/output schema，可被工作流编排作为节点调用。脚手架优先选 a3s-code-tool-agent / a3s-code-python-tool-agent。",
        application:
          "application — 应用型智能体。独立部署到\"进程\"页，不要求结构化输出。脚手架优先选 a3s-code-basic-agent / a3s-code-python-basic-agent。",
        agentic:
          "agentic — 自主型智能体。基于 a3s-code 或其它框架开发，面向交互式对话场景；要求**必须产出结构化输出**才能被工作流编排调用，请在脚手架里默认带上 generate_object / structured output 示例。",
      };
      lines.push(
        "",
        `Target agent kind (set by the create dialog): **${targetAgentKind}**. ${kindHints[targetAgentKind]} Pass \`agentKind: "${targetAgentKind}"\` to \`createAsset\` unless the user explicitly switches.`
      );
    }
    const initialPrompt = session.asset?.initialPrompt;
    if (initialPrompt && !session.assetId) {
      lines.push("", `User intent for this session: ${initialPrompt}`);
    }
    if (session.assetId) {
      lines.push(
        "",
        "## Session Asset Lock",
        "",
        `This session is bound to asset \`${session.assetId}\`.`
      );
      lines.push(
        "",
        "Hard rule: continue modifying and iterating on this digital asset only. Do not create, clone, delete, or modify any other digital asset in this session.",
        `If capabilities is actually listed in the current runtime and you use it for assets write operations, include \`sessionId: "${ctx.sessionId}"\`, and the target asset id must be \`${session.assetId}\`.`
      );
    } else {
      lines.push(
        "",
        "## Session Asset Lock",
        "",
        "This session is not bound to a digital asset yet. You may create or select exactly one asset in this session. After binding, continue modifying and iterating on that asset only.",
        `If capabilities is actually listed in the current runtime and you use it for assets write operations, include \`sessionId: "${ctx.sessionId}"\`; the platform will enforce the first bound asset.`
      );
    }

    // Proposal gate state — keep the model honest about whether it can call
    // createAsset yet. The understanding-phase prompt requires emitting a
    // structured ```asset-proposal block and waiting for explicit user
    // confirmation; this section reflects the runtime view of that state.
    const proposalState = session.asset;
    if (proposalState && !session.assetId) {
      lines.push("", "## Proposal Gate");
      if (!proposalState.lastProposal) {
        lines.push(
          "",
          "No proposal has been emitted yet. You MUST emit a `\`\`\`asset-proposal` JSON block summarising your inferred plan (category / name / visibility / description / agentKind when applicable / scaffoldTemplate when applicable) BEFORE calling `createAsset`. The block is rendered as a confirmation card to the user.",
        );
      } else {
        const json = JSON.stringify(proposalState.lastProposal);
        lines.push(
          "",
          `Most recent proposal you emitted: \`${json}\``,
        );
        if (proposalState.proposalConfirmed) {
          lines.push(
            "",
            "The user has replied since you emitted this proposal — treat it as engaged. Re-read the latest user message: if they approve (`好` / `ok` / `确认` / `proceed` / similar), transition to creating and call `createAsset`. If they reject or ask for changes, emit a NEW `\`\`\`asset-proposal` block reflecting the updated plan and wait again.",
          );
        } else {
          lines.push(
            "",
            "The user has NOT replied since you emitted this proposal. You MUST NOT call `createAsset` yet. Wait for the user.",
          );
        }
      }
      // 把上一次因 schema/contract 不合规被拒的 issues 喂回 LLM，让它在
      // 下一轮提案里把错误改掉，避免在同样的违规上反复试错。
      if (proposalState.lastProposalRejection) {
        const rejection = proposalState.lastProposalRejection;
        lines.push(
          "",
          "### Last proposal REJECTED",
          "",
          "Your previous `\`\`\`asset-proposal` block did NOT pass server-side validation and was discarded (the user did not see it). Fix every issue below in your NEXT proposal block:",
          "",
          ...rejection.issues.map(issue => `- ${issue}`),
          "",
          "Common causes:",
          "- For `agentKind: \"tool\"` or `agentKind: \"agentic\"`, you MUST include valid `inputSchema` and `outputSchema` (JSON Schema subset; no oneOf / anyOf / allOf / format / remote $ref).",
          "- For `agentKind: \"agentic\"`, you MUST include `capabilities: { tools: [...], skills: [...] }`.",
          "- Schemas must declare `type` at every node, use `properties` / `required` / `items` / `enum` / `additionalProperties:boolean` only.",
          "",
          "Emit a corrected proposal now; do not respond to the user until the proposal passes validation.",
        );
      }
    }

    return lines.join("\n");
  }

  workers(): WorkerAgentSpec[] {
    return [
      {
        name: "asset-advisor",
        description:
          "Advises on asset category selection, naming conventions, and configuration best practices",
        kind: "read_only",
        hidden: true,
        maxSteps: 3,
        prompt: ASSET_ADVISOR_PROMPT,
      },
    ];
  }

  runtimeDefaults(): Partial<SessionRuntimeOverrides> {
    return {
      maxToolRounds: 12,
      continuationEnabled: true,
      maxContinuationTurns: 3,
      permissionMode: LOCKED_AGENT_POLICY.permissionMode,
      planningMode: LOCKED_AGENT_POLICY.planningMode,
      goalTracking: LOCKED_AGENT_POLICY.goalTracking,
      // capabilities 是 OS 渐进式 API 的 meta-skill —— 让资产开发 agent 通过
      // list/search/describe/execute 探索 assets 模块的字段约束 / inputSchema /
      // outputSchema,而不是凭 prompt 例子硬编码。cloud 下 skill 默认被
      // isCloudRuntimeSkillAllowed deny,这里显式 opt-in;CapabilitiesToolService
      // 的 assertSingleAssetSessionCanExecute 内层 RBAC 兜底,只允许 assets
      // 写操作且锁定本会话绑定的单资产。
      skills: ["a3s-code-agent-framework", "capabilities"],
    };
  }

  onStreamText(
    ctx: StreamEventContext,
    fullText: string,
    _delta: string
  ): void {
    const session = this.store.get(ctx.sessionId);
    if (!session?.asset) return;
    this.store.touch(ctx.sessionId);
    const assetState = session.asset;

    // Proposal blocks: every new ```asset-proposal``` JSON block is parsed,
    // surfaced via SSE so the UI can render a confirmation card, and used to
    // reset the confirmation gate. A subsequent proposal that differs from the
    // last one means "I changed my mind, please re-confirm".
    const { blocks: proposalBlocks, lastOffset: proposalOffset } =
      extractAssetProposalBlocks(fullText, assetState.lastProposalParsedOffset);
    if (proposalOffset > assetState.lastProposalParsedOffset) {
      assetState.lastProposalParsedOffset = proposalOffset;
    }
    for (const block of proposalBlocks) {
      const { proposal, issues } = parseAssetProposalDetailed(block);
      if (!proposal) {
        // 把 issues 钉在 session state 上，下一轮 extra() 会把它喂回给 LLM，
        // 让模型看到具体哪里不合规（schema 含 oneOf、缺 capabilities、agentKind=tool 漏 schema 等）。
        // 同时也 emit SSE，方便前端在 UI 上提示用户/调用方"模型方案被拒"。
        assetState.lastProposalRejection = {
          issues,
          rawSnippet: block.length > 800 ? `${block.slice(0, 800)}…` : block,
          timestamp: Date.now(),
        };
        this.logger.debug(
          `Rejected asset-proposal block on session ${ctx.sessionId}: ${issues.join('; ')}`,
        );
        ctx.emit({
          type: "asset_proposal_rejected",
          issues,
          timestamp: Date.now(),
        });
        continue;
      }
      // 合法 proposal 到达 → 清除上一次的拒绝记录
      assetState.lastProposalRejection = undefined;
      if (
        !assetState.lastProposal ||
        !sameProposal(assetState.lastProposal, proposal)
      ) {
        assetState.proposalConfirmed = false;
      }
      assetState.lastProposal = proposal;
      ctx.emit({
        type: "asset_proposal",
        proposal,
        timestamp: Date.now(),
      });
    }

    // Phase markers: consume every marker since the last offset and
    // transition lane each time the value actually changes. Each marker
    // advances its own offset so we never re-fire on subsequent deltas.
    while (true) {
      const marker = detectAssetPhaseMarker(fullText, assetState.lastPhaseMarkerOffset);
      if (!marker) break;
      assetState.lastPhaseMarkerOffset = marker.index + marker.length;
      const newPhase = marker.phase;
      if (session.phase === newPhase) continue;
      const previousPhase = session.phase;
      void this.store.transitionPhase(ctx.sessionId, newPhase);
      ctx.emit({
        type: "agent_phase",
        phase: newPhase,
        previousPhase,
        timestamp: Date.now(),
      });
    }

    // ASSET_CREATED markers: each new asset id triggers a lock + binding
    // exactly once. After the session is locked to an asset, any further
    // marker referencing a different asset id is reported as a lock
    // violation (the asset write enforcement layer is the actual guard).
    while (true) {
      const marker = detectAssetCreatedMarker(fullText, assetState.lastCreatedMarkerOffset);
      if (!marker) break;
      assetState.lastCreatedMarkerOffset = marker.index + marker.length;
      const assetId = marker.assetId;
      if (assetState.createdAssetIds.includes(assetId)) continue;
      if (session.assetId && session.assetId !== assetId) {
        ctx.emit({
          type: "asset_agent_lock_violation",
          lockedAssetId: session.assetId,
          attemptedAssetId: assetId,
          message: "当前会话已绑定一个数字资产，忽略后续资产创建标记。",
          timestamp: Date.now(),
        });
        continue;
      }
      assetState.createdAssetIds.push(assetId);
      this.store.persistEphemeral(ctx.sessionId);
      this.lockAsset(ctx.sessionId, assetId).catch((err) => {
        this.logger.warn(
          `Failed to bind asset session ${ctx.sessionId}: ${
            err instanceof Error ? err.message : err
          }`
        );
      });
      ctx.emit({ type: "asset_binding", assetId, timestamp: Date.now() });
    }
  }

  async onSessionCreate(
    ctx: AgentSessionContext
  ): Promise<Record<string, unknown>> {
    const lockedAssetId = this.stringValue(ctx.metadata?.assetId);
    const targetCategory = this.stringValue(ctx.metadata?.assetCategory);
    const initialPrompt = this.stringValue(ctx.metadata?.initialPrompt);
    const rawAgentKind = this.stringValue(ctx.metadata?.agentKind);
    const targetAgentKind =
      rawAgentKind === "tool" || rawAgentKind === "application" || rawAgentKind === "agentic"
        ? rawAgentKind
        : undefined;
    this.store.create(ctx.sessionId, "asset", lockedAssetId, "understanding", {
      targetCategory,
      targetAgentKind,
      initialPrompt,
    });
    if (lockedAssetId) {
      void this.lockAsset(ctx.sessionId, lockedAssetId);
    }
    return {
      agentType: "asset",
      singleAssetSession: true,
      agentPhase: "understanding",
      ...(lockedAssetId ? { assetId: lockedAssetId } : {}),
    };
  }

  private async lockAsset(sessionId: string, assetId: string): Promise<void> {
    this.store.bindAsset(sessionId, assetId);
    const session = this.store.get(sessionId);
    await this.kernelService.updateSession(sessionId, {
      assetId,
      agentPhase: session?.phase,
      singleAssetSession: true,
    });
  }

  private stringValue(value: unknown): string | undefined {
    return typeof value === "string" && value.trim() ? value.trim() : undefined;
  }
}

const PHASE_LABELS: Record<AssetAgentPhase, string> = {
  understanding: "Understanding",
  creating: "Creating asset",
  configuring: "Configuring asset",
  done: "Done",
};

function sameProposal(a: AssetProposal, b: AssetProposal): boolean {
  return (
    a.category === b.category &&
    a.name === b.name &&
    a.visibility === b.visibility &&
    (a.description ?? "") === (b.description ?? "") &&
    (a.agentKind ?? "") === (b.agentKind ?? "") &&
    (a.scaffoldTemplate ?? "") === (b.scaffoldTemplate ?? "")
  );
}
