import type { SessionRuntimeOverrides } from './session-runtime.contract';

export const KERNEL_RUNTIME_CONFIG_SERVICE = Symbol('KERNEL_RUNTIME_CONFIG_SERVICE');

/**
 * 默认智能助手(默认内核助手, agentId='default')全局配置投影为运行时覆盖项的子集。
 *
 * 仅包含会话工厂会用到的运行时字段;只携带「确有意义设置」的字段——空字符串 /
 * 空数组 / 未设置一律被实现层省略,这样在 mergeRuntimeOverrides 里就不会覆盖
 * 前端 metadata / 内置默认(契约:全局空值=回退既有行为)。
 *
 * 仅投影运行时字段;name/avatar/description 等展示字段不在此集合内,不会进入运行时。
 *
 * 复用 domain 层的 {@link SessionRuntimeOverrides} 子集而非另立类型,保证字段
 * 语义与会话工厂消费端完全一致。
 */
export type KernelAssistantRuntimeDefaults = Pick<
    SessionRuntimeOverrides,
    | 'systemPrompt'
    | 'model'
    | 'temperature'
    | 'thinkingBudget'
    | 'maxToolRounds'
    | 'continuationEnabled'
    | 'maxContinuationTurns'
    | 'planningMode'
    | 'goalTracking'
    | 'builtinSkills'
    | 'enforceActiveSkillToolRestrictions'
    | 'maxParseRetries'
    | 'circuitBreakerThreshold'
    | 'autoCompact'
    | 'autoCompactThreshold'
    | 'toolTimeoutMs'
    | 'queueTimeoutMs'
    | 'maxExecutionTimeMs'
    | 'streamStallWarningMs'
    | 'streamStallHardMs'
    | 'streamStallActiveToolHardMs'
    | 'maxConsecutiveToolErrors'
    | 'maxStreamRetries'
    | 'autoDelegation'
    | 'autoParallel'
    | 'maxParallelTasks'
    | 'artifactStoreLimits'
    | 'retentionLimits'
    | 'skills'
    | 'mcpServers'
>;

export interface KernelRuntimeModelConfig {
    id: string;
    name: string;
    family: string;
    apiKey?: string | null;
    baseUrl?: string | null;
    headers?: Record<string, string> | null;
    sessionIdHeader?: string | null;
    attachment?: boolean | null;
    reasoning?: boolean | null;
    toolCall?: boolean | null;
    temperature?: boolean | null;
    /** Token limits. output > 0 → a3s-code uses it as the LLM max_tokens cap. Required for
     *  reasoning models (glm5.1): without it the openai client sends no max_tokens and reasoning
     *  exhausts the server default before any generate_object/tool call. */
    limit?: { context?: number | null; output?: number | null } | null;
}

export interface KernelRuntimeModelProvider {
    name: string;
    apiKey?: string | null;
    baseUrl?: string | null;
    headers?: Record<string, string> | null;
    sessionIdHeader?: string | null;
    models?: KernelRuntimeModelConfig[];
}

export interface KernelRuntimeModelsConfig {
    defaultModel?: string | null;
    providers?: KernelRuntimeModelProvider[];
    mcpServers?: unknown[];
    maxToolRounds?: number | null;
    thinkingBudget?: number | null;
    /** Per-tool execution timeout in milliseconds. Falls back to kernel default. */
    toolTimeoutMs?: number | null;
    /** Lane queue dispatch timeout in milliseconds. Falls back to kernel default. */
    queueTimeoutMs?: number | null;
    /** Overall ceiling for a single message-run in milliseconds. */
    maxExecutionTimeMs?: number | null;
    /** Stall watchdog soft threshold (ms) — emit heartbeat after this long. */
    streamStallWarningMs?: number | null;
    /** Stall watchdog hard threshold (ms) for idle/model-stream silence — force-cancel after this long. */
    streamStallHardMs?: number | null;
    /** Stall watchdog hard threshold (ms) while a tool is mid-execution — defaults to a longer window so legitimate long tools aren't preempted. */
    streamStallActiveToolHardMs?: number | null;
    /** Same-tool circuit breaker: cancel after this many consecutive failures. */
    maxConsecutiveToolErrors?: number | null;
    /** Auto-retry budget for the "model thinking" stall; 0 disables retry. */
    maxStreamRetries?: number | null;
    search?: KernelRuntimeSearchConfig | null;
    clawSentry?: KernelRuntimeClawSentryConfig | null;
}

export interface KernelRuntimeSearchConfig {
    enabledEngines?: string[];
    language?: string | null;
    safesearch?: 'off' | 'moderate' | 'strict';
    timeout?: number | null;
    limit?: number | null;
}

export interface KernelRuntimeClawSentryConfig {
    enabled?: boolean;
    mode?: 'managed-gateway' | 'external-gateway' | string;
    failClosed?: boolean;
    permissionPolicy?: 'allow' | 'default' | string;
    ignoreSkillToolRestrictions?: boolean;
    gatewayUrl?: string;
    token?: string;
}

export interface IKernelRuntimeConfigService {
    getModelsConfig(): Promise<KernelRuntimeModelsConfig | null>;
    /**
     * 默认智能助手(默认内核助手)全局配置投影。`null` = 无全局配置(等价于全部回退)。
     * 仅对 agentId==='default' 的会话生效;由会话工厂以最高优先级合并。
     */
    getAssistantDefaults?(): Promise<KernelAssistantRuntimeDefaults | null>;
}
