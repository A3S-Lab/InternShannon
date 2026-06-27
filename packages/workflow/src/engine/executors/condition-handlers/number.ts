/**
 * Number condition handler - aligned with Flowgram.ai
 */

import { ConditionOperator, ParsedConditionValue, ConditionHandler } from '../condition.types';

function isNil(val: unknown): boolean {
    return val === null || val === undefined;
}

export const conditionNumberHandler: ConditionHandler = (condition: ParsedConditionValue): boolean => {
    const { operator } = condition;
    const leftValue = condition.leftValue as number;

    if (operator === ConditionOperator.EQ) {
        const rightValue = condition.rightValue as number;
        return leftValue === rightValue;
    }
    if (operator === ConditionOperator.NEQ) {
        const rightValue = condition.rightValue as number;
        return leftValue !== rightValue;
    }
    if (operator === ConditionOperator.GT) {
        const rightValue = condition.rightValue as number;
        return leftValue > rightValue;
    }
    if (operator === ConditionOperator.GTE) {
        const rightValue = condition.rightValue as number;
        return leftValue >= rightValue;
    }
    if (operator === ConditionOperator.LT) {
        const rightValue = condition.rightValue as number;
        return leftValue < rightValue;
    }
    if (operator === ConditionOperator.LTE) {
        const rightValue = condition.rightValue as number;
        return leftValue <= rightValue;
    }
    if (operator === ConditionOperator.IN) {
        const rightValue = condition.rightValue as number[];
        return Array.isArray(rightValue) && rightValue.includes(leftValue);
    }
    if (operator === ConditionOperator.NIN) {
        const rightValue = condition.rightValue as number[];
        return !Array.isArray(rightValue) || !rightValue.includes(leftValue);
    }
    if (operator === ConditionOperator.IS_EMPTY) {
        return isNil(leftValue);
    }
    if (operator === ConditionOperator.IS_NOT_EMPTY) {
        return !isNil(leftValue);
    }
    return false;
};
