import { Logger } from '@nestjs/common';
import { BaseNodeExecutor, NodeExecutorResult } from './base.executor';
import { ExecutionContext } from '../execution-context';
import { WorkflowNode, WorkflowEdge, WorkflowNodeType, LoopNodeData, ConditionItem } from '../../domain/value-objects';
import { MaterialRegistry } from '../material-registry';
import { CancellationToken } from '../cancellation-token';
import { buildConditionEvalContext, evaluateConditions } from './condition-evaluator';
import { DEFAULT_NODE_FANOUT_CONCURRENCY, mapWithConcurrency } from '../map-with-concurrency';

/**
 * Loop Node Executor
 * Iterates over an array and executes child nodes for each item
 * Aligns with Flowgram.ai's loop execution model using sub-context and cache
 */
export class LoopNodeExecutor extends BaseNodeExecutor {
    readonly type = WorkflowNodeType.Loop;
    private readonly logger = new Logger(LoopNodeExecutor.name);

    constructor(private materialRegistry?: MaterialRegistry) {
        super();
    }

    protected async doExecute(
        context: ExecutionContext,
        node: WorkflowNode,
        inputs: Record<string, unknown>,
        _cancellationToken?: CancellationToken,
    ): Promise<NodeExecutorResult> {
        const data = node.data as LoopNodeData;

        // Get loop array from variable reference
        const loopArray = this.resolveLoopArray(data.loopArray, context);

        if (!Array.isArray(loopArray)) {
            this.logger.warn(`Loop node ${node.id}: loopArray is not an array`);
            return { outputs: { items: [] } };
        }

        if (loopArray.length === 0) {
            this.logger.debug(`Loop node ${node.id}: empty array`);
            return { outputs: { items: [] } };
        }

        // Find block start and end nodes in children
        const blockStartNode = this.findBlockStartNode(node);
        const blockEndNode = this.findBlockEndNode(node);
        if (!blockStartNode || !blockEndNode) {
            this.logger.warn(`Loop node ${node.id}: block start or end node not found`);
            return { outputs: { items: [] } };
        }

        // Build block edge map
        const blockEdgeMap = this.buildBlockEdgeMap(node);

        const maxIterations = data.maxIterations || loopArray.length;
        const iterationOutputs: Record<string, unknown>[] = [];
        const loopVariable = data.loopVariable || 'item';
        const loopIndexVar = '_loop.index';
        const loopItemVar = '_loop.item';

        this.logger.debug(`Loop node ${node.id}: iterating ${Math.min(loopArray.length, maxIterations)} times`);

        const breakConditions = (data as LoopNodeData & { breakConditions?: ConditionItem[] }).breakConditions;
        const hasBreakConditions = Array.isArray(breakConditions) && breakConditions.length > 0;

        // Parallel iteration (Dify parity / engine perf): when enabled and no break
        // condition is declared (break/continue are serial-only semantics), run the
        // iterations concurrently with a bounded fan-out. mapWithConcurrency preserves
        // input order in the collected outputs.
        const loopOpts = data as LoopNodeData & { parallel?: boolean; concurrency?: number };
        if (loopOpts.parallel && !hasBreakConditions) {
            const limit =
                typeof loopOpts.concurrency === 'number' && loopOpts.concurrency > 0 ? loopOpts.concurrency : DEFAULT_NODE_FANOUT_CONCURRENCY;
            const count = Math.min(loopArray.length, maxIterations);
            const indices = Array.from({ length: count }, (_, i) => i);
            const outputs = await mapWithConcurrency(indices, limit, async (index) => {
                const item = loopArray[index];
                const subContext = context.sub();
                subContext.setVariable(loopVariable, item);
                subContext.setVariable(loopIndexVar, index);
                subContext.setVariable(loopItemVar, item);
                const blockOutput = await this.executeBlock(subContext, blockStartNode, blockEndNode, blockEdgeMap, node.blocks || []);
                subContext.clear();
                return blockOutput;
            });
            const items = outputs.filter((output) => output && Object.keys(output).length > 0) as Record<string, unknown>[];
            return { outputs: { items } };
        }

        // Iterate over array
        for (let index = 0; index < loopArray.length; index++) {
            if (index >= maxIterations) break;

            const item = loopArray[index];

            // Create sub-context for this iteration (like Flowgram.ai's context.runtime.sub())
            const subContext = context.sub();

            // Set loop variables on sub-context
            subContext.setVariable(loopVariable, item);
            subContext.setVariable(loopIndexVar, index);
            subContext.setVariable(loopItemVar, item);

            // Execute block subgraph in sub-context
            const blockOutput = await this.executeBlock(
                subContext,
                blockStartNode,
                blockEndNode,
                blockEdgeMap,
                node.blocks || [],
            );

            // Read break/continue signals from the sub-context cache BEFORE
            // clearing it — clear() wipes the cache, so reading after it always
            // saw `undefined` and break/continue were silently no-ops.
            // Read break/continue signals from the sub-context cache BEFORE
            // clearing it — clear() wipes the cache, so reading after it always
            // saw `undefined` and break/continue were silently no-ops.
            const broke = subContext.cache.get('loop-break') === true;
            const continued = subContext.cache.get('loop-continue') === true;

            // Clean up sub-context after iteration to prevent memory leak
            subContext.clear();

            // Check for break (using sub-context's cache like Flowgram.ai)
            if (broke) {
                this.logger.debug(`Loop node ${node.id}: break at index ${index}`);
                break;
            }

            // Check for continue (using sub-context's cache like Flowgram.ai)
            if (continued) {
                this.logger.debug(`Loop node ${node.id}: continue at index ${index}`);
                continue;
            }

            // Collect block output from executeBlock's return value
            if (blockOutput && Object.keys(blockOutput).length > 0) {
                iterationOutputs.push(blockOutput);
            }

            // Dify loop-termination parity: break when a declared break condition
            // holds. Evaluated after the iteration completes, against this
            // iteration's loop variable + block output (so the condition can
            // reference `${item}` / `${_loop.output.x}`).
            if (breakConditions && breakConditions.length > 0) {
                const breakContext = buildConditionEvalContext({
                    variables: { [loopVariable]: item, _loop: { index, item } },
                    nodeOutputs: { _loop: blockOutput ?? {} },
                    inputs: { [loopVariable]: item, ...(blockOutput ?? {}) },
                });
                if (evaluateConditions(breakConditions, breakContext)) {
                    this.logger.debug(`Loop node ${node.id}: break condition met at index ${index}`);
                    break;
                }
            }
        }

        return { outputs: { items: iterationOutputs } };
    }

    private resolveLoopArray(loopArrayRef: unknown, context: ExecutionContext): unknown {
        if (Array.isArray(loopArrayRef)) {
            return loopArrayRef;
        }
        if (!loopArrayRef) {
            this.logger.warn('No loopArray reference provided');
            return [];
        }

        const value = context.getVariable(String(loopArrayRef));
        if (!Array.isArray(value)) {
            this.logger.warn(`Variable ${loopArrayRef} is not an array`);
            return [];
        }

        return value;
    }

    private findBlockStartNode(node: WorkflowNode): WorkflowNode | undefined {
        if (!node.blocks) return undefined;
        return node.blocks.find((b) => b.type === WorkflowNodeType.BlockStart);
    }

    private findBlockEndNode(node: WorkflowNode): WorkflowNode | undefined {
        if (!node.blocks) return undefined;
        return node.blocks.find((b) => b.type === WorkflowNodeType.BlockEnd);
    }

    /**
     * Build edge map for nodes within a block
     * Key is sourceNodeId, value is list of edges from that node
     */
    private buildBlockEdgeMap(node: WorkflowNode): Map<string, WorkflowEdge[]> {
        const edgeMap = new Map<string, WorkflowEdge[]>();
        const blocks = node.blocks || [];

        for (const blockNode of blocks) {
            edgeMap.set(blockNode.id, []);
        }

        for (const edge of node.edges || []) {
            const edges = edgeMap.get(edge.sourceNodeId) || [];
            edges.push(edge);
            edgeMap.set(edge.sourceNodeId, edges);
        }

        return edgeMap;
    }

    /**
     * Execute the block subgraph starting from BlockStart and ending at BlockEnd
     * Collects outputs from all executed nodes in the block
     */
    private async executeBlock(
        context: ExecutionContext,
        blockStartNode: WorkflowNode,
        blockEndNode: WorkflowNode,
        blockEdgeMap: Map<string, WorkflowEdge[]>,
        allBlockNodes: WorkflowNode[],
    ): Promise<Record<string, unknown> | null> {
        // Mark block start as executed
        context.markNodeExecuted(blockStartNode.id);

        // Build node map for the block
        const nodeMap = new Map<string, WorkflowNode>();
        for (const n of allBlockNodes) {
            nodeMap.set(n.id, n);
        }

        // Execute nodes from block start, following edges, until block end
        let currentNodeId = blockStartNode.id;
        const visited = new Set<string>();
        let lastOutputs: Record<string, unknown> | null = null;

        while (currentNodeId && currentNodeId !== blockEndNode.id) {
            if (visited.has(currentNodeId)) {
                // Avoid infinite loops in case of cycle
                break;
            }
            visited.add(currentNodeId);

            const currentNode = nodeMap.get(currentNodeId);
            if (!currentNode) break;

            // Get executor for this node type
            const executor = this.materialRegistry?.getExecutor(currentNode.type);
            if (!executor) {
                // Unknown node type, skip
                break;
            }

            // Execute the node
            try {
                const result = await executor.execute(context, currentNode);
                context.markNodeExecuted(currentNode.id);

                // Collect outputs (skip BlockStart and BlockEnd which just pass through)
                if (currentNode.type !== WorkflowNodeType.BlockStart && currentNode.type !== WorkflowNodeType.BlockEnd) {
                    lastOutputs = result.outputs;
                }

                // Handle break/continue signals
                if (currentNode.type !== WorkflowNodeType.Break && currentNode.type !== WorkflowNodeType.Continue) {
                    // Find next node based on result branch or successors
                    if (result.branch) {
                        currentNodeId = result.branch;
                    } else {
                        // Follow edge from current node
                        const successors = this.getSuccessorsFromEdgeMap(currentNodeId, blockEdgeMap);
                        currentNodeId = successors.length > 0 ? successors[0] : blockEndNode.id;
                    }
                } else {
                    // Break or Continue - exit the block loop
                    break;
                }
            } catch (error) {
                context.markNodeFailed(currentNode.id);
                throw error;
            }
        }

        // Mark block end as executed
        context.markNodeExecuted(blockEndNode.id);

        return lastOutputs;
    }

    private getSuccessorsFromEdgeMap(nodeId: string, edgeMap: Map<string, WorkflowEdge[]>): string[] {
        const edges = edgeMap.get(nodeId) || [];
        return edges.map((e) => e.targetNodeId);
    }

    private combineBlockOutputs(blockOutputs: Record<string, unknown[]>): Record<string, unknown> {
        const result: Record<string, unknown> = { items: [] as unknown[] };

        for (const [key, values] of Object.entries(blockOutputs)) {
            result[key] = values;
            (result.items as unknown[]).push(...values);
        }

        return result;
    }
}
