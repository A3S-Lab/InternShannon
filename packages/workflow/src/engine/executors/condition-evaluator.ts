import {
    ConditionGroup,
    ConditionItem,
    SimpleCondition,
    StructuredCondition,
} from '../../domain/value-objects';
import { expressionEvaluator } from '../expression-evaluator';
import { conditionHandlers } from './condition-handlers';
import { ConditionOperator, ConditionVariableType, ParsedConditionValue } from './condition.types';

/**
 * Pure condition-branch evaluator shared by the in-engine `ConditionNodeExecutor`
 * and the definition walker in `runtime-workflow-execution.service.ts` (the agent
 * fallback path). Keeping a single evaluator is what stops the two execution
 * engines from routing IF/ELSE differently — see the dual-engine convergence note
 * in the engine docs. All functions here are side-effect free.
 */

export interface ConditionEvalContextInput {
    variables: Record<string, unknown>;
    nodeOutputs: Record<string, Record<string, unknown>>;
    inputs?: Record<string, unknown>;
}

/**
 * Build the flat evaluation context both code paths feed into the evaluator, so
 * `${nodes.x.output.y}`, `${input.z}`, `${vars.w}` resolve identically whether the
 * condition ran inside the core engine or the definition walker. Mirrors the shape
 * `ConditionNodeExecutor.buildEvaluationContext` produces.
 */
export function buildConditionEvalContext(input: ConditionEvalContextInput): Record<string, unknown> {
    const variables = input.variables ?? {};
    const inputs = input.inputs ?? {};
    const nodes = Object.fromEntries(
        Object.entries(input.nodeOutputs ?? {}).map(([nodeId, output]) => [
            nodeId,
            { output, outputs: output, ...output },
        ]),
    );
    return {
        ...variables,
        ...nodes,
        ...inputs,
        input: variables.input ?? inputs,
        variables,
        vars: variables,
        nodes,
        nodeOutputs: input.nodeOutputs ?? {},
        workflow: { input: variables.input ?? inputs, variables },
    };
}

/**
 * Evaluate condition items in declared order against an already-built context.
 * Returns the first matching item's `targetNodeId`, else the default branch, else
 * `{}` (no branch taken). This is the single source of truth for branch routing.
 */
export function evaluateConditionBranch(
    conditions: ConditionItem[] | undefined,
    defaultNodeId: string | undefined,
    context: Record<string, unknown>,
): { branch?: string } {
    for (const item of conditions ?? []) {
        if (evaluateConditionItem(item, context)) {
            return { branch: item.targetNodeId };
        }
    }
    return defaultNodeId ? { branch: defaultNodeId } : {};
}

/**
 * True if ANY of the given conditions matches the context. Used where a condition
 * list is a predicate (a yes/no gate) rather than a branch router — e.g. a Loop
 * node's termination condition (Dify parity: break when a break-condition holds).
 */
export function evaluateConditions(
    conditions: ConditionItem[] | undefined,
    context: Record<string, unknown>,
): boolean {
    return (conditions ?? []).some((item) => evaluateConditionItem(item, context));
}

function isStructuredCondition(item: ConditionItem): item is StructuredCondition {
    return item.type === 'structured';
}

function isSimpleCondition(item: ConditionItem): item is SimpleCondition {
    return !item.type || item.type === 'simple';
}

function evaluateConditionItem(item: ConditionItem, context: Record<string, unknown>): boolean {
    if (item.type === 'group') {
        return evaluateConditionGroup(item, context);
    }
    if (isStructuredCondition(item)) {
        return evaluateStructuredCondition(item, context);
    }
    if (isSimpleCondition(item)) {
        return evaluateSimpleCondition(item, context);
    }
    return false;
}

function evaluateStructuredCondition(condition: StructuredCondition, context: Record<string, unknown>): boolean {
    const leftResolved = resolveFlowRefValue(condition.value.left, context);

    let rightResolved: unknown;
    let rightType: ConditionVariableType = ConditionVariableType.Null;
    if (condition.value.right) {
        rightResolved = resolveFlowConstantValue(condition.value.right, context);
        rightType = inferVariableType(rightResolved);
    }

    const leftType = inferVariableType(leftResolved);
    const operator = parseOperator(condition.value.operator);

    const parsedCondition: ParsedConditionValue = {
        key: condition.key,
        leftValue: leftResolved,
        leftType,
        rightValue: rightResolved,
        rightType,
        operator,
        targetNodeId: condition.targetNodeId,
    };

    const handler = conditionHandlers[leftType];
    if (handler) {
        return handler(parsedCondition);
    }
    return false;
}

function parseOperator(operatorStr: string): ConditionOperator {
    const operatorMap: Record<string, ConditionOperator> = {
        eq: ConditionOperator.EQ,
        neq: ConditionOperator.NEQ,
        gt: ConditionOperator.GT,
        gte: ConditionOperator.GTE,
        lt: ConditionOperator.LT,
        lte: ConditionOperator.LTE,
        contains: ConditionOperator.CONTAINS,
        not_contains: ConditionOperator.NOT_CONTAINS,
        starts_with: ConditionOperator.STARTS_WITH,
        ends_with: ConditionOperator.ENDS_WITH,
        in: ConditionOperator.IN,
        nin: ConditionOperator.NIN,
        is_empty: ConditionOperator.IS_EMPTY,
        is_not_empty: ConditionOperator.IS_NOT_EMPTY,
        is_true: ConditionOperator.IS_TRUE,
        is_false: ConditionOperator.IS_FALSE,
    };
    return operatorMap[operatorStr.toLowerCase()] || ConditionOperator.EQ;
}

function inferVariableType(value: unknown): ConditionVariableType {
    if (value === null || value === undefined) {
        return ConditionVariableType.Null;
    }
    if (Array.isArray(value)) {
        return ConditionVariableType.Array;
    }
    if (typeof value === 'boolean') {
        return ConditionVariableType.Boolean;
    }
    if (typeof value === 'number') {
        return Number.isInteger(value) ? ConditionVariableType.Integer : ConditionVariableType.Number;
    }
    if (value instanceof Date) {
        return ConditionVariableType.DateTime;
    }
    if (typeof value === 'object') {
        return ConditionVariableType.Object;
    }
    return ConditionVariableType.String;
}

function resolveFlowRefValue(
    ref: { type: 'variable' | 'expression'; value: string },
    context: Record<string, unknown>,
): unknown {
    if (ref.type === 'variable') {
        return resolvePath(normalizeExpression(ref.value), context);
    }
    try {
        return resolveExpression(ref.value, context);
    } catch {
        return undefined;
    }
}

function resolveFlowConstantValue(
    constant: { type: 'static' | 'variable' | 'expression'; value: unknown },
    context: Record<string, unknown>,
): unknown {
    switch (constant.type) {
        case 'static':
            return constant.value;
        case 'variable':
            return resolvePath(normalizeExpression(constant.value as string), context);
        case 'expression':
            try {
                return resolveExpression(constant.value as string, context);
            } catch {
                return undefined;
            }
        default:
            return constant.value;
    }
}

function evaluateConditionGroup(group: ConditionGroup, context: Record<string, unknown>): boolean {
    if (group.operator === 'AND') {
        return group.conditions.every((cond) => evaluateConditionItem(cond, context));
    }
    return group.conditions.some((cond) => evaluateConditionItem(cond, context));
}

function evaluateSimpleCondition(condition: SimpleCondition, context: Record<string, unknown>): boolean {
    return evaluateExpressionCondition(condition.expression, context);
}

function evaluateExpressionCondition(expression: string, context: Record<string, unknown>): boolean {
    if (expression.includes('{{') || expression.includes('}}')) {
        return false;
    }
    let processedExpr = expression;
    const matches = [...expression.matchAll(/\$\{\s*([^}]+?)\s*\}/g)];
    if (matches) {
        for (const match of matches) {
            const path = normalizeExpression(match[1] ?? '');
            const value = resolvePath(path, context);
            if (typeof value === 'string') {
                processedExpr = processedExpr.replace(match[0], `"${value.replace(/"/g, '\\"')}"`);
            } else if (value === null || value === undefined) {
                processedExpr = processedExpr.replace(match[0], 'null');
            } else {
                processedExpr = processedExpr.replace(match[0], String(value));
            }
        }
    }

    try {
        const result = resolveExpression(processedExpr, context);
        return Boolean(result);
    } catch {
        return false;
    }
}

function resolvePath(path: string, context: Record<string, unknown>): unknown {
    return expressionEvaluator.resolvePath(path, context);
}

function resolveExpression(expression: string, context: Record<string, unknown>): unknown {
    const normalized = normalizeExpression(expression);
    const pathValue = expressionEvaluator.resolvePath(normalized, context);
    return pathValue !== undefined ? pathValue : expressionEvaluator.evaluate(normalized, context);
}

function normalizeExpression(expression: string): string {
    const trimmed = expression.trim();
    const template = trimmed.match(/^\$\{\s*([^}]+?)\s*\}$/);
    const value = template ? template[1].trim() : trimmed;
    return value.startsWith('$.') ? value.slice(2) : value;
}
