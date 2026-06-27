/**
 * 纯领域校验错误 —— domain 层禁止依赖 NestJS(BusinessException 继承 HttpException 会传染框架),
 * 值对象/实体的不变量校验抛本错误;GlobalErrorFilter 统一映射为 VALIDATION_ERROR 400,
 * 线上响应契约与原 BusinessException 路径完全一致。
 */
export class DomainValidationError extends Error {
    public readonly details?: Record<string, unknown>;

    constructor(message: string, details?: Record<string, unknown>) {
        super(message);
        this.name = 'DomainValidationError';
        this.details = details;
    }
}
