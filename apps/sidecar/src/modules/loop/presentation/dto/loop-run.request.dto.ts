import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsBoolean, IsIn, IsInt, IsNotEmpty, IsOptional, IsString, Max, Min } from 'class-validator';
import { PaginationQueryDto } from '@/shared/api/presentation/dto/pagination.dto';

export class AdjudicateLoopRunRequestDto {
    @IsIn(['approve', 'reject'])
    @ApiProperty({ description: 'HITL 裁决', enum: ['approve', 'reject'] })
    decision: 'approve' | 'reject';

    @IsOptional()
    @IsString()
    @ApiPropertyOptional({ description: '裁决备注 / 拒绝原因' })
    note?: string;
}

/** 启动一条绑定资产的内核循环(自主修复)。 */
export class CreateDevLoopRunRequestDto {
    @IsString()
    @IsNotEmpty()
    @ApiProperty({ description: '绑定的资产 id' })
    assetId: string;

    @IsOptional()
    @IsString()
    @ApiPropertyOptional({ description: '分支 / ref' })
    ref?: string;

    @IsString()
    @IsNotEmpty()
    @ApiProperty({ description: '循环目标(自然语言)' })
    goal: string;

    @IsOptional()
    @IsInt()
    @Min(1)
    @Max(20)
    @ApiPropertyOptional({ description: '最大迭代轮数(预算),默认 6,上限 20' })
    maxIterations?: number;
}

/** 记录一轮 generate→verify→repair 的结果。 */
export class RecordDevIterationRequestDto {
    @IsInt()
    @Min(0)
    @ApiProperty({ description: '本轮序号(从 1 起)' })
    turn: number;

    @IsOptional()
    @IsArray()
    @IsString({ each: true })
    @ApiPropertyOptional({ description: '本轮智能体改动的文件(相对路径)', type: [String] })
    mutatedFiles?: string[];

    @IsBoolean()
    @ApiProperty({ description: 'verify(诊断/质检)是否通过' })
    verifyPassed: boolean;

    @IsOptional()
    @IsString()
    @ApiPropertyOptional({ description: 'verify 诊断报告 id' })
    verifyReportId?: string;

    @IsOptional()
    @IsArray()
    @IsString({ each: true })
    @ApiPropertyOptional({ description: '未通过的 scope 列表', type: [String] })
    verifyFailedScopes?: string[];

    @IsOptional()
    @IsBoolean()
    @ApiPropertyOptional({ description: '是否已把失败 scope 注回下一轮修复提示' })
    repaired?: boolean;

    @IsOptional()
    @IsString()
    @ApiPropertyOptional({ description: '备注' })
    note?: string;

    @IsOptional()
    @IsBoolean()
    @ApiPropertyOptional({ description: '请求人工裁决(置为 awaiting_human)' })
    awaitingHuman?: boolean;

    @IsOptional()
    @IsString()
    @ApiPropertyOptional({ description: '错误签名 / 终止原因' })
    errorSignature?: string;
}

/** 触发认知蒸馏:不带 signature 蒸馏全部缺失/陈旧的签名,带则只蒸馏一条。 */
export class DistillCognitionRequestDto {
    @IsOptional()
    @IsString()
    @ApiPropertyOptional({ description: '认知签名;省略则蒸馏全部缺失/陈旧的认知' })
    signature?: string;
}

/**
 * 人工编辑认知正文(只更新提供的字段)。注意:引擎重新蒸馏仍会覆盖正文(引擎优先),
 * 但本次编辑会作为一条 'edit' 记录保留在演化时间线中。
 */
export class EditCognitionRequestDto {
    @IsOptional()
    @IsString()
    @ApiPropertyOptional({ description: '一句话标题' })
    title?: string;

    @IsOptional()
    @IsString()
    @ApiPropertyOptional({ description: '典型症状/触发条件' })
    symptom?: string;

    @IsOptional()
    @IsString()
    @ApiPropertyOptional({ description: '对策/修复方法' })
    remedy?: string;

    @IsOptional()
    @IsString()
    @ApiPropertyOptional({ description: '经验散文(什么有效/什么会失败/如何规避)' })
    experience?: string;
}

/** 认知经验列表的分页 + 过滤查询(扩展分页 DTO,白名单 loopKind / status)。 */
export class ListCognitionLessonsQueryDto extends PaginationQueryDto {
    @IsOptional()
    @IsString()
    @ApiPropertyOptional({ description: '按循环类型过滤 (dev/ops/knowledge)' })
    loopKind?: string;

    @IsOptional()
    @IsString()
    @IsIn(['enabled', 'disabled'])
    @ApiPropertyOptional({ description: '按状态过滤', enum: ['enabled', 'disabled'] })
    status?: string;
}

/**
 * 循环运行列表的分页 + 过滤查询(扩展分页 DTO,白名单 loopKind / status / subjectId)。
 * 必须用一个声明了这些字段的 DTO 绑定整个 query —— 全局 forbidNonWhitelisted 会拒绝
 * 任何未在 DTO 上声明的 query 参数(否则 WebIDE 诊断按钮的
 * ?loopKind=dev&subjectId=<asset> 会被判「property should not exist」400)。
 */
export class ListLoopRunsQueryDto extends PaginationQueryDto {
    @IsOptional()
    @IsString()
    @ApiPropertyOptional({ description: '按循环类型过滤 (dev/ops/knowledge)' })
    loopKind?: string;

    @IsOptional()
    @IsString()
    @ApiPropertyOptional({ description: '按运行状态过滤(running/awaiting_human/succeeded/failed 等)' })
    status?: string;

    @IsOptional()
    @IsString()
    @ApiPropertyOptional({ description: '按主体 id 过滤(如绑定的资产 id)' })
    subjectId?: string;
}

/** 终结一条内核循环。 */
export class FinalizeDevLoopRunRequestDto {
    @IsIn(['succeeded', 'failed', 'terminated', 'cancelled'])
    @ApiProperty({ description: '终态', enum: ['succeeded', 'failed', 'terminated', 'cancelled'] })
    status: 'succeeded' | 'failed' | 'terminated' | 'cancelled';

    @IsOptional()
    @IsString()
    @ApiPropertyOptional({ description: '错误签名 / 终止原因' })
    errorSignature?: string;
}
