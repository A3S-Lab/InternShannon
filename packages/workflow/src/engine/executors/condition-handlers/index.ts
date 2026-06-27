/**
 * Condition handlers index - aligned with Flowgram.ai
 */

export { conditionStringHandler } from './string';
export { conditionNumberHandler } from './number';
export { conditionBooleanHandler } from './boolean';
export { conditionNullHandler } from './null';
export { conditionObjectHandler } from './object';
export { conditionArrayHandler } from './array';
export { conditionDateTimeHandler } from './datetime';

import { conditionStringHandler } from './string';
import { conditionNumberHandler } from './number';
import { conditionBooleanHandler } from './boolean';
import { conditionNullHandler } from './null';
import { conditionObjectHandler } from './object';
import { conditionArrayHandler } from './array';
import { conditionDateTimeHandler } from './datetime';
import { ConditionHandler, ConditionVariableType } from '../condition.types';

/**
 * Handler map by variable type
 */
export const conditionHandlers: Record<ConditionVariableType, ConditionHandler> = {
    [ConditionVariableType.String]: conditionStringHandler,
    [ConditionVariableType.Number]: conditionNumberHandler,
    [ConditionVariableType.Integer]: conditionNumberHandler,
    [ConditionVariableType.Boolean]: conditionBooleanHandler,
    [ConditionVariableType.Object]: conditionObjectHandler,
    [ConditionVariableType.Array]: conditionArrayHandler,
    [ConditionVariableType.DateTime]: conditionDateTimeHandler,
    [ConditionVariableType.Null]: conditionNullHandler,
};
