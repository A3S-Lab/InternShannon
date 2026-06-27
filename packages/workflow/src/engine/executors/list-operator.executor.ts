import { BaseNodeExecutor, NodeExecutorResult } from './base.executor';
import { ExecutionContext } from '../execution-context';
import { WorkflowNode, WorkflowNodeType } from '../../domain/value-objects';
import { CancellationToken } from '../cancellation-token';

export type ListOperationType = 'filter' | 'sort' | 'limit' | 'extract' | 'reverse' | 'unique' | 'at';

export interface ListOperation {
    type: ListOperationType;
    /** Object field to operate on (filter/sort/extract/unique). Omit for primitive items. */
    field?: string;
    /** filter operator. */
    operator?: 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'contains' | 'not_contains';
    /** filter comparand. */
    value?: unknown;
    /** sort direction (default asc). */
    order?: 'asc' | 'desc';
    /** limit count — positive keeps the first N, negative keeps the last N.
     *  Also the index for `at` (Dify "extract by serial number"): negative counts
     *  from the end; out-of-range yields an empty list. */
    count?: number;
}

function getField(item: unknown, field?: string): unknown {
    if (!field) {
        return item;
    }
    return item && typeof item === 'object' && !Array.isArray(item)
        ? (item as Record<string, unknown>)[field]
        : undefined;
}

function compareValues(a: unknown, b: unknown): number {
    if (typeof a === 'number' && typeof b === 'number') {
        return a - b;
    }
    const as = a === null || a === undefined ? '' : String(a);
    const bs = b === null || b === undefined ? '' : String(b);
    return as < bs ? -1 : as > bs ? 1 : 0;
}

function matchFilter(left: unknown, operator: ListOperation['operator'], right: unknown): boolean {
    switch (operator) {
        case 'neq':
            return left !== right;
        case 'gt':
            return compareValues(left, right) > 0;
        case 'gte':
            return compareValues(left, right) >= 0;
        case 'lt':
            return compareValues(left, right) < 0;
        case 'lte':
            return compareValues(left, right) <= 0;
        case 'contains':
            return typeof left === 'string' && typeof right === 'string'
                ? left.includes(right)
                : Array.isArray(left) && left.includes(right);
        case 'not_contains':
            return !(typeof left === 'string' && typeof right === 'string'
                ? left.includes(right)
                : Array.isArray(left) && left.includes(right));
        default:
            return left === right; // 'eq'
    }
}

function applyOne(list: unknown[], op: ListOperation): unknown[] {
    switch (op.type) {
        case 'filter':
            return list.filter(item => matchFilter(getField(item, op.field), op.operator, op.value));
        case 'sort': {
            const direction = op.order === 'desc' ? -1 : 1;
            return [...list].sort((a, b) => compareValues(getField(a, op.field), getField(b, op.field)) * direction);
        }
        case 'limit': {
            const count = typeof op.count === 'number' ? Math.trunc(op.count) : list.length;
            return count >= 0 ? list.slice(0, count) : list.slice(count);
        }
        case 'extract':
            return list.map(item => getField(item, op.field));
        case 'at': {
            // Dify "extract by serial number": keep only the item at index `count`
            // (negative counts from the end). Out of range → empty list.
            if (typeof op.count !== 'number') {
                return list;
            }
            const index = op.count < 0 ? list.length + op.count : op.count;
            return index >= 0 && index < list.length ? [list[index]] : [];
        }
        case 'reverse':
            return [...list].reverse();
        case 'unique': {
            const seen = new Set<string>();
            const out: unknown[] = [];
            for (const item of list) {
                const key = JSON.stringify(getField(item, op.field));
                if (!seen.has(key)) {
                    seen.add(key);
                    out.push(item);
                }
            }
            return out;
        }
        default:
            return list;
    }
}

/**
 * Apply a sequence of list operations (filter/sort/limit/extract/reverse/unique)
 * to an array. Pure + total, so the node's transform logic is unit-tested without
 * the engine. Each operation returns a new array; malformed ops are no-ops.
 */
export function applyListOperations(list: unknown[], operations: ListOperation[]): unknown[] {
    let result = Array.isArray(list) ? [...list] : [];
    for (const op of operations ?? []) {
        if (op && typeof op.type === 'string') {
            result = applyOne(result, op);
        }
    }
    return result;
}

interface ListOperatorNodeData {
    array?: unknown;
    operations?: ListOperation[];
}

/**
 * List-Operator node (Dify parity): filter / sort / limit / extract / reverse /
 * unique an array variable without dropping to a Code node. Reads the list from
 * `input.array` (or `input.list`), applies the configured operations in order, and
 * exposes the result plus first/last/length.
 */
export class ListOperatorNodeExecutor extends BaseNodeExecutor {
    readonly type = WorkflowNodeType.ListOperator;

    protected async doExecute(
        _context: ExecutionContext,
        node: WorkflowNode,
        inputs: Record<string, unknown>,
        _cancellationToken?: CancellationToken,
    ): Promise<NodeExecutorResult> {
        const data = (node.data ?? {}) as ListOperatorNodeData;
        const source = inputs.array ?? inputs.list ?? data.array;
        const list = Array.isArray(source) ? source : [];
        const operations = Array.isArray(data.operations) ? data.operations : [];
        const result = applyListOperations(list, operations);
        return {
            outputs: {
                result,
                first: result.length > 0 ? result[0] : null,
                last: result.length > 0 ? result[result.length - 1] : null,
                length: result.length,
            },
        };
    }
}
