// ============================================================================
// Validation Pipe - Global validation configuration
// ============================================================================

import { BadRequestException, ValidationPipe, ValidationPipeOptions } from '@nestjs/common';
import { ValidationError, ValidatorOptions } from 'class-validator';
import { StatusCode, getStatusMessage } from '../../common/errors/error-codes';

/**
 * class-validator 约束名 → 中文描述。DTO 装饰器未写自定义 message 时,class-validator 默认吐英文
 * (如 "email should not be empty");这里按约束名统一映射成中文,前端 fieldErrors 即显示中文。
 * 未覆盖的约束回退到库的英文原文(不丢信息)。字段名由 fieldErrors.field 单独承载,故此处只描述约束。
 */
const ZH_CONSTRAINT_MESSAGES: Record<string, string> = {
    isDefined: '不能为空',
    isNotEmpty: '不能为空',
    isString: '必须是字符串',
    isNumber: '必须是数字',
    isInt: '必须是整数',
    isBoolean: '必须是布尔值',
    isArray: '必须是数组',
    isObject: '必须是对象',
    isEmail: '必须是有效的邮箱地址',
    isUrl: '必须是有效的链接',
    isUUID: '必须是有效的 UUID',
    isEnum: '取值不在允许范围内',
    isDateString: '必须是有效的日期',
    isPositive: '必须是正数',
    matches: '格式不正确',
    minLength: '长度不足',
    maxLength: '超出长度限制',
    min: '小于允许的最小值',
    max: '超过允许的最大值',
    arrayNotEmpty: '至少需要一项',
    arrayMinSize: '数量低于下限',
    arrayMaxSize: '数量超过上限',
};

/**
 * Default validator options for class-validator
 */
export const DEFAULT_VALIDATOR_OPTIONS: ValidatorOptions = {
    whitelist: true,
    forbidNonWhitelisted: true,
    forbidUnknownValues: true,
};

/**
 * Default transform options
 */
export const DEFAULT_TRANSFORM_OPTIONS = {
    enableImplicitConversion: true,
};

/**
 * One field's validation failure. `messages` carries every failed
 * constraint message for that field so the frontend can render them verbatim.
 */
export interface FieldValidationError {
    field: string;
    messages: string[];
}

/**
 * Transform NestJS ValidationError into the stable `fieldErrors` shape consumed
 * by the unified error contract. Nested DTOs (@ValidateNested) are flattened to
 * dotted paths, e.g. `modalities.input`.
 */
export function formatValidationErrors(
    errors: ValidationError[],
    parentProperty = '',
): FieldValidationError[] {
    const formatted: FieldValidationError[] = [];

    for (const error of errors) {
        const field = parentProperty ? `${parentProperty}.${error.property}` : error.property;

        if (error.constraints) {
            formatted.push({
                field,
                // 约束名映射中文;未覆盖的回退英文原文。
                messages: Object.entries(error.constraints).map(([key, fallback]) => ZH_CONSTRAINT_MESSAGES[key] ?? fallback),
            });
        }

        if (error.children && error.children.length > 0) {
            formatted.push(...formatValidationErrors(error.children, field));
        }
    }

    return formatted;
}

/**
 * Create a ValidationPipe with standardized configuration
 */
export function createValidationPipe(options: ValidationPipeOptions = {}): ValidationPipe {
    return new ValidationPipe({
        ...options,
        transform: true,
        transformOptions: DEFAULT_TRANSFORM_OPTIONS,
        exceptionFactory: (errors: ValidationError[]) => {
            const fieldErrors = formatValidationErrors(errors);
            return new BadRequestException({
                status: StatusCode.VALIDATION_ERROR,
                message: getStatusMessage(StatusCode.VALIDATION_ERROR),
                // GlobalErrorFilter lifts this into `details.fieldErrors`.
                fieldErrors,
            });
        },
    });
}

/**
 * Default global validation pipe instance
 */
export const globalValidationPipe = createValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
});

/**
 * Strict validation pipe (for DTOs that must be exact)
 */
export const strictValidationPipe = createValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    skipMissingProperties: false,
});

/**
 * Partial validation pipe (for optional/update DTOs)
 */
export const partialValidationPipe = createValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: false,
    skipMissingProperties: true,
});
