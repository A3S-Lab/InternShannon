import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { SessionStatus } from '../../../domain/value-objects/session-status.vo';

export class SessionBoundAssetResponseDto {
    @ApiProperty({ description: '资产 ID' })
    id: string;

    @ApiProperty({ description: '资产名称' })
    name: string;

    @ApiProperty({
        description: '资产分类',
        enum: ['code', 'agent', 'workflow', 'mcp', 'knowledge', 'memory', 'skill', 'tool'],
    })
    category: string;

    @ApiProperty({ description: '可见性', enum: ['public', 'private'] })
    visibility: string;

    @ApiPropertyOptional({ description: '描述' })
    description?: string;

    @ApiPropertyOptional({ description: '生命周期状态' })
    lifecycleState?: string;

    @ApiProperty({ description: '星标数' })
    starCount: number;

    @ApiProperty({ description: 'Fork 数' })
    forkCount: number;

    @ApiProperty({ description: '创建时间，ISO 8601 格式' })
    createdAt: Date;

    @ApiProperty({ description: '更新时间，ISO 8601 格式' })
    updatedAt: Date;
}

export class SessionResponseDto {
    @ApiProperty({ description: '会话ID' })
    id: string;

    @ApiProperty({ description: '会话ID，兼容前端 sessionId 字段' })
    sessionId: string;

    @ApiProperty({ description: '智能体ID' })
    agentId: string;

    @ApiProperty({ description: '用户ID' })
    userId: string;

    @ApiProperty({ description: '会话标题' })
    title: string;

    @ApiProperty({ description: '会话工作区目录' })
    cwd: string;

    @ApiPropertyOptional({ description: '会话模型' })
    model?: string;

    @ApiPropertyOptional({ description: '是否跟随默认模型' })
    followDefaultModel?: boolean;

    @ApiPropertyOptional({ description: '权限模式' })
    permissionMode?: string;

    @ApiPropertyOptional({ description: '会话元数据' })
    metadata?: Record<string, unknown>;

    @ApiProperty({ enum: ['active', 'completed', 'aborted'], description: '会话状态' })
    status: SessionStatus;

    @ApiProperty({ description: '创建时间，ISO 8601 格式' })
    createdAt: Date;

    @ApiProperty({ description: '更新时间，ISO 8601 格式' })
    updatedAt: Date;

    // Asset-related fields (for asset development sessions)
    @ApiPropertyOptional({ description: '关联的资产ID' })
    assetId?: string;

    @ApiPropertyOptional({
        description: '当前会话绑定的数字资产详情。会话详情接口返回；列表接口通常只返回 assetId。',
        type: SessionBoundAssetResponseDto,
    })
    boundAsset?: SessionBoundAssetResponseDto;

    @ApiPropertyOptional({ description: '智能体阶段' })
    agentPhase?: string;

    @ApiPropertyOptional({ description: '工作目录' })
    workingDirectory?: string;
}

export class CreateSessionSuccessDto {
    @ApiProperty({ description: '会话ID' })
    sessionId: string;

    @ApiProperty({ description: '会话标题' })
    title: string;

    @ApiProperty({ description: '会话工作区目录' })
    cwd: string;

    @ApiPropertyOptional({ description: '智能体ID' })
    agentId?: string;

    @ApiPropertyOptional({ description: '会话模型' })
    model?: string;

    @ApiPropertyOptional({ description: '是否跟随默认模型' })
    followDefaultModel?: boolean;

    @ApiPropertyOptional({ description: '权限模式' })
    permissionMode?: string;

    @ApiPropertyOptional({ description: '会话元数据' })
    metadata?: Record<string, unknown>;

    @ApiPropertyOptional({ description: '关联的资产ID' })
    assetId?: string;

    @ApiPropertyOptional({ description: '智能体阶段' })
    agentPhase?: string;

    @ApiPropertyOptional({ description: '工作目录' })
    workingDirectory?: string;
}

export class CreateSessionResponseDto {
    @ApiProperty({ description: '是否成功' })
    success: boolean;

    @ApiProperty({ description: '会话信息', type: CreateSessionSuccessDto })
    session?: CreateSessionSuccessDto;

    @ApiProperty({ description: '错误信息' })
    error?: string;
}
