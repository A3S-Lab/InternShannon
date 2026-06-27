// ============================================================================
// Global Error Filter - Handle all exceptions and format error responses
// ============================================================================

import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import { Request, Response } from 'express';
import { DomainValidationError } from '../../domain/domain-error';
import { attachRequestIdHeader, getOrCreateRequestId } from '../http';
import { BusinessException } from './business.exception';
import { StatusCode, StatusCodeHttpStatus, getStatusMessage, normalizePublicErrorMessage } from './error-codes';

interface ErrorResponse {
    code: number;
    status: StatusCode;
    message: string;
    details?: Record<string, unknown>;
    requestId?: string;
    timestamp: string;
}

@Catch()
export class GlobalErrorFilter implements ExceptionFilter {
    private readonly logger = new Logger(GlobalErrorFilter.name);

    catch(exception: unknown, host: ArgumentsHost): void {
        const ctx = host.switchToHttp();
        const response = ctx.getResponse<Response>();
        const request = ctx.getRequest<Request>();

        const requestId = getOrCreateRequestId(request);
        attachRequestIdHeader(response, requestId);

        let errorResponse: ErrorResponse;

        // 纯领域校验错误(domain 层不依赖 NestJS)→ 与 BusinessException(VALIDATION_ERROR) 同契约的 400。
        if (exception instanceof DomainValidationError) {
            exception = new BusinessException({
                code: StatusCode.VALIDATION_ERROR,
                message: exception.message,
                details: exception.details,
            });
        }

        if (exception instanceof BusinessException) {
            const status = StatusCodeHttpStatus[exception.code] ?? 500;
            errorResponse = {
                code: status,
                status: exception.code,
                message: normalizePublicErrorMessage(exception.message, exception.code),
                details: exception.details,
                requestId,
                timestamp: new Date().toISOString(),
            };

            this.logger.warn(`[${errorResponse.code}] ${errorResponse.message}`, {
                requestId,
                path: request.url,
                method: request.method,
            });
        } else if (exception instanceof HttpException) {
            const status = exception.getStatus();
            const exceptionResponse = exception.getResponse();

            let code: StatusCode;
            if (
                typeof exceptionResponse === 'object' &&
                exceptionResponse !== null &&
                (exceptionResponse as Record<string, unknown>).status
            ) {
                code = (exceptionResponse as Record<string, unknown>).status as StatusCode;
            } else {
                code = this.getStatusCode(status);
            }

            if (typeof exceptionResponse === 'object' && exceptionResponse !== null) {
                const resp = exceptionResponse as Record<string, unknown>;
                const details = this.extractDetails(resp);
                const message = normalizePublicErrorMessage(resp.message, code);
                errorResponse = {
                    code: status,
                    status: code,
                    message,
                    details,
                    requestId,
                    timestamp: new Date().toISOString(),
                };
            } else {
                errorResponse = {
                    code: status,
                    status: code,
                    message: normalizePublicErrorMessage(exceptionResponse, code),
                    requestId,
                    timestamp: new Date().toISOString(),
                };
            }

            if (status >= 500) {
                this.logger.error(
                    `[${errorResponse.code}] ${errorResponse.message}`,
                    exception instanceof Error ? exception.stack : undefined,
                    { requestId, path: request.url, method: request.method },
                );
            } else {
                this.logger.warn(`[${errorResponse.code}] ${errorResponse.message}`, {
                    requestId,
                    path: request.url,
                    method: request.method,
                });
            }
        } else if (exception instanceof Error) {
            errorResponse = {
                code: 500,
                status: StatusCode.INTERNAL_SERVER_ERROR,
                message: getStatusMessage(StatusCode.INTERNAL_SERVER_ERROR),
                requestId,
                timestamp: new Date().toISOString(),
            };

            this.logger.error(`[${errorResponse.code}] ${exception.message}`, exception.stack, {
                requestId,
                path: request.url,
                method: request.method,
            });
        } else {
            errorResponse = {
                code: 500,
                status: StatusCode.INTERNAL_SERVER_ERROR,
                message: getStatusMessage(StatusCode.INTERNAL_SERVER_ERROR),
                requestId,
                timestamp: new Date().toISOString(),
            };

            this.logger.error(`[${errorResponse.code}] Unknown exception`, exception as Error, {
                requestId,
                path: request.url,
                method: request.method,
            });
        }

        response.status(errorResponse.code).json(errorResponse);
    }

    /**
     * Normalize an HttpException response body into the stable `details` shape.
     *
     * Field-level validation failures are always surfaced under
     * `details.fieldErrors` (`[{ field, messages }]`) regardless of which pipe
     * produced them, so the frontend has a single contract to render against.
     */
    private extractDetails(resp: Record<string, unknown>): Record<string, unknown> | undefined {
        if (Array.isArray(resp.fieldErrors)) {
            return { fieldErrors: resp.fieldErrors };
        }
        // Legacy validation payloads used `errors: [{ field, constraints }]`.
        if (Array.isArray(resp.errors)) {
            return { fieldErrors: resp.errors };
        }
        if (resp.details && typeof resp.details === 'object' && !Array.isArray(resp.details)) {
            return resp.details as Record<string, unknown>;
        }
        // NestJS built-in exceptions expose array messages (e.g. unhandled validation).
        if (Array.isArray(resp.message)) {
            return { messages: resp.message };
        }
        return undefined;
    }

    private getStatusCode(status: number): StatusCode {
        const statusToCode: Record<number, StatusCode> = {
            400: StatusCode.BAD_REQUEST,
            401: StatusCode.UNAUTHORIZED,
            403: StatusCode.FORBIDDEN,
            404: StatusCode.NOT_FOUND,
            409: StatusCode.CONFLICT,
            422: StatusCode.UNPROCESSABLE_ENTITY,
            429: StatusCode.TOO_MANY_REQUESTS,
            500: StatusCode.INTERNAL_SERVER_ERROR,
            502: StatusCode.EXTERNAL_SERVICE_ERROR,
            503: StatusCode.SERVICE_UNAVAILABLE,
            504: StatusCode.GATEWAY_TIMEOUT,
        };

        return statusToCode[status] || StatusCode.INTERNAL_SERVER_ERROR;
    }
}
