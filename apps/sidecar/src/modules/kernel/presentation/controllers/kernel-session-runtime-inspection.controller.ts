import { BadRequestException, Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiParam, ApiQuery, ApiTags } from '@nestjs/swagger';
import { DesktopApi } from '@/shared/security/desktop-access';
import { ApiOkResponse } from '@/shared/api/openapi';
import { NotFoundException } from '@/shared/common/errors';
import { DesktopOwnerId } from '@/shared/security/decorators/desktop-owner.decorator';
import { KernelMessageRunCancellationService } from '../../application/kernel-message-run-cancellation.service';
import { KernelSessionAccessService } from '../../application/kernel-session-access.service';
import { KernelSessionRuntimeAccessService } from '../../application/kernel-session-runtime-access.service';
import { VerifyKernelSessionCommandsRequestDto } from '../dto/request';
import {
    KernelSessionCancelResponseDto,
    KernelSessionRuntimeEventResponseDto,
} from '../dto/response';

@ApiTags('内核 - 会话运行检查')
@DesktopApi()
@Controller('kernel/sessions/:sessionId/runtime')
export class KernelSessionRuntimeInspectionController {
    constructor(
        private readonly runtimeAccess: KernelSessionRuntimeAccessService,
        private readonly sessionAccess: KernelSessionAccessService,
        private readonly cancellation: KernelMessageRunCancellationService,
    ) {}

    @Get('runs')
    @ApiOkResponse({ summary: '列出 SDK run 快照', type: Object })
    async runs(@Param('sessionId') sessionId: string, @DesktopOwnerId() userId: string): Promise<unknown> {
        return this.requireRuntime(sessionId, userId).then(active => active.session.runs());
    }

    @Get('runs/:runId/events')
    @ApiParam({ name: 'runId', description: 'SDK run ID' })
    @ApiOkResponse({ summary: '获取 SDK run 事件', type: Object })
    async runEvents(
        @Param('sessionId') sessionId: string,
        @Param('runId') runId: string,
        @DesktopOwnerId() userId: string,
    ): Promise<unknown> {
        return this.requireRuntime(sessionId, userId).then(active => active.session.runEvents(runId));
    }

    @Post('runs/:runId/cancel')
    @ApiParam({ name: 'runId', description: 'SDK run ID' })
    @ApiOkResponse({ summary: '取消指定 SDK run', type: KernelSessionCancelResponseDto })
    async cancelRun(
        @Param('sessionId') sessionId: string,
        @Param('runId') runId: string,
        @DesktopOwnerId() userId: string,
    ): Promise<KernelSessionCancelResponseDto> {
        await this.requireRuntime(sessionId, userId);
        const events: KernelSessionRuntimeEventResponseDto[] = [];
        await this.cancellation.cancelRun({
            sessionId,
            runId,
            emit: event => events.push(this.toRuntimeEvent(event)),
        });
        return { sessionId, events, cancelledAt: new Date() };
    }

    @Get('subagent-tasks')
    @ApiOkResponse({ summary: '列出子智能体任务', type: Object })
    async subagentTasks(
        @Param('sessionId') sessionId: string,
        @DesktopOwnerId() userId: string,
    ): Promise<unknown> {
        return this.requireRuntime(sessionId, userId).then(active => active.session.subagentTasks());
    }

    @Post('subagent-tasks/:taskId/cancel')
    @ApiParam({ name: 'taskId', description: '子智能体任务 ID' })
    @ApiOkResponse({ summary: '取消指定子智能体任务', type: KernelSessionCancelResponseDto })
    async cancelSubagentTask(
        @Param('sessionId') sessionId: string,
        @Param('taskId') taskId: string,
        @DesktopOwnerId() userId: string,
    ): Promise<KernelSessionCancelResponseDto> {
        await this.requireRuntime(sessionId, userId);
        const events: KernelSessionRuntimeEventResponseDto[] = [];
        await this.cancellation.cancelSubagentTask({
            sessionId,
            taskId,
            emit: event => events.push(this.toRuntimeEvent(event)),
        });
        return { sessionId, events, cancelledAt: new Date() };
    }

    @Get('verification')
    @ApiOkResponse({ summary: '获取会话验证报告与预设', type: Object })
    async verification(
        @Param('sessionId') sessionId: string,
        @DesktopOwnerId() userId: string,
    ): Promise<Record<string, unknown>> {
        const active = await this.requireRuntime(sessionId, userId);
        return {
            reports: active.session.verificationReports(),
            summary: active.session.verificationSummary(),
            summaryText: active.session.verificationSummaryText(),
            presets: active.session.verificationPresets(),
        };
    }

    @Post('verification/commands')
    @ApiOkResponse({ summary: '执行会话验证命令', type: Object })
    async verifyCommands(
        @Param('sessionId') sessionId: string,
        @Body() dto: VerifyKernelSessionCommandsRequestDto,
        @DesktopOwnerId() userId: string,
    ): Promise<unknown> {
        if (!Array.isArray(dto.commands) || dto.commands.length === 0) {
            throw new BadRequestException('commands is required');
        }
        const active = await this.requireRuntime(sessionId, userId);
        return active.session.verifyCommands(dto.subject, dto.commands);
    }

    @Get('artifact')
    @ApiQuery({ name: 'uri', description: 'artifact URI' })
    @ApiOkResponse({ summary: '读取 SDK tool/program artifact', type: Object })
    async artifact(
        @Param('sessionId') sessionId: string,
        @Query('uri') uri: string | undefined,
        @DesktopOwnerId() userId: string,
    ): Promise<unknown> {
        const artifactUri = uri?.trim();
        if (!artifactUri) throw new BadRequestException('uri is required');
        const active = await this.requireRuntime(sessionId, userId);
        const artifact = active.session.getArtifact(artifactUri);
        if (!artifact) throw new NotFoundException('Artifact not found');
        return artifact;
    }

    private async requireRuntime(sessionId: string, userId: string) {
        await this.sessionAccess.requireOwnedSession(sessionId, userId);
        const active = this.runtimeAccess.active(sessionId);
        if (!active) throw new NotFoundException('Kernel session runtime not found');
        return active;
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
        return { type: 'event', payload: { value: event } };
    }
}
