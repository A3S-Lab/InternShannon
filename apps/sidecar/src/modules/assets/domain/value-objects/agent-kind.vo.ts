/**
 * Agent Kind - 智能体子类型
 *
 * 仅对 category === 'agent' 的资产有意义：
 * - tool        专用型智能体，可被工作流编排作为节点调用
 * - application 应用型智能体，只能独立部署运行
 * - agentic        基于 a3s-code 或其它框架开发的自主交互智能体；
 *               可被工作流编排，但要求资产产出结构化输出
 */
export type AgentKind = 'tool' | 'application' | 'agentic';

export const AgentKind = {
    TOOL: 'tool' as AgentKind,
    APPLICATION: 'application' as AgentKind,
    AGENTIC: 'agentic' as AgentKind,
};

export const AGENT_KIND_VALUES: readonly AgentKind[] = ['tool', 'application', 'agentic'];

export const AGENT_KIND_LABELS: Record<AgentKind, string> = {
    tool: '专用型',
    application: '应用型',
    agentic: '自主型',
};

/** 默认值：保持与历史"独立部署"行为一致 */
export const DEFAULT_AGENT_KIND: AgentKind = 'application';

/** 可被工作流编排作为节点调用的 agent kinds（tool 默认可调用；agentic 要求结构化输出） */
export const ORCHESTRABLE_AGENT_KINDS: readonly AgentKind[] = ['tool', 'agentic'];

export function isAgentKind(value: unknown): value is AgentKind {
    return value === 'tool' || value === 'application' || value === 'agentic';
}

export function isOrchestrableAgentKind(value: unknown): value is AgentKind {
    return value === 'tool' || value === 'agentic';
}

export function normalizeAgentKind(value: unknown): AgentKind | undefined {
    if (value === null || value === undefined || value === '') return undefined;
    if (isAgentKind(value)) return value;
    if (typeof value === 'string') {
        const lower = value.trim().toLowerCase();
        if (isAgentKind(lower)) return lower;
    }
    return undefined;
}
