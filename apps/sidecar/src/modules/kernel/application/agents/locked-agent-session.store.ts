import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Chain } from '../orchestration/serial-chain-planner/schemas';
import { type IKernelService, KERNEL_SERVICE } from '../../domain/services/kernel-service.interface';
import type { WorkflowStructuralIssue } from './workflow-structural-validator';

export interface SessionFileEntry {
    uploadId: string;
    fileName: string;
    mimeType?: string;
    size: number;
    path: string;
}

export interface OrchestrationEphemeralState {
    // Persisted across instance failover (see persistEphemeral / getOrRecover).
    files: SessionFileEntry[];
    chain?: Chain;
    // In-memory only — meaningful inside one streamed turn on one instance.
    currentGraph?: { nodes: unknown[]; edges: unknown[] };
    lastEmittedHash: string | null;
    /** Offset for workflow-json block extraction only. Phase / planner / delta markers maintain their own offsets. */
    lastParsedOffset: number;
    /** Offset for workflow-delta block extraction only. */
    lastDeltaParsedOffset: number;
    lastUserPrompt?: string;
    lastPhaseMarkerOffset: number;
    lastPlannerMarkerOffset: number;
    /** Tail of the per-session promise chain that serializes planner executions. Not persisted. */
    plannerInflight?: Promise<void>;
    /**
     * True once a [PLAN:*] marker has been observed in the current assistant turn.
     * When true, the orchestration agent ignores model-authored `workflow-delta` /
     * `workflow-json` blocks on the same turn — the planner owns the canvas update.
     * Reset on every onUserMessage (next turn starts).
     */
    plannerFiredThisTurn: boolean;
    /**
     * True once a workflow-delta or workflow-json block has been parsed and
     * applied to `currentGraph` during the current assistant turn. Used by
     * `onStreamEnd` to decide whether the end-of-turn checkpoint persist
     * should fire — a turn that emitted nothing graph-related (e.g. pure
     * Q&A) does not need a final commit. Reset on every onUserMessage.
     */
    workflowEmittedThisTurn: boolean;
    /**
     * Issues from the most recent structural validation. Persists across
     * stream ticks within one turn so `extra()` can inject them into the
     * next model invocation's system prompt. Cleared when a subsequent
     * emit passes validation.
     */
    lastValidationIssues?: WorkflowStructuralIssue[];
    /**
     * Fingerprint of the last validation result so we only push
     * workflow_invalid / workflow_valid SSE events on state transitions
     * instead of every stream tick.
     */
    lastValidationFingerprint?: string;
    /**
     * Auto-resolved bindings from the most recent persistIfValid round. Each
     * `agent` node in the persisted graph is mapped to a real published-listed
     * non-application agent (tool / agentic). Surfaced into `extra()` so the LLM
     * knows what concrete agent each placeholder ended up bound to, which
     * helps it adjust subsequent node intents and explain bindings to the user.
     */
    lastAgentBindings?: Array<{
        nodeId: string;
        agentId: string;
        agentName: string;
        agentKind: 'tool' | 'agentic';
        fallback: boolean;
        packageId?: string;
        packageVersion?: string;
    }>;
    /**
     * Set when the binding resolver could not place every `agent` node — for
     * example when the marketplace has no published tool / agentic to bind to.
     * NOT a persist gate: `persistIfValid` writes the structurally-valid graph
     * to git even when binding fails (unbound agent nodes carry no `agentId` /
     * `packageId`, so the runtime will refuse to execute them with a clear
     * error). Surfaced into `extra()` so the LLM tells the user what went
     * wrong and stops iterating on the workflow JSON until the marketplace
     * state is fixed.
     */
    lastBindingError?: {
        message: string;
        timestamp: number;
    };
    /**
     * Lightweight cache of the marketplace catalog (listed `tool` / `agentic`
     * agents) used to populate the `## Marketplace Catalog` block of
     * `extra()`. Refreshed at the start of each user turn with a short TTL
     * so repeated turns within the same minute don't re-hit marketplace.
     *
     * Includes a short `description` per entry because tool / agentic names
     * across the marketplace tend to collide (lots of `*-extractor`,
     * `*-checker`, `*-composer` variants) — names alone are not enough for
     * the LLM to pick the right one when writing node intent text. Each
     * description is truncated to keep the prompt budget bounded.
     */
    marketplaceCatalog?: {
        entries: Array<{ name: string; agentKind: 'tool' | 'agentic'; description: string }>;
        total: number;
        fetchedAt: number;
    };
}

export interface AssetEphemeralState {
    // Persisted across instance failover.
    createdAssetIds: string[];
    /** Caller-supplied hint about the category the user wants to create. */
    targetCategory?: string;
    /** Caller-supplied hint about the agent sub-kind (tool / application / agentic) the user picked in the dialog. */
    targetAgentKind?: 'tool' | 'application' | 'agentic';
    /** Caller-supplied initial prompt, surfaced into `extra()` until the asset is bound. */
    initialPrompt?: string;
    // In-memory only — stream offsets for the current turn on this instance.
    lastPhaseMarkerOffset: number;
    lastCreatedMarkerOffset: number;
    /** Offset for `\`\`\`asset-proposal` fenced block extraction. */
    lastProposalParsedOffset: number;
    /**
     * Most recent structured proposal the agent has emitted in this session.
     * Surfaced to `extra()` until the user explicitly confirms, so the model
     * never forgets what it already proposed.
     */
    lastProposal?: import('./asset-marker.util').AssetProposal;
    /**
     * True once the user has explicitly approved the most recent proposal.
     * The `understanding -> creating` gate keys off this flag — without an
     * approved proposal, the model is told it must NOT call createAsset.
     */
    proposalConfirmed: boolean;
    /**
     * Issues from the most recent proposal that failed schema/contract checks.
     * Surfaced into `extra()` on the next turn so the LLM can self-correct
     * instead of silently retrying the same broken proposal. Cleared as soon
     * as a valid proposal arrives.
     */
    lastProposalRejection?: {
        issues: string[];
        rawSnippet: string;
        timestamp: number;
    };
}

export interface LockedAgentSessionEntry {
    sessionId: string;
    agentId: 'orchestration' | 'asset';
    assetId: string;
    phase: string;
    lastActivityAt: number;
    orchestration?: OrchestrationEphemeralState;
    asset?: AssetEphemeralState;
}

/** Shape persisted onto `session.metadata.lockedAgentState`. */
interface PersistedLockedAgentState {
    files?: SessionFileEntry[];
    chain?: Chain;
    createdAssetIds?: string[];
}

const SESSION_IDLE_TTL_MS = 30 * 60 * 1000;
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000;

@Injectable()
export class LockedAgentSessionStore {
    private readonly logger = new Logger(LockedAgentSessionStore.name);
    private readonly sessions = new Map<string, LockedAgentSessionEntry>();
    private readonly cleanupTimer: ReturnType<typeof setInterval>;

    constructor(@Inject(KERNEL_SERVICE) private readonly kernelService: IKernelService) {
        this.cleanupTimer = setInterval(() => this.evictIdle(), CLEANUP_INTERVAL_MS);
        this.cleanupTimer.unref?.();
    }

    create(
        sessionId: string,
        agentId: 'orchestration' | 'asset',
        assetId: string | undefined,
        initialPhase: string,
        assetHint: {
            targetCategory?: string;
            targetAgentKind?: 'tool' | 'application' | 'agentic';
            initialPrompt?: string;
        } = {},
    ): LockedAgentSessionEntry {
        const entry: LockedAgentSessionEntry = {
            sessionId,
            agentId,
            assetId: assetId || '',
            phase: initialPhase,
            lastActivityAt: Date.now(),
            ...(agentId === 'orchestration'
                ? {
                      orchestration: {
                          files: [],
                          lastEmittedHash: null,
                          lastParsedOffset: 0,
                          lastDeltaParsedOffset: 0,
                          lastPhaseMarkerOffset: 0,
                          lastPlannerMarkerOffset: 0,
                          plannerFiredThisTurn: false,
                          workflowEmittedThisTurn: false,
                      },
                  }
                : {
                      asset: {
                          createdAssetIds: assetId ? [assetId] : [],
                          targetCategory: assetHint.targetCategory,
                          targetAgentKind: assetHint.targetAgentKind,
                          initialPrompt: assetHint.initialPrompt,
                          lastPhaseMarkerOffset: 0,
                          lastCreatedMarkerOffset: 0,
                          lastProposalParsedOffset: 0,
                          // 已绑定资产的会话视为隐式已确认（恢复流程 / 旧会话不会再要求一次 confirm）
                          proposalConfirmed: Boolean(assetId),
                      },
                  }),
        };
        this.sessions.set(sessionId, entry);
        return entry;
    }

    get(sessionId: string): LockedAgentSessionEntry | undefined {
        return this.sessions.get(sessionId);
    }

    async getOrRecover(sessionId: string): Promise<LockedAgentSessionEntry | undefined> {
        const existing = this.sessions.get(sessionId);
        if (existing) return existing;

        const session = await this.kernelService.getSession(sessionId);
        if (!session) return undefined;

        const agentId = session.agentId as 'orchestration' | 'asset' | undefined;
        if (agentId !== 'orchestration' && agentId !== 'asset') return undefined;

        const metadata = (session.metadata ?? {}) as Record<string, unknown>;
        const assetId = typeof metadata.assetId === 'string' ? metadata.assetId : undefined;
        if (agentId === 'orchestration' && !assetId) return undefined;

        const fallbackPhase = agentId === 'orchestration' ? 'requirement_collection' : 'understanding';
        const phase = typeof metadata.agentPhase === 'string' ? metadata.agentPhase : fallbackPhase;
        const targetCategory = typeof metadata.assetCategory === 'string' ? metadata.assetCategory : undefined;
        const initialPrompt = typeof metadata.initialPrompt === 'string' ? metadata.initialPrompt : undefined;
        const rawAgentKind = typeof metadata.agentKind === 'string' ? metadata.agentKind : undefined;
        const targetAgentKind =
            rawAgentKind === 'tool' || rawAgentKind === 'application' || rawAgentKind === 'agentic'
                ? rawAgentKind
                : undefined;
        this.logger.log(`Recovering locked agent session ${sessionId} (agent=${agentId}, phase=${phase})`);
        const entry = this.create(sessionId, agentId, assetId, phase, { targetCategory, targetAgentKind, initialPrompt });
        this.rehydrateFromMetadata(entry, metadata.lockedAgentState);
        return entry;
    }

    /**
     * Persist the subset of ephemeral state that must survive instance failover
     * (files / chain / createdAssetIds). Stream-position offsets and the
     * planner promise chain stay in-memory only. Fire-and-forget; failures are
     * logged but never propagate to the caller.
     */
    persistEphemeral(sessionId: string): void {
        const entry = this.sessions.get(sessionId);
        if (!entry) return;
        const payload = this.toPersistedState(entry);
        void this.kernelService
            .updateSession(sessionId, { lockedAgentState: payload })
            .catch(err => {
                this.logger.warn(
                    `Failed to persist locked agent state for ${sessionId}: ${
                        err instanceof Error ? err.message : err
                    }`,
                );
            });
    }

    private toPersistedState(entry: LockedAgentSessionEntry): PersistedLockedAgentState {
        const payload: PersistedLockedAgentState = {};
        if (entry.orchestration) {
            if (entry.orchestration.files.length > 0) payload.files = entry.orchestration.files;
            if (entry.orchestration.chain) payload.chain = entry.orchestration.chain;
        }
        if (entry.asset && entry.asset.createdAssetIds.length > 0) {
            payload.createdAssetIds = entry.asset.createdAssetIds;
        }
        return payload;
    }

    private rehydrateFromMetadata(entry: LockedAgentSessionEntry, raw: unknown): void {
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return;
        const persisted = raw as PersistedLockedAgentState;

        if (entry.orchestration) {
            if (Array.isArray(persisted.files)) {
                entry.orchestration.files = persisted.files.filter(
                    (file): file is SessionFileEntry =>
                        !!file &&
                        typeof (file as SessionFileEntry).uploadId === 'string' &&
                        typeof (file as SessionFileEntry).fileName === 'string',
                );
            }
            if (persisted.chain && typeof persisted.chain === 'object') {
                entry.orchestration.chain = persisted.chain;
            }
        }

        if (entry.asset && Array.isArray(persisted.createdAssetIds)) {
            entry.asset.createdAssetIds = persisted.createdAssetIds.filter(
                (id): id is string => typeof id === 'string' && !!id,
            );
        }
    }

    async transitionPhase(sessionId: string, newPhase: string): Promise<void> {
        const entry = this.sessions.get(sessionId);
        if (!entry) return;
        entry.phase = newPhase;
        entry.lastActivityAt = Date.now();
        await this.kernelService.updateSession(sessionId, { agentPhase: newPhase }).catch(err => {
            this.logger.warn(
                `Failed to persist agentPhase for ${sessionId}: ${err instanceof Error ? err.message : err}`,
            );
        });
    }

    touch(sessionId: string): void {
        const entry = this.sessions.get(sessionId);
        if (entry) entry.lastActivityAt = Date.now();
    }

    bindAsset(sessionId: string, assetId: string): void {
        const entry = this.sessions.get(sessionId);
        if (entry && !entry.assetId) {
            entry.assetId = assetId;
        }
    }

    delete(sessionId: string): void {
        this.sessions.delete(sessionId);
    }

    has(sessionId: string): boolean {
        return this.sessions.has(sessionId);
    }

    private evictIdle(): void {
        const now = Date.now();
        for (const [sessionId, entry] of this.sessions) {
            if (now - entry.lastActivityAt > SESSION_IDLE_TTL_MS) {
                this.sessions.delete(sessionId);
                this.logger.debug(`Evicted idle locked agent session: ${sessionId}`);
            }
        }
    }
}
