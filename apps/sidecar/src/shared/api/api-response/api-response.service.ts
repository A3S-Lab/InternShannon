// ============================================================================
// API Response Service - Factory for creating standardized responses
// ============================================================================

import { Injectable } from '@nestjs/common';
import { Request } from 'express';
import { PaginatedResponseDto } from '../../application/pagination.dto';
import { StatusCode, StatusCodeHttpStatus } from '../../common/errors/error-codes';
import { API_SUCCESS_MESSAGE, API_SUCCESS_STATUS } from './api-response.constants';
import { ApiErrorResponseDto, ApiResponseDto } from './api-response.dto';

@Injectable()
export class ApiResponseService {
    /**
     * Create a success response
     */
    success(data?: any, message = API_SUCCESS_MESSAGE, requestId?: string): ApiResponseDto {
        return new ApiResponseDto({
            code: 200,
            status: API_SUCCESS_STATUS,
            message,
            data,
            requestId,
        });
    }

    /**
     * Create a created response (201)
     */
    created(data?: any, message = '创建成功', requestId?: string): ApiResponseDto {
        return new ApiResponseDto({
            code: 201,
            status: API_SUCCESS_STATUS,
            message,
            data,
            requestId,
        });
    }

    /**
     * Create an accepted response (202)
     */
    accepted(data?: any, message = '已接受', requestId?: string): ApiResponseDto {
        return new ApiResponseDto({
            code: 202,
            status: API_SUCCESS_STATUS,
            message,
            data,
            requestId,
        });
    }

    /**
     * Create a no content response (204)
     */
    noContent(requestId?: string): ApiResponseDto {
        return new ApiResponseDto({
            code: 204,
            status: API_SUCCESS_STATUS,
            message: '无内容',
            requestId,
        });
    }

    /**
     * Create a paginated response
     */
    paginated<T>(
        items: T[],
        total: number,
        page: number,
        limit: number,
        _message = 'Success',
        _requestId?: string,
    ): PaginatedResponseDto<T> {
        const totalPages = Math.ceil(total / limit);

        return new PaginatedResponseDto<T>({
            items,
            total,
            page,
            limit,
            totalPages,
            hasNext: page < totalPages,
            hasPrevious: page > 1,
        });
    }

    /**
     * Create an error response
     * @param status Business status code (StatusCode enum)
     * @param message Error message
     * @param details Additional error details
     * @param requestId Request ID for tracing
     */
    error(
        status: StatusCode,
        message: string,
        details?: Record<string, unknown>,
        requestId?: string,
    ): ApiErrorResponseDto {
        return new ApiErrorResponseDto({
            code: StatusCodeHttpStatus[status],
            status,
            message,
            details,
            requestId,
        });
    }

    /**
     * Get request ID from request object
     */
    getRequestId(request: Request): string | undefined {
        const req = request as Request & { headers: { 'x-request-id'?: string; 'x-correlation-id'?: string } };
        return req.headers['x-request-id'] || req.headers['x-correlation-id'] || undefined;
    }
}
