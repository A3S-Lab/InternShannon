import { WorkflowNode, WorkflowEdge, FlowValue, FlowValueType, WorkflowNodeData } from '../../domain/value-objects';
import { ExecutionContext, TEMPLATE_HELPERS } from '../execution-context';
import { CancellationToken } from '../cancellation-token';
import { expressionEvaluator } from '../expression-evaluator';

/**
 * Node Executor Result
 */
export interface NodeExecutorResult {
    outputs: Record<string, unknown>;
    branch?: string;  // For condition nodes
}

/**
 * Base Node Executor
 */
export abstract class BaseNodeExecutor {
    abstract readonly type: string;

    async execute(
        context: ExecutionContext,
        node: WorkflowNode,
        cancellationToken?: CancellationToken,
    ): Promise<NodeExecutorResult> {
        // Check cancellation before execution
        cancellationToken?.throwIfCancelled();

        // 1. Resolve inputs
        const inputs = this.resolveInputs(context, node);

        const runtimeNode = this.withResolvedRuntimeData(context, node, inputs);

        // 2. Execute with cancellation check
        const rawResult = await this.doExecute(context, runtimeNode, inputs, cancellationToken);
        const result: NodeExecutorResult = {
            ...rawResult,
            outputs: this.resolveOutputMappings(context, runtimeNode, rawResult.outputs, inputs),
        };

        // 3. Store outputs (both node-level and port-level)
        for (const [key, value] of Object.entries(result.outputs)) {
            context.setNodeOutput(node.id, key, value);
            // Also store as port output for port-based routing
            context.setPortOutput(node.id, key, value);
        }

        return result;
    }

    /**
     * Override to implement actual execution logic
     */
    protected abstract doExecute(
        context: ExecutionContext,
        node: WorkflowNode,
        inputs: Record<string, unknown>,
        cancellationToken?: CancellationToken,
    ): Promise<NodeExecutorResult>;

    /**
     * Resolve node inputs from variable bindings and optional port mapping.
     * When `inputsFromEdges` is false, explicit FlowValue bindings are the
     * source of truth and incoming edge ports are ignored.
     */
    protected resolveInputs(
        context: ExecutionContext,
        node: WorkflowNode,
    ): Record<string, unknown> {
        const inputs: Record<string, unknown> = {};
        const data = node.data as Record<string, unknown>;
        const inputsFromEdges = data?.inputsFromEdges !== false;

        // Get input bindings from node data
        const inputValues = data?.inputsValues as Record<string, { type: string; value?: unknown; variableName?: string; expression?: string }> | undefined;

        // Get edges targeting this node for port-based routing when enabled.
        const incomingEdges = inputsFromEdges ? context.getIncomingEdges(node.id) : [];

        if (inputValues) {
            for (const [key, flowValue] of Object.entries(inputValues)) {
                // First, try port-based input from edge
                const portInput = inputsFromEdges ? this.resolvePortInput(context, node.id, key, incomingEdges) : undefined;
                if (portInput !== undefined) {
                    inputs[key] = portInput;
                } else {
                    // Fall back to variable/expression resolution
                    inputs[key] = context.resolveFlowValue(flowValue as any);
                }
            }
        }

        return inputs;
    }

    /**
     * Resolve port input by finding the connected edge
     * If an edge connects sourcePortId to targetPortId, retrieve the source's port output
     */
    private resolvePortInput(
        context: ExecutionContext,
        targetNodeId: string,
        targetPortId: string,
        incomingEdges: WorkflowEdge[],
    ): unknown {
        // Find edge where targetPortId matches
        const matchingEdge = incomingEdges.find((e) => e.targetPortId === targetPortId);
        if (!matchingEdge) {
            return undefined;
        }

        // Get the source node's output at sourcePortId
        const sourcePortId = matchingEdge.sourcePortId || targetPortId;
        const sourceOutput = context.getPortOutput(matchingEdge.sourceNodeId, sourcePortId);
        if (sourceOutput !== undefined) {
            return sourceOutput;
        }

        // Fall back to node-level output if port output not found
        const sourceNodeOutput = context.getNodeOutput(matchingEdge.sourceNodeId, sourcePortId);
        return sourceNodeOutput;
    }

    private withResolvedRuntimeData(
        context: ExecutionContext,
        node: WorkflowNode,
        inputs: Record<string, unknown>,
    ): WorkflowNode {
        const data = this.recordValue(node.data) ?? {};
        const configMappings = this.recordValue(data.configMappings);
        const mappedConfig = configMappings
            ? this.resolveMapping(configMappings, context, node, inputs)
            : {};
        const resolvedData = this.resolveDataValue(
            {
                ...data,
                ...mappedConfig,
            },
            context,
            node,
            inputs,
            undefined,
            // 'assignments' is the variable-assigner's control structure (like
            // 'conditions') — it must reach the executor raw so it can resolve
            // each target's FlowValue/${} source itself, not be auto-pre-resolved.
            new Set(['inputsValues', 'configMappings', 'outputMappings', 'conditions', 'assignments']),
        );

        return {
            ...node,
            data: this.recordValue(resolvedData) as WorkflowNodeData,
        };
    }

    private resolveOutputMappings(
        context: ExecutionContext,
        node: WorkflowNode,
        rawOutputs: Record<string, unknown>,
        inputs: Record<string, unknown>,
    ): Record<string, unknown> {
        const outputMappings = this.recordValue((node.data as Record<string, unknown> | undefined)?.outputMappings);
        if (!outputMappings || Object.keys(outputMappings).length === 0) {
            return rawOutputs;
        }
        return this.resolveMapping(outputMappings, context, node, inputs, rawOutputs);
    }

    private resolveMapping(
        mapping: Record<string, unknown>,
        context: ExecutionContext,
        node: WorkflowNode,
        inputs: Record<string, unknown>,
        currentOutput: Record<string, unknown> = {},
    ): Record<string, unknown> {
        return Object.fromEntries(
            Object.entries(mapping).map(([key, value]) => [
                key,
                this.resolveMappedValue(value, context, node, inputs, currentOutput),
            ]),
        );
    }

    private resolveDataValue(
        value: unknown,
        context: ExecutionContext,
        node: WorkflowNode,
        inputs: Record<string, unknown>,
        key?: string,
        skippedKeys: Set<string> = new Set(),
    ): unknown {
        if (key && skippedKeys.has(key)) {
            return value;
        }
        if (this.isFlowValue(value)) {
            return context.resolveFlowValue(value);
        }
        if (typeof value === 'string') {
            return key === 'code' ? value : this.resolveTemplateValue(value, this.mappingContext(context, node, inputs));
        }
        if (Array.isArray(value)) {
            return value.map((item) => this.resolveDataValue(item, context, node, inputs, key, skippedKeys));
        }
        const record = this.recordValue(value);
        if (record) {
            return Object.fromEntries(
                Object.entries(record).map(([nextKey, item]) => [
                    nextKey,
                    this.resolveDataValue(item, context, node, inputs, nextKey, skippedKeys),
                ]),
            );
        }
        return value;
    }

    private resolveMappedValue(
        value: unknown,
        context: ExecutionContext,
        node: WorkflowNode,
        inputs: Record<string, unknown>,
        currentOutput: Record<string, unknown>,
    ): unknown {
        if (this.isFlowValue(value)) {
            return context.resolveFlowValue(value);
        }
        const expressionContext = this.mappingContext(context, node, inputs, currentOutput);
        if (typeof value === 'string') {
            return this.resolveMappingString(value, expressionContext);
        }
        if (Array.isArray(value)) {
            return value.map((item) => this.resolveMappedValue(item, context, node, inputs, currentOutput));
        }
        const record = this.recordValue(value);
        if (record) {
            return Object.fromEntries(
                Object.entries(record).map(([key, item]) => [
                    key,
                    this.resolveMappedValue(item, context, node, inputs, currentOutput),
                ]),
            );
        }
        return value;
    }

    private resolveTemplateValue(value: string, context: Record<string, unknown>): unknown {
        const fullMatch = value.match(/^\s*\$\{\s*([^}]+?)\s*\}\s*$/);
        if (fullMatch) {
            return this.evaluateExpression(fullMatch[1], context);
        }
        if (value.includes('${')) {
            return value.replace(/\$\{\s*([^}]+?)\s*\}/g, (_match, expression: string) => {
                const resolved = this.evaluateExpression(expression, context);
                return resolved === undefined || resolved === null ? '' : String(resolved);
            });
        }
        return value;
    }

    private resolveMappingString(value: string, context: Record<string, unknown>): unknown {
        if (value.includes('${')) {
            return this.resolveTemplateValue(value, context);
        }
        if (!this.shouldEvaluateRawMapping(value)) {
            return value;
        }
        return this.evaluateExpression(value, context);
    }

    private evaluateExpression(expression: string, context: Record<string, unknown>): unknown {
        const normalized = expression.trim().startsWith('$.')
            ? expression.trim().slice(2)
            : expression.trim();
        const pathValue = expressionEvaluator.resolvePath(normalized, context);
        return pathValue !== undefined ? pathValue : expressionEvaluator.evaluate(normalized, context);
    }

    private mappingContext(
        context: ExecutionContext,
        node: WorkflowNode,
        inputs: Record<string, unknown>,
        currentOutput: Record<string, unknown> = {},
    ): Record<string, unknown> {
        const snapshot = context.toSnapshot();
        const nodeOutputs = {
            ...snapshot.nodeOutputs,
            [node.id]: currentOutput,
        };
        const nodes = Object.fromEntries(
            Object.entries(nodeOutputs).map(([nodeId, output]) => [
                nodeId,
                { output, outputs: output, ...output },
            ]),
        );
        const variables = context.getAllVariables();
        return {
            ...variables,
            ...nodes,
            input: this.recordValue(variables.input) ?? variables,
            variables,
            vars: variables,
            metadata: this.recordValue(variables.metadata) ?? {},
            nodes,
            nodeOutputs,
            output: currentOutput,
            outputs: currentOutput,
            currentNode: {
                id: node.id,
                type: node.type,
                input: inputs,
                config: this.recordValue(node.data) ?? {},
                output: currentOutput,
                outputs: currentOutput,
            },
            // Template helpers (coalesce/json/…) — mirror ExecutionContext's
            // evaluation context. Without these, node data/config/output mappings
            // that call a helper (e.g. http node url `${coalesce(...)}`) throw
            // inside the evaluator and silently fall back to the literal expression
            // string, breaking the node (e.g. "Failed to parse URL from coalesce(…)").
            ...TEMPLATE_HELPERS,
        };
    }

    private shouldEvaluateRawMapping(value: string): boolean {
        const trimmed = value.trim();
        if (!trimmed) {
            return false;
        }
        return trimmed.startsWith('$.')
            || trimmed.startsWith('input.')
            || trimmed.startsWith('variables.')
            || trimmed.startsWith('vars.')
            || trimmed.startsWith('nodes.')
            || trimmed.startsWith('nodeOutputs.')
            || trimmed.startsWith('currentNode.')
            || trimmed.startsWith('workflow.')
            || trimmed.startsWith('metadata.')
            || trimmed.startsWith('output.')
            || trimmed.startsWith('outputs.')
            || trimmed === 'true'
            || trimmed === 'false'
            || trimmed === 'null'
            || /^-?\d+(\.\d+)?$/.test(trimmed)
            || /^(['"]).*\1$/.test(trimmed);
    }

    private isFlowValue(value: unknown): value is FlowValue {
        const record = this.recordValue(value);
        return Boolean(
            record
            && (record.type === FlowValueType.Static || record.type === FlowValueType.Variable || record.type === FlowValueType.Expression)
            && ('value' in record || 'variableName' in record || 'expression' in record),
        );
    }

    private recordValue(value: unknown): Record<string, unknown> | undefined {
        return value && typeof value === 'object' && !Array.isArray(value)
            ? value as Record<string, unknown>
            : undefined;
    }
}
