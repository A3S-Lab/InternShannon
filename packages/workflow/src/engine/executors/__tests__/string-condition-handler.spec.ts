import { conditionArrayHandler } from '../condition-handlers/array';
import { conditionNumberHandler } from '../condition-handlers/number';
import { conditionStringHandler } from '../condition-handlers/string';
import { ConditionOperator, type ConditionHandler, type ParsedConditionValue } from '../condition.types';

const make = (handler: ConditionHandler) => (operator: ConditionOperator, leftValue: unknown, rightValue?: unknown) =>
    handler({ operator, leftValue, rightValue } as unknown as ParsedConditionValue);
const run = make(conditionStringHandler);

describe('conditionStringHandler — operator coverage + robustness', () => {
    it('starts_with / ends_with (Dify parity)', () => {
        expect(run(ConditionOperator.STARTS_WITH, 'hello world', 'hello')).toBe(true);
        expect(run(ConditionOperator.STARTS_WITH, 'hello world', 'world')).toBe(false);
        expect(run(ConditionOperator.ENDS_WITH, 'hello world', 'world')).toBe(true);
        expect(run(ConditionOperator.ENDS_WITH, 'hello world', 'hello')).toBe(false);
    });

    it('contains / not_contains still work', () => {
        expect(run(ConditionOperator.CONTAINS, 'abcdef', 'cd')).toBe(true);
        expect(run(ConditionOperator.NOT_CONTAINS, 'abcdef', 'zz')).toBe(true);
    });

    it('a null/undefined left value does not throw (was a crash) and yields sane results', () => {
        expect(run(ConditionOperator.CONTAINS, null, 'x')).toBe(false);
        expect(run(ConditionOperator.STARTS_WITH, undefined, 'x')).toBe(false);
        expect(run(ConditionOperator.ENDS_WITH, null, 'x')).toBe(false);
        // null contains nothing → "not contains" is true
        expect(run(ConditionOperator.NOT_CONTAINS, null, 'x')).toBe(true);
    });

    it('in / nin tolerate a non-array right value (was a crash)', () => {
        expect(run(ConditionOperator.IN, 'a', undefined)).toBe(false);
        expect(run(ConditionOperator.NIN, 'a', undefined)).toBe(true);
        expect(run(ConditionOperator.IN, 'a', ['a', 'b'])).toBe(true);
        expect(run(ConditionOperator.NIN, 'c', ['a', 'b'])).toBe(true);
    });
});

describe('conditionArrayHandler — contains robustness', () => {
    const arr = make(conditionArrayHandler);
    it('contains works and tolerates a missing/non-array left value (was a crash)', () => {
        expect(arr(ConditionOperator.CONTAINS, ['a', 'b'], 'a')).toBe(true);
        expect(arr(ConditionOperator.CONTAINS, ['a', 'b'], 'z')).toBe(false);
        expect(arr(ConditionOperator.CONTAINS, null, 'a')).toBe(false);
        expect(arr(ConditionOperator.NOT_CONTAINS, null, 'a')).toBe(true);
        expect(arr(ConditionOperator.IS_EMPTY, [], undefined)).toBe(true);
    });
});

describe('conditionNumberHandler — in/nin robustness', () => {
    const num = make(conditionNumberHandler);
    it('in/nin tolerate a non-array right value (was a crash)', () => {
        expect(num(ConditionOperator.IN, 2, [1, 2, 3])).toBe(true);
        expect(num(ConditionOperator.IN, 9, undefined)).toBe(false);
        expect(num(ConditionOperator.NIN, 9, undefined)).toBe(true);
        expect(num(ConditionOperator.GT, 5, 3)).toBe(true);
    });
});
