/**
 * Capability protocols + agent binding.
 *
 * Ported from `serial_agent_chain/scheduler.py`. The scheduler picks a
 * `CapabilityProtocol` from the task view (e.g. bid review, policy compliance,
 * financial risk) and assigns concrete agents from the registry to each step.
 */
import { OUTPUT_RULES, SLUG_RULES, matchAny } from './rules';
import { BUILTIN_REGISTRY, toolIds } from './registry';
import type { AgentAssignment, AgentRegistryView, TaskView } from './schemas';

export interface CapabilityStep {
    capability: string;
    responsibility: string;
    optional?: boolean;
    preferredAgents?: readonly string[];
}

export interface CapabilityProtocol {
    protocolId: string;
    keywords: readonly string[];
    steps: readonly CapabilityStep[];
    priority: number;
}

export interface AgentBindingTrace {
    protocolId: string;
    requiredCapabilities: string[];
    selectedAgents: string[];
    missingCapabilities: string[];
    coverageScore: number;
}

export const PROTOCOLS: readonly CapabilityProtocol[] = [
    {
        protocolId: 'bid_review_opinion',
        keywords: ['投标', '审查意见书', 'bid_review', 'bid_review_opinion'],
        priority: 100,
        steps: [
            { capability: 'document_parse', responsibility: '解析分块并归类待审材料', preferredAgents: ['project_material_parser'] },
            { capability: 'review_planning', responsibility: '拆解审查维度和循环任务', preferredAgents: ['review_scheduler'] },
            { capability: 'policy_search', responsibility: '召回适用政策、监管办法和采购规则', preferredAgents: ['policy_retriever'] },
            { capability: 'rule_matching', responsibility: '匹配条款并判断响应性', preferredAgents: ['rule_matcher'] },
            { capability: 'state_management', responsibility: '维护问题清单和风险等级', preferredAgents: ['review_state_manager'] },
            { capability: 'evidence_synthesis', responsibility: '组装审查事实、风险和建议', preferredAgents: ['report_assembler'] },
            { capability: 'quality_gate', responsibility: '检查意见书完整性和可追溯性', preferredAgents: ['opinion_completeness_checker'] },
            { capability: 'file_generation', responsibility: '生成最终 docx/png 文件清单', preferredAgents: ['final_file_generator'] },
        ],
    },
    {
        protocolId: 'policy_compliance',
        keywords: ['政策', '合规', '投资目录', '扶持', 'policy_compliance', 'subsidy_policy', 'subsidy_application'],
        priority: 80,
        steps: [
            { capability: 'policy_search', responsibility: '检索政策、投资目录和申报指南', preferredAgents: ['policy_retriever'] },
            { capability: 'policy_compliance', responsibility: '核查任务要求与政策条款的符合性', preferredAgents: ['compliance_checker'] },
            { capability: 'report_generation', responsibility: '生成政策或合规相关报告', preferredAgents: ['report_writer'] },
        ],
    },
    {
        protocolId: 'financial_risk',
        keywords: ['资金', '财务', '偿债', 'ERP', '杠杆', 'risk_rating', 'financial_health', 'debt_risk', 'erp_financial'],
        priority: 75,
        steps: [
            { capability: 'erp_read', responsibility: '读取授权 ERP 或财务数据', preferredAgents: ['erp_data_connector'] },
            { capability: 'financial_analysis', responsibility: '分析资金链健康度和偿债风险', preferredAgents: ['financial_risk_analyst'] },
            { capability: 'risk_report_generation', responsibility: '生成风险评级或财务健康报告', preferredAgents: ['risk_reporter'] },
        ],
    },
    {
        protocolId: 'technology_review',
        keywords: ['技术', '专利', '标准', '设备', 'technology_advancement', 'technology_solution', 'patent_frontier', 'standard_compliance'],
        priority: 70,
        steps: [
            { capability: 'patent_search', responsibility: '检索专利和公开技术资料', preferredAgents: ['patent_retriever'] },
            { capability: 'technical_standard_check', responsibility: '对比行业技术标准和安全规范', preferredAgents: ['standard_comparator'] },
            { capability: 'technology_review', responsibility: '生成技术先进性或可行性评估', preferredAgents: ['technical_reviewer'] },
        ],
    },
    {
        protocolId: 'supplier_qualification',
        keywords: ['供应商', '资质', 'supplier_admission', 'qualification_check'],
        priority: 65,
        steps: [
            { capability: 'qualification_check', responsibility: '核验供应商资质和准入条件', preferredAgents: ['qualification_checker'] },
            { capability: 'supplier_risk', responsibility: '识别经营异常和外部合规风险', preferredAgents: ['supplier_risk_checker'] },
            { capability: 'report_generation', responsibility: '生成供应商审查报告', preferredAgents: ['report_writer'] },
        ],
    },
    {
        protocolId: 'contract_performance',
        keywords: ['履约', '合同', 'performance_review', 'contract_history'],
        priority: 60,
        steps: [
            { capability: 'contract_performance_analysis', responsibility: '分析历史合同履约表现', preferredAgents: ['performance_analyst'] },
            { capability: 'report_generation', responsibility: '生成履约评估报告', preferredAgents: ['report_writer'] },
        ],
    },
    {
        protocolId: 'material_gap',
        keywords: ['材料', '缺口', 'material_gap'],
        priority: 55,
        steps: [
            { capability: 'material_gap_check', responsibility: '核查材料缺口和补充建议', preferredAgents: ['material_gap_checker'] },
            { capability: 'report_generation', responsibility: '生成材料核查结论', preferredAgents: ['report_writer'] },
        ],
    },
    {
        protocolId: 'generic_report',
        keywords: ['报告', '总结', '建议', 'final_report'],
        priority: 1,
        steps: [
            { capability: 'requirement_parse', responsibility: '解析任务目标和约束', preferredAgents: ['intent_parser'] },
            { capability: 'report_generation', responsibility: '整理输出报告', preferredAgents: ['report_writer'] },
        ],
    },
];

function outputSignal(view: TaskView): string {
    const text = `${view.title} ${view.requirement}`;
    for (const rule of OUTPUT_RULES) {
        if (matchAny(text, rule.keywords)) return rule.value;
    }
    for (const rule of SLUG_RULES) {
        if (matchAny(view.title, rule.keywords)) return `${rule.value}_report`;
    }
    return '';
}

export function inferCapabilityProtocol(view: TaskView): CapabilityProtocol {
    const fields: { text: string; weight: number }[] = [
        { text: outputSignal(view), weight: 8 },
        { text: view.requirement, weight: 4 },
        { text: view.title, weight: 3 },
        { text: view.description, weight: 1 },
    ];
    let best: { score: number; priority: number; protocol: CapabilityProtocol } | null = null;
    for (const protocol of PROTOCOLS) {
        let score = 0;
        for (const field of fields) {
            if (matchAny(field.text, protocol.keywords)) score += field.weight;
        }
        if (!score) continue;
        if (
            best === null ||
            score > best.score ||
            (score === best.score && protocol.priority > best.priority)
        ) {
            best = { score, priority: protocol.priority, protocol };
        }
    }
    return best?.protocol ?? PROTOCOLS[PROTOCOLS.length - 1]!;
}

interface AgentCandidate {
    agentId: string;
    score: number;
}

function bestAgentForStep(
    step: CapabilityStep,
    registry: AgentRegistryView,
    used: ReadonlySet<string>,
): AgentCandidate | null {
    let best: AgentCandidate | null = null;
    for (const card of registry.list()) {
        if (used.has(card.agent_id)) continue;
        const capabilities = new Set(card.capabilities);
        const tools = new Set(toolIds(card));
        if (!capabilities.has(step.capability) && !tools.has(step.capability)) continue;
        let score = 10;
        if (capabilities.has(step.capability)) score += 8;
        if (tools.has(step.capability)) score += 5;
        score += Math.min(capabilities.size, 6);
        if (card.endpoint) score += 1;
        if (step.preferredAgents?.includes(card.agent_id)) score += 20;
        if (best === null || score > best.score) best = { agentId: card.agent_id, score };
    }
    return best;
}

function bestFallbackAgent(registry: AgentRegistryView, used: ReadonlySet<string>): string | null {
    for (const preferred of ['report_writer', 'intent_parser']) {
        const card = registry.get(preferred);
        if (card && !used.has(preferred)) return preferred;
    }
    for (const card of registry.list()) {
        if (!used.has(card.agent_id)) return card.agent_id;
    }
    return null;
}

export interface BindAgentsOptions {
    registry?: AgentRegistryView;
    maxAgents?: number;
}

export function bindAgents(
    view: TaskView,
    options: BindAgentsOptions = {},
): { trace: AgentBindingTrace; assignments: AgentAssignment[] } {
    const registry = options.registry ?? BUILTIN_REGISTRY;
    const maxAgents = options.maxAgents ?? 8;
    const protocol = inferCapabilityProtocol(view);

    const selected: { agentId: string; responsibility: string }[] = [];
    const missing: string[] = [];
    const used = new Set<string>();

    for (const step of protocol.steps) {
        const candidate = bestAgentForStep(step, registry, used);
        if (!candidate) {
            missing.push(step.capability);
            if (!step.optional) {
                const fallback = bestFallbackAgent(registry, used);
                if (fallback) {
                    selected.push({
                        agentId: fallback,
                        responsibility: `${step.responsibility}（能力缺口：${step.capability}）`,
                    });
                    used.add(fallback);
                }
            }
            continue;
        }
        selected.push({ agentId: candidate.agentId, responsibility: step.responsibility });
        used.add(candidate.agentId);
        if (selected.length >= maxAgents) break;
    }

    const required = protocol.steps.filter((step) => !step.optional).map((step) => step.capability);
    const covered = required.length - missing.filter((cap) => required.includes(cap)).length;
    const coverageScore = required.length === 0 ? 1.0 : covered / required.length;

    const assignments: AgentAssignment[] = selected.map((entry, index) => ({
        order: index + 1,
        agent: entry.agentId,
        responsibility: entry.responsibility,
    }));

    return {
        trace: {
            protocolId: protocol.protocolId,
            requiredCapabilities: required,
            selectedAgents: selected.map((entry) => entry.agentId),
            missingCapabilities: missing,
            coverageScore,
        },
        assignments,
    };
}

export function scheduleAgents(view: TaskView, options: BindAgentsOptions = {}): AgentAssignment[] {
    return bindAgents(view, options).assignments;
}
