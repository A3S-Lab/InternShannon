import { ApiProperty } from '@nestjs/swagger';
import type { LoopRunRecord, LoopRunEventRecord } from '../../domain/repositories/loop-run.repository.interface';

export class LoopRunResponseDto {
    @ApiProperty({ description: 'loop-run id' })
    id: string;

    @ApiProperty({ description: '循环类型', enum: ['dev', 'ops', 'knowledge'] })
    loopKind: string;

    @ApiProperty({ description: '作用对象类型', nullable: true })
    subjectType: string | null;

    @ApiProperty({ description: '作用对象 id', nullable: true })
    subjectId: string | null;

    @ApiProperty({ description: '状态机', enum: ['pending', 'running', 'awaiting_human', 'succeeded', 'failed', 'terminated', 'cancelled'] })
    status: string;

    @ApiProperty({ description: '当前迭代序号' })
    iteration: number;

    @ApiProperty({ description: '预算', type: Object })
    budget: Record<string, unknown>;

    @ApiProperty({ description: '已花费', type: Object })
    spent: Record<string, unknown>;

    @ApiProperty({ description: '跨轮状态', type: Object })
    state: Record<string, unknown>;

    @ApiProperty({ description: '错误签名/终止原因', nullable: true })
    errorSignature: string | null;

    @ApiProperty({ description: '环流关联 id', nullable: true })
    correlationId: string | null;

    @ApiProperty({ description: '创建时间 (ISO 8601 / RFC3339 with timezone offset)' })
    createdAt: string;

    @ApiProperty({ description: '更新时间 (ISO 8601 / RFC3339 with timezone offset)' })
    updatedAt: string;
}

export class LoopRunEventResponseDto {
    @ApiProperty({ description: '事件行 id' })
    id: string;

    @ApiProperty({ description: '所属 loop-run id' })
    runId: string;

    @ApiProperty({ description: '迭代序号' })
    iteration: number;

    @ApiProperty({ description: '事件类型 (step.started/step.completed/step.abandoned/run.terminated/...)' })
    eventType: string;

    @ApiProperty({ description: '确定性事件 id = hash(runId, iteration, eventType)' })
    eventId: string;

    @ApiProperty({ description: '事件负载', type: Object })
    payload: Record<string, unknown>;

    @ApiProperty({ description: '记录时间 (ISO 8601 / RFC3339 with timezone offset)' })
    createdAt: string;
}

export function toLoopRunDto(record: LoopRunRecord): LoopRunResponseDto {
    return {
        id: record.id,
        loopKind: record.loopKind,
        subjectType: record.subjectType,
        subjectId: record.subjectId,
        status: record.status,
        iteration: record.iteration,
        budget: record.budget as unknown as Record<string, unknown>,
        spent: record.spent as unknown as Record<string, unknown>,
        state: record.state,
        errorSignature: record.errorSignature,
        correlationId: record.correlationId,
        createdAt: record.createdAt.toISOString(),
        updatedAt: record.updatedAt.toISOString(),
    };
}

export function toLoopRunEventDto(record: LoopRunEventRecord): LoopRunEventResponseDto {
    return {
        id: record.id,
        runId: record.runId,
        iteration: record.iteration,
        eventType: record.eventType,
        eventId: record.eventId,
        payload: record.payload,
        createdAt: record.createdAt.toISOString(),
    };
}
