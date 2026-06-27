import { BaseNodeExecutor, NodeExecutorResult } from './base.executor';
import { ExecutionContext } from '../execution-context';
import { WorkflowEdge, WorkflowNode, WorkflowNodeType } from '../../domain/value-objects';
import { CancellationToken } from '../cancellation-token';

/**
 * Aggregates named branch values into one object.
 *
 * Incoming edges contribute by targetPortId first, then sourcePortId. When no
 * port is declared, object outputs from the source node are merged field by
 * field. Explicit inputsValues override edge-derived values for the same key.
 */
export class AggregatorNodeExecutor extends BaseNodeExecutor {
    readonly type = WorkflowNodeType.Aggregator;

    protected async doExecute(
        context: ExecutionContext,
        node: WorkflowNode,
        inputs: Record<string, unknown>,
        _cancellationToken?: CancellationToken,
    ): Promise<NodeExecutorResult> {
        const data = this.asRecord(node.data) ?? {};
        const edgeValues = data.inputsFromEdges === false
            ? {}
            : this.resolveIncomingEdgeValues(context, node.id);
        const merged = {
            ...edgeValues,
            ...inputs,
        };
        // Dify variable-aggregator parity: `firstNonNull` mode coalesces the inputs to
        // the first non-null value (fallback chain) instead of merging fields. Default
        // stays `merge` so existing flows are unchanged.
        if (data.aggregateMode === 'firstNonNull') {
            const firstNonNull = Object.values(merged).find((value) => value !== null && value !== undefined);
            return { outputs: { output: firstNonNull === undefined ? null : firstNonNull } };
        }
        const declaredKeys = this.declaredOutputKeys(data.outputs);
        if (declaredKeys.length === 0) {
            return { outputs: merged };
        }
        return {
            outputs: Object.fromEntries(
                declaredKeys
                    .filter((key) => Object.prototype.hasOwnProperty.call(merged, key))
                    .map((key) => [key, merged[key]]),
            ),
        };
    }

    private resolveIncomingEdgeValues(context: ExecutionContext, nodeId: string): Record<string, unknown> {
        const values: Record<string, unknown> = {};
        for (const edge of context.getIncomingEdges(nodeId)) {
            Object.assign(values, this.edgeValue(context, edge));
        }
        return values;
    }

    private edgeValue(context: ExecutionContext, edge: WorkflowEdge): Record<string, unknown> {
        const targetKey = edge.targetPortId ?? edge.sourcePortId;
        const sourceOutputs = context.getNodeOutputs(edge.sourceNodeId);
        if (targetKey) {
            const value = this.resolveSourcePortValue(context, edge, targetKey, sourceOutputs);
            return value === undefined ? {} : { [targetKey]: value };
        }
        return sourceOutputs;
    }

    private resolveSourcePortValue(
        context: ExecutionContext,
        edge: WorkflowEdge,
        targetKey: string,
        sourceOutputs: Record<string, unknown>,
    ): unknown {
        if (edge.sourcePortId) {
            const portValue = context.getPortOutput(edge.sourceNodeId, edge.sourcePortId);
            if (portValue !== undefined) return portValue;
            return sourceOutputs[edge.sourcePortId];
        }
        if (Object.prototype.hasOwnProperty.call(sourceOutputs, targetKey)) {
            return sourceOutputs[targetKey];
        }
        const entries = Object.entries(sourceOutputs);
        if (entries.length === 1) {
            return entries[0][1];
        }
        return entries.length > 0 ? sourceOutputs : undefined;
    }

    private declaredOutputKeys(value: unknown): string[] {
        const schema = this.asRecord(value);
        if (!schema) return [];
        const properties = this.asRecord(schema.properties);
        if (properties) return Object.keys(properties);
        if (schema.type === 'object') return [];
        return Object.entries(schema)
            .filter(([, field]) => Boolean(this.asRecord(field)))
            .map(([key]) => key);
    }

    private asRecord(value: unknown): Record<string, unknown> | undefined {
        return value && typeof value === 'object' && !Array.isArray(value)
            ? value as Record<string, unknown>
            : undefined;
    }
}

export class TemplateNodeExecutor extends BaseNodeExecutor {
    readonly type = WorkflowNodeType.Template;

    protected async doExecute(
        _context: ExecutionContext,
        node: WorkflowNode,
        inputs: Record<string, unknown>,
        _cancellationToken?: CancellationToken,
    ): Promise<NodeExecutorResult> {
        const data = this.asRecord(node.data) ?? {};
        const rendered = this.stringifyOutput(data.template ?? inputs.template ?? '');
        return { outputs: { output: rendered } };
    }

    private stringifyOutput(value: unknown): string {
        if (value === null || value === undefined) return '';
        if (typeof value === 'string') return value;
        return JSON.stringify(value);
    }

    private asRecord(value: unknown): Record<string, unknown> | undefined {
        return value && typeof value === 'object' && !Array.isArray(value)
            ? value as Record<string, unknown>
            : undefined;
    }
}

export class AnswerNodeExecutor extends BaseNodeExecutor {
    readonly type = WorkflowNodeType.Answer;

    protected async doExecute(
        _context: ExecutionContext,
        node: WorkflowNode,
        inputs: Record<string, unknown>,
        _cancellationToken?: CancellationToken,
    ): Promise<NodeExecutorResult> {
        const data = this.asRecord(node.data) ?? {};
        const answer = this.stringifyOutput(data.answer ?? inputs.answer ?? '');
        return { outputs: { answer } };
    }

    private stringifyOutput(value: unknown): string {
        if (value === null || value === undefined) return '';
        if (typeof value === 'string') return value;
        return JSON.stringify(value);
    }

    private asRecord(value: unknown): Record<string, unknown> | undefined {
        return value && typeof value === 'object' && !Array.isArray(value)
            ? value as Record<string, unknown>
            : undefined;
    }
}
