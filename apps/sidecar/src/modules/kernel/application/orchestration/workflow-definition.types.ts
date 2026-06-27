import { PageQueryOptions } from '@/shared/application/pagination.dto';

export type WorkflowDefinitionStatus = 'draft' | 'published' | 'archived';
export type WorkflowDefinitionVisibility = 'private' | 'public';
export type WorkflowNodeType =
    // Engine/Designer general types (aligned with packages/workflow and workflow-designer)
    | 'start'
    | 'end'
    | 'llm'
    | 'http'
    | 'code'
    | 'condition'
    | 'loop'
    | 'break'
    | 'continue'
    | 'aggregator'
    | 'template'
    | 'answer'
    | 'comment'
    | 'group'
    | 'block-start'
    | 'block-end'
    // Runtime waiting/control gates handled by RuntimeWorkflowExecutionService
    | 'approval'
    | 'risk_gate'
    // Custom/Package node types (designer CustomNodeKind).
    // 'workflow' / 'package-workflow' intentionally excluded: a workflow asset
    // is the workflow itself (top-level), never a sub-workflow DAG node.
    | 'agent'
    | 'tool'
    | 'mcp'
    | 'package-agent'
    | 'package-tool'
    | 'package-mcp';
export type WorkflowNodeAssignmentTargetKind = 'builtin' | 'asset' | 'package' | 'external';
export type WorkflowNodeAssignmentPolicy = 'manual' | 'recommended' | 'auto' | 'locked';

export interface WorkflowNodeAssignmentDefinition {
    targetKind?: WorkflowNodeAssignmentTargetKind;
    targetId?: string;
    targetVersion?: string;
    assigneeIds?: string[];
    selectionPolicy?: WorkflowNodeAssignmentPolicy;
    locked?: boolean;
    requiredCapabilities?: string[];
    fallbackNodeIds?: string[];
    constraints?: Record<string, unknown>;
}

export interface WorkflowNodeDefinition {
    id: string;
    type: WorkflowNodeType | string;
    name: string;
    description?: string;
    dependsOn?: string[];
    packageId?: string;
    packageVersion?: string;
    assignment?: WorkflowNodeAssignmentDefinition;
    executionOrder?: number;
    parallelGroup?: string;
    locked?: boolean;
    input?: Record<string, unknown>;
    inputMappings?: Record<string, unknown>;
    config?: Record<string, unknown>;
    configMappings?: Record<string, unknown>;
    outputMappings?: Record<string, unknown>;
    data?: Record<string, unknown>;
    position?: { x: number; y: number };
    blocks?: WorkflowNestedNodeDefinition[];
    edges?: WorkflowNestedEdgeDefinition[];
}

export type WorkflowNestedNodeDefinition = Omit<WorkflowNodeDefinition, 'id'> & { id?: string };
export type WorkflowNestedEdgeDefinition = Omit<WorkflowEdgeDefinition, 'id'> & { id?: string };

export interface WorkflowEdgeDefinition {
    id: string;
    sourceNodeId: string;
    targetNodeId: string;
    sourcePortId?: string;
    targetPortId?: string;
    condition?: string;
    data?: Record<string, unknown>;
    metadata?: Record<string, unknown>;
}

export interface WorkflowDefinitionSpec {
    nodes: WorkflowNodeDefinition[];
    edges: WorkflowEdgeDefinition[];
    variables?: Array<{
        name: string;
        type?: string;
        required?: boolean;
        defaultValue?: unknown;
        expression?: string;
        description?: string;
    }>;
    outputs?: Array<{
        name: string;
        expression?: string;
        description?: string;
    }>;
}

export type WorkflowDefinitionDraftNode = Omit<WorkflowNodeDefinition, 'id'> & { id?: string };
export type WorkflowDefinitionDraftEdge = Omit<WorkflowEdgeDefinition, 'id'> & { id?: string };

export interface WorkflowDefinitionDraftSpec {
    nodes?: WorkflowDefinitionDraftNode[];
    edges?: WorkflowDefinitionDraftEdge[];
    variables?: WorkflowDefinitionSpec['variables'];
    outputs?: WorkflowDefinitionSpec['outputs'];
}

export interface WorkflowDefinitionViewModel {
    id: string;
    ownerId: string;
    ownerType: 'user' | 'organization';
    name: string;
    description?: string;
    visibility: WorkflowDefinitionVisibility;
    status: WorkflowDefinitionStatus;
    latestVersion?: number;
    draftDefinition: WorkflowDefinitionSpec;
    metadata: Record<string, unknown>;
    createdAt: Date;
    updatedAt: Date;
}

export interface WorkflowDefinitionVersionViewModel {
    id: string;
    workflowDefinitionId: string;
    version: number;
    definition: WorkflowDefinitionSpec;
    changelog?: string;
    createdBy: string;
    createdAt: Date;
}

export type WorkflowDefinitionDiagnosticSeverity = 'error' | 'warning' | 'info';

export interface WorkflowDefinitionDiagnostic {
    severity: WorkflowDefinitionDiagnosticSeverity;
    code: string;
    message: string;
    nodeId?: string;
    edgeId?: string;
    path?: string;
}

export interface WorkflowDefinitionExecutionStage {
    index: number;
    nodeIds: string[];
}

export interface WorkflowDefinitionExecutionPlan {
    orderedNodeIds: string[];
    stages: WorkflowDefinitionExecutionStage[];
    packageNodeIds: string[];
    approvalNodeIds: string[];
    riskGateNodeIds: string[];
}

export interface WorkflowDefinitionValidationSummary {
    nodeCount: number;
    edgeCount: number;
    packageNodeCount: number;
    approvalNodeCount: number;
    riskGateNodeCount: number;
    variableCount: number;
    outputCount: number;
    maxDepth: number;
}

export interface WorkflowDefinitionValidationResult {
    valid: boolean;
    diagnostics: WorkflowDefinitionDiagnostic[];
    summary: WorkflowDefinitionValidationSummary;
    executionPlan: WorkflowDefinitionExecutionPlan;
}

export interface WorkflowDefinitionGraphSourceViewModel {
    type: 'draft' | 'version';
    version?: number;
}

export interface WorkflowDefinitionGraphViewModel {
    workflowDefinitionId: string;
    source: WorkflowDefinitionGraphSourceViewModel;
    graph: WorkflowDefinitionSpec;
    validation: WorkflowDefinitionValidationResult;
    updatedAt: Date;
}

export interface PatchWorkflowDefinitionGraphInput {
    upsertNodes?: WorkflowDefinitionDraftNode[];
    removeNodeIds?: string[];
    upsertEdges?: WorkflowDefinitionDraftEdge[];
    removeEdgeIds?: string[];
    variables?: WorkflowDefinitionSpec['variables'];
    outputs?: WorkflowDefinitionSpec['outputs'];
    metadata?: Record<string, unknown>;
    pruneDanglingEdges?: boolean;
    validateOnly?: boolean;
}

export interface WorkflowDefinitionGraphQueryInput {
    version?: number;
}

export interface WorkflowDefinitionGraphDiffInput {
    baseVersion?: number;
    headVersion?: number;
}

export interface WorkflowDefinitionGraphDiffSummaryViewModel {
    addedNodes: number;
    removedNodes: number;
    updatedNodes: number;
    addedEdges: number;
    removedEdges: number;
    updatedEdges: number;
    variablesChanged: boolean;
    outputsChanged: boolean;
    changed: boolean;
}

export interface WorkflowDefinitionGraphDiffViewModel {
    workflowDefinitionId: string;
    base: WorkflowDefinitionGraphSourceViewModel;
    head: WorkflowDefinitionGraphSourceViewModel;
    summary: WorkflowDefinitionGraphDiffSummaryViewModel;
    addedNodeIds: string[];
    removedNodeIds: string[];
    updatedNodeIds: string[];
    addedEdgeIds: string[];
    removedEdgeIds: string[];
    updatedEdgeIds: string[];
    variablesChanged: boolean;
    outputsChanged: boolean;
}

export interface ValidateWorkflowDefinitionInput {
    definition: WorkflowDefinitionDraftSpec;
}

export interface ValidateStoredWorkflowDefinitionInput {
    version?: number;
}

export interface WorkflowDefinitionListOptions extends PageQueryOptions {
    ownerId?: string;
    visibility?: WorkflowDefinitionVisibility;
    status?: WorkflowDefinitionStatus;
}

export interface CreateWorkflowDefinitionInput {
    name: string;
    description?: string;
    visibility?: WorkflowDefinitionVisibility;
    draftDefinition?: WorkflowDefinitionDraftSpec;
    metadata?: Record<string, unknown>;
}

export interface UpdateWorkflowDefinitionInput {
    name?: string;
    description?: string;
    visibility?: WorkflowDefinitionVisibility;
    status?: WorkflowDefinitionStatus;
    draftDefinition?: WorkflowDefinitionDraftSpec;
    metadata?: Record<string, unknown>;
}

export interface ExecuteWorkflowDefinitionInput {
    version?: number;
    input?: Record<string, unknown>;
    metadata?: Record<string, unknown>;
    executionMode?: 'sync' | 'async';
    timeout?: number;
    retryPolicy?: {
        maxRetries: number;
        retryDelay?: number;
    };
    parentExecutionId?: string;
    /** Set by HTTP run entries to enforce the required-input contract; internal
     *  callers leave it off so out-of-band node inputs aren't falsely gated. */
    validateRequiredInput?: boolean;
}

export interface ExecuteWorkflowDefinitionBatchInput {
    version?: number;
    items: Record<string, unknown>[];
    inputTemplate?: Record<string, unknown>;
    itemKey?: string;
    batchId?: string;
    metadata?: Record<string, unknown>;
    timeout?: number;
    retryPolicy?: {
        maxRetries: number;
        retryDelay?: number;
    };
    parentExecutionId?: string;
}
