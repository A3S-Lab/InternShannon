/**
 * Array condition handler - aligned with Flowgram.ai
 */

import { ConditionOperator, ParsedConditionValue, ConditionHandler } from '../condition.types';

function isNil(val: unknown): boolean {
    return val === null || val === undefined;
}

export const conditionArrayHandler: ConditionHandler = (condition: ParsedConditionValue): boolean => {
    const { operator } = condition;
    const leftValue = condition.leftValue as unknown[];

    if (operator === ConditionOperator.IS_EMPTY) {
        return isNil(leftValue) || leftValue.length === 0;
    }
    if (operator === ConditionOperator.IS_NOT_EMPTY) {
        return !isNil(leftValue) && leftValue.length > 0;
    }
    // A missing / non-array left value contains nothing — guard so .includes can't
    // throw and crash the whole run.
    if (operator === ConditionOperator.CONTAINS) {
        return Array.isArray(leftValue) && leftValue.includes(condition.rightValue);
    }
    if (operator === ConditionOperator.NOT_CONTAINS) {
        return !Array.isArray(leftValue) || !leftValue.includes(condition.rightValue);
    }
    return false;
};
