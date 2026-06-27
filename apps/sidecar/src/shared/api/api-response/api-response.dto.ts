// ============================================================================
// API Response DTO - Standardized API response wrapper
// ============================================================================

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { StatusCode } from '../../common/errors/error-codes';
import { API_SUCCESS_STATUS, type ApiSuccessStatus } from './api-response.constants';

// Standard API Response Wrapper
export class ApiResponseDto {
    @ApiProperty({ description: 'HTTP 状态码', example: 200 })
    code: number;

    @ApiProperty({ description: '业务状态码', example: API_SUCCESS_STATUS })
    status: ApiSuccessStatus;

    @ApiProperty({ description: '响应消息', example: '成功' })
    message: string;

    @ApiProperty({ description: '响应数据', type: 'object', additionalProperties: true })
    data: Record<string, any>;

    @ApiPropertyOptional({ description: '请求 ID，用于链路追踪' })
    requestId?: string;

    @ApiProperty({ description: '响应时间戳' })
    timestamp: string;

    constructor(partial?: Partial<ApiResponseDto>) {
        if (partial) {
            Object.assign(this, partial);
        }
        this.timestamp = this.timestamp || new Date().toISOString();
        this.status = this.status || API_SUCCESS_STATUS;
    }
}

// Paginated response data structure
export class PaginatedDataDto {
    @ApiProperty({ description: '当前页数据列表', type: 'array', items: { type: 'object', additionalProperties: true } })
    items: Record<string, any>[];

    @ApiProperty({ description: '数据总数', example: 100 })
    total: number;

    @ApiProperty({ description: '当前页码', example: 1 })
    page: number;

    @ApiProperty({ description: '每页数量', example: 10 })
    limit: number;

    @ApiProperty({ description: '总页数', example: 10 })
    totalPages: number;

    @ApiProperty({ description: '是否有下一页', example: true })
    hasNext: boolean;

    @ApiProperty({ description: '是否有上一页', example: false })
    hasPrevious: boolean;
}

export class ApiErrorResponseDto {
    @ApiProperty({ description: 'HTTP 状态码', example: 404 })
    code: number;

    @ApiProperty({ description: '业务状态码（唯一业务错误标识）', example: 'NOT_FOUND', enum: Object.values(StatusCode) })
    status: StatusCode;

    @ApiProperty({ description: '错误消息', example: '资源不存在' })
    message: string;

    @ApiPropertyOptional({
        description:
            '错误详情。参数校验失败时固定为 `{ fieldErrors: [{ field, messages }] }`，' +
            'field 为点分路径（如 modalities.input），messages 为该字段的全部约束提示。',
        example: {
            fieldErrors: [{ field: 'capacity', messages: ['capacity must be a number'] }],
        },
    })
    details?: Record<string, unknown>;

    @ApiProperty({ description: '响应时间戳' })
    timestamp: string;

    @ApiPropertyOptional({ description: '请求 ID，用于链路追踪' })
    requestId?: string;

    constructor(partial?: Partial<ApiErrorResponseDto>) {
        if (partial) {
            Object.assign(this, partial);
        }
        this.timestamp = this.timestamp || new Date().toISOString();
    }
}
