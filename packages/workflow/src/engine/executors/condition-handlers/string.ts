/**
 * String condition handler - aligned with Flowgram.ai
 */

import { ConditionOperator, ParsedConditionValue, ConditionHandler } from '../condition.types';

function isNil(val: unknown): boolean {
    return val === null || val === undefined;
}

export const conditionStringHandler: ConditionHandler = (condition: ParsedConditionValue): boolean => {
    const { operator } = condition;
    const leftValue = condition.leftValue as string;

    if (operator === ConditionOperator.EQ) {
        const rightValue = condition.rightValue as string;
        return leftValue === rightValue;
    }
    if (operator === ConditionOperator.NEQ) {
        const rightValue = condition.rightValue as string;
        return leftValue !== rightValue;
    }
    if (operator === ConditionOperator.IS_EMPTY) {
        return isNil(leftValue);
    }
    if (operator === ConditionOperator.IS_NOT_EMPTY) {
        return !isNil(leftValue);
    }
    if (operator === ConditionOperator.IN) {
        const rightValue = condition.rightValue as string[];
        return Array.isArray(rightValue) && rightValue.includes(leftValue);
    }
    if (operator === ConditionOperator.NIN) {
        const rightValue = condition.rightValue as string[];
        return !Array.isArray(rightValue) || !rightValue.includes(leftValue);
    }
    // Substring / affix operators (contains / not_contains / starts_with / ends_with).
    // A null/undefined left value can't contain or start/end with anything — and
    // calling .includes/.startsWith on it would throw and crash the whole run — so
    // treat missing-left as "no match" (only NOT_CONTAINS inverts to true).
    const rightValue = condition.rightValue as string;
    if (isNil(leftValue)) {
        return operator === ConditionOperator.NOT_CONTAINS;
    }
    if (operator === ConditionOperator.CONTAINS) {
        return leftValue.includes(rightValue);
    }
    if (operator === ConditionOperator.NOT_CONTAINS) {
        return !leftValue.includes(rightValue);
    }
    if (operator === ConditionOperator.STARTS_WITH) {
        return leftValue.startsWith(rightValue);
    }
    if (operator === ConditionOperator.ENDS_WITH) {
        return leftValue.endsWith(rightValue);
    }
    return false;
};
