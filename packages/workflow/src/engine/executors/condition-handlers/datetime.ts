/**
 * DateTime condition handler - aligned with Flowgram.ai
 */

import { ConditionOperator, ParsedConditionValue, ConditionHandler } from '../condition.types';

function isNil(val: unknown): boolean {
    return val === null || val === undefined;
}

export const conditionDateTimeHandler: ConditionHandler = (condition: ParsedConditionValue): boolean => {
    const { operator } = condition;
    const leftValue = condition.leftValue as string | Date;
    const leftDate = typeof leftValue === 'string' ? new Date(leftValue) : leftValue;

    if (isNaN(leftDate.getTime())) {
        return operator === ConditionOperator.IS_EMPTY;
    }

    if (operator === ConditionOperator.EQ) {
        const rightValue = condition.rightValue as string | Date;
        const rightDate = typeof rightValue === 'string' ? new Date(rightValue) : rightValue;
        return leftDate.getTime() === rightDate.getTime();
    }
    if (operator === ConditionOperator.NEQ) {
        const rightValue = condition.rightValue as string | Date;
        const rightDate = typeof rightValue === 'string' ? new Date(rightValue) : rightValue;
        return leftDate.getTime() !== rightDate.getTime();
    }
    if (operator === ConditionOperator.GT) {
        const rightValue = condition.rightValue as string | Date;
        const rightDate = typeof rightValue === 'string' ? new Date(rightValue) : rightValue;
        return leftDate.getTime() > rightDate.getTime();
    }
    if (operator === ConditionOperator.GTE) {
        const rightValue = condition.rightValue as string | Date;
        const rightDate = typeof rightValue === 'string' ? new Date(rightValue) : rightValue;
        return leftDate.getTime() >= rightDate.getTime();
    }
    if (operator === ConditionOperator.LT) {
        const rightValue = condition.rightValue as string | Date;
        const rightDate = typeof rightValue === 'string' ? new Date(rightValue) : rightValue;
        return leftDate.getTime() < rightDate.getTime();
    }
    if (operator === ConditionOperator.LTE) {
        const rightValue = condition.rightValue as string | Date;
        const rightDate = typeof rightValue === 'string' ? new Date(rightValue) : rightValue;
        return leftDate.getTime() <= rightDate.getTime();
    }
    if (operator === ConditionOperator.IS_EMPTY) {
        return isNil(leftValue) || isNaN(leftDate.getTime());
    }
    if (operator === ConditionOperator.IS_NOT_EMPTY) {
        return !isNil(leftValue) && !isNaN(leftDate.getTime());
    }
    return false;
};
