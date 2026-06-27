// ============================================================================
// OpenAPI Common DTOs - Reusable documentation objects
// ============================================================================

import { ApiProperty, ApiPropertyOptional, ApiSchema } from '@nestjs/swagger';
import { StatusCode } from '../../common/errors/error-codes';
import { API_SUCCESS_MESSAGE, API_SUCCESS_STATUS } from '../api-response/api-response.constants';

@ApiSchema({ name: 'ApiSuccessEnvelope' })
export class ApiSuccessEnvelopeDto {
    @ApiProperty({ description: 'HTTP状态码', example: 200 })
    code!: number;

    @ApiProperty({ description: '业务状态码', example: API_SUCCESS_STATUS })
    status!: string;

    @ApiProperty({ description: '响应消息', example: API_SUCCESS_MESSAGE })
    message!: string;

    @ApiPropertyOptional({ description: '业务数据', type: 'object', additionalProperties: true })
    data?: unknown;

    @ApiPropertyOptional({ description: '请求ID' })
    requestId?: string;

    @ApiProperty({ description: '时间戳', example: '2026-05-19T00:00:00.000Z' })
    timestamp!: string;
}

@ApiSchema({ name: 'ApiErrorEnvelope' })
export class ApiErrorEnvelopeDto {
    @ApiProperty({ description: 'HTTP状态码' })
    code!: number;

    @ApiProperty({ description: '业务状态码', enum: Object.values(StatusCode) })
    status!: string;

    @ApiProperty({ description: '错误信息' })
    message!: string;

    @ApiPropertyOptional({ description: '错误详情', type: 'object', additionalProperties: true })
    details?: Record<string, unknown>;

    @ApiPropertyOptional({ description: '请求ID' })
    requestId?: string;

    @ApiProperty({ description: '时间戳' })
    timestamp!: string;
}

@ApiSchema({ name: 'ApiPaginatedData' })
export class ApiPaginatedDataDto {
    @ApiProperty({ description: '数据列表', type: 'array', items: { type: 'object' } })
    items!: unknown[];

    @ApiProperty({ description: '总数', example: 100 })
    total!: number;

    @ApiProperty({ description: '当前页码', example: 1 })
    page!: number;

    @ApiProperty({ description: '每页数量', example: 10 })
    limit!: number;

    @ApiProperty({ description: '总页数', example: 10 })
    totalPages!: number;

    @ApiProperty({ description: '是否有下一页' })
    hasNext!: boolean;

    @ApiProperty({ description: '是否有上一页' })
    hasPrevious!: boolean;
}

export class PaginationParamsDto {
    @ApiPropertyOptional({ description: '页码', default: 1, minimum: 1 })
    page?: number;

    @ApiPropertyOptional({ description: '每页数量', default: 10, minimum: 1, maximum: 100 })
    limit?: number;
}

export class IdParamDto {
    @ApiProperty({ description: '唯一标识' })
    id: string;
}

export class SlugParamDto {
    @ApiProperty({ description: 'URL 友好的唯一标识' })
    slug: string;
}

export class CreatedAtFilterDto {
    @ApiPropertyOptional({ description: '创建时间起始筛选', example: '2024-01-01T00:00:00Z' })
    createdFrom?: string;

    @ApiPropertyOptional({ description: '创建时间截止筛选', example: '2024-12-31T23:59:59Z' })
    createdTo?: string;
}

export class StatusFilterDto {
    @ApiPropertyOptional({ description: '按状态筛选', enum: ['active', 'inactive', 'pending'] })
    status?: string;
}

export class SearchQueryDto {
    @ApiPropertyOptional({ description: '搜索关键词', example: 'keyword' })
    q?: string;

    @ApiPropertyOptional({ description: '页码', default: 1, minimum: 1 })
    page?: number;

    @ApiPropertyOptional({ description: '每页数量', default: 10, minimum: 1, maximum: 100 })
    limit?: number;
}
