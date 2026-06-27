import { BadRequestException, Body, Controller, Get, Inject, Param, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { AuthenticatedApi } from '@/shared/security/desktop-access';
import { ApiOkResponse, ApiPaginatedResponse } from '@/shared/api/openapi';
import {
    PaginatedResponseDto,
    PaginationQueryDto,
    parsePaginationOptions,
    toPaginatedResponse,
} from '@/shared/application/pagination.dto';
import { NotFoundException } from '@/shared/common/errors';
import { CurrentUserId } from '@/shared/security/decorators/current-user.decorator';
import { isLockedAgent, lockedRunViolation } from '../../application/agents/locked-agent.policy';
import { KernelBtwQueryService } from '../../application/kernel-btw-query.service';
import { KernelMessageRunCancellationService } from '../../application/kernel-message-run-cancellation.service';
import { KernelMessageRunIntakeService } from '../../application/kernel-message-run-intake.service';
import { KernelSessionAccessService } from '../../application/kernel-session-access.service';
import { KernelSessionResetService } from '../../application/kernel-session-reset.service';
import { KernelSessionRuntimeAccessService } from '../../application/kernel-session-runtime-access.service';
import { KernelSessionSnapshotService } from '../../application/kernel-session-snapshot.service';
import { KernelSessionStatusService } from '../../application/kernel-session-status.service';
import { type IKernelService, KERNEL_SERVICE } from '../../domain/services/kernel-service.interface';
import { AskKernelSessionBtwRequestDto, RunKernelSessionMessageRequestDto } from '../dto/request';
import {
    KernelSessionCancelResponseDto,
    KernelSessionLogEntryResponseDto,
    KernelSessionResetResponseDto,
    KernelSessionRunResponseDto,
    KernelSessionRuntimeEventResponseDto,
    KernelSessionSnapshotResponseDto,
    KernelSessionStatusResponseDto,
} from '../dto/response';

@ApiTags('内核 - 会话运行')
@AuthenticatedApi()
@Controller('kernel/sessions/:sessionId')
export class KernelSessionRuntimeController {
    constructor(
        @Inject(KERNEL_SERVICE)
        private readonly kernelService: IKernelService,
        private readonly runtimeAccess: KernelSessionRuntimeAccessService,
        private readonly messageRunIntake: KernelMessageRunIntakeService,
        private readonly messageRunCancellation: KernelMessageRunCancellationService,
        private readonly btwQuery: KernelBtwQueryService,
        private readonly sessionAccess: KernelSessionAccessService,
        private readonly sessionReset: KernelSessionResetService,
        private readonly sessionSnapshot: KernelSessionSnapshotService,
        private readonly sessionStatus: KernelSessionStatusService,
    ) {}

    @Get('snapshot')
    @ApiOkResponse({
        summary: '获取内核会话快照',
        description: '返回会话摘要和可回放消息历史，用于恢复智能体调试、制造车间执行日志或工作台会话状态。',
        type: KernelSessionSnapshotResponseDto,
    })
    async snapshot(
        @Param('sessionId') sessionId: string,
        @CurrentUserId() userId: string,
    ): Promise<KernelSessionSnapshotResponseDto> {
        await this.sessionAccess.requireOwnedSession(sessionId, userId);
        const snapshot = await this.sessionSnapshot.getSnapshot(sessionId);
        if (!snapshot) {
            throw new NotFoundException('Kernel session not found');
        }
        return snapshot;
    }

    @Get('status')
    @ApiOkResponse({
        summary: '获取内核会话运行状态',
        description: '返回当前会话运行时的工作区、工具、技能、MCP、队列和记忆状态；实时推送仍可通过 WebSocket 订阅。',
        type: KernelSessionStatusResponseDto,
    })
    async status(
        @Param('sessionId') sessionId: string,
        @CurrentUserId() userId: string,
    ): Promise<KernelSessionStatusResponseDto> {
        await this.sessionAccess.requireOwnedSession(sessionId, userId);
        const activeSession = this.runtimeAccess.active(sessionId);
        if (!activeSession) {
            throw new NotFoundException('Kernel session runtime not found');
        }
        return {
            ...(await this.sessionStatus.describe(activeSession)),
            events: [],
        };
    }

    @Get('logs')
    @ApiPaginatedResponse({
        summary: '查询内核会话执行日志',
        description: '以消息记录形式返回会话执行日志，覆盖用户输入、智能体回复、工具调用摘要和运行元数据。',
        type: KernelSessionLogEntryResponseDto,
    })
    async logs(
        @Param('sessionId') sessionId: string,
        @Query() query: PaginationQueryDto,
        @CurrentUserId() userId: string,
    ): Promise<PaginatedResponseDto<KernelSessionLogEntryResponseDto>> {
        await this.sessionAccess.requireOwnedSession(sessionId, userId);
        const { page, limit, offset } = parsePaginationOptions(query);
        const messages = await this.kernelService.getSessionMessages(sessionId);
        const items = messages
            .sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime())
            .map(message => ({
                id: message.id,
                sessionId: message.sessionId,
                role: message.role,
                content: message.content,
                metadata: message.metadata,
                createdAt: message.createdAt,
            }));
        return toPaginatedResponse({
            items: items.slice(offset, offset + limit),
            total: items.length,
            page,
            limit,
        });
    }

    @Post('messages')
    @ApiOkResponse({
        summary: '提交内核会话消息运行',
        description:
            '向会话提交用户消息并触发一次智能体运行；HTTP 响应包含本次调用收集到的事件，实时事件可通过 WebSocket 获取。',
        type: KernelSessionRunResponseDto,
    })
    async runMessage(
        @Param('sessionId') sessionId: string,
        @Body() dto: RunKernelSessionMessageRequestDto,
        @CurrentUserId() userId: string,
    ): Promise<KernelSessionRunResponseDto> {
        const session = await this.sessionAccess.requireOwnedSession(sessionId, userId);
        const violation = lockedRunViolation(session.agentId, dto);
        if (violation) throw new BadRequestException(violation);
        const locked = isLockedAgent(session.agentId);
        const events: KernelSessionRuntimeEventResponseDto[] = [];
        await this.messageRunIntake.run({
            sessionId,
            content: dto.content,
            images: dto.images,
            model: locked ? undefined : dto.model,
            emit: event => events.push(this.toRuntimeEvent(event)),
        });
        return {
            sessionId,
            accepted: true,
            events,
            completedAt: new Date(),
        };
    }

    @Post('btw')
    @ApiOkResponse({
        summary: '提交内核会话旁路查询',
        description: '在不中断主任务语义的前提下向会话提交 BTW 查询，用于调试和补充询问。',
        type: KernelSessionRunResponseDto,
    })
    async btw(
        @Param('sessionId') sessionId: string,
        @Body() dto: AskKernelSessionBtwRequestDto,
        @CurrentUserId() userId: string,
    ): Promise<KernelSessionRunResponseDto> {
        await this.sessionAccess.requireOwnedSession(sessionId, userId);
        const events: KernelSessionRuntimeEventResponseDto[] = [];
        await this.btwQuery.ask({
            sessionId,
            content: dto.content,
            emit: event => events.push(this.toRuntimeEvent(event)),
        });
        return {
            sessionId,
            accepted: true,
            events,
            completedAt: new Date(),
        };
    }

    @Post('pause')
    @ApiOkResponse({
        summary: '暂停内核会话当前运行',
        description: '请求取消当前活跃运行并保留会话，适合智能体调试中的暂停操作。',
        type: KernelSessionCancelResponseDto,
    })
    async pause(
        @Param('sessionId') sessionId: string,
        @CurrentUserId() userId: string,
    ): Promise<KernelSessionCancelResponseDto> {
        return this.cancelOwnedSession(sessionId, userId);
    }

    @Post('cancel')
    @ApiOkResponse({
        summary: '取消内核会话当前运行',
        description: '请求取消当前活跃运行并返回取消事件。',
        type: KernelSessionCancelResponseDto,
    })
    async cancel(
        @Param('sessionId') sessionId: string,
        @CurrentUserId() userId: string,
    ): Promise<KernelSessionCancelResponseDto> {
        return this.cancelOwnedSession(sessionId, userId);
    }

    private async cancelOwnedSession(sessionId: string, userId: string): Promise<KernelSessionCancelResponseDto> {
        await this.sessionAccess.requireOwnedSession(sessionId, userId);
        const events: KernelSessionRuntimeEventResponseDto[] = [];
        await this.messageRunCancellation.cancel({
            sessionId,
            emit: event => events.push(this.toRuntimeEvent(event)),
        });
        return {
            sessionId,
            events,
            cancelledAt: new Date(),
        };
    }

    @Post('reset')
    @ApiOkResponse({
        summary: '重置内核会话运行态',
        description: '清空会话消息和运行态文件，保留会话资源本身，用于智能体调试的重置操作。',
        type: KernelSessionResetResponseDto,
    })
    async reset(
        @Param('sessionId') sessionId: string,
        @CurrentUserId() userId: string,
    ): Promise<KernelSessionResetResponseDto> {
        await this.sessionAccess.requireOwnedSession(sessionId, userId);
        const result = await this.sessionReset.reset(sessionId);
        return {
            sessionId,
            ...result,
            resetAt: new Date(),
        };
    }

    private toRuntimeEvent(event: unknown): KernelSessionRuntimeEventResponseDto {
        if (event && typeof event === 'object' && !Array.isArray(event)) {
            const record = event as Record<string, unknown>;
            const { type, ...payload } = record;
            return {
                type: typeof type === 'string' && type.trim() ? type : 'event',
                payload,
            };
        }
        return {
            type: 'event',
            payload: { value: event },
        };
    }
}
