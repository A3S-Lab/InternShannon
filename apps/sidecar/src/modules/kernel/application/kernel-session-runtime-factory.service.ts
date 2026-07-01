import {
    Agent,
    DefaultSecurityProvider,
    FileMemoryStore,
    FileSessionStore,
    type Session,
    type SessionOptions,
} from '@a3s-lab/code';
import { Inject, Injectable, Logger, type OnModuleInit, Optional } from '@nestjs/common';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { MetricsService } from '@/shared/observability/metrics';
import { IKernelService, KERNEL_SERVICE } from '../domain/services/kernel-service.interface';
import { AgentRegistry } from './agents/agent-registry';
import { classifyWebSearchReadiness, verifyBrowserBinary } from './kernel-browser-binary-check';
import {
    confirmationPolicyForMode,
    permissionPolicyForMode,
    planningModeForRuntime,
    planReadonlyToolBlockReason,
} from './kernel-session-policies';
import { KernelSessionRuntimeStateService } from './kernel-session-runtime-state.service';
import {
    type ActiveSession,
    DEFAULT_MAX_EXECUTION_TIME_MS,
    DEFAULT_MAX_PARSE_RETRIES,
    DEFAULT_CIRCUIT_BREAKER_THRESHOLD,
    DEFAULT_TOOL_TIMEOUT_MS,
    type RuntimeMcpInitError,
    type RuntimeMcpServerConfig,
    type SessionRuntimeOverrides,
} from './session-runtime.types';

export interface KernelSessionRuntimeFactoryInput {
    sessionId: string;
    agentId?: string;
    cwd?: string;
    overrides?: SessionRuntimeOverrides;
    emit: (message: unknown) => void;
}

@Injectable()
export class KernelSessionRuntimeFactory implements OnModuleInit {
    private readonly logger = new Logger(KernelSessionRuntimeFactory.name);
    private readonly pendingCreations = new Map<string, Promise<ActiveSession | null>>();

    constructor(
        @Inject(KERNEL_SERVICE)
        private readonly kernelService: IKernelService,
        private readonly runtimeState: KernelSessionRuntimeStateService,
        private readonly agentRegistry: AgentRegistry,
        @Optional()
        private readonly metrics?: MetricsService,
    ) {}

    async onModuleInit(): Promise<void> {
        const browserStatus = verifyBrowserBinary();
        const readiness = classifyWebSearchReadiness(process.env, browserStatus);
        if (readiness.reason === 'binary_missing' && browserStatus.reason) {
            this.logger.error(browserStatus.reason);
        } else if (readiness.reason === 'no_pin') {
            this.logger.warn(
                'No headless browser pinned via LIGHTPANDA/CHROME env. ' +
                    'The kernel SDK will lazily auto-detect on first web_search call, ' +
                    'which may stall while fetching the binary from github.',
            );
        }
        this.metrics?.setGauge('kernel_web_search_ready', readiness.ready ? 1 : 0, { reason: readiness.reason });
    }

    async getOrCreateSession(input: KernelSessionRuntimeFactoryInput): Promise<ActiveSession | null> {
        const { sessionId } = input;
        const pending = this.pendingCreations.get(sessionId);
        if (pending) return pending;

        const promise = this.doGetOrCreateSession(input);
        this.pendingCreations.set(sessionId, promise);
        try {
            return await promise;
        } finally {
            this.pendingCreations.delete(sessionId);
        }
    }

    private async doGetOrCreateSession(input: KernelSessionRuntimeFactoryInput): Promise<ActiveSession | null> {
        const { sessionId, overrides } = input;
        await this.runtimeState.refreshModelsConfig();
        this.runtimeState.patchRuntimeOverrides(sessionId, overrides);

        const runtimeConfig = this.runtimeState.runtimeConfigBuilder();
        const kernelSession = await this.kernelService.getSession(sessionId);
        if (!kernelSession) {
            this.logger.error(`Session ${sessionId} not found in kernel service`);
            return null;
        }

        await this.kernelService.awaitWorkspaceReady?.(sessionId);

        const resolvedAgentId = input.agentId || kernelSession.agentId || 'default';
        // For the default kernel assistant (agentId 'default'; legacy 'super-admin'
        // aliases to 'default'), the desktop assistant config is AUTHORITATIVE: it is
        // merged LAST so any meaningfully-set field (systemPrompt / skills / mcpServers /
        // params) OVERRIDES whatever the frontend sent in session metadata or the
        // per-session live patch. Unset global fields are absent from the projection, so
        // they fall back to frontend metadata / built-in defaults. Non-default agents
        // never see this layer, so their behavior is unchanged.
        // Effective precedence (top wins):
        //   systemRuntimeDefaults < session-metadata < per-session patch < GLOBAL-assistant
        // and default.agent.runtimeDefaults() fills only the still-unset gaps below.
        const isDefaultAgent = resolvedAgentId === 'default' || this.agentRegistry.resolve(resolvedAgentId)?.id === 'default';
        const runtimeOverrides = runtimeConfig.mergeRuntimeOverrides(
            runtimeConfig.systemRuntimeDefaults(),
            runtimeConfig.sessionMetadataOverrides(kernelSession),
            this.runtimeState.runtimeOverrides(sessionId) ?? {},
            isDefaultAgent ? runtimeConfig.assistantDefaultOverrides() : undefined,
        );
        const finalOverrides = this.effectiveRuntimeOverrides(
            this.agentRegistry.resolveOverrides(resolvedAgentId, runtimeOverrides, sessionId),
        );
        const runtimeKey = runtimeConfig.runtimeKey(finalOverrides);

        const existing = this.runtimeState.getActiveSession(sessionId);
        if (existing) {
            if (existing.runtimeKey === runtimeKey) {
                this.runtimeState.touchActivity(sessionId);
                return existing;
            }
            existing.session.close();
            this.runtimeState.deleteActiveSession(sessionId);
            this.runtimeState.recordCloseMetric('runtime_key_change');
            this.logger.log(`Recreating session ${sessionId} after runtime config changed`);
        }

        const profileMcpServers = this.agentRegistry.resolveMcpServers(resolvedAgentId);
        const agentConfig = runtimeConfig.buildAgentConfig(finalOverrides);

        const [workspace, agent] = await Promise.all([
            this.resolveRuntimeWorkspace(sessionId, input.cwd || kernelSession.cwd),
            this.createAgent(agentConfig),
        ]);
        const runtimeSkillDirs = finalOverrides.skillDirs;
        const nativeConfirmationEnabled =
            finalOverrides.permissionMode !== 'auto' && finalOverrides.permissionMode !== 'plan';

        const localRuntimeStores = {
            sessionStore: new FileSessionStore(path.join(workspace, '.sessions')),
            memoryStore: new FileMemoryStore(path.join(workspace, '.memory')),
            autoSave: true,
        };

        const resolvedModel = runtimeConfig.resolveDefaultModel(finalOverrides);
        const modelApiKeyMissing = runtimeConfig.resolvedModelApiKeyMissing(resolvedModel);
        const basePermissionPolicy = permissionPolicyForMode(finalOverrides.permissionMode, nativeConfirmationEnabled);
        const confirmationPolicy = confirmationPolicyForMode(finalOverrides.permissionMode, nativeConfirmationEnabled);

        const sessionOptions: SessionOptions = {
            sessionId,
            model: resolvedModel,
            ...localRuntimeStores,
            permissionPolicy: basePermissionPolicy,
            confirmationPolicy,
            builtinSkills: finalOverrides.builtinSkills ?? false,
            enforceActiveSkillToolRestrictions: finalOverrides.enforceActiveSkillToolRestrictions,
            skillDirs: runtimeSkillDirs,
            planningMode: planningModeForRuntime(finalOverrides),
            goalTracking: finalOverrides.goalTracking,
            maxToolRounds: finalOverrides.maxToolRounds ?? 12,
            maxParseRetries: this.clampNonNegativeInteger(finalOverrides.maxParseRetries) ?? DEFAULT_MAX_PARSE_RETRIES,
            toolTimeoutMs: this.clampPositiveMs(finalOverrides.toolTimeoutMs) ?? DEFAULT_TOOL_TIMEOUT_MS,
            // Local (a1040668): config-driven via session metadata / settings; defaults to
            // DEFAULT_CIRCUIT_BREAKER_THRESHOLD (=2), matching origin's previous literal.
            circuitBreakerThreshold:
                this.clampPositiveInteger(finalOverrides.circuitBreakerThreshold) ?? DEFAULT_CIRCUIT_BREAKER_THRESHOLD,
            // Origin (fc3ea7cc, session exception handling / diagnostic loop): default continuation +
            // auto-compact ON so long-running loops keep recovering instead of stalling. Still
            // override-driven so explicit session metadata / settings can dial them back.
            continuationEnabled: finalOverrides.continuationEnabled ?? true,
            maxContinuationTurns: finalOverrides.maxContinuationTurns ?? 2,
            autoCompact: finalOverrides.autoCompact ?? true,
            autoCompactThreshold: finalOverrides.autoCompactThreshold ?? 0.8,
            temperature: finalOverrides.temperature,
            thinkingBudget: finalOverrides.thinkingBudget,
            maxExecutionTimeMs:
                this.clampPositiveMs(finalOverrides.maxExecutionTimeMs) ?? DEFAULT_MAX_EXECUTION_TIME_MS,
            securityProvider: new DefaultSecurityProvider(),
            queueConfig: {
                queryConcurrency: 1,
                executeConcurrency: 1,
                generateConcurrency: 1,
                enableDlq: true,
                enableMetrics: true,
                timeoutMs: this.clampPositiveMs(finalOverrides.queueTimeoutMs) ?? DEFAULT_TOOL_TIMEOUT_MS,
            },
            // Pass agent-supplied prompt slots straight through to the SDK.
            // The SDK's core agentic prompt (planning mode, tool-use protocol,
            // response format) stays intact and is never overwritten.
            role: finalOverrides.role,
            guidelines: finalOverrides.guidelines,
            responseStyle: finalOverrides.responseStyle,
            extra: runtimeConfig.composeExtraSlot(finalOverrides),
            // 3.2.x async-delegation primitives. When an agent registers
            // `workerAgents`, callers can offload long ops via
            // `session.task({ agent: '<name>', ... })` and cancel them per-task
            // through `cancelSubagentTask(taskId)` without nuking the parent
            // session. `undefined` is passed through unchanged so the SDK
            // applies its own defaults.
            workerAgents: finalOverrides.workerAgents,
            inlineSkills: finalOverrides.inlineSkills,
            autoDelegation: finalOverrides.autoDelegation,
            autoParallel: finalOverrides.autoParallel,
            maxParallelTasks: finalOverrides.maxParallelTasks,
            artifactStoreLimits: finalOverrides.artifactStoreLimits,
            retentionLimits: finalOverrides.retentionLimits,
        };

        const session = this.createOrResumeSdkSession(agent, workspace, sessionId, sessionOptions);
        const allMcpServers = [...(finalOverrides.mcpServers ?? []), ...profileMcpServers];
        const mcpInitErrors = await this.applyMcpServers(session, allMcpServers);

        this.registerWorkers(session, resolvedAgentId);

        if (finalOverrides.permissionMode === 'plan') {
            this.registerPlanReadonlyHooks(session);
        }

        const now = Date.now();
        const activeSession: ActiveSession = {
            session,
            workspace,
            storageWorkspace: kernelSession.cwd || workspace,
            agentId: resolvedAgentId,
            userId: kernelSession.userId,
            runtimeKey,
            runtimeOverrides: finalOverrides,
            resolvedModel,
            modelApiKeyMissing,
            mcpInitErrors,
            nativeConfirmationEnabled,
            nativeConfirmedToolKeys: new Set(),
            createdAt: now,
            lastActivityAt: now,
        };

        this.runtimeState.setActiveSession(sessionId, activeSession);
        return activeSession;
    }

    private createOrResumeSdkSession(
        agent: Agent,
        workspace: string,
        sessionId: string,
        sessionOptions: SessionOptions,
    ): Session {
        if (sessionOptions.sessionStore && sessionOptions.autoSave === true) {
            try {
                return agent.resumeSession(sessionId, sessionOptions);
            } catch (error) {
                this.logger.debug(
                    `No persisted SDK session found for ${sessionId}, creating a new runtime session: ${
                        error instanceof Error ? error.message : String(error)
                    }`,
                );
            }
        }

        return agent.session(workspace, sessionOptions);
    }

    private clampPositiveMs(value: number | undefined): number | undefined {
        if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return undefined;
        return Math.floor(value);
    }

    private clampPositiveInteger(value: number | undefined): number | undefined {
        if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return undefined;
        return Math.floor(value);
    }

    private clampNonNegativeInteger(value: number | undefined): number | undefined {
        if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return undefined;
        return Math.floor(value);
    }

    private async createAgent(agentConfig: string): Promise<Agent> {
        try {
            const agent = await Agent.create(agentConfig);
            this.metrics?.incCounter('kernel_runtime_agent_created_total');
            return agent;
        } catch (error) {
            this.logger.error(`Failed to create Agent: ${error}`);
            throw error;
        }
    }

    private effectiveRuntimeOverrides(overrides: SessionRuntimeOverrides): SessionRuntimeOverrides {
        return overrides;
    }

    async resolveRuntimeWorkspace(sessionId: string, workspace?: string): Promise<string> {
        const candidate = workspace?.trim();
        const fallback = path.join(os.homedir(), '.internshannon', 'workspace');
        const localCandidate = candidate || fallback;
        if (this.isRemoteWorkspacePath(localCandidate)) {
            throw new Error(`Desktop runtime workspace must be a local path (got ${JSON.stringify(localCandidate)})`);
        }
        await fs.mkdir(localCandidate, { recursive: true });
        return localCandidate;
    }

    private isRemoteWorkspacePath(workspace: string): boolean {
        return /^[a-z][a-z0-9+.-]*:\/{1,2}/i.test(workspace);
    }

    private async applyMcpServers(
        session: Session,
        servers?: RuntimeMcpServerConfig[],
    ): Promise<RuntimeMcpInitError[]> {
        const enabled = (servers ?? []).filter(s => s.enabled !== false);
        if (enabled.length === 0) return [];

        const results = await Promise.allSettled(
            enabled.map(async (server): Promise<RuntimeMcpInitError | null> => {
                try {
                    const transport = server.transport.type ?? 'stdio';
                    const timeoutMs =
                        server.timeoutMs ??
                        (server.tool_timeout_secs ? Math.max(1, server.tool_timeout_secs) * 1000 : undefined);
                    if (transport === 'stdio' && !server.transport.command) {
                        throw new Error('stdio MCP server requires transport.command');
                    }
                    if ((transport === 'http' || transport === 'streamable-http') && !server.transport.url) {
                        throw new Error(`${transport} MCP server requires transport.url`);
                    }
                    const toolCount = await session.addMcpServer(
                        server.name,
                        transport,
                        server.transport.command,
                        server.transport.args,
                        server.transport.url,
                        server.transport.headers,
                        server.env,
                        timeoutMs,
                    );
                    this.logger.log(
                        `MCP server ${server.name} registered for session ${session.sessionId} (${toolCount} tools)`,
                    );
                    return null;
                } catch (error) {
                    const message = error instanceof Error ? error.message : String(error);
                    this.logger.warn(
                        `Failed to register MCP server ${server.name} for session ${session.sessionId}: ${message}`,
                    );
                    return { name: server.name, error: message };
                }
            }),
        );

        return results
            .map(r => (r.status === 'fulfilled' ? r.value : { name: 'unknown', error: String(r.reason) }))
            .filter((e): e is RuntimeMcpInitError => e !== null);
    }

    /**
     * Wrap a hook handler so it can NEVER let a synchronous JS exception
     * propagate back to the SDK's napi threadsafe_function callback. When
     * the JS side throws, napi 2.x catches the error trying to convert the
     * return value into a Rust struct, fails with `GenericFailure`, and
     * aborts the entire Node process with FATAL ERROR — which presents to
     * users as "the API died mid-tool-call, every active session froze".
     *
     * Concrete trigger we've observed in v3: the SDK occasionally invokes
     * `pre_tool_use` with a null event payload, and our policy helpers
     * blindly read `event.toolName`. This wrapper makes the whole call
     * site safe-by-default: any thrown error becomes a non-blocking log +
     * a `null` decision (which the SDK reads as "no opinion, proceed").
     */
    private safeHookHandler(
        hookId: string,
        handler: (event: Record<string, unknown>) => { action: string; reason?: string } | null | undefined,
    ): (event: Record<string, unknown>) => { action: string; reason?: string } | null {
        return (event: Record<string, unknown>) => {
            try {
                if (!event || typeof event !== 'object') return null;
                return handler(event) ?? null;
            } catch (error) {
                this.logger.error(
                    `[kernel.hook.error] hookId=${hookId} message="${
                        error instanceof Error ? error.message : String(error)
                    }"`,
                );
                return null;
            }
        };
    }

    private registerPlanReadonlyHooks(session: Session): void {
        session.registerHook(
            'plan-readonly-guard',
            'pre_tool_use',
            undefined,
            { priority: 0, timeoutMs: 5_000 },
            this.safeHookHandler('plan-readonly-guard', event => {
                const reason = planReadonlyToolBlockReason(event);
                return reason ? { action: 'block', reason } : null;
            }),
        );
    }

    private registerWorkers(session: Session, agentId: string): void {
        const defaultSpec = this.agentRegistry.resolve('default');
        if (defaultSpec?.workers) {
            session.registerWorkerAgents(defaultSpec.workers());
        }
        if (agentId === 'default') return;
        const spec = this.agentRegistry.resolve(agentId);
        if (spec?.workers) {
            session.registerWorkerAgents(spec.workers());
        }
    }
}
