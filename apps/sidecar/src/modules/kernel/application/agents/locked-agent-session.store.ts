import { Inject, Injectable, Logger } from '@nestjs/common';
import { type IKernelService, KERNEL_SERVICE } from '../../domain/services/kernel-service.interface';

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
    agentId: 'asset';
    assetId: string;
    phase: string;
    lastActivityAt: number;
    asset?: AssetEphemeralState;
}

/** Shape persisted onto `session.metadata.lockedAgentState`. */
interface PersistedLockedAgentState {
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
        agentId: 'asset',
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

        const agentId = session.agentId as 'asset' | undefined;
        if (agentId !== 'asset') return undefined;

        const metadata = (session.metadata ?? {}) as Record<string, unknown>;
        const assetId = typeof metadata.assetId === 'string' ? metadata.assetId : undefined;

        const fallbackPhase = 'understanding';
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
     * Persist the subset of asset-agent state that must survive instance
     * failover. Stream-position offsets stay in-memory only. Fire-and-forget;
     * failures are logged but never propagate to the caller.
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
        if (entry.asset && entry.asset.createdAssetIds.length > 0) {
            payload.createdAssetIds = entry.asset.createdAssetIds;
        }
        return payload;
    }

    private rehydrateFromMetadata(entry: LockedAgentSessionEntry, raw: unknown): void {
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return;
        const persisted = raw as PersistedLockedAgentState;

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
