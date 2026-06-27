/**
 * Boolean condition handler - aligned with Flowgram.ai
 */

import { ConditionOperator, ParsedConditionValue, ConditionHandler } from '../condition.types';

function isNil(val: unknown): boolean {
    return val === null || val === undefined;
}

export const conditionBooleanHandler: ConditionHandler = (condition: ParsedConditionValue): boolean => {
    const { operator } = condition;
    const leftValue = condition.leftValue as boolean;

    if (operator === ConditionOperator.EQ) {
        const rightValue = condition.rightValue as boolean;
        return leftValue === rightValue;
    }
    if (operator === ConditionOperator.NEQ) {
        const rightValue = condition.rightValue as boolean;
        return leftValue !== rightValue;
    }
    if (operator === ConditionOperator.IS_TRUE) {
        return leftValue === true;
    }
    if (operator === ConditionOperator.IS_FALSE) {
        return leftValue === false;
    }
    if (operator === ConditionOperator.IN) {
        const rightValue = condition.rightValue as boolean[];
        return rightValue.includes(leftValue);
    }
    if (operator === ConditionOperator.NIN) {
        const rightValue = condition.rightValue as boolean[];
        return !rightValue.includes(leftValue);
    }
    if (operator === ConditionOperator.IS_EMPTY) {
        return isNil(leftValue);
    }
    if (operator === ConditionOperator.IS_NOT_EMPTY) {
        return !isNil(leftValue);
    }
    return false;
};
