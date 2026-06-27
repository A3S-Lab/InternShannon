/**
 * Null condition handler - aligned with Flowgram.ai
 */

import { ConditionOperator, ParsedConditionValue, ConditionHandler } from '../condition.types';

function isNil(val: unknown): boolean {
    return val === null || val === undefined;
}

export const conditionNullHandler: ConditionHandler = (condition: ParsedConditionValue): boolean => {
    const { operator } = condition;

    if (operator === ConditionOperator.EQ) {
        return isNil(condition.leftValue);
    }
    if (operator === ConditionOperator.IS_EMPTY) {
        return isNil(condition.leftValue);
    }
    if (operator === ConditionOperator.IS_NOT_EMPTY) {
        return !isNil(condition.leftValue);
    }
    return false;
};
