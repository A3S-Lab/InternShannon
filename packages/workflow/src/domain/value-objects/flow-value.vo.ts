/**
 * Flow Value Types - for variable binding
 */
export enum FlowValueType {
    Static = 'static',
    Variable = 'variable',
    Expression = 'expression',
}

/**
 * Flow Value - represents a value that can be static or a variable reference
 */
export interface FlowValue {
    type: FlowValueType;
    value?: unknown;
    variableName?: string;
    expression?: string;
}

export const FlowValue = {
    /**
     * Create a static value
     */
    static: (value: unknown): FlowValue => ({
        type: FlowValueType.Static,
        value,
    }),

    /**
     * Create a variable reference
     */
    variable: (name: string): FlowValue => ({
        type: FlowValueType.Variable,
        variableName: name,
    }),

    /**
     * Create an expression value
     */
    expression: (expr: string): FlowValue => ({
        type: FlowValueType.Expression,
        expression: expr,
    }),
};

/**
 * Variable binding - connects source to target
 */
export interface VariableBinding {
    targetVariable: string;
    source: FlowValue;
}

/**
 * Input bindings for a node
 */
export interface InputBindings {
    [variableName: string]: FlowValue;
}
