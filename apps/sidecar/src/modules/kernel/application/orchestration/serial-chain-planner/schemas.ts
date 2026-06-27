/**
 * Serial Agent Chain — core data model.
 *
 * Ported from `serial_agent_chain/schemas.py`. The model is internal to the
 * planner service; we use plain TypeScript types instead of zod to keep the
 * dependency surface minimal. External boundary validation (controllers, DTOs)
 * stays in the existing class-validator-based layer.
 */

export interface TaskView {
    task_id: string;
    title: string;
    description: string;
    requirement: string;
}

export interface AgentAssignment {
    order: number;
    agent: string;
    responsibility: string;
}

export interface TaskContract {
    task_id: string;
    inputs: string[];
    outputs: string[];
    success_criteria: string[];
    constraints: string[];
    agents: AgentAssignment[];
}

export interface TaskMetadata {
    version: number;
    view_hash: string;
    contract_hash: string;
    locked: boolean;
    created_by: string;
    last_modified_by: string;
}

export interface TaskRecord {
    task_id: string;
    view: TaskView;
    contract: TaskContract;
    metadata: TaskMetadata;
}

export const ChainStatus = {
    Draft: 'draft',
    Verified: 'verified',
    NeedsRepair: 'needs_repair',
    Failed: 'failed',
} as const;
export type ChainStatusValue = (typeof ChainStatus)[keyof typeof ChainStatus];

export interface HardError {
    type: string;
    task_id?: string | null;
    field?: string | null;
    message: string;
    missing: string[];
    allowed_repair: string[];
}

export function errorSignature(error: HardError): string {
    const missing = [...error.missing].sort().join(',');
    return `${error.type}:${error.task_id ?? ''}:${error.field ?? ''}:${missing}`;
}

export interface VerificationResult {
    pass: boolean;
    errors: HardError[];
}

export const RepairOperator = {
    RewriteTask: 'rewrite_task',
    InsertTask: 'insert_task',
    SplitTask: 'split_task',
    MergeTask: 'merge_task',
    RelabelOutput: 'relabel_output',
    ReplaceAgent: 'replace_agent',
    ReorderAgents: 'reorder_agents',
    TightenAccept: 'tighten_accept',
    AddInputSource: 'add_input_source',
} as const;
export type RepairOperatorValue = (typeof RepairOperator)[keyof typeof RepairOperator];

export interface RepairPatch {
    patch_id: string;
    hypothesis: string;
    operator: RepairOperatorValue;
    touched_tasks: string[];
    payload: Record<string, unknown>;
    patch_cost: number;
}

export interface RepairTraceItem {
    round: number;
    operator: string;
    touched_tasks: string[];
    errors_before: number;
    errors_after: number;
    accepted: boolean;
    hypothesis?: string | null;
    patch_cost: number;
}

export interface Chain {
    chain_id: string;
    version: number;
    status: ChainStatusValue;
    records: TaskRecord[];
    repair_trace: RepairTraceItem[];
    expected_final_outputs: string[];
    original_prompt: string;
    current_revision_id: string | null;
    revision_counter: number;
    conversation_summary: string;
}

export function chainTaskViews(chain: Chain): TaskView[] {
    return chain.records.map((record) => record.view);
}

export function chainContracts(chain: Chain): TaskContract[] {
    return chain.records.map((record) => record.contract);
}

export interface FileReference {
    name: string;
    uri: string;
}

export interface PlanInput {
    prompt: string;
    files?: FileReference[];
    chainId?: string;
    maxTasks?: number;
}

export type ConversationIntent =
    | 'shorten_chain'
    | 'lengthen_chain'
    | 'insert_task'
    | 'delete_task'
    | 'rewrite_task'
    | 'regenerate_chain'
    | 'clarify_chain';

export interface ChainChangeOperation {
    op: string;
    task_ids: string[];
    task_id?: string | null;
    target_task_count?: number | null;
    title?: string | null;
    description?: string | null;
    requirement?: string | null;
    position?: string | null;
    message?: string | null;
}

export interface ChainRevision {
    revision_id: string;
    parent_revision_id: string | null;
    chain_id: string;
    version: number;
    status: ChainStatusValue;
    intent: string;
    user_message: string;
    change_set: ChainChangeOperation[];
    tasks: TaskView[];
    created_at: string;
    summary: string;
}

export interface AgentCard {
    agent_id: string;
    display_name: string;
    capabilities: string[];
    tools: { tool_id: string }[];
    constraints: string[];
    endpoint?: { type: 'http'; url: string } | null;
}

export interface AgentRegistryView {
    get(agentId: string): AgentCard | undefined;
    list(): AgentCard[];
}
