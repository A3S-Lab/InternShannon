/**
 * Workflow Node Types - aligned with Flowgram.ai
 */
export enum WorkflowNodeType {
    // Control flow
    Start = 'start',
    End = 'end',
    Condition = 'condition',
    Loop = 'loop',
    Break = 'break',
    Continue = 'continue',

    // Execution
    LLM = 'llm',
    Code = 'code',
    HTTP = 'http',

    // LLM-backed (Dify parity)
    QuestionClassifier = 'question-classifier',
    ParameterExtractor = 'parameter-extractor',

    // Data flow
    Aggregator = 'aggregator',
    Template = 'template',
    Answer = 'answer',
    VariableAssigner = 'variable-assigner',
    ListOperator = 'list-operator',

    // Structure
    Comment = 'comment',
    Group = 'group',
    BlockStart = 'block-start',
    BlockEnd = 'block-end',
}

export const WORKFLOW_NODE_TYPE_LABELS: Record<WorkflowNodeType, string> = {
    [WorkflowNodeType.Start]: '开始',
    [WorkflowNodeType.End]: '结束',
    [WorkflowNodeType.Condition]: '条件分支',
    [WorkflowNodeType.Loop]: '循环',
    [WorkflowNodeType.Break]: '中断',
    [WorkflowNodeType.Continue]: '继续',
    [WorkflowNodeType.LLM]: 'LLM',
    [WorkflowNodeType.Code]: '代码',
    [WorkflowNodeType.HTTP]: 'HTTP',
    [WorkflowNodeType.QuestionClassifier]: '问题分类器',
    [WorkflowNodeType.ParameterExtractor]: '参数提取器',
    [WorkflowNodeType.Aggregator]: '变量聚合器',
    [WorkflowNodeType.Template]: '模板转换',
    [WorkflowNodeType.Answer]: '应答',
    [WorkflowNodeType.VariableAssigner]: '变量赋值',
    [WorkflowNodeType.ListOperator]: '列表操作',
    [WorkflowNodeType.Comment]: '注释',
    [WorkflowNodeType.Group]: '分组',
    [WorkflowNodeType.BlockStart]: '块开始',
    [WorkflowNodeType.BlockEnd]: '块结束',
};

/**
 * Loop context keys for break/continue
 * Returns per-loop-instance keys using loop node ID
 */
export function getLoopContextKeys(loopNodeId: string) {
    return {
        BREAK: `loop-break-${loopNodeId}`,
        CONTINUE: `loop-continue-${loopNodeId}`,
    };
}

/**
 * @deprecated Use getLoopContextKeys(loopNodeId) instead for nested loop support
 */
export const LOOP_CONTEXT_KEYS = {
    BREAK: 'loop-break',
    CONTINUE: 'loop-continue',
} as const;
