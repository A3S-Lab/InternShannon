import { Inject, Injectable, Logger, type OnModuleDestroy, type OnModuleInit, Optional } from "@nestjs/common";
import { MetricsService } from "@/shared/observability/metrics";
import {
    IKernelRuntimeConfigService,
    KERNEL_RUNTIME_CONFIG_SERVICE,
    KernelAssistantRuntimeDefaults,
    KernelRuntimeModelsConfig,
} from "../domain/services/kernel-runtime-config.service.interface";
import { KernelRuntimeConfigBuilder } from "./kernel-runtime-config.builder";
import {
    ActiveSession,
    DEFAULT_RUNTIME_IDLE_TIMEOUT_MS,
    DEFAULT_RUNTIME_SWEEP_INTERVAL_MS,
    SessionRuntimeOverrides,
} from "./session-runtime.types";

export interface ActiveSessionSummary {
    sessionId: string;
    agentId: string;
    userId: string;
    runtimeKey: string;
    requestedModel?: string;
    resolvedModel?: string;
    createdAt: number;
    lastActivityAt: number;
    idleMs: number;
    ageMs: number;
}

export type KernelSessionOperationPhase = "queued" | "preparing" | "running" | "compacting" | "cancelling";

export interface KernelSessionOperation {
    operationId: string;
    runId?: string;
    phase: KernelSessionOperationPhase;
    startedAt: number;
}

const RUNTIME_AFFECTING_SESSION_FIELDS = new Set([
    "model",
    "followDefaultModel",
    "systemPrompt",
    "role",
    "guidelines",
    "responseStyle",
    "extra",
    "permissionMode",
    "skills",
    "allowCapabilities",
    "skillDirs",
    "builtinSkills",
    "enforceActiveSkillToolRestrictions",
    "planningMode",
    "goalTracking",
    "maxToolRounds",
    "maxParseRetries",
    "circuitBreakerThreshold",
    "continuationEnabled",
    "maxContinuationTurns",
    "autoCompact",
    "autoCompactThreshold",
    "temperature",
    "thinkingBudget",
    "toolTimeoutMs",
    "queueTimeoutMs",
    "maxExecutionTimeMs",
    "streamStallWarningMs",
    "streamStallHardMs",
    "toolInputStreamStallHardMs",
    "streamStallActiveToolHardMs",
    "maxConsecutiveToolErrors",
    "maxStreamRetries",
    "mcpServers",
    "searchConfig",
    "workerAgents",
    "inlineSkills",
    "autoDelegation",
    "autoParallel",
    "maxParallelTasks",
    "artifactStoreLimits",
    "retentionLimits",
]);

export type SessionCloseReason =
    | "explicit"
    | "reset"
    | "runtime_key_change"
    | "closed_runtime_recovery"
    | "idle_sweep"
    | "shutdown";

@Injectable()
export class KernelSessionRuntimeStateService implements OnModuleInit, OnModuleDestroy {
    private readonly logger = new Logger(KernelSessionRuntimeStateService.name);
    private modelsConfig: KernelRuntimeModelsConfig | null = null;
    private assistantDefaults: KernelAssistantRuntimeDefaults | null = null;
    private modelsConfigFetchedAt = 0;
    private readonly activeSessions = new Map<string, ActiveSession>();
    private readonly activeOperations = new Map<string, KernelSessionOperation>();
    private readonly sessionRuntimeOverrides = new Map<string, SessionRuntimeOverrides>();
    private readonly cancelledSessionIds = new Set<string>();
    private sweepTimer: NodeJS.Timeout | null = null;
    private readonly idleTimeoutMs: number;
    private readonly sweepIntervalMs: number;
    private readonly modelsConfigTtlMs: number;

    constructor(
        @Optional()
        @Inject(KERNEL_RUNTIME_CONFIG_SERVICE)
        private readonly runtimeConfigService?: IKernelRuntimeConfigService,
        @Optional()
        private readonly metrics?: MetricsService,
    ) {
        this.idleTimeoutMs = this.parsePositiveIntEnv(
            process.env.KERNEL_RUNTIME_IDLE_TIMEOUT_MS,
            DEFAULT_RUNTIME_IDLE_TIMEOUT_MS,
        );
        this.sweepIntervalMs = this.parsePositiveIntEnv(
            process.env.KERNEL_RUNTIME_SWEEP_INTERVAL_MS,
            DEFAULT_RUNTIME_SWEEP_INTERVAL_MS,
        );
        // How long a fetched models config is reused before the next session
        // create re-reads it. Lower = AI-settings edits take effect sooner;
        // higher = fewer config reads. Set to 0 to always re-read (debugging).
        // NOTE: this is a per-process desktop cache.
        this.modelsConfigTtlMs = this.parseNonNegativeIntEnv(process.env.KERNEL_MODELS_CONFIG_TTL_MS, 10_000);
    }

    runtimeConfigBuilder(): KernelRuntimeConfigBuilder {
        return new KernelRuntimeConfigBuilder(this.modelsConfig, this.assistantDefaults);
    }

    invalidateModelsConfig(reason = "unknown"): void {
        this.modelsConfig = null;
        this.assistantDefaults = null;
        this.modelsConfigFetchedAt = 0;
        this.logger.log(`Runtime models config cache invalidated (reason=${reason})`);
    }

    async refreshModelsConfig(): Promise<void> {
        if (!this.runtimeConfigService) return;
        const now = Date.now();
        if (this.modelsConfig && now - this.modelsConfigFetchedAt < this.modelsConfigTtlMs) return;
        // The global assistant defaults share the models-config TTL/refresh cadence so a
        // desktop assistant config edit takes effect on the same
        // schedule as an AI-settings edit.
        const [models, assistant] = await Promise.all([
            this.runtimeConfigService.getModelsConfig(),
            this.runtimeConfigService.getAssistantDefaults?.() ?? Promise.resolve(null),
        ]);
        this.modelsConfig = models;
        this.assistantDefaults = assistant;
        this.modelsConfigFetchedAt = now;
    }

    patchRuntimeOverrides(sessionId: string, patch?: SessionRuntimeOverrides): void {
        if (!patch) return;
        const current = this.sessionRuntimeOverrides.get(sessionId) ?? {};
        const next = { ...current };
        const writable = next as Record<string, unknown>;
        for (const [key, value] of Object.entries(patch) as Array<
            [keyof SessionRuntimeOverrides, SessionRuntimeOverrides[keyof SessionRuntimeOverrides]]
        >) {
            if (typeof value === "string" && value.trim()) {
                writable[key] = value.trim();
            } else if (value !== undefined) {
                writable[key] = value;
            }
        }
        this.sessionRuntimeOverrides.set(sessionId, next);
    }

    runtimeOverrides(sessionId: string): SessionRuntimeOverrides {
        return this.sessionRuntimeOverrides.get(sessionId) ?? {};
    }

    getActiveSession(sessionId: string): ActiveSession | undefined {
        return this.activeSessions.get(sessionId);
    }

    tryBeginOperation(sessionId: string, operationId: string, now: number = Date.now()): boolean {
        if (this.activeOperations.has(sessionId)) return false;
        this.activeOperations.set(sessionId, { operationId, phase: "queued", startedAt: now });
        return true;
    }

    activeOperation(sessionId: string): KernelSessionOperation | null {
        return this.activeOperations.get(sessionId) ?? null;
    }

    isOperationActive(sessionId: string): boolean {
        return this.activeOperations.has(sessionId);
    }

    updateOperationPhase(sessionId: string, operationId: string, phase: KernelSessionOperationPhase): boolean {
        const operation = this.activeOperations.get(sessionId);
        if (!operation || operation.operationId !== operationId) return false;
        operation.phase = phase;
        return true;
    }

    updateActiveOperationPhase(sessionId: string, phase: KernelSessionOperationPhase): boolean {
        const operation = this.activeOperations.get(sessionId);
        if (!operation) return false;
        operation.phase = phase;
        return true;
    }

    associateOperationRunId(sessionId: string, operationId: string, runId: string): boolean {
        const operation = this.activeOperations.get(sessionId);
        if (!operation || operation.operationId !== operationId) return false;
        operation.runId = runId;
        return true;
    }

    finishOperation(sessionId: string, operationId: string): boolean {
        const operation = this.activeOperations.get(sessionId);
        if (!operation || operation.operationId !== operationId) return false;
        this.activeOperations.delete(sessionId);
        return true;
    }

    patchAffectsRuntime(patch: Record<string, unknown>): boolean {
        return Object.keys(patch).some((key) => RUNTIME_AFFECTING_SESSION_FIELDS.has(key));
    }

    setActiveSession(sessionId: string, session: ActiveSession): void {
        this.activeSessions.set(sessionId, session);
        this.metrics?.setGauge("kernel_active_runtime_sessions", this.activeSessions.size);
    }

    /**
     * Refresh the lastActivityAt watermark so the idle sweeper does not
     * retire this runtime. Called by the access service on every lookup so
     * any live caller (runner or inspection endpoint) counts as
     * activity. Cheap — single map read + epoch write.
     */
    touchActivity(sessionId: string, now: number = Date.now()): void {
        const session = this.activeSessions.get(sessionId);
        if (session) session.lastActivityAt = now;
    }

    deleteActiveSession(
        sessionId: string,
        options: { preserveOperation?: boolean; preserveRuntimeOverrides?: boolean } = {},
    ): void {
        this.activeSessions.delete(sessionId);
        if (options.preserveRuntimeOverrides !== true) this.sessionRuntimeOverrides.delete(sessionId);
        this.cancelledSessionIds.delete(sessionId);
        if (options.preserveOperation !== true) this.activeOperations.delete(sessionId);
        this.metrics?.setGauge("kernel_active_runtime_sessions", this.activeSessions.size);
    }

    activeSessionIds(): string[] {
        return Array.from(this.activeSessions.keys());
    }

    activeSessionSummaries(now: number = Date.now()): ActiveSessionSummary[] {
        const result: ActiveSessionSummary[] = [];
        for (const [sessionId, session] of this.activeSessions.entries()) {
            result.push({
                sessionId,
                agentId: session.agentId,
                userId: session.userId,
                runtimeKey: session.runtimeKey,
                requestedModel: session.runtimeOverrides.model,
                resolvedModel: session.resolvedModel,
                createdAt: session.createdAt,
                lastActivityAt: session.lastActivityAt,
                idleMs: now - session.lastActivityAt,
                ageMs: now - session.createdAt,
            });
        }
        return result;
    }

    /**
     * Snapshot ids of sessions that have been idle longer than the configured
     * threshold. Caller does the actual close (via the access service) so the
     * state service stays free of cross-module dependencies.
     */
    idleSessionIds(thresholdMs: number = this.idleTimeoutMs, now: number = Date.now()): string[] {
        const ids: string[] = [];
        for (const [sessionId, session] of this.activeSessions.entries()) {
            // A long model/tool operation is not idle merely because no second
            // caller touched the runtime. Closing it from the sweeper would
            // turn an in-flight run into a misleading "Session is closed".
            if (this.activeOperations.has(sessionId)) continue;
            if (now - session.lastActivityAt >= thresholdMs) {
                ids.push(sessionId);
            }
        }
        return ids;
    }

    markCancelled(sessionId: string): void {
        this.cancelledSessionIds.add(sessionId);
    }

    clearCancelled(sessionId: string): void {
        this.cancelledSessionIds.delete(sessionId);
    }

    isCancelled(sessionId: string): boolean {
        return this.cancelledSessionIds.has(sessionId);
    }

    /**
     * Hook for the runtime sweeper. Returns the registered reaper, or `null`
     * if none has been wired yet — `KernelSessionRuntimeSweeper` registers
     * itself in `onModuleInit` to avoid a circular dependency with the
     * access service.
     */
    private reaper: ((sessionId: string, reason: SessionCloseReason) => boolean) | null = null;

    registerReaper(reaper: (sessionId: string, reason: SessionCloseReason) => boolean): void {
        this.reaper = reaper;
    }

    recordCloseMetric(reason: SessionCloseReason): void {
        this.metrics?.incCounter("kernel_runtime_session_closed_total", { reason });
    }

    onModuleInit(): void {
        if (this.sweepTimer || this.idleTimeoutMs <= 0 || this.sweepIntervalMs <= 0) return;
        this.sweepTimer = setInterval(() => this.sweep(), this.sweepIntervalMs);
        // Unref so the sweeper never blocks Node.js from exiting on its own.
        this.sweepTimer.unref?.();
        this.logger.log(
            `Runtime sweeper armed: idleTimeoutMs=${this.idleTimeoutMs}, sweepIntervalMs=${this.sweepIntervalMs}`,
        );
    }

    async onModuleDestroy(): Promise<void> {
        if (this.sweepTimer) {
            clearInterval(this.sweepTimer);
            this.sweepTimer = null;
        }
        if (!this.reaper) return;
        const ids = this.activeSessionIds();
        if (ids.length === 0) return;
        this.logger.log(`Closing ${ids.length} active runtime session(s) on module destroy`);
        for (const sessionId of ids) {
            try {
                this.reaper(sessionId, "shutdown");
            } catch (error) {
                this.logger.warn(
                    `Failed to close session ${sessionId} on shutdown: ${
                        error instanceof Error ? error.message : String(error)
                    }`,
                );
            }
        }
    }

    private sweep(): void {
        if (!this.reaper) return;
        const ids = this.idleSessionIds();
        if (ids.length === 0) return;
        this.logger.log(`Sweeping ${ids.length} idle runtime session(s)`);
        for (const sessionId of ids) {
            try {
                this.reaper(sessionId, "idle_sweep");
            } catch (error) {
                this.logger.warn(
                    `Idle sweep failed to close session ${sessionId}: ${
                        error instanceof Error ? error.message : String(error)
                    }`,
                );
            }
        }
    }

    private parsePositiveIntEnv(value: string | undefined, fallback: number): number {
        if (!value) return fallback;
        const trimmed = value.trim();
        if (!trimmed) return fallback;
        const parsed = Number.parseInt(trimmed, 10);
        if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
        return parsed;
    }

    /** Like {@link parsePositiveIntEnv} but allows 0 (used by the models-config
     *  TTL where 0 means "never cache, always re-read"). */
    private parseNonNegativeIntEnv(value: string | undefined, fallback: number): number {
        if (!value) return fallback;
        const trimmed = value.trim();
        if (!trimmed) return fallback;
        const parsed = Number.parseInt(trimmed, 10);
        if (!Number.isFinite(parsed) || parsed < 0) return fallback;
        return parsed;
    }
}
