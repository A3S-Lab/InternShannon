import type { AgentSpec } from '../../domain/services/agent-spec.interface';

export interface AgentSummary {
    id: string;
    name: string;
    description: string;
}

const AGENT_DISPLAY_META: Record<string, { name: string; description: string }> = {
    default: { name: '书小安', description: '认知驱动的智能助手，帮助对话、整理信息、管理文件和使用知识库' },
    asset: { name: '知识库管理智能体', description: '帮助创建、整理和维护智能体与知识库资产' },
};

export function listAgentSummaries(specs: AgentSpec[], keyword?: string, rawLimit?: string): AgentSummary[] {
    const search = keyword?.trim().toLowerCase();
    const limit = parseAgentSearchLimit(rawLimit);

    return specs
        .map(spec => ({
            id: spec.id,
            name: AGENT_DISPLAY_META[spec.id]?.name ?? spec.id,
            description: AGENT_DISPLAY_META[spec.id]?.description ?? '',
        }))
        .filter(agent => {
            if (!search) return true;
            return [agent.id, agent.name, agent.description].join(' ').toLowerCase().includes(search);
        })
        .slice(0, limit);
}

function parseAgentSearchLimit(rawLimit?: string): number {
    const limit = Number(rawLimit);
    if (!Number.isFinite(limit)) return 20;
    return Math.min(Math.max(Math.floor(limit), 1), 100);
}
