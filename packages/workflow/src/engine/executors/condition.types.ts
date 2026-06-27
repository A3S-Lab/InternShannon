/**
 * Condition Operators - aligned with Flowgram.ai
 */
export enum ConditionOperator {
    EQ = 'eq',
    NEQ = 'neq',
    GT = 'gt',
    GTE = 'gte',
    LT = 'lt',
    LTE = 'lte',
    CONTAINS = 'contains',
    NOT_CONTAINS = 'not_contains',
    STARTS_WITH = 'starts_with',
    ENDS_WITH = 'ends_with',
    IN = 'in',
    NIN = 'nin',
    IS_EMPTY = 'is_empty',
    IS_NOT_EMPTY = 'is_not_empty',
    IS_TRUE = 'is_true',
    IS_FALSE = 'is_false',
}

/**
 * Workflow Variable Types for conditions
 */
export enum ConditionVariableType {
    String = 'string',
    Number = 'number',
    Integer = 'integer',
    Boolean = 'boolean',
    Object = 'object',
    Array = 'array',
    DateTime = 'datetime',
    Null = 'null',
}

/**
 * Condition Item - structured condition aligned with Flowgram.ai
 */
export interface ConditionItem {
    key: string;
    value: {
        left: FlowRefValue;
        operator: ConditionOperator;
        right?: FlowConstantValue;
    };
    targetNodeId: string;
}

/**
 * Flow reference value for left side of condition
 */
export interface FlowRefValue {
    type: 'variable' | 'expression';
    value: string; // variable name or expression
}

/**
 * Flow constant value for right side of condition
 */
export interface FlowConstantValue {
    type: 'static' | 'variable' | 'expression';
    value: unknown;
}

/**
 * Parsed condition value with resolved types and values
 */
export interface ParsedConditionValue {
    key: string;
    leftValue: unknown;
    leftType: ConditionVariableType;
    rightValue: unknown;
    rightType: ConditionVariableType;
    operator: ConditionOperator;
    targetNodeId: string;
}

/**
 * Condition handler function type
 */
export type ConditionHandler = (condition: ParsedConditionValue) => boolean;

/**
 * Condition handlers for different variable types
 */
export interface ConditionHandlers {
    [type: string]: ConditionHandler;
}
