/**
 * Built-in agent registry used by the planner when no external registry is
 * provided. Mirrors the default cards in `serial_agent_chain/registry.py`.
 *
 * In production, a `RegistryAdapter` should resolve agents from the OS
 * super-factory (published agents); this fallback ensures the planner can
 * still produce a verified chain if no real agents are discovered.
 */
import type { AgentCard, AgentRegistryView } from './schemas';

function makeCard(
    agent_id: string,
    display_name: string,
    capabilities: string[],
    toolIds: string[],
): AgentCard {
    return {
        agent_id,
        display_name,
        capabilities,
        tools: toolIds.map((tool_id) => ({ tool_id })),
        constraints: [],
        endpoint: { type: 'http', url: `https://agent-factory.example.com/agents/${agent_id}/invoke` },
    };
}

export const BUILTIN_AGENT_CARDS: readonly AgentCard[] = [
    makeCard('intent_parser', '意图解析智能体', ['intent_extract', 'requirement_parse'], []),
    makeCard('policy_retriever', '政策检索智能体', ['policy_search', 'document_retrieval'], ['policy_catalog']),
    makeCard('compliance_checker', '合规审查智能体', ['policy_compliance', 'risk_check'], []),
    makeCard('report_writer', '报告生成智能体', ['report_generation'], []),
    makeCard('erp_data_connector', 'ERP 数据连接智能体', ['erp_read', 'data_extract'], ['erp_read']),
    makeCard('financial_risk_analyst', '资金风险分析智能体', ['financial_analysis', 'risk_rating'], []),
    makeCard('risk_reporter', '风险报告智能体', ['risk_report_generation', 'report_generation'], []),
    makeCard('patent_retriever', '专利检索智能体', ['patent_search', 'document_retrieval'], ['patent_search']),
    makeCard(
        'standard_comparator',
        '标准对比智能体',
        ['standard_compare', 'technical_standard_check'],
        ['standard_search'],
    ),
    makeCard('technical_reviewer', '技术评估智能体', ['technology_review', 'report_generation'], []),
    makeCard(
        'supplier_risk_checker',
        '供应商风险智能体',
        ['supplier_risk', 'public_risk_search'],
        ['public_risk_data'],
    ),
    makeCard('qualification_checker', '资质核验智能体', ['qualification_check'], []),
    makeCard('performance_analyst', '履约评估智能体', ['contract_performance_analysis'], []),
    makeCard('material_gap_checker', '材料缺口核查智能体', ['material_gap_check'], []),
    makeCard(
        'project_material_parser',
        '材料解析智能体',
        ['document_parse', 'material_gap_check'],
        ['document_parse'],
    ),
    makeCard('review_scheduler', '审查调度智能体', ['review_planning'], []),
    makeCard('rule_matcher', '条款匹配智能体', ['rule_matching', 'policy_compliance'], []),
    makeCard('review_state_manager', '审查状态智能体', ['state_management'], []),
    makeCard('report_assembler', '审查报告组装智能体', ['evidence_synthesis', 'bid_review'], []),
    makeCard('opinion_completeness_checker', '意见书完整性核查智能体', ['quality_gate', 'bid_review'], []),
    makeCard('final_file_generator', '最终交付物生成智能体', ['file_generation'], []),
];

export class InMemoryAgentRegistry implements AgentRegistryView {
    private readonly map: Map<string, AgentCard>;

    constructor(cards: readonly AgentCard[] = BUILTIN_AGENT_CARDS) {
        this.map = new Map(cards.map((card) => [card.agent_id, card]));
    }

    get(agentId: string): AgentCard | undefined {
        return this.map.get(agentId);
    }

    list(): AgentCard[] {
        return [...this.map.values()];
    }

    register(card: AgentCard): void {
        this.map.set(card.agent_id, card);
    }
}

export const BUILTIN_REGISTRY: AgentRegistryView = new InMemoryAgentRegistry();

export function toolIds(card: AgentCard): string[] {
    return card.tools.map((tool) => tool.tool_id);
}
