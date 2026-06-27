import type { WorkerAgentSpec } from '@a3s-lab/code';
import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { ASSET_SERVICE, type IAssetService } from '@/modules/assets/domain/services/asset.service.interface';
import { SerialChainPlannerService } from '../orchestration/serial-chain-planner/serial-chain-planner.service';
import type { Chain } from '../orchestration/serial-chain-planner/schemas';
import type { WorkflowDefinitionSpec } from '../orchestration/workflow-definition.types';
interface AgentNodeIntent {
    nodeId: string;
    name?: string;
    description?: string;
    requirement?: string;
    successCriteria?: string;
}

interface AgentBinding {
    nodeId: string;
    agentId: string;
    agentName: string;
    agentKind: 'tool' | 'agentic';
    fallback: boolean;
    packageId: string;
    packageVersion: string;
}

interface AgentBindingResolverService {
    resolveBindings(intents: AgentNodeIntent[], userId: string): Promise<{ bindings: AgentBinding[] }>;
}

interface MarketplaceService {
    listListedAgentAssets(
        currentUserId: string | undefined,
        options: { keyword?: string; page?: number; limit?: number; scenario?: string },
    ): Promise<{
        items: { asset: { name: string; description?: string | null; metadata?: unknown }; listing: unknown | null }[];
        total: number;
        page: number;
        limit: number;
    }>;
}
interface WorkflowRepairPlanService {
    createFromRepairTrace(
        projectId: string,
        repairTrace: Chain['repair_trace'],
        options: {
            prompt?: string;
            graphSnapshot?: WorkflowDefinitionSpec;
            userId: string;
        },
    ): Promise<unknown>;
}
import type {
    AgentSessionContext,
    AgentSpec,
    StreamEventContext,
    WorkspaceUploadMetadata,
} from '../../domain/services/agent-spec.interface';
import {
    type FileAttachedData,
    type OrchestrationPhase,
    OrchestrationTimelineService,
} from '../orchestration-timeline.service';
import type { SessionRuntimeOverrides } from '../session-runtime.types';
import {
    ORCHESTRATION_GUIDELINES,
    ORCHESTRATION_ROLE,
    WORKFLOW_ARCHITECT_PROMPT,
    WORKFLOW_VALIDATOR_PROMPT,
} from './prompts/orchestration-agent.prompts';
import {
    detectPhaseMarker,
    detectPlannerMarker,
    extractWorkflowDeltaBlocks,
    extractWorkflowBlocks,
    type PlannerMarkerKind,
} from './workflow-parser.util';
import { LOCKED_AGENT_POLICY } from './locked-agent.policy';
import { type LockedAgentSessionEntry, LockedAgentSessionStore } from './locked-agent-session.store';
import {
    describeWorkflowIssues,
    WorkflowStructuralValidator,
    type WorkflowStructuralIssue,
} from './workflow-structural-validator';

type WorkflowGraphSnapshot = { nodes: unknown[]; edges: unknown[] };
type WorkflowUpdateSource = 'workflow-delta' | 'workflow-json' | 'planner';
type WorkflowDeltaOperationKind = 'upsert_node' | 'delete_node' | 'upsert_edge' | 'delete_edge';
type WorkflowGraphUpdateStep = {
    graph: WorkflowGraphSnapshot;
    operation?: WorkflowDeltaOperationKind;
    changedNodeIds?: string[];
    changedEdgeIds?: string[];
};

/**
 * 当前开放平台前端只能渲染"自定义智能体节点"（type === 'agent'）以及画布上必备的
 * start/end 框架节点。引擎原生节点（http / llm / code / condition / loop /
 * group / comment / package-*）虽然可以被工作流引擎执行，但 UI 没有对应卡片渲染
 * → 用户看到的画布就是空白。所以编排智能体在这个会话里只允许产出这三种类型，
 * 验证器把这条规则作为持久化的硬闸门。
 */
const ORCHESTRATION_ALLOWED_NODE_TYPES = new Set(['start', 'end', 'agent']);

@Injectable()
export class OrchestrationAgent implements AgentSpec {
    readonly id = 'orchestration';
    private readonly logger = new Logger(OrchestrationAgent.name);
    private readonly structuralValidator = new WorkflowStructuralValidator({
        allowedNodeTypes: ORCHESTRATION_ALLOWED_NODE_TYPES,
        // 编排画布只渲染单链：start → agent → agent → … → end。
        // Fan-out / fan-in 由 validator 拦截在 persist 前，保证 canvas 永远是一条线。
        requireSerialChain: true,
    });

    /**
     * Process-wide marketplace catalog cache. Catalog content (listed
     * tool / agentic agents) is user-independent for the "listed" subset, so
     * one cache serves all sessions. 60s TTL keeps the system prompt fresh
     * after publish events without re-hitting marketplace on every turn.
     * The in-flight promise dedupes concurrent refresh attempts when several
     * turns start within the same TTL window.
     */
    private marketplaceCatalogCache: {
        entries: Array<{ name: string; agentKind: 'tool' | 'agentic'; description: string }>;
        total: number;
        fetchedAt: number;
    } | null = null;
    private marketplaceCatalogInflight: Promise<void> | null = null;
    private static readonly CATALOG_TTL_MS = 60_000;
    private static readonly CATALOG_FETCH_LIMIT = 50;
    private static readonly CATALOG_DESC_MAX = 160;

    constructor(
        @Inject(ASSET_SERVICE) private readonly assetService: IAssetService,
        private readonly timeline: OrchestrationTimelineService,
        private readonly planner: SerialChainPlannerService,
        private readonly store: LockedAgentSessionStore,
        @Optional() private readonly bindingResolver?: AgentBindingResolverService,
        @Optional() private readonly marketplaceService?: MarketplaceService,
        @Optional() private readonly repairPlanService?: WorkflowRepairPlanService,
    ) {}

    onSessionEnd(ctx: { sessionId: string }): void {
        this.store.delete(ctx.sessionId);
    }

    /**
     * Refresh the in-process marketplace catalog cache so the next
     * `extra()` call can render an up-to-date `## Marketplace Catalog`
     * block. No-op when:
     * - `MarketplaceService` is not wired (e.g. desktop sidecar / tests).
     * - The existing cache is still fresh (within {@link CATALOG_TTL_MS}).
     * - Another refresh is already in flight (dedupe via promise).
     *
     * Errors are swallowed with a warn log so a flaky marketplace never
     * blocks the user turn. `extra()` will simply fall back to the previous
     * cache (or omit the catalog block entirely on cold start).
     */
    private async refreshMarketplaceCatalog(userId: string): Promise<void> {
        if (!this.marketplaceService) return;
        const now = Date.now();
        if (
            this.marketplaceCatalogCache &&
            now - this.marketplaceCatalogCache.fetchedAt < OrchestrationAgent.CATALOG_TTL_MS
        ) {
            return;
        }
        if (this.marketplaceCatalogInflight) return this.marketplaceCatalogInflight;
        this.marketplaceCatalogInflight = (async () => {
            try {
                const result = await this.marketplaceService!.listListedAgentAssets(userId, {
                    page: 1,
                    limit: OrchestrationAgent.CATALOG_FETCH_LIMIT,
                });
                const entries = result.items
                    .map(({ asset }) => ({
                        name: asset.name,
                        agentKind: (asset as { agentKind?: unknown }).agentKind,
                        description: (asset.description ?? '').trim(),
                    }))
                    .filter(
                        (entry): entry is { name: string; agentKind: 'tool' | 'agentic'; description: string } =>
                            entry.agentKind === 'tool' || entry.agentKind === 'agentic',
                    )
                    .map(entry => ({
                        ...entry,
                        description:
                            entry.description.length > OrchestrationAgent.CATALOG_DESC_MAX
                                ? `${entry.description.slice(0, OrchestrationAgent.CATALOG_DESC_MAX - 1)}…`
                                : entry.description,
                    }));
                this.marketplaceCatalogCache = {
                    entries,
                    total: entries.length,
                    fetchedAt: Date.now(),
                };
            } catch (err) {
                this.logger.warn(`Marketplace catalog refresh failed: ${err instanceof Error ? err.message : err}`);
            } finally {
                this.marketplaceCatalogInflight = null;
            }
        })();
        await this.marketplaceCatalogInflight;
    }

    /**
     * End-of-turn final-save checkpoint. If the assistant emitted any
     * workflow-delta / workflow-json / planner update during the turn, force
     * one last `persistIfValid` on the latest `currentGraph` so the flow.json
     * always has a commit corresponding to the turn the user just saw on the
     * canvas — even if the SSE was cancelled, the browser tab closed, or the
     * streamed deltas were all individually persisted (in which case this is
     * a cheap no-op since the graph is unchanged but the commit captures the
     * "turn complete" boundary).
     *
     * Skipped when the turn emitted no workflow updates (pure Q&A), to avoid
     * empty commits on every conversation reply.
     */
    async onStreamEnd(ctx: StreamEventContext, _fullText: string): Promise<void> {
        const session = this.store.get(ctx.sessionId);
        const orch = session?.orchestration;
        if (!session?.assetId || !orch) return;
        if (!orch.workflowEmittedThisTurn) return;
        const graph = orch.currentGraph;
        if (!graph || !Array.isArray(graph.nodes) || graph.nodes.length === 0) return;
        orch.workflowEmittedThisTurn = false;
        try {
            await this.persistIfValid(session.assetId, graph, session, ctx);
        } catch (err) {
            this.logger.warn(
                `Final end-of-turn persist failed for session ${session.sessionId}: ${err instanceof Error ? err.message : err}`,
            );
        }
    }

    async onUserMessage(ctx: { sessionId: string; agentId: string; userId: string }, content: string): Promise<void> {
        // 优先从 store 取;若内存中没有(server 重启 / 实例切换),通过 getOrRecover
        // 从持久化 session metadata 重建一份。否则后续 delta 会基于空图计算,
        // 导致第二次对话看不到第一次的节点。
        const session = await this.store.getOrRecover(ctx.sessionId);
        if (!session?.orchestration) return;
        session.orchestration.lastUserPrompt = content;
        session.orchestration.plannerFiredThisTurn = false;
        session.orchestration.workflowEmittedThisTurn = false;

        // Block the turn start on a marketplace catalog refresh when the
        // cache is stale, so the system prompt rendered for this turn always
        // carries an up-to-date `## Marketplace Catalog` block. Inflight
        // dedupe means parallel turns within the TTL only fire one query.
        await this.refreshMarketplaceCatalog(ctx.userId);

        // 关键修复:每个新 turn 开始前从 flow.json 重新 hydrate currentGraph。
        // 即使内存里已经有,也覆盖一次,确保与画布(asset blob)严格一致 ——
        // 用户可能在两次对话间直接编辑了画布。
        if (session.assetId) {
            session.orchestration.currentGraph = await this.loadGraphFromAsset(session.assetId);
        }
        this.store.touch(ctx.sessionId);
    }

    private async loadGraphFromAsset(assetId: string): Promise<{ nodes: unknown[]; edges: unknown[] }> {
        try {
            const raw = await this.assetService.getBlobContent(assetId, 'flow.json');
            if (!raw) return { nodes: [], edges: [] };
            const parsed = JSON.parse(raw);
            const nodes = Array.isArray(parsed?.nodes) ? (parsed.nodes as unknown[]) : [];
            const edges = Array.isArray(parsed?.edges) ? (parsed.edges as unknown[]) : [];
            return { nodes, edges };
        } catch (err) {
            this.logger.debug(`loadGraphFromAsset(${assetId}) skipped: ${err instanceof Error ? err.message : err}`);
            return { nodes: [], edges: [] };
        }
    }

    async onSessionCreate(ctx: AgentSessionContext): Promise<Record<string, unknown>> {
        const assetName = `workflow-${ctx.sessionId.slice(0, 8)}`;
        const assetDescription = '编排智能体自动创建的工作流';
        const asset = await this.assetService.createAsset(
            assetName,
            ctx.userId,
            'user',
            'workflow',
            'private',
            assetDescription,
            undefined,
            { sessionId: ctx.sessionId, lifecycleState: 'draft' },
        );

        this.store.create(ctx.sessionId, 'orchestration', asset.id, 'requirement_collection');

        // Fire-and-forget: initial blob + timeline don't block session creation.
        // 内置工作流资产形态：`.a3s/manifest.acl` + `flow.json`。NL 创建的资产
        // 同样落两份文件，保证导出后能被 builtin-asset syncer 识别为 workflow。
        void this.assetService
            .updateBlob(
                asset.id,
                'flow.json',
                JSON.stringify({ nodes: [], edges: [] }, null, 2),
                'init: 初始化工作流定义',
                'main',
            )
            .catch(err => {
                this.logger.warn(`Failed to init flow.json for asset ${asset.id}: ${err}`);
            });
        void this.assetService
            .updateBlob(
                asset.id,
                '.a3s/manifest.acl',
                renderWorkflowManifestAcl({
                    name: assetName,
                    ownerType: 'user',
                    ownerId: ctx.userId,
                    description: assetDescription,
                }),
                'init: 写入资产清单',
                'main',
            )
            .catch(err => {
                this.logger.warn(`Failed to init manifest.acl for asset ${asset.id}: ${err}`);
            });

        const phaseEvent = this.timeline.createEvent(ctx.sessionId, 'phase_transition', {
            from: null,
            to: 'requirement_collection',
            reason: 'session_created',
        });
        void this.timeline.appendEvent(asset.id, phaseEvent);

        return {
            assetId: asset.id,
            singleAssetSession: true,
            agentPhase: 'requirement_collection',
        };
    }

    async onFileAttached(ctx: AgentSessionContext & { upload: WorkspaceUploadMetadata }): Promise<void> {
        const session = this.store.get(ctx.sessionId);
        if (!session?.orchestration) return;

        session.orchestration.files.push({
            uploadId: ctx.upload.uploadId,
            fileName: ctx.upload.fileName,
            mimeType: ctx.upload.mimeType,
            size: ctx.upload.size,
            path: ctx.upload.path,
        });

        const event = this.timeline.createEvent(ctx.sessionId, 'file_attached', {
            uploadId: ctx.upload.uploadId,
            fileName: ctx.upload.fileName,
            mimeType: ctx.upload.mimeType,
            size: ctx.upload.size,
            sha256: ctx.upload.sha256,
        } satisfies FileAttachedData);
        void this.timeline.appendEvent(session.assetId, event);
        this.store.persistEphemeral(ctx.sessionId);
    }

    role(): string {
        return ORCHESTRATION_ROLE;
    }

    guidelines(): string {
        return ORCHESTRATION_GUIDELINES;
    }

    extra(ctx?: { sessionId?: string }): string {
        if (!ctx?.sessionId) return '';
        const session = this.store.get(ctx.sessionId);
        if (!session?.orchestration) return '';

        const blocks: string[] = [];
        const orch = session.orchestration;

        if (orch.files.length > 0) {
            const lines = [
                '## Current Workspace Files',
                '',
                'The following files have been uploaded to the session workspace. Read them only with workspace read tools that are actually listed in the current runtime:',
                '',
            ];
            for (const file of orch.files) {
                const sizeKB = Math.round(file.size / 1024);
                let line = `- **${file.fileName}** - ${file.mimeType || 'unknown type'}, ${sizeKB}KB`;
                if (file.path) line += ` - path: \`${file.path}\``;
                lines.push(line);
            }
            lines.push('', 'When referring to a file, use the uploaded file name exactly.');
            blocks.push(lines.join('\n'));
        }

        const phase = session.phase as OrchestrationPhase;
        const phaseLines = ['## Current Phase', '', `Current phase: **${PHASE_LABELS[phase] || phase}**.`];
        if (phase === 'requirement_collection') {
            phaseLines.push('Continue collecting and confirming requirements. Do not rush into workflow-json output.');
        }
        blocks.push(phaseLines.join('\n'));

        blocks.push(
            [
                '## Session Asset Lock',
                '',
                `This session is already bound to workflow asset \`${session.assetId}\`.`,
                'Create, modify, and iterate on this digital asset only. Do not create, clone, delete, or modify any other digital asset in this session.',
            ].join('\n'),
        );

        // 当前画布快照 —— 每个新 turn 开始时,onUserMessage 已经从 flow.json
        // 重新 hydrate 了 currentGraph,这里把它的概要塞到 system prompt,
        // 让 model 在多轮对话中"看得见"上一次自己/用户留下的节点和边。
        const canvas = orch.currentGraph;
        const nodeCount = Array.isArray(canvas?.nodes) ? canvas!.nodes.length : 0;
        const edgeCount = Array.isArray(canvas?.edges) ? canvas!.edges.length : 0;
        const canvasLines = [
            '## Current Canvas State',
            '',
            `Workflow asset currently has **${nodeCount} node(s) and ${edgeCount} edge(s)** persisted to \`flow.json\`.`,
        ];
        if (nodeCount > 0 && canvas) {
            canvasLines.push(
                '',
                'Existing graph (loaded from the asset at the start of this turn — treat as authoritative):',
                '',
                '```json',
                JSON.stringify(canvas, null, 2),
                '```',
                '',
                'When the user asks for ANY change to the workflow, you MUST re-emit the COMPLETE `workflow-json` block representing the FULL intended state (including unchanged nodes), NOT a partial delta. The platform will diff and version it. Do not assume the canvas is empty just because you cannot see your previous turn — the snapshot above IS the truth.',
            );
        } else {
            canvasLines.push(
                '',
                'Canvas is currently empty. Once you decide on the design, emit a complete `workflow-json` block with all nodes and edges.',
            );
        }
        blocks.push(canvasLines.join('\n'));

        if (orch.lastValidationIssues && orch.lastValidationIssues.length > 0) {
            blocks.push(
                [
                    '## Workflow Structural Errors From Your Last Output',
                    '',
                    'Your most recently emitted workflow graph failed structural validation and was NOT persisted to the workflow asset. You must fix every issue below in your next output. Until the graph passes validation, no save is committed and the user only sees the broken state highlighted in red on the canvas.',
                    '',
                    describeWorkflowIssues(orch.lastValidationIssues),
                    '',
                    'Re-emit a complete `workflow-json` block whose `nodes` and `edges` form a single DAG with exactly one `start`, exactly one `end`, every node reachable from `start`, every node able to reach `end`, and every `condition.data.conditions[].targetNodeId` / `defaultNodeId` pointing at a real sibling. Do not emit partial deltas while fixing — emit the complete corrected graph.',
                ].join('\n'),
            );
        }

        const catalog = this.marketplaceCatalogCache;
        if (catalog && catalog.entries.length > 0) {
            const lines: string[] = [
                '## Marketplace Catalog (Listed Non-Application Agents)',
                '',
                `${catalog.entries.length} of ${catalog.total} listed non-application agents available to bind. The server resolver picks one per \`agent\` node automatically based on your node's \`name\` + \`description\` + \`success_criteria\`. **Treat this as a menu**: when designing node intents, align names and descriptions with the closest entry below so the resolver makes a clean semantic match (not a fallback). You still do NOT emit \`agentId\` — the resolver does the actual binding.`,
                '',
                '| Name | Kind | Description |',
                '| --- | --- | --- |',
            ];
            for (const entry of catalog.entries) {
                const desc = entry.description.replace(/\|/g, '\\|').replace(/\n/g, ' ');
                lines.push(`| ${entry.name} | ${entry.agentKind} | ${desc || '—'} |`);
            }
            blocks.push(lines.join('\n'));
        }

        if (orch.lastBindingError) {
            blocks.push(
                [
                    '## Agent Binding Failed On Your Last Output',
                    '',
                    'The platform tried to auto-bind every `agent` node to a published-listed non-application agent (tool / agentic) but FAILED. The workflow WAS still persisted to git so your conversational design history is preserved, but the `agent` nodes carry no `agentId` / `packageId` and the DAG is NOT runnable until the bindings resolve. Reason:',
                    '',
                    `> ${orch.lastBindingError.message}`,
                    '',
                    'Stop iterating on `workflow-json` / `workflow-delta` blocks until this is resolved. Tell the user clearly that the marketplace currently has no suitable non-application agent and they need to publish at least one `tool` or `agentic` agent before the workflow can execute. Suggest concrete next steps (e.g. open the agent factory, publish a draft as tool kind). Once the user confirms the marketplace state is fixed, re-emit the same workflow on the next turn — the resolver will retry and stamp the bindings.',
                ].join('\n'),
            );
        }

        if (orch.lastAgentBindings && orch.lastAgentBindings.length > 0) {
            const lines: string[] = [
                '## Agent Bindings Auto-Resolved On Your Last Output',
                '',
                "The platform automatically bound each `agent` node in your last persisted graph to a real published-listed non-application agent (tool / agentic) and stamped its OCI `packageId` / `packageVersion` so the workflow runtime can pull the image at execution time. You did NOT control these bindings — the resolver picked them from the marketplace based on each node's name + description + success_criteria. Fallback bindings indicate the resolver could not find a semantic match and used a default candidate; if a fallback looks wrong, improve the node's name / description / success_criteria so the next round can match better.",
                '',
                '| Node ID | Bound Agent | Kind | Package | Match |',
                '| --- | --- | --- | --- | --- |',
            ];
            for (const b of orch.lastAgentBindings) {
                const pkg = b.packageId ? `${b.packageId}${b.packageVersion ? `@${b.packageVersion}` : ''}` : '—';
                lines.push(
                    `| ${b.nodeId} | ${b.agentName} (${b.agentId}) | ${b.agentKind} | ${pkg} | ${b.fallback ? 'fallback' : 'semantic'} |`,
                );
            }
            blocks.push(lines.join('\n'));
        }

        return blocks.join('\n\n');
    }

    workers(): WorkerAgentSpec[] {
        return [
            {
                name: 'workflow-architect',
                description:
                    'Workflow architecture specialist that designs node graphs, validates connections, and suggests optimizations',
                kind: 'read_only',
                hidden: true,
                maxSteps: 5,
                prompt: WORKFLOW_ARCHITECT_PROMPT,
            },
            {
                name: 'workflow-validator',
                description:
                    'Validates workflow definitions for correctness, detects cycles, missing connections, and unreachable nodes',
                kind: 'read_only',
                hidden: true,
                maxSteps: 3,
                prompt: WORKFLOW_VALIDATOR_PROMPT,
            },
        ];
    }

    runtimeDefaults(): Partial<SessionRuntimeOverrides> {
        return {
            maxToolRounds: 8,
            continuationEnabled: true,
            maxContinuationTurns: 3,
            permissionMode: LOCKED_AGENT_POLICY.permissionMode,
            planningMode: LOCKED_AGENT_POLICY.planningMode,
            goalTracking: LOCKED_AGENT_POLICY.goalTracking,
            // capabilities 是 OS 渐进式 API 的 meta-skill —— list/search/describe/execute
            // 4 个 action 让编排 agent 探索"系统有什么模块、能调什么 operation",
            // 否则只能基于 prompt 例子猜 packageId / agentId 等命名。cloud 下 skill 文件
            // 默认被 isCloudRuntimeSkillAllowed deny(粗粒度反 prompt-injection),
            // 这里显式 opt-in 让 cloud 也加载;CapabilitiesToolService 内层 RBAC
            // (assertSingleAssetSessionCanExecute)继续兜底,只允许对 assets 模块的
            // 单资产会话写操作。
            skills: ['a3s-workflow-engine', 'capabilities'],
        };
    }

    onStreamText(ctx: StreamEventContext, fullText: string, _delta: string): void {
        const session = this.store.get(ctx.sessionId);
        if (!session?.orchestration) return;
        this.store.touch(ctx.sessionId);
        const orch = session.orchestration;

        // Phase markers: consume every new marker in stream order. Each marker
        // independently advances its own offset so it can't be re-fired.
        while (true) {
            const phaseMarker = detectPhaseMarker(fullText, orch.lastPhaseMarkerOffset);
            if (!phaseMarker) break;
            orch.lastPhaseMarkerOffset = phaseMarker.index + phaseMarker.length;
            if (phaseMarker.phase !== session.phase) {
                this.transitionPhase(ctx, session, phaseMarker.phase, 'agent_marker');
            }
        }

        // Planner markers: enqueue every new marker but serialize execution
        // through a per-session promise chain so concurrent runs cannot race
        // on `orch.chain` / `lastEmittedHash`. Also raise the per-turn PLAN
        // gate so freestyle workflow-json/delta blocks emitted on the same
        // turn are ignored — the planner owns the canvas update.
        while (true) {
            const plannerMarker = detectPlannerMarker(fullText, orch.lastPlannerMarkerOffset);
            if (!plannerMarker) break;
            orch.lastPlannerMarkerOffset = plannerMarker.index + plannerMarker.length;
            orch.plannerFiredThisTurn = true;
            const { kind, payload } = plannerMarker;
            orch.plannerInflight = (orch.plannerInflight ?? Promise.resolve())
                .then(() => this.runPlanner(ctx, session, kind, payload))
                .catch(err => {
                    this.logger.warn(`Planner trigger failed: ${err instanceof Error ? err.message : err}`);
                });
        }

        // PLAN gate: once a [PLAN:*] marker fires this turn, the planner owns
        // the canvas. Drop any freestyle workflow-delta/workflow-json blocks
        // that follow, but still advance the parser offsets so the next turn
        // (after onUserMessage clears the gate) does not re-scan stale text.
        if (orch.plannerFiredThisTurn) {
            const { lastOffset: lastDeltaOffset } = extractWorkflowDeltaBlocks(fullText, orch.lastDeltaParsedOffset);
            if (lastDeltaOffset > orch.lastDeltaParsedOffset) orch.lastDeltaParsedOffset = lastDeltaOffset;
            const { lastOffset: lastJsonOffset } = extractWorkflowBlocks(fullText, orch.lastParsedOffset);
            if (lastJsonOffset > orch.lastParsedOffset) orch.lastParsedOffset = lastJsonOffset;
            return;
        }

        const { blocks: deltaBlocks, lastOffset: lastDeltaOffset } = extractWorkflowDeltaBlocks(
            fullText,
            orch.lastDeltaParsedOffset,
        );
        if (lastDeltaOffset > orch.lastDeltaParsedOffset) {
            orch.lastDeltaParsedOffset = lastDeltaOffset;
        }

        for (const block of deltaBlocks) {
            try {
                const parsed = JSON.parse(block);
                const graphSteps = this.applyWorkflowDeltaSteps(orch.currentGraph ?? { nodes: [], edges: [] }, parsed);
                if (graphSteps.length === 0) continue;

                if (session.phase === 'requirement_collection') {
                    this.transitionPhase(ctx, session, 'design', 'first_workflow_delta');
                }

                let emitted = false;
                for (let index = 0; index < graphSteps.length; index += 1) {
                    const graphStep = graphSteps[index];
                    emitted =
                        this.emitWorkflowGraph(ctx, session, graphStep.graph, {
                            source: 'workflow-delta',
                            progressive: graphSteps.length > 1,
                            nodeByNode: false,
                            step: index + 1,
                            totalSteps: graphSteps.length,
                            operation: graphStep.operation,
                            changedNodeIds: graphStep.changedNodeIds,
                            changedEdgeIds: graphStep.changedEdgeIds,
                        }) || emitted;
                }
                if (!emitted) continue;

                this.persistIfValid(session.assetId, graphSteps[graphSteps.length - 1].graph, session, ctx).catch(
                    error => {
                        this.logger.debug(
                            `Best-effort persistIfValid (delta) failed for session ${session.sessionId}: ${error instanceof Error ? error.message : error}`,
                        );
                    },
                );
            } catch (err) {
                this.logger.debug(`Skipped invalid workflow-delta block: ${err instanceof Error ? err.message : err}`);
            }
        }

        const { blocks, lastOffset } = extractWorkflowBlocks(fullText, orch.lastParsedOffset);
        if (lastOffset > orch.lastParsedOffset) {
            orch.lastParsedOffset = lastOffset;
        }

        for (const block of blocks) {
            try {
                const parsed = JSON.parse(block);
                const graph = this.normalizeWorkflowGraphSnapshot(parsed);
                if (!graph) continue;

                if (session.phase === 'requirement_collection') {
                    this.transitionPhase(ctx, session, 'design', 'first_workflow_output');
                }

                const emitted = this.emitWorkflowGraph(ctx, session, graph, { source: 'workflow-json' });
                if (!emitted) continue;

                this.persistIfValid(session.assetId, graph, session, ctx).catch(error => {
                    this.logger.debug(
                        `Best-effort persistIfValid (json) failed for session ${session.sessionId}: ${error instanceof Error ? error.message : error}`,
                    );
                });
            } catch (err) {
                this.logger.debug(`Skipped invalid workflow-json block: ${err instanceof Error ? err.message : err}`);
            }
        }
    }

    private async runPlanner(
        ctx: StreamEventContext,
        session: LockedAgentSessionEntry,
        kind: PlannerMarkerKind,
        payload?: string,
    ): Promise<void> {
        const orch = session.orchestration!;
        const prompt = orch.lastUserPrompt?.trim();
        if (kind === 'generate' && !prompt) {
            this.logger.debug('Skip planner generate: no captured user prompt yet');
            return;
        }

        // For `generate`, we stream task nodes from the planner as they're
        // parsed so the UI shows real progress. `repair`/`apply` stay
        // synchronous because they don't call the LLM.
        //
        // We diff each snapshot against the previous one and forward the IDs
        // of newly-added or replaced nodes as `changedNodeIds` so the frontend
        // can animate the freshly-appeared cards. Without this the canvas
        // fade-in / pulse animations never trigger — they're gated on the
        // node being a member of the changed set.
        //
        // The verified frame at the end of the stream is special: LocalRepairer
        // may have edited contracts/agents/positions on existing records, so a
        // diff that only looks at "new ids" would miss those. For that frame
        // we hash each node and surface every node whose hash changed.
        let streamed = false;
        let prevNodeIds = new Set<string>();
        let prevNodeHashByIdJson = '';
        const collectNodeIds = (graph: WorkflowDefinitionSpec): string[] =>
            graph.nodes
                .map(node => (typeof node.id === 'string' ? node.id : ''))
                .filter((id): id is string => id.length > 0);
        const buildNodeHashMap = (graph: WorkflowDefinitionSpec): Record<string, string> => {
            const out: Record<string, string> = {};
            for (const node of graph.nodes) {
                if (typeof node.id !== 'string' || !node.id) continue;
                out[node.id] = JSON.stringify(node);
            }
            return out;
        };
        const streamSnapshot = (snapshot: { chain: Chain; graph: WorkflowDefinitionSpec }) => {
            streamed = true;
            orch.chain = snapshot.chain;
            if (session.phase === 'requirement_collection') {
                this.transitionPhase(ctx, session, 'design', `planner_${kind}`);
            }
            const currentIds = collectNodeIds(snapshot.graph);
            const isFinalFrame = snapshot.chain.status !== 'draft';
            let changedNodeIds: string[];
            if (isFinalFrame) {
                const currHashes = buildNodeHashMap(snapshot.graph);
                const prevHashes: Record<string, string> = prevNodeHashByIdJson ? JSON.parse(prevNodeHashByIdJson) : {};
                changedNodeIds = currentIds.filter(id => currHashes[id] !== prevHashes[id]);
                prevNodeHashByIdJson = JSON.stringify(currHashes);
            } else {
                changedNodeIds = currentIds.filter(id => !prevNodeIds.has(id));
                prevNodeHashByIdJson = JSON.stringify(buildNodeHashMap(snapshot.graph));
            }
            prevNodeIds = new Set(currentIds);
            this.emitWorkflowGraph(ctx, session, snapshot.graph, {
                progressive: false,
                source: 'planner',
                changedNodeIds,
                chainStatus: snapshot.chain.status,
            });
        };

        const result = await (async () => {
            if (kind === 'generate') {
                return this.planner.generateGraph({
                    prompt: prompt!,
                    files: orch.files.map(file => ({ name: file.fileName, uri: file.path })),
                    onProgress: streamSnapshot,
                    onReasoning: text => {
                        ctx.emit({
                            type: 'orchestration_thinking',
                            text,
                            assetId: session.assetId,
                            agentPhase: session.phase,
                            timestamp: Date.now(),
                        });
                    },
                });
            }
            if (kind === 'repair') {
                if (!orch.chain) {
                    this.logger.debug('Skip planner repair: no chain in session');
                    return null;
                }
                return this.planner.repairGraph(this.planner.chainToGraph(orch.chain));
            }
            // apply
            if (!orch.chain) {
                this.logger.debug('Skip planner apply: no chain in session');
                return null;
            }
            const editMessage = (payload ?? prompt ?? '').trim();
            if (!editMessage) {
                this.logger.debug('Skip planner apply: no edit message available');
                return null;
            }
            const applied = this.planner.applyMessage(orch.chain, editMessage);
            return {
                chain: applied.chain,
                graph: applied.graph,
                changeSet: applied.changeSet,
                dirtySpan: applied.dirtySpan,
                lockedTasks: applied.lockedTasks,
                revision: applied.revision,
            };
        })();

        if (!result) return;

        orch.chain = result.chain;
        this.store.persistEphemeral(ctx.sessionId);
        if (session.phase === 'requirement_collection') {
            this.transitionPhase(ctx, session, 'design', `planner_${kind}`);
        }

        if (!streamed) {
            const emitted = this.emitWorkflowGraph(ctx, session, result.graph, {
                progressive: false,
                source: 'planner',
            });
            if (!emitted) return;
        }
        ctx.emit({
            type: 'orchestration_planner',
            kind,
            chainStatus: result.chain.status,
            chainId: result.chain.chain_id,
            chainVersion: result.chain.version,
            tasks: result.chain.records.map(record => ({
                taskId: record.task_id,
                title: record.view.title,
                outputs: record.contract.outputs,
                agents: record.contract.agents.map(agent => ({
                    order: agent.order,
                    agent: agent.agent,
                    responsibility: agent.responsibility,
                })),
                locked: record.metadata.locked,
            })),
            repairSummary: {
                rounds: result.chain.repair_trace.length,
                accepted: result.chain.repair_trace.filter(item => item.accepted).length,
                operators: Array.from(new Set(result.chain.repair_trace.map(item => item.operator))),
            },
            timestamp: Date.now(),
        });

        await this.persistIfValid(session.assetId, result.graph, session, ctx).catch(error => {
            this.logger.debug(
                `Best-effort persistIfValid (final) failed for session ${session.sessionId}: ${error instanceof Error ? error.message : error}`,
            );
        });

        if (result.chain.repair_trace.length > 0 && this.repairPlanService) {
            void this.repairPlanService
                .createFromRepairTrace(session.assetId, result.chain.repair_trace, {
                    prompt: result.chain.original_prompt,
                    graphSnapshot: result.graph,
                    userId: ctx.userId,
                })
                .catch(err => {
                    this.logger.debug(`Failed to persist repair trace: ${err instanceof Error ? err.message : err}`);
                });
        }
    }

    private normalizeWorkflowGraphSnapshot(value: unknown): WorkflowGraphSnapshot | null {
        if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
        const record = value as Record<string, unknown>;
        if (!Array.isArray(record.nodes)) return null;
        return {
            nodes: [...record.nodes],
            edges: Array.isArray(record.edges) ? [...record.edges] : [],
        };
    }

    private emitWorkflowGraph(
        ctx: StreamEventContext,
        session: LockedAgentSessionEntry,
        graphInput: unknown,
        options: {
            progressive?: boolean;
            nodeByNode?: boolean;
            source?: WorkflowUpdateSource;
            step?: number;
            totalSteps?: number;
            operation?: WorkflowDeltaOperationKind;
            changedNodeIds?: string[];
            changedEdgeIds?: string[];
            /**
             * Planner chain status — surfaced so the UI can distinguish
             * intermediate streaming frames ("draft") from the final
             * verify-and-repair output ("verified"/"needs_repair").
             */
            chainStatus?: string;
        } = {},
    ): boolean {
        const graph = this.normalizeWorkflowGraphSnapshot(graphInput);
        if (!graph) return false;
        const orch = session.orchestration!;
        const finalHash = JSON.stringify(graph);
        if (orch.lastEmittedHash === finalHash) return false;
        let lastProgressiveHash = '';

        if ((options.nodeByNode ?? options.progressive) && graph.nodes.length > 1) {
            const emittedNodeIds = new Set<string>();
            for (const node of graph.nodes) {
                const nodeId = this.workflowEntityId(node);
                if (nodeId) emittedNodeIds.add(nodeId);
                const partial = {
                    nodes: graph.nodes.filter(item => {
                        const id = this.workflowEntityId(item);
                        return id ? emittedNodeIds.has(id) : true;
                    }),
                    edges: graph.edges.filter(edge => {
                        const endpoints = this.workflowEdgeEndpoints(edge);
                        if (!endpoints) return true;
                        return emittedNodeIds.has(endpoints.sourceNodeId) && emittedNodeIds.has(endpoints.targetNodeId);
                    }),
                };
                const partialHash = JSON.stringify(partial);
                if (partialHash === lastProgressiveHash) continue;
                lastProgressiveHash = partialHash;
                this.emitWorkflowUpdate(ctx, session, partial, {
                    source: options.source ?? 'planner',
                    progressive: true,
                    step: emittedNodeIds.size,
                    totalSteps: graph.nodes.length,
                    changedNodeIds: nodeId ? [nodeId] : undefined,
                });
            }
        }

        if (lastProgressiveHash !== finalHash) {
            this.emitWorkflowUpdate(ctx, session, graph, {
                source: options.source ?? 'workflow-json',
                progressive: Boolean(options.progressive),
                step: options.step,
                totalSteps: options.totalSteps,
                operation: options.operation,
                changedNodeIds: options.changedNodeIds,
                changedEdgeIds: options.changedEdgeIds,
                chainStatus: options.chainStatus,
            });
        }
        orch.currentGraph = graph;
        orch.lastEmittedHash = finalHash;
        orch.workflowEmittedThisTurn = true;
        this.runStructuralValidation(ctx, session, graph);
        return true;
    }

    /**
     * Validate the just-emitted graph and surface failures both to the
     * frontend (via SSE) and to the model (via `extra()` injection next
     * turn). Persistence is gated by `persistIfValid()` reading
     * `orch.lastValidationIssues`.
     */
    private runStructuralValidation(
        ctx: StreamEventContext,
        session: LockedAgentSessionEntry,
        graph: WorkflowGraphSnapshot,
    ): void {
        const orch = session.orchestration!;
        const result = this.structuralValidator.validate(graph);
        const fingerprint = result.valid
            ? ''
            : JSON.stringify(result.issues.map(issue => ({ k: issue.kind, n: issue.nodeId, e: issue.edgeId })));

        // Always track the latest issues so persist gate + extra() stay in sync.
        orch.lastValidationIssues = result.valid ? undefined : result.issues;

        // Avoid re-emitting the same state on every stream tick.
        if (fingerprint === (orch.lastValidationFingerprint ?? '')) return;
        orch.lastValidationFingerprint = fingerprint;

        if (result.valid) {
            ctx.emit({
                type: 'workflow_valid',
                assetId: session.assetId,
                agentPhase: session.phase,
                timestamp: Date.now(),
            });
            return;
        }

        const unreachableFromStart = collectIssueNodes(result.issues, 'unreachable_from_start');
        const cannotReachEnd = collectIssueNodes(result.issues, 'cannot_reach_end');
        ctx.emit({
            type: 'workflow_invalid',
            issues: result.issues,
            unreachableFromStart,
            cannotReachEnd,
            assetId: session.assetId,
            agentPhase: session.phase,
            timestamp: Date.now(),
        });
        this.logger.debug(
            `Workflow validation failed on session ${ctx.sessionId}: ${result.issues
                .map(issue => issue.kind)
                .join(', ')}`,
        );
    }

    /**
     * Wrap persistWorkflow with the structural gate. Invalid graphs are
     * never written to git — they live only in the in-memory stream view
     * so the model can see them and self-correct on the next turn.
     *
     * Before persistence, every `agent` node is auto-bound to a published
     * non-application agent via {@link AgentBindingResolverService}. The LLM
     * does not (and must not) emit `agentId` / `packageId` itself —
     * we keep that decision deterministic and server-side.
     */
    private async persistIfValid(
        assetId: string,
        graph: { nodes: unknown[]; edges?: unknown[] },
        session: LockedAgentSessionEntry,
        ctx?: StreamEventContext,
    ): Promise<void> {
        const issues = session.orchestration?.lastValidationIssues;
        if (issues && issues.length > 0) {
            this.logger.debug(
                `Skip persist for asset ${assetId}: ${issues.length} structural issues (${issues
                    .map(issue => issue.kind)
                    .join(', ')})`,
            );
            ctx?.emit({
                type: 'workflow_persist_blocked',
                assetId,
                issueCount: issues.length,
                timestamp: Date.now(),
            });
            return;
        }
        // Binding is best-effort: structurally-valid graphs are always written
        // to git so the user's conversational design survives marketplace gaps.
        // `attachAgentBindings` enriches `agent` nodes with `agentId` / `packageId`
        // when the resolver succeeds, and emits `workflow_binding_failed` when it
        // can't — but it never blocks persistence anymore.
        const boundGraph = await this.attachAgentBindings(graph, session, ctx);
        await this.persistWorkflow(assetId, boundGraph, ctx?.sessionId ?? session.sessionId, ctx);
    }

    /**
     * For every `agent` node in `graph.nodes`, call the binding resolver to
     * pick a real published-listed non-application agent and merge the
     * resulting `agentId / agentName / agentKind / bindingIsFallback` —
     * plus the bound agent's OCI `packageId` / `packageVersion` when the
     * marketplace asset carries them — into `node.data`. The bindings are
     * also stashed on the session so the next system-prompt context can
     * echo them back to the LLM.
     *
     * **Best-effort semantics**: persistence is never blocked here. If the
     * resolver throws (typically because the marketplace has no non-application
     * agent), we emit `workflow_binding_failed`, stash `lastBindingError` for
     * the next prompt round, and return the input graph unchanged so the
     * caller can still write it to git. The unbound `agent` nodes will fail
     * loudly at runtime (no `agentId` / `packageId` to schedule against),
     * which is what we want — the user keeps their design history while the
     * LLM is told to fix the marketplace state.
     *
     * Returns the (possibly patched) graph. Falls back to the input unchanged
     * when there are no `agent` nodes, no resolver is wired, the resolver
     * threw, or `ctx.userId` is unavailable (degraded mode for tests /
     * desktop sidecar).
     */
    private async attachAgentBindings(
        graph: { nodes: unknown[]; edges?: unknown[] },
        session: LockedAgentSessionEntry,
        ctx?: StreamEventContext,
    ): Promise<{ nodes: unknown[]; edges?: unknown[] }> {
        if (session.orchestration) session.orchestration.lastBindingError = undefined;
        // 四条 "silent return" 路径之前对外完全无迹可寻，用户只能看到 persist 出
        // 来的 graph 里 data.agents 是空、却根本不知道是 (a) DI 没装好、(b) 一个
        // agent 节点都没识别出来、(c) 上下文丢了 userId、(d) resolver 抛了。统一
        // 落 warn 日志 + emit 一条 workflow_binding_skipped 事件,前端 SSE 和后端
        // 日志都能立刻给出原因,定位不再靠猜。
        const emitSkip = (reason: string, detail?: string) => {
            this.logger.warn(
                `[orchestration.binding.skipped] sessionId=${session.sessionId} reason=${reason}${
                    detail ? ` detail="${detail}"` : ''
                } — agent nodes in this graph will persist without packageId / data.agents bindings.`,
            );
            ctx?.emit({
                type: 'workflow_binding_skipped',
                reason,
                detail,
                timestamp: Date.now(),
            });
        };
        if (!this.bindingResolver) {
            // DI / desktop sidecar 未装 MarketplaceModule 时正常会走到这里;cloud
            // 模式下走到这里说明 forwardRef 解析失败或 KernelModule 没 import
            // MarketplaceModule。
            emitSkip('binding_resolver_unwired');
            return graph;
        }
        const intents = this.extractAgentNodeIntents(graph);
        if (intents.length === 0) {
            // 多半是 LLM 把节点 type 写错(非 'agent') 或者 node.id 缺失,导致
            // extractAgentNodeIntents 一个 intent 都没扫到。带上节点总数 + 类型
            // 分布,方便比对 LLM 实际输出。
            const typeTally = (graph.nodes as Array<Record<string, unknown> | undefined>)
                .map(node => (node && typeof node === 'object' ? String(node.type ?? '<no-type>') : '<non-object>'))
                .reduce<Record<string, number>>((acc, type) => {
                    acc[type] = (acc[type] ?? 0) + 1;
                    return acc;
                }, {});
            const summary = Object.entries(typeTally)
                .map(([type, count]) => `${type}=${count}`)
                .join(',');
            emitSkip('no_agent_node_intents', `nodes=${graph.nodes.length} types=${summary || 'empty'}`);
            return graph;
        }
        const userId = ctx?.userId;
        if (!userId) {
            this.logger.warn(`Cannot resolve agent bindings: ctx.userId missing on session ${session.sessionId}`);
            emitSkip('userid_missing');
            return graph;
        }
        let bindings: AgentBinding[];
        try {
            const result = await this.bindingResolver.resolveBindings(intents, userId);
            bindings = result.bindings;
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            this.logger.warn(`Agent binding resolve failed for session ${session.sessionId}: ${message}`);
            if (session.orchestration) {
                session.orchestration.lastBindingError = { message, timestamp: Date.now() };
                // 同步清掉上一轮的成功绑定，否则 extras() 会同时渲染
                // "Binding Failed" + 旧的 "Bindings Auto-Resolved" 两块,让 LLM 误以为
                // 当前绑定还有效。
                session.orchestration.lastAgentBindings = undefined;
            }
            ctx?.emit({
                type: 'workflow_binding_failed',
                message,
                timestamp: Date.now(),
            });
            return graph;
        }
        if (session.orchestration) session.orchestration.lastAgentBindings = bindings;
        const byNodeId = new Map(bindings.map(b => [b.nodeId, b]));
        const patchedNodes = graph.nodes.map(node => {
            if (!node || typeof node !== 'object') return node;
            const record = node as Record<string, unknown>;
            const id = typeof record.id === 'string' ? record.id : undefined;
            if (!id) return node;
            const binding = byNodeId.get(id);
            if (!binding) return node;
            const data = (record.data as Record<string, unknown> | undefined) ?? {};
            // Decide whether the LLM-emitted (or user-authored) `data.agents`
            // already encodes meaningful sub-task structure we MUST preserve:
            //   - Multi-sub-task nodes (length >= 2): the user/LLM has staged
            //     several ordered sub-agents to fan out at run time
            //     (parseMountedAgents in workflow-agent-dag-executor.ts groups
            //     by executionOrder). Overwriting with a single binding would
            //     silently collapse N sub-tasks into 1 — the exact regression
            //     users reported as "编排自动绑定把我手动加的子任务擦没了".
            //   - Any locked slot: a locked agent is the user saying
            //     "this specific agent is non-negotiable, don't re-pick".
            //     Honour it by leaving the whole list alone.
            // In either case we still STAMP the top-level `packageId` /
            // `packageVersion` / `agentKind` / `bindingIsFallback` from the
            // resolver — these are informational defaults used by the canvas
            // badge and the LLM next-turn context. Per-sub-task packageId is
            // resolved at run time by WorkflowAgentDagExecutor's
            // `resolveAgentPackageRef`, so the multi-sub-task case is safely
            // covered without us having to fill them all here.
            const existingAgents = Array.isArray(data.agents) ? (data.agents as Array<Record<string, unknown>>) : [];
            const hasLockedSlot = existingAgents.some(slot => slot?.isLocked === true);
            const preserveExistingAgents = existingAgents.length >= 2 || hasLockedSlot;

            // 三处必须同时写,否则用户在不同位置看到的状态不一致(用户已反馈"哪儿都看不到挂载"):
            //  1) 顶层 node.packageId / node.packageVersion —— WorkflowNodeDefinition 的标准位
            //     (workflow-definition.types.ts:49)。runtime 的 WorkflowAgentBinderService
            //     (workflow-agent-binder.service.ts:43) 检查这个字段决定是否 re-bind;
            //     OsWorkflowRuntime 也是从这里读 OCI 镜像坐标。
            //  2) data.agents = [{agentId, agentName, executionOrder, isLocked}] —— task-workbench
            //     沿用的 agent-node 形态 (task-workbench.service.ts:1283-1286);
            //     designer 的 parser 不会删 data.agents,inspector / 节点徽章也是读这里渲染
            //     "绑定到 X agent"。注意 designer 在 normalizeDesignerNodeData 里硬删 data.agentId
            //     (workflow-designer-document.ts:293),所以单数字段不能用,必须走数组。
            //  3) data.agentKind / data.bindingIsFallback —— designer 不删,留给 extras() 表格
            //     和 LLM next-turn context 显示 "fallback 还是 semantic 命中"。
            const next: Record<string, unknown> = {
                ...record,
                packageId: binding.packageId,
                packageVersion: binding.packageVersion,
                data: {
                    ...data,
                    agents: preserveExistingAgents
                        ? existingAgents
                        : [
                              {
                                  agentId: binding.agentId,
                                  agentName: binding.agentName,
                                  executionOrder: 1,
                                  isLocked: false,
                              },
                          ],
                    agentKind: binding.agentKind,
                    bindingIsFallback: binding.fallback,
                },
            };
            return next;
        });
        return { ...graph, nodes: patchedNodes };
    }

    private extractAgentNodeIntents(graph: { nodes: unknown[] }): AgentNodeIntent[] {
        const intents: AgentNodeIntent[] = [];
        for (const node of graph.nodes) {
            if (!node || typeof node !== 'object') continue;
            const record = node as Record<string, unknown>;
            if (record.type !== 'agent') continue;
            const id = typeof record.id === 'string' ? record.id : '';
            if (!id) continue;
            const data = (record.data as Record<string, unknown> | undefined) ?? {};
            intents.push({
                nodeId: id,
                name: this.stringValue(record.name),
                description: this.stringValue(record.description) ?? this.stringValue(data.description),
                requirement: this.stringValue(data.requirement),
                successCriteria: this.stringValue(data.success_criteria) ?? this.stringValue(data.successCriteria),
            });
        }
        return intents;
    }

    private emitWorkflowUpdate(
        ctx: StreamEventContext,
        session: LockedAgentSessionEntry,
        graph: WorkflowGraphSnapshot,
        options: {
            source: WorkflowUpdateSource;
            progressive?: boolean;
            step?: number;
            totalSteps?: number;
            operation?: WorkflowDeltaOperationKind;
            changedNodeIds?: string[];
            changedEdgeIds?: string[];
            chainStatus?: string;
        },
    ): void {
        ctx.emit({
            type: 'workflow_update',
            graph,
            source: options.source,
            progressive: Boolean(options.progressive),
            step: options.step,
            totalSteps: options.totalSteps,
            operation: options.operation,
            changedNodeIds: options.changedNodeIds,
            changedEdgeIds: options.changedEdgeIds,
            chainStatus: options.chainStatus,
            assetId: session.assetId,
            agentPhase: session.phase,
            timestamp: Date.now(),
        });
    }

    private applyWorkflowDeltaSteps(currentInput: unknown, deltaInput: unknown): WorkflowGraphUpdateStep[] {
        const current = this.normalizeWorkflowGraphSnapshot(currentInput) ?? { nodes: [], edges: [] };
        const operations = Array.isArray(deltaInput)
            ? deltaInput
                  .map(item => this.asRecord(item))
                  .filter((item): item is Record<string, unknown> => Boolean(item))
            : this.workflowDeltaOperations(this.asRecord(deltaInput));
        if (operations.length === 0) return [];

        const nodesById = new Map<string, unknown>();
        for (const node of current.nodes) {
            const id = this.workflowEntityId(node);
            if (id) nodesById.set(id, node);
        }

        const edgesByKey = new Map<string, unknown>();
        for (const edge of current.edges) {
            const key = this.workflowEdgeKey(edge);
            if (key) edgesByKey.set(key, edge);
        }

        const steps: WorkflowGraphUpdateStep[] = [];
        let lastSnapshotHash = JSON.stringify(current);
        const pushChangedSnapshot = (metadata: Omit<WorkflowGraphUpdateStep, 'graph'>) => {
            const snapshot = {
                nodes: [...nodesById.values()],
                edges: [...edgesByKey.values()],
            };
            const hash = JSON.stringify(snapshot);
            if (hash === lastSnapshotHash) return;
            steps.push({ graph: snapshot, ...metadata });
            lastSnapshotHash = hash;
        };

        for (const operation of operations) {
            const op = this.pickString(operation, ['op', 'operation', 'type']).replace(/-/g, '_');
            if (op === 'upsert_node' || op === 'add_node' || op === 'update_node' || op === 'node') {
                const node = this.asRecord(operation.node) ?? this.asRecord(operation.value);
                const id = this.workflowEntityId(node);
                if (!node || !id) continue;
                nodesById.set(id, node);
                pushChangedSnapshot({ operation: 'upsert_node', changedNodeIds: [id] });
                continue;
            }

            if (op === 'delete_node' || op === 'remove_node') {
                const id = this.pickString(operation, ['id', 'nodeId', 'nodeID']);
                if (!id) continue;
                nodesById.delete(id);
                const removedEdgeKeys: string[] = [];
                for (const [key, edge] of [...edgesByKey.entries()]) {
                    const endpoints = this.workflowEdgeEndpoints(edge);
                    if (endpoints?.sourceNodeId === id || endpoints?.targetNodeId === id) {
                        edgesByKey.delete(key);
                        removedEdgeKeys.push(key);
                    }
                }
                pushChangedSnapshot({
                    operation: 'delete_node',
                    changedNodeIds: [id],
                    changedEdgeIds: removedEdgeKeys,
                });
                continue;
            }

            if (op === 'upsert_edge' || op === 'add_edge' || op === 'update_edge' || op === 'edge') {
                const edge = this.asRecord(operation.edge) ?? this.asRecord(operation.value);
                const key = this.workflowEdgeKey(edge);
                if (!edge || !key) continue;
                edgesByKey.set(key, edge);
                pushChangedSnapshot({ operation: 'upsert_edge', changedEdgeIds: [key] });
                continue;
            }

            if (op === 'delete_edge' || op === 'remove_edge') {
                const key = this.pickString(operation, ['id', 'edgeId', 'edgeID']) || this.workflowEdgeKey(operation);
                if (key) edgesByKey.delete(key);
                pushChangedSnapshot({ operation: 'delete_edge', changedEdgeIds: key ? [key] : [] });
            }
        }

        return steps;
    }

    private workflowDeltaOperations(delta: Record<string, unknown> | null): Array<Record<string, unknown>> {
        if (!delta) return [];
        if (Array.isArray(delta.operations)) {
            return delta.operations
                .map(item => this.asRecord(item))
                .filter((item): item is Record<string, unknown> => Boolean(item));
        }

        const operations: Array<Record<string, unknown>> = [];
        if (Array.isArray(delta.nodes)) {
            for (const node of delta.nodes) operations.push({ op: 'upsert_node', node });
        }
        if (Array.isArray(delta.edges)) {
            for (const edge of delta.edges) operations.push({ op: 'upsert_edge', edge });
        }
        if (Array.isArray(delta.deleteNodeIds)) {
            for (const id of delta.deleteNodeIds) operations.push({ op: 'delete_node', id });
        }
        if (Array.isArray(delta.deleteEdgeIds)) {
            for (const id of delta.deleteEdgeIds) operations.push({ op: 'delete_edge', id });
        }
        return operations;
    }

    private workflowEntityId(value: unknown): string {
        const record = this.asRecord(value);
        return record ? this.pickString(record, ['id', 'nodeId', 'nodeID']) : '';
    }

    private workflowEdgeKey(value: unknown): string {
        const record = this.asRecord(value);
        if (!record) return '';
        const id = this.pickString(record, ['id', 'edgeId', 'edgeID']);
        if (id) return id;
        const endpoints = this.workflowEdgeEndpoints(record);
        if (!endpoints) return '';
        const sourcePortId = this.pickString(record, ['sourcePortId', 'sourcePortID', 'sourceHandle']);
        const targetPortId = this.pickString(record, ['targetPortId', 'targetPortID', 'targetHandle']);
        return [endpoints.sourceNodeId, sourcePortId, endpoints.targetNodeId, targetPortId].join('::');
    }

    private workflowEdgeEndpoints(value: unknown): { sourceNodeId: string; targetNodeId: string } | null {
        const record = this.asRecord(value);
        if (!record) return null;
        const sourceNodeId = this.pickString(record, [
            'sourceNodeId',
            'sourceNodeID',
            'source',
            'from',
            'source_node_id',
        ]);
        const targetNodeId = this.pickString(record, [
            'targetNodeId',
            'targetNodeID',
            'target',
            'to',
            'target_node_id',
        ]);
        return sourceNodeId && targetNodeId ? { sourceNodeId, targetNodeId } : null;
    }

    private asRecord(value: unknown): Record<string, unknown> | null {
        return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
    }

    private pickString(record: Record<string, unknown>, keys: string[]): string {
        for (const key of keys) {
            const value = record[key];
            if (typeof value === 'string' && value.trim()) return value.trim();
        }
        return '';
    }

    private transitionPhase(
        ctx: StreamEventContext,
        session: LockedAgentSessionEntry,
        newPhase: OrchestrationPhase,
        reason: string,
    ): void {
        const previousPhase = session.phase as OrchestrationPhase;
        session.phase = newPhase;

        void this.store.transitionPhase(ctx.sessionId, newPhase);

        ctx.emit({
            type: 'agent_phase',
            phase: newPhase,
            previousPhase,
            timestamp: Date.now(),
        });

        const event = this.timeline.createEvent(ctx.sessionId, 'phase_transition', {
            from: previousPhase,
            to: newPhase,
            reason,
        });
        void this.timeline.appendEvent(session.assetId, event);

    }

    private async persistWorkflow(
        assetId: string,
        graph: { nodes: unknown[]; edges?: unknown[] },
        sessionId?: string,
        ctx?: StreamEventContext,
    ): Promise<void> {
        try {
            const nodeCount = graph.nodes.length;
            const edgeCount = Array.isArray(graph.edges) ? graph.edges.length : 0;
            const result = await this.assetService.updateBlob(
                assetId,
                'flow.json',
                JSON.stringify(graph, null, 2),
                `update: ${nodeCount} nodes, ${edgeCount} edges`,
                'main',
            );

            if (sessionId) {
                const event = this.timeline.createEvent(sessionId, 'dag_version', {
                    commitSha: result.commitSha,
                    nodeCount,
                    edgeCount,
                    changeDescription: `${nodeCount} nodes, ${edgeCount} edges`,
                });
                void this.timeline.appendEvent(assetId, event);
            }
        } catch (err) {
            this.logger.warn(`Failed to persist workflow to asset ${assetId}: ${err}`);
            ctx?.emit({
                type: 'workflow_persist_error',
                message: err instanceof Error ? err.message : String(err),
                timestamp: Date.now(),
            });
        }
    }

    private stringValue(value: unknown): string | undefined {
        return typeof value === 'string' && value.trim() ? value.trim() : undefined;
    }
}

const PHASE_LABELS: Record<OrchestrationPhase, string> = {
    requirement_collection: 'Requirement collection',
    design: 'Design',
    refinement: 'Refinement',
    complete: 'Complete',
};

function collectIssueNodes(
    issues: ReadonlyArray<WorkflowStructuralIssue>,
    kind: WorkflowStructuralIssue['kind'],
): string[] {
    const ids: string[] = [];
    for (const issue of issues) {
        if (issue.kind !== kind) continue;
        if (issue.nodeId) ids.push(issue.nodeId);
    }
    return ids;
}

/**
 * 渲染 NL 创建的 workflow 资产的 `.a3s/manifest.acl`。形态对齐内置工作流
 * （`apps/api/builtin-assets/flows/finance/compliance-review-pipeline/.a3s/manifest.acl`），
 * 保证 git repo 单独导出后能被 builtin-asset syncer 识别为同类资产。
 *
 * 字段对齐说明：
 * - displayName/tags/scaffold 与内置一致，缺它们会让前端列表显示 raw name、
 *   没法按标签筛、丢失资产来源追溯链路。
 * - icon 暂不强加，assets-syncer 会按 displayName 生成首字母 text logo 兜底。
 */
function renderWorkflowManifestAcl(input: {
    name: string;
    ownerType: 'user' | 'organization';
    ownerId: string;
    description?: string;
}): string {
    const esc = (raw: string) => raw.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    const description = input.description ? `\n  description = "${esc(input.description)}"` : '';
    return [
        'schema = "builtin-asset/v1"',
        '',
        `asset "${esc(input.name)}" {`,
        `  category    = "workflow"`,
        `  ownerType   = "${input.ownerType}"`,
        `  ownerId     = "${esc(input.ownerId)}"`,
        `  visibility  = "private"${description}`,
        '',
        '  metadata = {',
        '    builtin     = false',
        '    builtBy     = "orchestration-agent"',
        `    displayName = "${esc(input.description ?? input.name)}"`,
        '    tags        = ["workflow", "nl-created"]',
        '',
        '    workflowSpec = {',
        '      sourceFile = "flow.json"',
        '    }',
        '',
        '    scaffold = {',
        '      source   = "orchestration-agent"',
        '      template = "nl-workflow"',
        '    }',
        '  }',
        '',
        '  source "git-local" {}',
        '}',
        '',
    ].join('\n');
}
