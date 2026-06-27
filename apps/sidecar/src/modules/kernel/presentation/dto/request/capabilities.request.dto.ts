import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsObject, IsOptional, IsString } from 'class-validator';

export class CapabilitiesQueryDto {
    @ApiPropertyOptional({
        description: '查询动作。list=列出模块或操作；describe=描述某模块；search=按关键词搜索；execute=执行某操作',
        enum: ['list', 'describe', 'search', 'execute'],
    })
    @IsString()
    @IsOptional()
    @IsIn(['list', 'describe', 'search', 'execute'])
    action?: 'list' | 'describe' | 'search' | 'execute';

    @ApiPropertyOptional({ description: '能力模块名（describe/execute 时必填）' })
    @IsString()
    @IsOptional()
    module?: string;

    @ApiPropertyOptional({ description: '关键词（search 时使用）' })
    @IsString()
    @IsOptional()
    query?: string;

    @ApiPropertyOptional({ description: '具体操作名（execute 时必填）' })
    @IsString()
    @IsOptional()
    operation?: string;

    @ApiPropertyOptional({
        description: '执行操作时的入参（execute 时使用）',
        type: 'object',
        additionalProperties: true,
    })
    @IsObject()
    @IsOptional()
    params?: Record<string, unknown>;

    @ApiPropertyOptional({ description: '所属 session id，可选；用于在会话上下文中执行能力' })
    @IsString()
    @IsOptional()
    sessionId?: string;
}
