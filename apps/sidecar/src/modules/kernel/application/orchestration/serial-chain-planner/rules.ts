/**
 * Built-in keyword rules used by the contract compiler and verifier.
 *
 * Ported from `serial_agent_chain/rules.py`. These are the algorithm's MVP
 * ontology. The rules are deliberately keyword-based and Chinese-leaning
 * because the original use case was bid-review / policy-compliance flows.
 *
 * For multi-industry deployments, swap in a custom RuleSet via
 * SerialChainPlannerService — see `rule-set.ts`.
 */

export interface KeywordRule {
    keywords: readonly string[];
    value: string;
}

export const SLUG_RULES: readonly KeywordRule[] = [
    { keywords: ['政策', '合规'], value: 'policy_compliance' },
    { keywords: ['资金'], value: 'risk_rating' },
    { keywords: ['财务'], value: 'financial_health' },
    { keywords: ['偿债'], value: 'debt_risk' },
    { keywords: ['技术'], value: 'technology_advancement' },
    { keywords: ['专利'], value: 'patent_analysis' },
    { keywords: ['标准'], value: 'standard_compliance' },
    { keywords: ['供应商'], value: 'supplier_review' },
    { keywords: ['资质'], value: 'qualification_review' },
    { keywords: ['履约'], value: 'performance_review' },
    { keywords: ['材料'], value: 'material_gap' },
    { keywords: ['投标', '审查', '意见书'], value: 'bid_review' },
    { keywords: ['申报'], value: 'application_feasibility' },
    { keywords: ['综合'], value: 'integrated_review' },
    { keywords: ['报告'], value: 'final_report' },
];

export const INPUT_RULES: readonly KeywordRule[] = [
    { keywords: ['项目', '客户经济'], value: 'project_profile' },
    { keywords: ['企业'], value: 'enterprise_profile' },
    { keywords: ['国家', '地方', '产业政策', '投资目录', '扶持政策', '申报指南'], value: 'policy_catalog' },
    { keywords: ['ERP', '财务', '资金', '偿债', '杠杆'], value: 'erp_financial_records' },
    { keywords: ['银行流水'], value: 'bank_transaction_records' },
    { keywords: ['专利'], value: 'patent_search_results' },
    { keywords: ['行业技术标准', '行业标准', '技术标准'], value: 'industry_technical_standards' },
    { keywords: ['数据安全', '联网安全', '安全规范'], value: 'security_standards' },
    { keywords: ['供应商', '营业执照', '行业资质', '授权文件'], value: 'supplier_profile' },
    { keywords: ['公开风险', '经营异常', '司法', '行政处罚'], value: 'public_risk_records' },
    { keywords: ['合同', '履约', '验收'], value: 'contract_history' },
    { keywords: ['历史申报材料', '申报材料'], value: 'historical_application_materials' },
];

export const OUTPUT_RULES: readonly KeywordRule[] = [
    { keywords: ['政策符合性报告'], value: 'policy_compliance_report' },
    { keywords: ['风险评级报告'], value: 'risk_rating_report' },
    { keywords: ['技术先进性评估报告'], value: 'technology_advancement_report' },
    { keywords: ['技术先进性与可行性评估报告'], value: 'technology_solution_review_report' },
    { keywords: ['综合审查报告'], value: 'integrated_due_diligence_report' },
    { keywords: ['供应商准入审查报告'], value: 'supplier_admission_review_report' },
    { keywords: ['财务健康报告'], value: 'financial_health_report' },
    { keywords: ['经营质量分析'], value: 'operation_quality_analysis' },
    { keywords: ['偿债风险评级'], value: 'debt_risk_rating' },
    { keywords: ['技术路线清单'], value: 'technology_route_inventory' },
    { keywords: ['专利与前沿性分析'], value: 'patent_frontier_analysis' },
    { keywords: ['标准符合性检查报告'], value: 'standard_compliance_report' },
    { keywords: ['标准与安全符合性检查报告'], value: 'standard_security_compliance_report' },
    { keywords: ['扶持政策清单'], value: 'subsidy_policy_matches' },
    { keywords: ['产业扶持资金申报可行性报告'], value: 'subsidy_application_feasibility_report' },
    { keywords: ['材料补充清单'], value: 'material_gap_list' },
    { keywords: ['投标审查意见书', '审查意见书'], value: 'bid_review_opinion' },
    { keywords: ['资质核验结论'], value: 'qualification_check_result' },
    { keywords: ['经营风险清单'], value: 'operation_risk_list' },
    { keywords: ['履约评估报告'], value: 'performance_review_report' },
    { keywords: ['准入建议'], value: 'admission_recommendation' },
];

export interface CriteriaRule {
    keywords: readonly string[];
    criteria: readonly string[];
}

export const CRITERIA_RULES: readonly CriteriaRule[] = [
    {
        keywords: ['政策', '合规', '申报', '扶持'],
        criteria: ['列出适用政策、目录或申报指南依据', '标记不确定条目和需人工复核事项'],
    },
    {
        keywords: ['资金', '财务', '偿债', 'ERP'],
        criteria: ['列出关键财务指标和计算口径', '识别资金链、偿债或杠杆风险因素'],
    },
    {
        keywords: ['技术', '专利', '标准'],
        criteria: ['列出专利、标准或行业规范对比依据', '区分技术先进性、成熟度和落地风险'],
    },
];

export interface ConstraintRule {
    keywords: readonly string[];
    constraints: readonly string[];
}

export const CONSTRAINT_RULES: readonly ConstraintRule[] = [
    {
        keywords: ['政策', '合规', '申报', '扶持'],
        constraints: ['不得伪造政策依据', '不得将模型判断表述为官方审批结论', '依据缺失时必须标记为待人工复核'],
    },
    { keywords: ['ERP', '银行流水', '财务'], constraints: ['只能使用授权数据库字段'] },
    { keywords: ['专利', '技术', '标准'], constraints: ['不得将专利数量直接等同于技术先进性'] },
];

export const UPSTREAM_AGGREGATION_KEYWORDS: readonly string[] = ['综合', '汇总', '整合', '定稿', '生成'];

export const CAPABILITY_ARTIFACT_RULES: readonly KeywordRule[] = [
    {
        keywords: ['policy_compliance', 'subsidy_policy', 'subsidy_application', 'policy_catalog'],
        value: 'policy_compliance',
    },
    { keywords: ['risk_rating', 'debt_risk'], value: 'risk_rating' },
    {
        keywords: ['financial_health', 'erp_financial', 'bank_transaction', 'financial_statement'],
        value: 'financial_analysis',
    },
    {
        keywords: [
            'technology_advancement',
            'technology_solution',
            'technical_standard',
            'patent_frontier',
            'standard_compliance',
        ],
        value: 'technology_review',
    },
    {
        keywords: ['supplier_admission', 'qualification_check', 'qualification_review'],
        value: 'qualification_check',
    },
    { keywords: ['performance_review', 'contract_history'], value: 'contract_performance_analysis' },
    { keywords: ['material_gap', 'missing_material'], value: 'material_gap_check' },
    { keywords: ['bid_review', 'bid_review_opinion'], value: 'bid_review' },
];

export const CAPABILITY_INPUT_RULES: readonly KeywordRule[] = [
    { keywords: ['policy_catalog'], value: 'policy_compliance' },
    {
        keywords: [
            'erp_financial_records',
            'bank_transaction_records',
            'financial_statements',
            'industry_financial_benchmark',
        ],
        value: 'financial_analysis',
    },
    {
        keywords: ['patent_search_results', 'industry_technical_standards'],
        value: 'technology_review',
    },
    { keywords: ['supplier_profile', 'qualification_documents'], value: 'qualification_check' },
    { keywords: ['contract_history'], value: 'contract_performance_analysis' },
];

export function matchAny(text: string, keywords: readonly string[]): boolean {
    return keywords.some((keyword) => text.includes(keyword));
}

export const DEFAULT_INITIAL_INPUTS: ReadonlySet<string> = new Set([
    'user_prompt',
    'project_profile',
    'enterprise_profile',
    'policy_catalog',
    'authorized_erp_connection',
    'erp_financial_records',
    'bank_transaction_records',
    'patent_search_results',
    'industry_technical_standards',
    'security_standards',
    'supplier_profile',
    'qualification_documents',
    'public_risk_records',
    'contract_history',
    'financial_statements',
    'industry_financial_benchmark',
    'equipment_inventory',
    'solution_design',
    'historical_application_materials',
]);
