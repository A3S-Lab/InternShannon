import { WorkflowNodeType } from './workflow-node-type.vo';
// WorkflowNodeType is used as type marker for built-in nodes, but custom nodes use string type

/**
 * Workflow Graph - DAG structure for workflow
 */
export interface WorkflowGraph {
    nodes: WorkflowNode[];
    edges: WorkflowEdge[];
}

/**
 * Workflow Node
 */
export interface WorkflowNode {
    id: string;
    type: string;                    // Node type (built-in or from Material)
    name: string;
    data: WorkflowNodeData;
    /** Package coordinate that provides custom node type definitions. */
    packageId?: string;
    position?: { x: number; y: number };
    blocks?: WorkflowNode[];          // Nested nodes (for Loop/Condition)
    edges?: WorkflowEdge[];           // Nested edges
}

export const workflowNodeMaterialPackageId = (node: WorkflowNode): string | undefined => {
    return typeof node.packageId === 'string' && node.packageId.trim() ? node.packageId.trim() : undefined;
};

/**
 * Node Data - specific to each node type
 */

// Start node has no special data
export interface StartNodeData {
    /** Designer-facing workflow input schema. Runtime exposes it as start outputs. */
    inputSchema?: Record<string, JsonSchema>;
    /** @deprecated Use inputSchema for designer-facing workflow input schema. */
    outputs?: Record<string, JsonSchema>;
}

// End node
export interface EndNodeData {
    inputs?: Record<string, JsonSchema>;   // Workflow input schema
}

// Package node - executes a Package
export interface PackageNodeData {
    title?: string;
    packageId: string;
    packageVersion: string;
    inputsFromEdges?: boolean;
    timeout?: number;
    retryPolicy?: {
        maxRetries: number;
        retryDelay?: number;
    };
    inputs?: Record<string, JsonSchema>;
    outputs?: Record<string, JsonSchema>;
}

// Condition node
export interface ConditionNodeData {
    title?: string;
    conditions: ConditionItem[];
    defaultNodeId?: string;
}

// Simple condition (legacy expression-based)
export interface SimpleCondition {
    type?: 'simple';
    id: string;
    expression: string;
    targetNodeId: string;
}

// Structured condition value - aligned with Flowgram.ai
export interface StructuredConditionValue {
    left: {
        type: 'variable' | 'expression';
        value: string;
    };
    operator: string;
    right?: {
        type: 'static' | 'variable' | 'expression';
        value: unknown;
    };
}

// Structured condition - aligned with Flowgram.ai
export interface StructuredCondition {
    type: 'structured';
    id: string;
    key: string;
    value: StructuredConditionValue;
    targetNodeId: string;
}

// Condition group with AND/OR operator
export interface ConditionGroup {
    type: 'group';
    id: string;
    operator: 'AND' | 'OR';
    conditions: ConditionItem[];
    targetNodeId: string;
}

// Union type for condition items
export type ConditionItem = SimpleCondition | StructuredCondition | ConditionGroup;

// Loop node
export interface LoopNodeData {
    title?: string;
    loopVariable?: string;   // Variable name to store current item
    loopArray?: string;      // Reference to array variable
    maxIterations?: number;
}

// Code node
export interface CodeNodeData {
    title?: string;
    language: 'javascript' | 'python';
    code: string;
    inputs?: Record<string, JsonSchema>;
    outputs?: Record<string, JsonSchema>;
}

// LLM node
export interface LLMNodeData {
    title?: string;
    model?: string;
    /**
     * @deprecated Standalone / single-machine only. In trusted resolver mode the workflow
     * engine ignores this field and resolves credentials from the server
     * config service (etcd). Embedding credentials in user-editable workflow
     * JSON is a security violation in production.
     */
    apiKey?: string;
    /**
     * @deprecated Standalone / single-machine only. In trusted resolver mode the workflow
     * engine ignores this field and resolves the API host from the server
     * config service (etcd) for the chosen model.
     */
    apiHost?: string;
    temperature?: number;
    maxTokens?: number;
    systemPrompt?: string;
    prompt?: string;
    timeout?: number;
    retryTimes?: number;
    inputs?: Record<string, JsonSchema>;
    outputs?: Record<string, JsonSchema>;
    /**
     * Structured output mode (Dify parity). `text` (default) returns the raw string
     * as `result`. `json_object` / `json_schema` ask the model for JSON and the
     * executor parses it, exposing the parsed object as `result` (and the raw text
     * as `text`). `json_schema` additionally sends `jsonSchema` to constrain shape.
     */
    responseFormat?: 'text' | 'json_object' | 'json_schema';
    jsonSchema?: Record<string, unknown>;
}

// HTTP node
export interface HTTPNodeData {
    title?: string;
    method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
    url: string;
    headers?: Record<string, string>;
    params?: Record<string, string>;
    bodyType?: 'none' | 'json' | 'form-data' | 'raw-text' | 'binary' | 'x-www-form-urlencoded';
    body?: string;
    timeout?: number;
    retryTimes?: number;
    /**
     * Treat a non-2xx HTTP response as a node failure (default true). When false,
     * the node succeeds with the error body in `outputs.body` so downstream nodes
     * can branch on `statusCode` — set this only when a flow intentionally handles
     * 4xx/5xx itself.
     */
    failOnErrorStatus?: boolean;
    inputs?: Record<string, JsonSchema>;
    outputs?: Record<string, JsonSchema>;
}

// Variable aggregator node
export interface AggregatorNodeData {
    title?: string;
    inputsFromEdges?: boolean;
    inputs?: Record<string, JsonSchema>;
    outputs?: Record<string, JsonSchema>;
}

// Template transform node
export interface TemplateNodeData {
    title?: string;
    template?: string;
    inputs?: Record<string, JsonSchema>;
    outputs?: Record<string, JsonSchema>;
}

// Chat answer node
export interface AnswerNodeData {
    title?: string;
    answer?: string;
    inputs?: Record<string, JsonSchema>;
    outputs?: Record<string, JsonSchema>;
}

// Group node (just visual grouping)
export interface GroupNodeData {
    title?: string;
    collapsed?: boolean;
}

/**
 * Union type for all node data
 */
export type WorkflowNodeData =
    | StartNodeData
    | EndNodeData
    | PackageNodeData
    | ConditionNodeData
    | LoopNodeData
    | CodeNodeData
    | LLMNodeData
    | HTTPNodeData
    | AggregatorNodeData
    | TemplateNodeData
    | AnswerNodeData
    | GroupNodeData
    | Record<string, unknown>;

/**
 * JSON Schema for type definition
 */
export interface JsonSchema {
    type: string;
    title?: string;
    description?: string;
    default?: unknown;
    enum?: unknown[];
    properties?: Record<string, JsonSchema>;
    items?: JsonSchema;
    required?: string[];
}

/**
 * Workflow Edge
 */
export interface WorkflowEdge {
    id: string;
    sourceNodeId: string;
    targetNodeId: string;
    sourcePortId?: string;
    targetPortId?: string;
}

/**
 * Create a simple edge between two nodes
 */
export const createEdge = (
    id: string,
    sourceNodeId: string,
    targetNodeId: string,
): WorkflowEdge => ({
    id,
    sourceNodeId,
    targetNodeId,
});
