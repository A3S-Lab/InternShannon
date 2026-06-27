import { buildConditionEvalContext, evaluateConditionBranch, evaluateConditions } from '../condition-evaluator';
import { ConditionItem } from '../../../domain/value-objects';

describe('evaluateConditionBranch', () => {
    const ctx = buildConditionEvalContext({
        variables: { input: { score: 80, name: 'alice' } },
        nodeOutputs: { classify: { label: 'vip', count: 3 } },
    });

    it('routes to the first matching structured condition (numeric gt)', () => {
        const conditions: ConditionItem[] = [
            {
                type: 'structured',
                id: 'c1',
                key: 'c1',
                value: {
                    left: { type: 'expression', value: '${input.score}' },
                    operator: 'gt',
                    right: { type: 'static', value: 60 },
                },
                targetNodeId: 'pass',
            },
        ];
        expect(evaluateConditionBranch(conditions, 'fail', ctx)).toEqual({ branch: 'pass' });
    });

    it('falls through to the default branch when nothing matches', () => {
        const conditions: ConditionItem[] = [
            {
                type: 'structured',
                id: 'c1',
                key: 'c1',
                value: {
                    left: { type: 'expression', value: '${input.score}' },
                    operator: 'gt',
                    right: { type: 'static', value: 90 },
                },
                targetNodeId: 'pass',
            },
        ];
        expect(evaluateConditionBranch(conditions, 'fail', ctx)).toEqual({ branch: 'fail' });
    });

    it('returns no branch when nothing matches and there is no default', () => {
        const conditions: ConditionItem[] = [
            {
                type: 'structured',
                id: 'c1',
                key: 'c1',
                value: {
                    left: { type: 'expression', value: '${input.score}' },
                    operator: 'gt',
                    right: { type: 'static', value: 90 },
                },
                targetNodeId: 'pass',
            },
        ];
        expect(evaluateConditionBranch(conditions, undefined, ctx)).toEqual({});
    });

    it('reads upstream node outputs via nodes.<id>.output', () => {
        const conditions: ConditionItem[] = [
            {
                type: 'structured',
                id: 'c1',
                key: 'c1',
                value: {
                    left: { type: 'expression', value: '${nodes.classify.output.label}' },
                    operator: 'eq',
                    right: { type: 'static', value: 'vip' },
                },
                targetNodeId: 'vipBranch',
            },
        ];
        expect(evaluateConditionBranch(conditions, 'normal', ctx)).toEqual({ branch: 'vipBranch' });
    });

    it('evaluates an AND group (all must hold)', () => {
        const conditions: ConditionItem[] = [
            {
                type: 'group',
                id: 'g1',
                operator: 'AND',
                targetNodeId: 'both',
                conditions: [
                    {
                        type: 'structured',
                        id: 'a',
                        key: 'a',
                        value: { left: { type: 'expression', value: '${input.score}' }, operator: 'gte', right: { type: 'static', value: 80 } },
                        targetNodeId: 'both',
                    },
                    {
                        type: 'structured',
                        id: 'b',
                        key: 'b',
                        value: { left: { type: 'expression', value: '${nodes.classify.output.count}' }, operator: 'lt', right: { type: 'static', value: 5 } },
                        targetNodeId: 'both',
                    },
                ],
            },
        ];
        expect(evaluateConditionBranch(conditions, 'none', ctx)).toEqual({ branch: 'both' });
    });

    it('AND group fails when one member is false', () => {
        const conditions: ConditionItem[] = [
            {
                type: 'group',
                id: 'g1',
                operator: 'AND',
                targetNodeId: 'both',
                conditions: [
                    {
                        type: 'structured',
                        id: 'a',
                        key: 'a',
                        value: { left: { type: 'expression', value: '${input.score}' }, operator: 'gt', right: { type: 'static', value: 100 } },
                        targetNodeId: 'both',
                    },
                    {
                        type: 'structured',
                        id: 'b',
                        key: 'b',
                        value: { left: { type: 'expression', value: '${nodes.classify.output.count}' }, operator: 'lt', right: { type: 'static', value: 5 } },
                        targetNodeId: 'both',
                    },
                ],
            },
        ];
        expect(evaluateConditionBranch(conditions, 'none', ctx)).toEqual({ branch: 'none' });
    });
});

describe('evaluateConditions (predicate gate — loop break condition)', () => {
    // Loop break: stop when the current item's value reaches a threshold.
    const breakWhen = (threshold: number): ConditionItem[] => [
        {
            type: 'structured',
            id: 'brk',
            key: 'brk',
            value: { left: { type: 'expression', value: '${item.n}' }, operator: 'gte', right: { type: 'static', value: threshold } },
            targetNodeId: '',
        },
    ];

    it('returns true when a break condition holds for the iteration item', () => {
        const ctx = buildConditionEvalContext({ variables: { item: { n: 5 } }, nodeOutputs: {} });
        expect(evaluateConditions(breakWhen(5), ctx)).toBe(true);
    });

    it('returns false while the item is below the threshold (keep looping)', () => {
        const ctx = buildConditionEvalContext({ variables: { item: { n: 2 } }, nodeOutputs: {} });
        expect(evaluateConditions(breakWhen(5), ctx)).toBe(false);
    });

    it('returns false for empty / undefined conditions', () => {
        const ctx = buildConditionEvalContext({ variables: {}, nodeOutputs: {} });
        expect(evaluateConditions([], ctx)).toBe(false);
        expect(evaluateConditions(undefined, ctx)).toBe(false);
    });
});
