import { BaseNodeExecutor, NodeExecutorResult } from './base.executor';
import { ExecutionContext } from '../execution-context';
import { WorkflowNode, WorkflowNodeType, FlowValue } from '../../domain/value-objects';
import { CancellationToken } from '../cancellation-token';

interface VariableAssignment {
    variable?: string;
    value?: unknown;
}

/**
 * Variable Assigner node (aligned with Dify): writes one or more conversation
 * variables (`conversation.*`) from configured sources, giving workflows a way
 * to carry mutable state across nodes / turns. Reads
 * `node.data.assignments = [{ variable, value }]`, where `value` is either a
 * FlowValue (resolved via the context) or a plain literal.
 */
export class VariableAssignerNodeExecutor extends BaseNodeExecutor {
    readonly type = WorkflowNodeType.VariableAssigner;

    protected async doExecute(
        context: ExecutionContext,
        node: WorkflowNode,
        _inputs: Record<string, unknown>,
        _cancellationToken?: CancellationToken,
    ): Promise<NodeExecutorResult> {
        const assignments = this.normalizeAssignments((node.data as { assignments?: unknown }).assignments);
        const assigned: Record<string, unknown> = {};
        for (const assignment of assignments) {
            const name = typeof assignment?.variable === 'string' ? assignment.variable.trim() : '';
            if (!name) continue;
            const resolved = this.resolveAssignmentValue(context, assignment?.value);
            context.setConversationVariable(name, resolved);
            assigned[name] = resolved;
        }
        return { outputs: { assigned } };
    }

    /**
     * Accept both shapes:
     *  - array  `[{ variable, value }]` (rich FlowValue sources)
     *  - record `{ name: valueOrTemplate }` (the simple designer map editor)
     */
    private normalizeAssignments(raw: unknown): VariableAssignment[] {
        if (Array.isArray(raw)) return raw as VariableAssignment[];
        if (raw !== null && typeof raw === 'object') {
            return Object.entries(raw as Record<string, unknown>).map(([variable, value]) => ({ variable, value }));
        }
        return [];
    }

    private resolveAssignmentValue(context: ExecutionContext, value: unknown): unknown {
        if (value !== null && typeof value === 'object' && 'type' in (value as Record<string, unknown>)) {
            return context.resolveFlowValue(value as FlowValue);
        }
        // A plain string carrying `${...}` is treated as an expression/template
        // so the simple map editor can reference other variables.
        if (typeof value === 'string' && value.includes('${')) {
            // Use the literal kind ('expression') rather than the FlowValueType enum
            // to avoid a barrel circular-import leaving the enum undefined at load.
            return context.resolveFlowValue({ type: 'expression', expression: value } as FlowValue);
        }
        return value;
    }
}
