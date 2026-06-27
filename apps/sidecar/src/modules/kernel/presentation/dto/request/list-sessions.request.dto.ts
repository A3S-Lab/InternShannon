import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';
import { PaginationQueryDto } from '@/shared/application/pagination.dto';

/**
 * 会话列表查询参数：在标准分页基础上增加 `conversational`。
 *
 * 必须把 `conversational` 显式声明为白名单字段——全局 ValidationPipe 在 cloud 模式启用了
 * `forbidNonWhitelisted`（见 main.ts），用户总览页传 `?conversational=true` 时若该参数不在
 * DTO 上会被判为「多余属性」直接 400（输入数据验证失败）。
 */
export class ListSessionsQueryDto extends PaginationQueryDto {
    @ApiPropertyOptional({
        description:
            '仅返回「真正的对话」会话（排除资产开发/编排/devops/系统等功能内部运行时会话）。传 "true" 或 "1" 开启。',
    })
    @IsOptional()
    @IsString()
    conversational?: string;
}
