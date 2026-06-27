/**
 * Condition Rules - defines valid operators for each variable type
 * Aligned with Flowgram.ai's condition rules
 */

import { ConditionOperator, ConditionVariableType } from './condition.types';

type OperatorRules = Record<ConditionOperator, ConditionVariableType | null>;

export const conditionRules: Record<ConditionVariableType, Partial<OperatorRules>> = {
    [ConditionVariableType.String]: {
        [ConditionOperator.EQ]: ConditionVariableType.String,
        [ConditionOperator.NEQ]: ConditionVariableType.String,
        [ConditionOperator.CONTAINS]: ConditionVariableType.String,
        [ConditionOperator.NOT_CONTAINS]: ConditionVariableType.String,
        [ConditionOperator.STARTS_WITH]: ConditionVariableType.String,
        [ConditionOperator.ENDS_WITH]: ConditionVariableType.String,
        [ConditionOperator.IN]: ConditionVariableType.Array,
        [ConditionOperator.NIN]: ConditionVariableType.Array,
        [ConditionOperator.IS_EMPTY]: ConditionVariableType.Null,
        [ConditionOperator.IS_NOT_EMPTY]: ConditionVariableType.Null,
    },
    [ConditionVariableType.Number]: {
        [ConditionOperator.EQ]: ConditionVariableType.Number,
        [ConditionOperator.NEQ]: ConditionVariableType.Number,
        [ConditionOperator.GT]: ConditionVariableType.Number,
        [ConditionOperator.GTE]: ConditionVariableType.Number,
        [ConditionOperator.LT]: ConditionVariableType.Number,
        [ConditionOperator.LTE]: ConditionVariableType.Number,
        [ConditionOperator.IN]: ConditionVariableType.Array,
        [ConditionOperator.NIN]: ConditionVariableType.Array,
        [ConditionOperator.IS_EMPTY]: ConditionVariableType.Null,
        [ConditionOperator.IS_NOT_EMPTY]: ConditionVariableType.Null,
    },
    [ConditionVariableType.Integer]: {
        [ConditionOperator.EQ]: ConditionVariableType.Integer,
        [ConditionOperator.NEQ]: ConditionVariableType.Integer,
        [ConditionOperator.GT]: ConditionVariableType.Integer,
        [ConditionOperator.GTE]: ConditionVariableType.Integer,
        [ConditionOperator.LT]: ConditionVariableType.Integer,
        [ConditionOperator.LTE]: ConditionVariableType.Integer,
        [ConditionOperator.IN]: ConditionVariableType.Array,
        [ConditionOperator.NIN]: ConditionVariableType.Array,
        [ConditionOperator.IS_EMPTY]: ConditionVariableType.Null,
        [ConditionOperator.IS_NOT_EMPTY]: ConditionVariableType.Null,
    },
    [ConditionVariableType.Boolean]: {
        [ConditionOperator.EQ]: ConditionVariableType.Boolean,
        [ConditionOperator.NEQ]: ConditionVariableType.Boolean,
        [ConditionOperator.IS_TRUE]: ConditionVariableType.Null,
        [ConditionOperator.IS_FALSE]: ConditionVariableType.Null,
        [ConditionOperator.IN]: ConditionVariableType.Array,
        [ConditionOperator.NIN]: ConditionVariableType.Array,
        [ConditionOperator.IS_EMPTY]: ConditionVariableType.Null,
        [ConditionOperator.IS_NOT_EMPTY]: ConditionVariableType.Null,
    },
    [ConditionVariableType.Object]: {
        [ConditionOperator.IS_EMPTY]: ConditionVariableType.Null,
        [ConditionOperator.IS_NOT_EMPTY]: ConditionVariableType.Null,
    },
    [ConditionVariableType.Array]: {
        [ConditionOperator.IS_EMPTY]: ConditionVariableType.Null,
        [ConditionOperator.IS_NOT_EMPTY]: ConditionVariableType.Null,
        [ConditionOperator.CONTAINS]: ConditionVariableType.String,
    },
    [ConditionVariableType.DateTime]: {
        [ConditionOperator.EQ]: ConditionVariableType.DateTime,
        [ConditionOperator.NEQ]: ConditionVariableType.DateTime,
        [ConditionOperator.GT]: ConditionVariableType.DateTime,
        [ConditionOperator.GTE]: ConditionVariableType.DateTime,
        [ConditionOperator.LT]: ConditionVariableType.DateTime,
        [ConditionOperator.LTE]: ConditionVariableType.DateTime,
        [ConditionOperator.IS_EMPTY]: ConditionVariableType.Null,
        [ConditionOperator.IS_NOT_EMPTY]: ConditionVariableType.Null,
    },
    [ConditionVariableType.Null]: {
        [ConditionOperator.EQ]: ConditionVariableType.Null,
        [ConditionOperator.IS_EMPTY]: ConditionVariableType.Null,
        [ConditionOperator.IS_NOT_EMPTY]: ConditionVariableType.Null,
    },
};

/**
 * Check if an operator is valid for a given variable type
 */
export function isOperatorValidForType(
    type: ConditionVariableType,
    operator: ConditionOperator
): boolean {
    const rules = conditionRules[type];
    if (!rules) return false;
    return rules[operator] !== undefined;
}

/**
 * Get the expected right type for an operator on a given type
 */
export function getExpectedRightType(
    type: ConditionVariableType,
    operator: ConditionOperator
): ConditionVariableType | null {
    const rules = conditionRules[type];
    if (!rules) return null;
    return rules[operator] ?? null;
}
