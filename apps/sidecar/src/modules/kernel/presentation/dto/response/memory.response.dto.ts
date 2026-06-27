import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type {
    UserMemoryAction,
    UserMemoryLayer,
} from '../../../domain/repositories/user-memory.repository.interface';

export class MemoryResponseDto {
    @ApiProperty({ description: '记忆ID' })
    id: string;

    @ApiPropertyOptional({ description: '产生该记忆的会话ID', nullable: true })
    sessionId: string | null;

    @ApiProperty({
        description: '记忆层：资源 / 产物 / 洞察',
        enum: ['resource', 'artifact', 'insight'],
    })
    layer: UserMemoryLayer;

    @ApiProperty({
        description: '记忆事件类型：写入 / 召回 / 清理',
        enum: ['stored', 'recalled', 'cleared'],
    })
    action: UserMemoryAction;

    @ApiPropertyOptional({ description: '记忆内容/摘要', nullable: true })
    content: string | null;

    @ApiPropertyOptional({ description: 'SDK 记忆ID（用于去重）', nullable: true })
    memoryId: string | null;

    @ApiProperty({ description: '附加元数据（importance / relevance / resultCount 等）' })
    metadata: Record<string, unknown>;

    @ApiProperty({ description: '创建时间，ISO 8601 格式' })
    createdAt: Date;
}
