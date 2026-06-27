// ============================================================================
// Business Exception - Base exception for business logic errors
// ============================================================================

import { HttpException, HttpStatus } from '@nestjs/common';
import { StatusCode, StatusCodeHttpStatus, containsChineseText, getStatusMessage, normalizePublicErrorMessage } from './error-codes';

export interface BusinessExceptionOptions {
    code: StatusCode;
    message: string;
    details?: Record<string, unknown>;
    httpStatus?: HttpStatus;
}

export class BusinessException extends HttpException {
    public readonly code: StatusCode;
    public readonly details?: Record<string, unknown>;

    constructor(options: BusinessExceptionOptions) {
        const httpStatus = options.httpStatus || StatusCodeHttpStatus[options.code] || 400;
        const message = normalizePublicErrorMessage(options.message, options.code);

        super(
            {
                status: options.code,
                message,
                details: options.details,
            },
            httpStatus,
        );

        this.code = options.code;
        this.details = options.details;
    }

    getResponse(): Record<string, unknown> {
        return {
            status: this.code,
            message: this.message,
            details: this.details,
        };
    }
}

// ============================================================================
// Common Business Exceptions
// ============================================================================

export class ValidationException extends BusinessException {
    constructor(message: string, details?: Record<string, unknown>) {
        super({
            code: StatusCode.VALIDATION_ERROR,
            message,
            details,
        });
    }
}

export class NotFoundException extends BusinessException {
    constructor(resource = '请求的资源', identifier?: string | number) {
        const message = identifier !== undefined
            ? formatResourceMessage(resource, '不存在')
            : normalizePublicErrorMessage(resource, StatusCode.RESOURCE_NOT_FOUND);

        super({
            code: StatusCode.RESOURCE_NOT_FOUND,
            message,
            httpStatus: HttpStatus.NOT_FOUND,
        });
    }
}

export class DuplicateEntryException extends BusinessException {
    constructor(resource: string, _field: string, _value: string) {
        super({
            code: StatusCode.DUPLICATE_ENTRY,
            message: containsChineseText(resource)
                ? `${resource}已存在`
                : getStatusMessage(StatusCode.DUPLICATE_ENTRY),
            httpStatus: HttpStatus.CONFLICT,
        });
    }
}

export class ForbiddenException extends BusinessException {
    constructor(message = '您没有权限执行此操作') {
        super({
            code: StatusCode.PERMISSION_DENIED,
            message,
            httpStatus: HttpStatus.FORBIDDEN,
        });
    }
}

export class UnauthorizedException extends BusinessException {
    constructor(message = '请先登录后再继续操作') {
        super({
            code: StatusCode.UNAUTHORIZED,
            message,
            httpStatus: HttpStatus.UNAUTHORIZED,
        });
    }
}

export class OperationFailedException extends BusinessException {
    constructor(operation: string, reason?: string) {
        super({
            code: StatusCode.OPERATION_FAILED,
            message: containsChineseText(operation)
                ? `${operation}失败${reason && containsChineseText(reason) ? `：${reason}` : ''}`
                : getStatusMessage(StatusCode.OPERATION_FAILED),
        });
    }
}

export class DevModeOnlyException extends BusinessException {
    constructor(message = '该接口仅在开发模式下可用') {
        super({
            code: StatusCode.DEV_MODE_ONLY,
            message,
            httpStatus: HttpStatus.FORBIDDEN,
        });
    }
}

export class BadRequestException extends BusinessException {
    constructor(message: string, details?: Record<string, unknown>) {
        super({
            code: StatusCode.BAD_REQUEST,
            message,
            details,
        });
    }
}

export class ConflictException extends BusinessException {
    constructor(message: string, details?: Record<string, unknown>) {
        super({
            code: StatusCode.CONFLICT,
            message,
            details,
        });
    }
}

function formatResourceMessage(resource: string, suffix: string): string {
    if (!containsChineseText(resource)) {
        return getStatusMessage(StatusCode.RESOURCE_NOT_FOUND);
    }

    return resource.endsWith(suffix) ? resource : `${resource}${suffix}`;
}
