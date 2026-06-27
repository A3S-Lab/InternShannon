import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsBoolean, IsObject, IsOptional, IsString } from 'class-validator';

export class CreateSessionRequestDto {
    @ApiPropertyOptional({ description: '智能体ID' })
    @IsString()
    @IsOptional()
    agentId?: string;

    @ApiPropertyOptional({ description: '会话标题' })
    @IsString()
    @IsOptional()
    title?: string;

    @ApiPropertyOptional({ description: '会话工作区根目录' })
    @IsString()
    @IsOptional()
    cwd?: string;

    @ApiPropertyOptional({ description: '会话模型，格式为 provider/model 或 model' })
    @IsString()
    @IsOptional()
    model?: string;

    @ApiPropertyOptional({ description: '是否跟随默认模型' })
    @IsBoolean()
    @IsOptional()
    followDefaultModel?: boolean;

    @ApiPropertyOptional({ description: '权限模式' })
    @IsString()
    @IsOptional()
    permissionMode?: string;

    @ApiPropertyOptional({ description: '系统提示词' })
    @IsString()
    @IsOptional()
    systemPrompt?: string;

    @ApiPropertyOptional({ description: '启用的技能列表', type: [String] })
    @IsArray()
    @IsOptional()
    skills?: string[];

    @ApiPropertyOptional({ description: '技能目录列表', type: [String] })
    @IsArray()
    @IsOptional()
    skillDirs?: string[];

    @ApiPropertyOptional({ description: 'MCP 服务配置' })
    @IsArray()
    @IsOptional()
    mcpServers?: unknown[];

    @ApiPropertyOptional({ description: '是否启用内置技能' })
    @IsBoolean()
    @IsOptional()
    builtinSkills?: boolean;

    @ApiPropertyOptional({ description: '规划模式：auto、enabled 或 disabled' })
    @IsString()
    @IsOptional()
    planningMode?: string;

    @ApiPropertyOptional({ description: '是否启用目标追踪' })
    @IsBoolean()
    @IsOptional()
    goalTracking?: boolean;

    @ApiPropertyOptional({ description: '最大工具调用轮次' })
    @IsOptional()
    maxToolRounds?: number;

    @ApiPropertyOptional({ description: '工具调用解析错误最大恢复次数' })
    @IsOptional()
    maxParseRetries?: number;

    @ApiPropertyOptional({ description: 'LLM API 连续失败熔断阈值' })
    @IsOptional()
    circuitBreakerThreshold?: number;

    @ApiPropertyOptional({ description: '是否启用自动继续' })
    @IsBoolean()
    @IsOptional()
    continuationEnabled?: boolean;

    @ApiPropertyOptional({ description: '最大自动继续次数' })
    @IsOptional()
    maxContinuationTurns?: number;

    @ApiPropertyOptional({ description: '是否启用自动压缩' })
    @IsBoolean()
    @IsOptional()
    autoCompact?: boolean;

    @ApiPropertyOptional({ description: '自动压缩阈值，0 到 1' })
    @IsOptional()
    autoCompactThreshold?: number;

    @ApiPropertyOptional({ description: '采样温度' })
    @IsOptional()
    temperature?: number;

    @ApiPropertyOptional({ description: '思考预算 token 数' })
    @IsOptional()
    thinkingBudget?: number;

    @ApiPropertyOptional({ description: '会话搜索默认配置' })
    @IsObject()
    @IsOptional()
    searchConfig?: Record<string, unknown>;

    @ApiPropertyOptional({ description: '桌面 ClawSentry 安全网关运行配置' })
    @IsObject()
    @IsOptional()
    clawSentry?: Record<string, unknown>;

    @ApiPropertyOptional({ description: '一次性 worker agent 配置，注册后可通过 task / parallel_task 调用' })
    @IsArray()
    @IsOptional()
    workerAgents?: unknown[];

    @ApiPropertyOptional({ description: '内联技能配置，无需写入工作区即可注入 SDK skill' })
    @IsArray()
    @IsOptional()
    inlineSkills?: unknown[];

    @ApiPropertyOptional({ description: '自动子任务委派策略' })
    @IsObject()
    @IsOptional()
    autoDelegation?: Record<string, unknown>;

    @ApiPropertyOptional({ description: '是否允许自动并行子任务扇出' })
    @IsBoolean()
    @IsOptional()
    autoParallel?: boolean;

    @ApiPropertyOptional({ description: '是否强制 active skill allowed-tools 限制普通会话工具调用' })
    @IsBoolean()
    @IsOptional()
    enforceActiveSkillToolRestrictions?: boolean;

    @ApiPropertyOptional({ description: '最大并行子任务数' })
    @IsOptional()
    maxParallelTasks?: number;

    @ApiPropertyOptional({ description: '工具/程序大输出 artifact 留存限制' })
    @IsObject()
    @IsOptional()
    artifactStoreLimits?: Record<string, unknown>;

    @ApiPropertyOptional({ description: 'SDK 内存保留上限（run / trace / subagent task FIFO caps）' })
    @IsObject()
    @IsOptional()
    retentionLimits?: Record<string, unknown>;

    @ApiPropertyOptional({ description: '单工具调用超时时间（毫秒）' })
    @IsOptional()
    toolTimeoutMs?: number;

    @ApiPropertyOptional({ description: '队列任务超时时间（毫秒）' })
    @IsOptional()
    queueTimeoutMs?: number;

    @ApiPropertyOptional({ description: '单轮运行最大执行时间（毫秒）' })
    @IsOptional()
    maxExecutionTimeMs?: number;

    @ApiPropertyOptional({ description: '流式输出停滞提示阈值（毫秒）' })
    @IsOptional()
    streamStallWarningMs?: number;

    @ApiPropertyOptional({ description: '模型无输出停滞硬超时（毫秒）' })
    @IsOptional()
    streamStallHardMs?: number;

    @ApiPropertyOptional({ description: '工具执行期间流式停滞硬超时（毫秒）' })
    @IsOptional()
    streamStallActiveToolHardMs?: number;

    @ApiPropertyOptional({ description: '同一工具连续失败熔断阈值' })
    @IsOptional()
    maxConsecutiveToolErrors?: number;

    @ApiPropertyOptional({ description: '模型首响应停滞后的自动重试次数' })
    @IsOptional()
    maxStreamRetries?: number;

    @ApiPropertyOptional({ description: '额外元数据' })
    @IsObject()
    @IsOptional()
    metadata?: Record<string, unknown>;
}
