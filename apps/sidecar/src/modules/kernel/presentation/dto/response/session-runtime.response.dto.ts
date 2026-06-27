import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class KernelSessionRuntimeEventResponseDto {
    @ApiProperty({ description: '事件类型' })
    type: string;

    @ApiPropertyOptional({ description: '事件载荷' })
    payload?: Record<string, unknown>;
}

export class KernelSessionRunResponseDto {
    @ApiProperty({ description: '会话 ID' })
    sessionId: string;

    @ApiProperty({ description: '是否已接受运行请求' })
    accepted: boolean;

    @ApiProperty({ description: 'HTTP 调用期间收集到的运行事件', type: [KernelSessionRuntimeEventResponseDto] })
    events: KernelSessionRuntimeEventResponseDto[];

    @ApiProperty({ description: '完成时间，ISO 8601 格式' })
    completedAt: Date;
}

export class KernelSessionCancelResponseDto {
    @ApiProperty({ description: '会话 ID' })
    sessionId: string;

    @ApiProperty({ description: 'HTTP 调用期间收集到的取消事件', type: [KernelSessionRuntimeEventResponseDto] })
    events: KernelSessionRuntimeEventResponseDto[];

    @ApiProperty({ description: '取消时间，ISO 8601 格式' })
    cancelledAt: Date;
}

export class KernelSessionResetResponseDto {
    @ApiProperty({ description: '会话 ID' })
    sessionId: string;

    @ApiPropertyOptional({ description: '运行工作区' })
    workspace?: string;

    @ApiPropertyOptional({ description: '用户可见的存储工作区' })
    storageWorkspace?: string;

    @ApiProperty({ description: '清理消息数' })
    messagesCleared: number;

    @ApiProperty({ description: '清理运行态文件数' })
    runtimeFilesCleared: number;

    @ApiProperty({ description: '重置时间' })
    resetAt: Date;
}

export class KernelSessionSnapshotSummaryResponseDto {
    @ApiProperty({ description: '会话 ID' })
    id: string;

    @ApiPropertyOptional({ description: '智能体 ID' })
    agentId?: string;

    @ApiProperty({ description: '会话标题' })
    title: string;

    @ApiProperty({ description: '会话状态' })
    status: string;

    @ApiProperty({ description: '工作区目录' })
    cwd: string;

    @ApiPropertyOptional({ description: '关联的资产 ID' })
    assetId?: string;

    @ApiPropertyOptional({ description: '智能体阶段' })
    agentPhase?: string;

    @ApiProperty({ description: '创建时间戳' })
    createdAt: number;

    @ApiProperty({ description: '更新时间戳' })
    updatedAt: number;
}

export class KernelSessionSnapshotResponseDto {
    @ApiProperty({ description: '会话摘要', type: KernelSessionSnapshotSummaryResponseDto })
    session: KernelSessionSnapshotSummaryResponseDto;

    @ApiProperty({ description: '可回放消息历史', type: [Object] })
    messages: unknown[];
}

export class KernelSessionStatusResponseDto {
    @ApiProperty({ description: '会话 ID' })
    sessionId: string;

    @ApiProperty({ description: '运行工作区' })
    workspace: string;

    @ApiPropertyOptional({ description: '用户可见的存储工作区' })
    storageWorkspace?: string;

    @ApiPropertyOptional({ description: '本地运行态工作区（仅桌面模式返回）' })
    runtimeWorkspace?: string;

    @ApiProperty({ description: '智能体 ID' })
    agentId: string;

    @ApiProperty({ description: '可用工具名称' })
    toolNames: unknown;

    @ApiProperty({ description: '工具定义' })
    toolDefinitions: unknown;

    @ApiProperty({ description: '技能列表', type: [Object] })
    skills: unknown[];

    @ApiProperty({ description: '运行命令列表', type: [String] })
    commands: string[];

    @ApiPropertyOptional({ description: '任务队列状态' })
    queueStats?: unknown;

    @ApiProperty({ description: 'MCP 状态', type: [Object] })
    mcpStatus: unknown[];

    @ApiPropertyOptional({ description: '记忆状态' })
    memoryStats?: unknown;

    @ApiPropertyOptional({ description: '初始化告警' })
    initWarning?: unknown;

    @ApiPropertyOptional({ description: '当前 SDK run' })
    currentRun?: unknown;

    @ApiPropertyOptional({ description: '当前活跃工具调用' })
    activeTools?: unknown;

    @ApiPropertyOptional({ description: 'SDK run 快照列表' })
    runs?: unknown;

    @ApiPropertyOptional({ description: '所有子智能体任务' })
    subagentTasks?: unknown;

    @ApiPropertyOptional({ description: '运行中的子智能体任务' })
    pendingSubagentTasks?: unknown;

    @ApiPropertyOptional({ description: 'SDK trace events' })
    traceEvents?: unknown;

    @ApiPropertyOptional({ description: '结构化验证报告' })
    verificationReports?: unknown;

    @ApiPropertyOptional({ description: '验证摘要' })
    verificationSummary?: unknown;

    @ApiPropertyOptional({ description: '人类可读验证摘要' })
    verificationSummaryText?: string;

    @ApiPropertyOptional({ description: '队列死信' })
    deadLetters?: unknown;

    @ApiPropertyOptional({ description: '队列指标' })
    queueMetrics?: unknown;

    @ApiProperty({ description: 'HTTP 调用期间收集到的状态事件', type: [KernelSessionRuntimeEventResponseDto] })
    events: KernelSessionRuntimeEventResponseDto[];
}

export class KernelSessionLogEntryResponseDto {
    @ApiProperty({ description: '日志 ID' })
    id: string;

    @ApiProperty({ description: '会话 ID' })
    sessionId: string;

    @ApiProperty({ description: '日志来源', enum: ['user', 'assistant', 'system'] })
    role: 'user' | 'assistant' | 'system';

    @ApiProperty({ description: '日志内容' })
    content: string;

    @ApiProperty({ description: '消息元数据' })
    metadata: Record<string, unknown>;

    @ApiProperty({ description: '创建时间，ISO 8601 格式' })
    createdAt: Date;
}
