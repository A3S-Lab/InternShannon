import type { AgentSpec } from '../../domain/services/agent-spec.interface';

export interface AgentSummary {
    id: string;
    name: string;
    description: string;
}

const AGENT_DISPLAY_META: Record<string, { name: string; description: string }> = {
    default: { name: '书小安', description: '认知驱动的智能助手，帮助整理信息、管理文件、分析内容和处理本地工作流' },
    orchestration: { name: '编排智能体', description: '工作流编排专家，擅长设计节点图、验证连接和优化工作流结构' },
    asset: { name: '开发智能体', description: '数字资产开发专家，擅长创建和配置智能体、MCP工具等各类数字资产' },
    devops: { name: '运维智能体', description: '诊断质检、代码优化、上架发布与运行维护专用智能体' },
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
