/**
 * 锁定智能体策略：编排（orchestration）、开发（asset）与运维（devops）智能体
 * 必须使用系统内核配置的默认模型，并强制启用 SDK planningMode；
 * 不允许通过开放平台接口指定模型或运行模式。
 *
 * 单一事实来源；REST 控制器与 WebSocket Gateway 均消费本模块。
 */

export enum LockedAgentId {
    ORCHESTRATION = 'orchestration',
    ASSET = 'asset',
    DEVOPS = 'devops',
}

const LOCKED_AGENT_IDS = new Set<string>([
    LockedAgentId.ORCHESTRATION,
    LockedAgentId.ASSET,
    LockedAgentId.DEVOPS,
]);

export interface LockedAgentPolicy {
    readonly model: undefined;
    readonly followDefaultModel: true;
    readonly permissionMode: 'auto';
    readonly planningMode: 'enabled';
    readonly goalTracking: true;
}

export const LOCKED_AGENT_POLICY: LockedAgentPolicy = Object.freeze({
    model: undefined,
    followDefaultModel: true,
    permissionMode: 'auto',
    planningMode: 'enabled',
    goalTracking: true,
});

export function isLockedAgent(agentId?: string | null): boolean {
    return !!agentId && LOCKED_AGENT_IDS.has(agentId);
}

/**
 * 把锁定策略叠加到 createSession 的元数据上。会移除 model 并强制规划模式。
 * 调用方应已用 assertLockedSessionPayload 校验过用户输入，本函数只负责覆盖。
 */
export function applyLockedAgentMetadata(metadata: Record<string, unknown>): Record<string, unknown> {
    return {
        ...metadata,
        model: undefined,
        followDefaultModel: true,
        permissionMode: LOCKED_AGENT_POLICY.permissionMode,
        planningMode: LOCKED_AGENT_POLICY.planningMode,
        goalTracking: LOCKED_AGENT_POLICY.goalTracking,
    };
}

/**
 * 校验 createSession 阶段用户传入的字段是否触碰锁定项。命中即返回错误描述（由调用方抛出）。
 */
export function describeLockedSessionViolation(payload: {
    model?: unknown;
    permissionMode?: unknown;
    planningMode?: unknown;
    goalTracking?: unknown;
    followDefaultModel?: unknown;
    systemPrompt?: unknown;
}): string | null {
    if (typeof payload.model === 'string' && payload.model.trim()) {
        return '编排、开发与运维智能体必须使用系统内核配置的默认模型，不允许指定 model';
    }
    if (typeof payload.systemPrompt === 'string' && payload.systemPrompt.trim()) {
        return '编排、开发与运维智能体的系统提示词由后端内置规格提供，不允许指定 systemPrompt';
    }
    if (
        typeof payload.permissionMode === 'string' &&
        payload.permissionMode.trim() &&
        payload.permissionMode.trim() !== LOCKED_AGENT_POLICY.permissionMode
    ) {
        return '编排、开发与运维智能体的执行权限由系统固定，不允许指定 permissionMode';
    }
    if (
        typeof payload.planningMode === 'string' &&
        payload.planningMode.trim() &&
        payload.planningMode.trim() !== LOCKED_AGENT_POLICY.planningMode
    ) {
        return '编排、开发与运维智能体强制启用规划模式，不允许指定 planningMode';
    }
    if (payload.goalTracking === false) {
        return '编排、开发与运维智能体强制启用任务追踪，不允许 goalTracking=false';
    }
    if (payload.followDefaultModel === false) {
        return '编排、开发与运维智能体必须跟随系统默认模型，不允许 followDefaultModel=false';
    }
    return null;
}

/**
 * Convenience: returns the session-creation violation iff the agent is locked.
 * Avoids the "if (isLockedAgent) { describeLockedSessionViolation; if (...) }"
 * dance at every input edge — controllers/gateways can do
 * `const violation = lockedSessionViolation(agentId, dto); if (violation) ...`.
 */
export function lockedSessionViolation(
    agentId: string | null | undefined,
    payload: Parameters<typeof describeLockedSessionViolation>[0],
): string | null {
    if (!isLockedAgent(agentId)) return null;
    return describeLockedSessionViolation(payload);
}

/** Same as lockedSessionViolation but for runMessage-time payloads. */
export function lockedRunViolation(
    agentId: string | null | undefined,
    payload?: object | null,
): string | null {
    if (!isLockedAgent(agentId)) return null;
    return describeLockedRunViolation(payload);
}

/**
 * runMessage 阶段允许 locked 智能体接收的字段白名单。
 * 任何不在这里的字段视为运行参数覆盖尝试并被拒绝（防御深度：
 * 未来新增 runtime 字段不会无感地通过此函数）。
 *
 * content / images 是用户消息内容，与运行时配置无关。
 */
const LOCKED_RUN_ALLOWED_KEYS = new Set<string>(['content', 'images']);

/**
 * 校验 runMessage 阶段是否传入了不允许覆盖的运行参数。
 * 白名单策略：除 `content` / `images` 外的任何已设字段都会触发违规。
 */
export function describeLockedRunViolation(payload?: object | null): string | null {
    if (!payload) return null;
    const record = payload as Record<string, unknown>;
    for (const key of Object.keys(record)) {
        if (LOCKED_RUN_ALLOWED_KEYS.has(key)) continue;
        const value = record[key];
        // Tolerate undefined / null / empty strings — they are equivalent to
        // "not set" and shouldn't fire a violation for callers that always
        // splat their DTO.
        if (value === undefined || value === null) continue;
        if (typeof value === 'string' && value.trim() === '') continue;
        if (Array.isArray(value) && value.length === 0) continue;
        if (typeof value === 'object' && Object.keys(value as Record<string, unknown>).length === 0) continue;
        return `编排、开发与运维智能体不允许在单条消息中覆盖运行参数：${key}`;
    }
    return null;
}
