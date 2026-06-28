import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional } from 'class-validator';
import { PaginationQueryDto } from '@/shared/api/presentation/dto/pagination.dto';
import type {
    UserMemoryAction,
    UserMemoryLayer,
} from '../../../domain/repositories/user-memory.repository.interface';

/**
 * Memory list query: standard pagination plus optional `layer` / `action` filters.
 *
 * Both filter params MUST be declared here (whitelisted): the global ValidationPipe runs with
 * `forbidNonWhitelisted` in cloud mode (see main.ts), so an undeclared `?layer=` / `?action=` would 400.
 */
export class ListMemoriesQueryDto extends PaginationQueryDto {
    @ApiPropertyOptional({
        description: '按记忆层过滤',
        enum: ['resource', 'artifact', 'insight'],
    })
    @IsOptional()
    @IsIn(['resource', 'artifact', 'insight'])
    layer?: UserMemoryLayer;

    @ApiPropertyOptional({
        description: '按记忆事件类型过滤',
        enum: ['stored', 'recalled', 'cleared'],
    })
    @IsOptional()
    @IsIn(['stored', 'recalled', 'cleared'])
    action?: UserMemoryAction;
}
