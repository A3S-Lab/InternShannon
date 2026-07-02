import type { Session } from '@a3s-lab/code';

// Session runtime contract types moved to the domain layer so domain/AgentSpec
// no longer imports from application. Re-exported here for existing consumers.
export type {
    RuntimeArtifactStoreLimits,
    RuntimeAutoDelegationOptions,
    RuntimeMcpServerConfig,
    RuntimeRetentionLimits,
    RuntimeSearchConfig,
    RuntimeWorkerAgentSpec,
    SessionRuntimeOverrides,
} from '../domain/services/session-runtime.contract';

import type { SessionRuntimeOverrides } from '../domain/services/session-runtime.contract';

export interface SubscribePayload {
    sessionId: string;
    agentId?: string;
    cwd?: string;
}

export interface MessagePayload {
    sessionId: string;
    type: string;
    content?: string;
    model?: string;
    systemPrompt?: string;
    mode?: string;
    images?: { mediaType: string; data: string }[];
    [key: string]: unknown;
}

export interface ActiveSession {
    session: Session;
    workspace: string;
    storageWorkspace?: string;
    agentId: string;
    userId: string;
    runtimeKey: string;
    runtimeOverrides: SessionRuntimeOverrides;
    /**
     * The fully-resolved `provider/modelId` actually handed to the SDK at
     * creation (output of `resolveDefaultModel`). Unlike `runtimeOverrides.model`
     * — which is empty when the session uses the system default — this is always
     * the concrete model, so failure reports can name it instead of "default".
     */
    resolvedModel?: string;
    /**
     * True when {@link resolvedModel} had no usable API key (config + env fallback)
     * at creation. Lets the later empty-response failure be reported as an
     * actionable "configure the provider API key" error rather than a generic one.
     */
    modelApiKeyMissing?: boolean;
    mcpInitErrors?: RuntimeMcpInitError[];
    nativeConfirmationEnabled: boolean;
    nativeConfirmedToolKeys: Set<string>;
    /** Epoch ms of when this runtime was first created in this process. */
    createdAt: number;
    /**
     * Epoch ms of the last access (lookup or create). Refreshed by the access
     * service on every `active()` / `getActiveOrCreate()` call, which makes any
     * live caller — runner or inspection — counts as activity. Used by
     * the idle sweeper to retire abandoned sessions whose underlying SDK
     * `Agent` cannot be closed (the SDK exposes no Agent.close in 3.2.x).
     */
    lastActivityAt: number;
}

/**
 * Per-tool execution timeout default. Chosen to be long enough for legitimate
 * slow tools (browser-based `web_search`, large local reads) but short enough
 * that misconfigured/unreachable endpoints surface as failures fast, instead
 * of looking like the agent is "stuck on tool calls" for two minutes.
 */
export const DEFAULT_TOOL_TIMEOUT_MS = 30_000;

/**
 * Overall ceiling for a single message-run inside the SDK. Caps the worst-case
 * blast radius of a runaway agent (e.g. tool-result retry loop, a streaming
 * model that won't stop) so a single user message can never lock a session
 * indefinitely. Five minutes is generous for legitimate multi-step plans yet
 * short enough that operators don't need a manual kill switch.
 */
export const DEFAULT_MAX_EXECUTION_TIME_MS = 300_000;

/** Max consecutive malformed tool-call / parser recovery attempts before abort. */
export const DEFAULT_MAX_PARSE_RETRIES = 2;

/**
 * Max model↔tool exchange rounds per SDK run. Coding tasks regularly need
 * read/edit/test/fix cycles across several files, so the SDK's conservative
 * fallback of 12 is too easy to hit for normal desktop work.
 */
export const DEFAULT_MAX_TOOL_ROUNDS = 50;

/** Max consecutive LLM API failures before the SDK circuit breaker aborts the run. */
export const DEFAULT_CIRCUIT_BREAKER_THRESHOLD = 2;

/**
 * Runner-side watchdog soft threshold. If the SDK emits no events for this
 * long, the runner pushes a `stream_stalled` heartbeat so the UI can show
 * "still working…" instead of looking frozen. Picked slightly under the
 * default tool timeout so a single slow tool surfaces a heartbeat before the
 * SDK itself reports a failure.
 */
export const DEFAULT_STREAM_STALL_WARNING_MS = 15_000;

/**
 * Runner-side watchdog hard threshold for the model-thinking phase. When no
 * tool is in flight and the SDK emits no events for this long, the runner
 * force-cancels the session and surfaces a clear error. Defense-in-depth for
 * cases where the SDK's own timeouts don't fire (native deadlock, DNS-blocking
 * syscalls, etc).
 *
 * Kept at 90s because a wedged model stream is usually catastrophic — fail
 * fast and let the caller retry. Long tool runs use
 * {@link DEFAULT_STREAM_STALL_ACTIVE_TOOL_HARD_MS} instead.
 */
export const DEFAULT_STREAM_STALL_HARD_MS = 90_000;

/**
 * Runner-side watchdog hard threshold while the model is still streaming tool
 * input JSON. This is model output, not tool execution, so it should fail fast
 * like Claude Code's stream idle watchdog instead of inheriting the long
 * active-tool window.
 */
export const DEFAULT_TOOL_INPUT_STREAM_STALL_HARD_MS = 90_000;

/**
 * Runner-side watchdog hard threshold while a tool is actively executing.
 * Five minutes is generous for legitimate long tool runs (slow `web_search`
 * retries, large `Bash` builds, multi-MB git clones) that emit no
 * intermediate SDK events. The per-tool `toolTimeoutMs` is the authoritative
 * killer; this threshold only fires when the SDK itself drops the tool's
 * completion event.
 */
export const DEFAULT_STREAM_STALL_ACTIVE_TOOL_HARD_MS = 300_000;

/**
 * Same-tool circuit breaker threshold: cancel the run after this many
 * consecutive failures of the same tool inside one user message. Prevents
 * `maxToolRounds` from being silently drained by a broken tool while the
 * user stares at a frozen UI.
 */
export const DEFAULT_MAX_CONSECUTIVE_TOOL_ERRORS = 3;

/**
 * Auto-retry budget for blank model-stream failures: either the watchdog fires
 * before the first token, or the SDK stream completes normally with no visible
 * assistant content or tool events. One retry covers the common case (provider
 * hiccup, cold-start latency, empty streamed response) without burning
 * unbounded token cost or letting a genuinely dead provider keep retrying.
 * Tool-active and partial-output stalls bypass this retry entirely — the
 * runner only retries when the user would see exactly the same UI state on
 * both attempts (a blank turn).
 */
export const DEFAULT_MAX_STREAM_RETRIES = 1;

/**
 * Idle threshold for the runtime sweeper. A runtime with no `active()` /
 * `getActiveOrCreate()` access for this long is considered abandoned and
 * closed. 30 minutes is comfortably longer than a normal user pause between
 * messages but short enough to keep the leaked-agent surface bounded — the
 * SDK 3.2.x `Agent` has no `close()`, so each leaked session keeps its
 * native tokio task graph alive until the process restarts.
 */
export const DEFAULT_RUNTIME_IDLE_TIMEOUT_MS = 30 * 60 * 1000;

/**
 * How often the sweeper scans the active-runtime map. Long enough that the
 * sweep itself is negligible CPU; short enough that the worst-case delay
 * between idleness and reclamation is ≤ idleTimeout + sweepInterval.
 */
export const DEFAULT_RUNTIME_SWEEP_INTERVAL_MS = 5 * 60 * 1000;

export interface RuntimeMcpInitError {
    name: string;
    error: string;
}

export type AssistantContentBlock =
    | { type: 'text'; text: string }
    | {
          type: 'tool_use';
          id: string;
          name: string;
          input: Record<string, unknown>;
      }
    | {
          type: 'tool_result';
          toolUseId: string;
          content: string;
          isError?: boolean;
          before?: string;
          after?: string;
          filePath?: string;
      };

export interface RuntimeSkillInfo {
    name: string;
    description?: string;
    kind?: string;
}
