// ============================================================================
// Pagination DTO - Standardized HTTP pagination parameters
// ============================================================================

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

import {
    CursorPaginationOptions,
    PageQueryOptions,
    PageResult,
    PaginationOptions,
} from '@/shared/domain/pagination';

export class PaginationQueryDto {
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    @ApiPropertyOptional({ description: '页码', default: 1, minimum: 1 })
    page?: number = 1;

    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    @Max(100)
    @ApiPropertyOptional({ description: '每页数量', default: 10, minimum: 1, maximum: 100 })
    limit?: number = 10;

    @IsOptional()
    @IsString()
    @ApiPropertyOptional({ description: '搜索关键词', required: false })
    search?: string;

    @IsOptional()
    @IsString()
    @ApiPropertyOptional({ description: '排序字段', required: false })
    sortBy?: string;

    @IsOptional()
    @IsString()
    @IsIn(['asc', 'desc'])
    @ApiPropertyOptional({ description: '排序方向', enum: ['asc', 'desc'], default: 'desc' })
    sortOrder?: 'asc' | 'desc' = 'desc';
}

export class CursorPaginationQueryDto {
    @IsOptional()
    @IsString()
    @ApiPropertyOptional({ description: '游标（最后一项ID）', required: false })
    cursor?: string;

    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    @Max(100)
    @ApiPropertyOptional({ description: '页面大小', default: 20, minimum: 1, maximum: 100 })
    limit?: number = 20;

    @IsOptional()
    @IsString()
    @IsIn(['asc', 'desc'])
    @ApiPropertyOptional({ description: '排序方向', default: 'asc' })
    order?: 'asc' | 'desc' = 'asc';
}

export function parsePaginationOptions(query: PaginationQueryDto): PaginationOptions {
    const page = query.page ?? 1;
    const limit = query.limit ?? 10;
    const offset = (page - 1) * limit;

    return { page, limit, offset };
}

export function parsePageQueryOptions(query: PaginationQueryDto): PageQueryOptions {
    const pagination = parsePaginationOptions(query);
    return {
        ...pagination,
        search: query.search?.trim() || undefined,
        sortBy: query.sortBy,
        sortOrder: query.sortOrder ?? 'desc',
    };
}

export function toPaginatedResponse<T>(result: PageResult<T>): PaginatedResponseDto<T> {
    const totalPages = Math.max(1, Math.ceil(result.total / result.limit));
    return new PaginatedResponseDto({
        items: result.items,
        total: result.total,
        page: result.page,
        limit: result.limit,
        totalPages,
        hasNext: result.page < totalPages,
        hasPrevious: result.page > 1,
    });
}

export function parseCursorPaginationOptions(query: CursorPaginationQueryDto): CursorPaginationOptions {
    return {
        cursor: query.cursor ?? null,
        limit: query.limit ?? 20,
        order: query.order ?? 'asc',
    };
}

export class PaginatedResponseDto<T> {
    @ApiProperty({ description: '当前页数据列表' })
    items: T[];

    @ApiProperty({ description: '数据总数' })
    total: number;

    @ApiProperty({ description: '当前页码' })
    page: number;

    @ApiProperty({ description: '每页数量' })
    limit: number;

    @ApiProperty({ description: '总页数' })
    totalPages: number;

    @ApiProperty({ description: '是否有下一页' })
    hasNext: boolean;

    @ApiProperty({ description: '是否有上一页' })
    hasPrevious: boolean;

    constructor(partial: Partial<PaginatedResponseDto<T>>) {
        Object.assign(this, partial);
    }
}

export class CursorPaginatedResponseDto<T> {
    @ApiProperty({ description: '当前页数据列表' })
    items: T[];

    @ApiProperty({ description: '下一页游标，为空表示没有更多数据', nullable: true })
    nextCursor: string | null;

    @ApiProperty({ description: '是否还有更多数据' })
    hasMore: boolean;

    constructor(partial: Partial<CursorPaginatedResponseDto<T>>) {
        Object.assign(this, partial);
    }
}
