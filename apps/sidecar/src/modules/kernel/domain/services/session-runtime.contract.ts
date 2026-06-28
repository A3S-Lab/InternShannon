import type { InlineSkill, PermissionPolicy } from '@a3s-lab/code';

/**
 * Session runtime contract types — the configuration surface an agent (domain
 * {@link AgentSpec}) exposes for how it wants its runtime composed. Lives in the
 * domain layer so {@link AgentSpec} stays free of any application import; the
 * application `session-runtime.types` re-exports these for its own consumers.
 *
 * Pure type declarations only — no NestJS / DB / framework dependency. The two
 * external references ({@link InlineSkill}, {@link PermissionPolicy}) are SDK
 * type-only contracts from `@a3s-lab/code`, the same package the agent spec
 * already builds on.
 */

export interface RuntimeMcpServerConfig {
    name: string;
    enabled?: boolean;
    transport: {
        type?: 'stdio' | 'http' | 'streamable-http';
        command?: string;
        args?: string[];
        url?: string;
        headers?: Record<string, string>;
    };
    env?: Record<string, string>;
    tool_timeout_secs?: number;
    timeoutMs?: number;
}

export interface RuntimeSearchConfig {
    enabledEngines?: string[];
    language?: string;
    safesearch?: 'off' | 'moderate' | 'strict';
    timeout?: number;
    limit?: number;
}

export interface RuntimeWorkerAgentSpec {
    name: string;
    description: string;
    kind?: 'read_only' | 'planner' | 'implementer' | 'verifier' | 'reviewer' | 'custom' | string;
    hidden?: boolean;
    permissions?: PermissionPolicy;
    model?: string;
    prompt?: string;
    maxSteps?: number;
    /** "auto_approve" (default) | "deny_on_ask" | "inherit_parent". */
    confirmationInheritance?: 'auto_approve' | 'deny_on_ask' | 'inherit_parent' | string;
}

export interface RuntimeAutoDelegationOptions {
    enabled?: boolean;
    autoParallel?: boolean;
    minConfidence?: number;
    maxTasks?: number;
}

export interface RuntimeArtifactStoreLimits {
    maxArtifacts?: number;
    maxBytes?: number;
}

export interface RuntimeRetentionLimits {
    maxRunsRetained?: number;
    maxEventsPerRun?: number;
    maxTraceEvents?: number;
    maxTerminalSubagentTasks?: number;
}

export interface RuntimeClawSentryConfig {
    enabled?: boolean;
    mode?: 'managed-gateway' | 'external-gateway' | string;
    failClosed?: boolean;
    permissionPolicy?: 'allow' | 'default' | string;
    /**
     * Desktop default-mode safety is delegated to ClawSentry/AHP. When true,
     * file-based skills are loaded from a temporary copy whose `allowed-tools`
     * grant is widened to `*`, so active skills cannot preempt the normal
     * permission/AHP/HITL pipeline.
     */
    ignoreSkillToolRestrictions?: boolean;
    gatewayUrl?: string;
    token?: string;
}

export interface SessionRuntimeOverrides {
    model?: string;
    /**
     * @deprecated Prefer the typed slots: `role`, `guidelines`, `responseStyle`, `extra`.
     * Kept for backward compatibility — when set, lands in the SDK's `extra` slot
     * alongside any agent-supplied slot content.
     */
    systemPrompt?: string;
    /** SDK slot: identity / role prepended before the SDK's core agentic prompt. */
    role?: string;
    /** SDK slot: domain rules appended after the SDK's core prompt. */
    guidelines?: string;
    /** SDK slot: replaces the default Response Format section. Use sparingly. */
    responseStyle?: string;
    /**
     * SDK slot: freeform content appended at the very end of the system prompt.
     * Right place for context-dependent injections (file lists, current phase, etc.)
     * that vary per turn.
     */
    extra?: string;
    permissionMode?: string;
    skills?: string[];
    /**
     * Opt the agent into the cloud progressive-API meta-skill (`capabilities`)
     * WITHOUT turning `skills` into a restrictive whitelist. Setting `skills` to
     * gate capabilities also narrows the session to exactly those skills (see
     * the factory `runtimeSkillNames` whitelist), which is right for locked
     * specialists but wrong for the default assistant (internShannon), which must keep
     * all its system skills. This flag enables `capabilities` while leaving every
     * other skill intact. Execute access stays READ-ONLY for the default agent
     * (enforced in CapabilitiesToolService).
     */
    allowCapabilities?: boolean;
    skillDirs?: string[];
    builtinSkills?: boolean;
    /**
     * SDK 4.2+ active-skill tool restriction switch. Defaults to false in
     * a3s-code; true restores the legacy behavior where the active skill's
     * allowed-tools list globally narrows ordinary session tool calls.
     */
    enforceActiveSkillToolRestrictions?: boolean;
    planningMode?: string;
    goalTracking?: boolean;
    maxToolRounds?: number;
    maxParseRetries?: number;
    circuitBreakerThreshold?: number;
    continuationEnabled?: boolean;
    maxContinuationTurns?: number;
    autoCompact?: boolean;
    autoCompactThreshold?: number;
    temperature?: number;
    thinkingBudget?: number;
    maxExecutionTimeMs?: number;
    /**
     * Per-tool execution timeout in milliseconds. Bounds how long a single
     * tool call (built-in or MCP) can run before the runtime aborts it.
     * Defaults to `DEFAULT_TOOL_TIMEOUT_MS` when unset.
     */
    toolTimeoutMs?: number;
    /**
     * Lane queue dispatch timeout in milliseconds. Defaults to
     * `DEFAULT_TOOL_TIMEOUT_MS` when unset.
     */
    queueTimeoutMs?: number;
    /**
     * Runner-side watchdog: emit a `stream_stalled` heartbeat after this many
     * ms of silence from the SDK event stream. Defaults to
     * `DEFAULT_STREAM_STALL_WARNING_MS`.
     */
    streamStallWarningMs?: number;
    /**
     * Runner-side watchdog: force-cancel the run after this many ms of silence
     * from the SDK event stream **while no tool is in flight** (model is
     * "thinking" between tool calls). Defaults to `DEFAULT_STREAM_STALL_HARD_MS`.
     */
    streamStallHardMs?: number;
    /**
     * Runner-side watchdog: force-cancel after this many ms of silence **while a
     * tool is actively executing**. Decoupled from `streamStallHardMs`
     * because legitimate long tools (large `Bash`, `web_search` with retries,
     * `git clone`, multi-MB reads) commonly emit no intermediate SDK events and
     * should not be preempted before their own `toolTimeoutMs` fires.
     *
     * The effective threshold is `max(streamStallActiveToolHardMs, toolTimeoutMs + 60_000)`
     * so the SDK's per-tool timeout always fires first — the runner watchdog is
     * only here to catch the case where the SDK itself drops `tool_end`.
     *
     * Defaults to `DEFAULT_STREAM_STALL_ACTIVE_TOOL_HARD_MS`.
     */
    streamStallActiveToolHardMs?: number;
    /**
     * Same-tool circuit breaker: maximum consecutive failures of one tool in
     * one user message before the runner cancels the run. Defaults to
     * `DEFAULT_MAX_CONSECUTIVE_TOOL_ERRORS`.
     */
    maxConsecutiveToolErrors?: number;
    /**
     * Maximum automatic re-attempts after `event_stream_stalled` when **no
     * tokens have been streamed yet** (model-thinking wedge). Tool-mid or
     * partially-streamed runs are never auto-retried — the surface to the user
     * would diverge between attempts. Defaults to `DEFAULT_MAX_STREAM_RETRIES`.
     * Set to `0` to disable the safety net and surface the stall as the legacy
     * hard failure.
     */
    maxStreamRetries?: number;
    mcpServers?: RuntimeMcpServerConfig[];
    searchConfig?: RuntimeSearchConfig;
    /**
     * Disposable worker-agent specs registered for `task` / `parallel_task`
     * delegation. Use this when a session wants to fan out long operations to
     * scoped subagents instead of running them on the main loop.
     *
     * Cancellation is per-task via `session.cancelSubagentTask(taskId)` — the
     * parent session stays alive even when a worker run is killed.
     */
    workerAgents?: RuntimeWorkerAgentSpec[];
    /**
     * Programmatic SDK skills. Lets built-in kernel agents register small
     * per-session instruction/persona packs without writing temporary skill
     * files into the workspace.
     */
    inlineSkills?: InlineSkill[];
    /**
     * Auto child-agent delegation policy. When `enabled` is true, the runtime
     * may automatically dispatch nested tasks to workers based on local
     * confidence signals. Bounded by `maxTasks` per user request.
     */
    autoDelegation?: RuntimeAutoDelegationOptions;
    /**
     * Global kill switch for automatic parallel fan-out. Manual
     * `parallel_task` / `session.tasks(...)` remain available when false.
     */
    autoParallel?: boolean;
    /** Sibling parallel branches cap for `parallel_task` / auto-delegation. */
    maxParallelTasks?: number;
    /**
     * Retention limits for large tool/program outputs. Outputs over the inline
     * display budget are persisted as session artifacts and surfaced via
     * `session.getArtifact(uri)`.
     */
    artifactStoreLimits?: RuntimeArtifactStoreLimits;
    /**
     * FIFO caps for the SDK in-memory run / trace / subagent stores. Omitted
     * fields keep a3s-code's unbounded default.
     */
    retentionLimits?: RuntimeRetentionLimits;
    /**
     * Desktop security gateway runtime configuration. `token` and
     * `gatewayUrl` are internal-only connection hints; public status endpoints
     * must redact them.
     */
    clawSentry?: RuntimeClawSentryConfig;
}
