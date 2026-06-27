import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { MessageRole } from '../../../domain/entities/message.entity';

export class MessageResponseDto {
    @ApiProperty({ description: '消息ID' })
    id: string;

    @ApiProperty({ description: '会话ID' })
    sessionId: string;

    @ApiProperty({ enum: ['user', 'assistant', 'system'], description: '消息角色' })
    role: MessageRole;

    @ApiProperty({ description: '消息内容' })
    content: string;

    @ApiPropertyOptional({ description: '元数据' })
    metadata?: Record<string, unknown>;

    @ApiProperty({ description: '创建时间，ISO 8601 格式' })
    createdAt: Date;
}
