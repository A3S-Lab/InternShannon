/**
 * Structural verifier for flow.json graphs (the engine's runtime shape,
 * not the planner's Chain). Hardens the persist boundary so any write — by
 * the planner, by model freestyle, or by an external API — that violates
 * graph topology is rejected with an explainable list of issues.
 *
 * Scope of checks (top-level + recursive into loop blocks):
 *   1. Exactly one `start` node and one `end` node.
 *   2. Top-level edge endpoints reference existing nodes.
 *   3. No cycles (DAG).
 *   4. Every executable node is reachable from `start` (forward). `comment`
 *      nodes are design-time annotations and do not participate in execution.
 *   5. Every executable node can reach `end` (backward). In loop bodies,
 *      `break` / `continue` are terminal control-flow nodes and count as
 *      valid exits for their branch.
 *   6. condition nodes: `data.conditions[].targetNodeId` and
 *      `data.defaultNodeId` reference existing siblings; their virtual edges
 *      are folded into reachability so well-routed branches are not
 *      false-positives.
 *   7. loop nodes: `data.blocks[]` form a self-contained subgraph that must
 *      itself satisfy checks 1–6 (with `block-start`/`block-end` substituting
 *      for `start`/`end`).
 */

export type WorkflowStructuralIssueKind =
    | 'missing_start'
    | 'missing_end'
    | 'duplicate_start'
    | 'duplicate_end'
    | 'edge_endpoint_unknown'
    | 'cycle_detected'
    | 'unreachable_from_start'
    | 'cannot_reach_end'
    | 'condition_route_unknown'
    | 'loop_block_invalid'
    | 'disallowed_node_type'
    | 'non_serial_topology';

export interface WorkflowStructuralIssue {
    kind: WorkflowStructuralIssueKind;
    /** Top-level node id, or `loopId/innerNodeId` when nested in a loop body. */
    nodeId?: string;
    /** Edge id when the issue is about a specific edge. */
    edgeId?: string;
    /** Human-readable explanation, used in the system-prompt feedback. */
    message: string;
}

export interface WorkflowStructuralResult {
    valid: boolean;
    issues: WorkflowStructuralIssue[];
}

interface NormalisedNode {
    id: string;
    type: string;
    data: Record<string, unknown>;
    blocks: NormalisedSubgraph | null;
}

interface NormalisedEdge {
    id: string;
    source: string;
    target: string;
}

interface NormalisedSubgraph {
    nodes: NormalisedNode[];
    edges: NormalisedEdge[];
}

/**
 * Tokens used to identify graph entrypoints inside a loop body. The engine
 * uses `block-start` / `block-end` instead of `start` / `end` when nested.
 */
const LOOP_BODY_START = 'block-start';
const LOOP_BODY_END = 'block-end';
const COMMENT_NODE_TYPE = 'comment';
const LOOP_TERMINAL_NODE_TYPES = new Set(['break', 'continue']);

export interface WorkflowStructuralValidatorOptions {
    /**
     * White-list of node types the workflow is allowed to contain. If set,
     * every node whose type is NOT in this set is rejected with
     * `disallowed_node_type`. `null` / omitted disables the type gate (default).
     *
     * The orchestration agent currently passes `{'start','end','agent'}` because
     * the 开放平台 front-end can only render custom-agent nodes; engine-native
     * types (`http` / `llm` / `code` / `condition` / `loop` / `group` / `comment`
     * / `package-*`) would leave the canvas blank and break workflow editing.
     */
    allowedNodeTypes?: ReadonlySet<string> | null;
    /**
     * When true the graph must be a **strict serial chain**: every node has
     * at most one incoming edge and at most one outgoing edge. Violations
     * (fan-out from one node into multiple children, fan-in from multiple
     * parents into one node) are reported as `non_serial_topology` issues.
     *
     * The orchestration agent enables this so the canvas always renders a
     * left-to-right linear pipeline. Branching / parallel work should live
     * INSIDE the bound agent's own implementation, not as parallel workflow
     * siblings.
     */
    requireSerialChain?: boolean;
}

export class WorkflowStructuralValidator {
    constructor(private readonly options: WorkflowStructuralValidatorOptions = {}) {}

    validate(graph: { nodes: unknown[]; edges: unknown[] }): WorkflowStructuralResult {
        const issues: WorkflowStructuralIssue[] = [];
        const subgraph = normaliseSubgraph(graph);
        validateSubgraph(
            subgraph,
            {
                startType: 'start',
                endType: 'end',
                scope: '',
                allowedNodeTypes: this.options.allowedNodeTypes ?? null,
                requireSerialChain: this.options.requireSerialChain ?? false,
            },
            issues,
        );
        return { valid: issues.length === 0, issues };
    }
}

/**
 * Render issues into a compact bullet list suitable for injection into the
 * next-turn system prompt. Kept here so the wording stays consistent between
 * SSE telemetry and model feedback.
 */
export function describeWorkflowIssues(issues: ReadonlyArray<WorkflowStructuralIssue>): string {
    if (issues.length === 0) return '';
    const lines = issues.map((issue) => {
        const where = issue.nodeId
            ? ` (node ${issue.nodeId})`
            : issue.edgeId
              ? ` (edge ${issue.edgeId})`
              : '';
        return `- [${issue.kind}]${where}: ${issue.message}`;
    });
    return lines.join('\n');
}

// ────────────────────────────────────────────────────────────────────────────
// Internals
// ────────────────────────────────────────────────────────────────────────────

function validateSubgraph(
    subgraph: NormalisedSubgraph,
    options: {
        startType: string;
        endType: string;
        scope: string;
        allowedNodeTypes: ReadonlySet<string> | null;
        requireSerialChain: boolean;
    },
    issues: WorkflowStructuralIssue[],
): void {
    const { nodes, edges } = subgraph;
    const { startType, endType, scope, allowedNodeTypes, requireSerialChain } = options;
    const tagId = (id: string) => (scope ? `${scope}/${id}` : id);

    // 0. White-list gate. Done first so the model gets the most actionable
    // feedback for malformed graphs (otherwise it tends to chase the
    // unreachable/cycle errors that show up downstream).
    if (allowedNodeTypes) {
        for (const node of nodes) {
            if (allowedNodeTypes.has(node.type)) continue;
            const allowed = [...allowedNodeTypes].join(', ');
            issues.push({
                kind: 'disallowed_node_type',
                nodeId: tagId(node.id),
                message: scope
                    ? `Loop body ${scope} contains node "${node.id}" of type "${node.type || 'unknown'}", which is not allowed in this session (allowed: ${allowed}).`
                    : `Node "${node.id}" has type "${node.type || 'unknown'}", which is not allowed in this session (allowed: ${allowed}).`,
            });
        }
    }

    const startIds = nodes.filter((node) => node.type === startType).map((node) => node.id);
    const endIds = nodes.filter((node) => node.type === endType).map((node) => node.id);

    if (startIds.length === 0) {
        issues.push({
            kind: 'missing_start',
            message: scope
                ? `Loop body ${scope} is missing a ${startType} node.`
                : `Workflow must contain exactly one ${startType} node.`,
        });
    } else if (startIds.length > 1) {
        for (const id of startIds.slice(1)) {
            issues.push({
                kind: 'duplicate_start',
                nodeId: tagId(id),
                message: `Workflow has more than one ${startType} node; only one is allowed.`,
            });
        }
    }
    if (endIds.length === 0) {
        issues.push({
            kind: 'missing_end',
            message: scope
                ? `Loop body ${scope} is missing a ${endType} node.`
                : `Workflow must contain exactly one ${endType} node.`,
        });
    } else if (endIds.length > 1) {
        for (const id of endIds.slice(1)) {
            issues.push({
                kind: 'duplicate_end',
                nodeId: tagId(id),
                message: `Workflow has more than one ${endType} node; only one is allowed.`,
            });
        }
    }

    const nodeById = new Map(nodes.map((node) => [node.id, node]));

    // 2. Edge endpoints must reference real nodes; drop bad edges from the
    // adjacency we use for the remaining checks so cycle/reachability errors
    // aren't double-reported on top of dangling-edge errors.
    const liveEdges: NormalisedEdge[] = [];
    for (const edge of edges) {
        if (!nodeById.has(edge.source)) {
            issues.push({
                kind: 'edge_endpoint_unknown',
                edgeId: edge.id,
                message: `Edge ${edge.id} sourceNodeId "${edge.source}" does not match any node.`,
            });
            continue;
        }
        if (!nodeById.has(edge.target)) {
            issues.push({
                kind: 'edge_endpoint_unknown',
                edgeId: edge.id,
                message: `Edge ${edge.id} targetNodeId "${edge.target}" does not match any node.`,
            });
            continue;
        }
        liveEdges.push(edge);
    }

    // 6. Condition routes contribute virtual edges so well-routed branches
    // are not flagged unreachable. Targets pointing at non-existent nodes
    // become condition_route_unknown errors.
    const virtualEdges: Array<{ source: string; target: string }> = [];
    for (const node of nodes) {
        if (node.type !== 'condition') continue;
        const conditions = Array.isArray(node.data.conditions) ? node.data.conditions : [];
        for (const branch of conditions) {
            const target = pickString(asRecord(branch), ['targetNodeId', 'targetNodeID']);
            if (!target) continue;
            if (!nodeById.has(target)) {
                issues.push({
                    kind: 'condition_route_unknown',
                    nodeId: tagId(node.id),
                    message: `Condition node ${node.id} routes to unknown node "${target}".`,
                });
                continue;
            }
            virtualEdges.push({ source: node.id, target });
        }
        const defaultTarget = pickString(node.data, ['defaultNodeId', 'defaultNodeID']);
        if (defaultTarget && !nodeById.has(defaultTarget)) {
            issues.push({
                kind: 'condition_route_unknown',
                nodeId: tagId(node.id),
                message: `Condition node ${node.id} default route "${defaultTarget}" matches no node.`,
            });
        } else if (defaultTarget) {
            virtualEdges.push({ source: node.id, target: defaultTarget });
        }
    }

    const adjacency = buildAdjacency(nodes, liveEdges, virtualEdges);
    const reverseAdjacency = buildAdjacency(
        nodes,
        liveEdges.map((edge) => ({ id: edge.id, source: edge.target, target: edge.source })),
        virtualEdges.map((edge) => ({ source: edge.target, target: edge.source })),
    );

    // 2.5 Strict serial-chain topology (opt-in). Each node may have at most
    // one incoming and one outgoing real edge. Fan-out / fan-in is rejected
    // with `non_serial_topology` issues so the model self-corrects on the
    // next turn instead of leaving a parallel canvas the platform cannot
    // render as a clean LR chain. virtualEdges from condition nodes are
    // excluded here — when serial chain is required, condition nodes are
    // also forbidden by `allowedNodeTypes`, so this never matters in practice.
    if (requireSerialChain) {
        const indegree = new Map<string, number>();
        const outdegree = new Map<string, number>();
        for (const node of nodes) {
            indegree.set(node.id, 0);
            outdegree.set(node.id, 0);
        }
        for (const edge of liveEdges) {
            indegree.set(edge.target, (indegree.get(edge.target) ?? 0) + 1);
            outdegree.set(edge.source, (outdegree.get(edge.source) ?? 0) + 1);
        }
        for (const node of nodes) {
            const out = outdegree.get(node.id) ?? 0;
            const inc = indegree.get(node.id) ?? 0;
            if (out > 1) {
                issues.push({
                    kind: 'non_serial_topology',
                    nodeId: tagId(node.id),
                    message: `Node ${node.id} has ${out} outgoing edges (fan-out). The orchestration workflow must be a strict serial chain — every node has at most one outgoing edge. Move parallel work INSIDE the bound agent's implementation, not into sibling workflow nodes.`,
                });
            }
            if (inc > 1) {
                issues.push({
                    kind: 'non_serial_topology',
                    nodeId: tagId(node.id),
                    message: `Node ${node.id} has ${inc} incoming edges (fan-in). The orchestration workflow must be a strict serial chain — every node has at most one incoming edge.`,
                });
            }
        }
    }

    // 3. Cycle detection via Kahn's algorithm (in-degree = 0 frontier).
    if (hasCycle(nodes, adjacency)) {
        issues.push({
            kind: 'cycle_detected',
            message: scope
                ? `Loop body ${scope} contains a cycle; workflows must be DAGs.`
                : 'Workflow graph contains a cycle; workflows must be DAGs.',
        });
    }

    if (startIds.length > 0 && endIds.length > 0) {
        // 4. Reachable from start.
        const reachableFromStart = bfs(startIds, adjacency);
        for (const node of nodes) {
            if (isDesignOnlyNode(node)) continue;
            if (reachableFromStart.has(node.id)) continue;
            issues.push({
                kind: 'unreachable_from_start',
                nodeId: tagId(node.id),
                message: `Node ${node.id} (${node.type || 'unknown'}) is not reachable from ${startType}.`,
            });
        }
        // 5. Can reach end.
        const terminalIds =
            endType === LOOP_BODY_END
                ? nodes.filter((node) => LOOP_TERMINAL_NODE_TYPES.has(node.type)).map((node) => node.id)
                : [];
        const canReachEnd = bfs([...endIds, ...terminalIds], reverseAdjacency);
        for (const node of nodes) {
            if (isDesignOnlyNode(node)) continue;
            if (canReachEnd.has(node.id)) continue;
            // Avoid duplicate complaints when already flagged unreachable.
            if (!reachableFromStart.has(node.id)) continue;
            issues.push({
                kind: 'cannot_reach_end',
                nodeId: tagId(node.id),
                message: `Node ${node.id} (${node.type || 'unknown'}) has no path to ${endType}.`,
            });
        }
    }

    // 7. Recurse into loop blocks. Each loop body is a self-contained
    // subgraph with `block-start` / `block-end` substituting for start/end.
    for (const node of nodes) {
        if (node.type !== 'loop' || !node.blocks) continue;
        const innerScope = scope ? `${scope}/${node.id}` : node.id;
        const innerIssues: WorkflowStructuralIssue[] = [];
        validateSubgraph(
            node.blocks,
            {
                startType: LOOP_BODY_START,
                endType: LOOP_BODY_END,
                scope: innerScope,
                allowedNodeTypes,
                requireSerialChain,
            },
            innerIssues,
        );
        if (innerIssues.length > 0) {
            for (const inner of innerIssues) {
                issues.push({
                    kind: inner.kind === 'cycle_detected' ? 'loop_block_invalid' : inner.kind,
                    nodeId: inner.nodeId,
                    edgeId: inner.edgeId,
                    message: inner.message,
                });
            }
        }
    }
}

function isDesignOnlyNode(node: NormalisedNode): boolean {
    return node.type === COMMENT_NODE_TYPE;
}

function buildAdjacency(
    nodes: NormalisedNode[],
    edges: ReadonlyArray<{ source: string; target: string }>,
    virtualEdges: ReadonlyArray<{ source: string; target: string }>,
): Map<string, Set<string>> {
    const adjacency = new Map<string, Set<string>>();
    for (const node of nodes) adjacency.set(node.id, new Set());
    for (const edge of [...edges, ...virtualEdges]) {
        adjacency.get(edge.source)?.add(edge.target);
    }
    return adjacency;
}

function bfs(seeds: string[], adjacency: Map<string, Set<string>>): Set<string> {
    const visited = new Set<string>(seeds);
    const queue = [...seeds];
    while (queue.length > 0) {
        const current = queue.shift()!;
        const neighbours = adjacency.get(current);
        if (!neighbours) continue;
        for (const next of neighbours) {
            if (visited.has(next)) continue;
            visited.add(next);
            queue.push(next);
        }
    }
    return visited;
}

function hasCycle(nodes: NormalisedNode[], adjacency: Map<string, Set<string>>): boolean {
    const inDegree = new Map<string, number>();
    for (const node of nodes) inDegree.set(node.id, 0);
    for (const [, targets] of adjacency) {
        for (const target of targets) inDegree.set(target, (inDegree.get(target) ?? 0) + 1);
    }
    const queue: string[] = [];
    for (const [id, degree] of inDegree) if (degree === 0) queue.push(id);
    let processed = 0;
    while (queue.length > 0) {
        const current = queue.shift()!;
        processed += 1;
        const neighbours = adjacency.get(current);
        if (!neighbours) continue;
        for (const next of neighbours) {
            const nextDegree = (inDegree.get(next) ?? 0) - 1;
            inDegree.set(next, nextDegree);
            if (nextDegree === 0) queue.push(next);
        }
    }
    return processed !== nodes.length;
}

function normaliseSubgraph(input: { nodes: unknown[]; edges: unknown[] }): NormalisedSubgraph {
    const nodes: NormalisedNode[] = [];
    for (const raw of input.nodes ?? []) {
        const node = normaliseNode(raw);
        if (node) nodes.push(node);
    }
    const edges: NormalisedEdge[] = [];
    const edgeRaws = Array.isArray(input.edges) ? input.edges : [];
    edgeRaws.forEach((raw, index) => {
        const edge = normaliseEdge(raw, index);
        if (edge) edges.push(edge);
    });
    return { nodes, edges };
}

function normaliseNode(raw: unknown): NormalisedNode | null {
    const record = asRecord(raw);
    if (!record) return null;
    const id = pickString(record, ['id', 'nodeId', 'nodeID']);
    if (!id) return null;
    const type = pickString(record, ['type', 'kind']);
    const data = asRecord(record.data) ?? {};
    // Canonical position per WorkflowNodeDefinition is top-level `node.blocks`
    // / `node.edges`. Some upstream emitters nest them under `data`; accept
    // either to avoid false negatives.
    const blocks = Array.isArray(record.blocks)
        ? (record.blocks as unknown[])
        : Array.isArray(data.blocks)
          ? (data.blocks as unknown[])
          : null;
    const innerEdges = Array.isArray(record.edges)
        ? (record.edges as unknown[])
        : Array.isArray(data.edges)
          ? (data.edges as unknown[])
          : [];
    let inner: NormalisedSubgraph | null = null;
    if (type === 'loop' && blocks) {
        inner = normaliseSubgraph({ nodes: blocks, edges: innerEdges });
    }
    return { id, type, data, blocks: inner };
}

function normaliseEdge(raw: unknown, index: number): NormalisedEdge | null {
    const record = asRecord(raw);
    if (!record) return null;
    const source = pickString(record, ['sourceNodeId', 'sourceNodeID', 'source', 'from', 'source_node_id']);
    const target = pickString(record, ['targetNodeId', 'targetNodeID', 'target', 'to', 'target_node_id']);
    if (!source || !target) return null;
    const id = pickString(record, ['id', 'edgeId', 'edgeID']) || `edge-${index + 1}`;
    return { id, source, target };
}

function asRecord(value: unknown): Record<string, unknown> | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    return value as Record<string, unknown>;
}

function pickString(record: Record<string, unknown> | null, keys: string[]): string {
    if (!record) return '';
    for (const key of keys) {
        const value = record[key];
        if (typeof value === 'string' && value.trim()) return value.trim();
    }
    return '';
}
