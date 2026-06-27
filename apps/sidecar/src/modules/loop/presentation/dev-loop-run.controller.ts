import { Body, Controller, Param, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { AuthenticatedApi } from '@/shared/security/desktop-access';
import { ApiOkResponse } from '@/shared/api/openapi';
import { NotFoundException } from '@/shared/common/errors';
import { DevLoopRunService } from '../application/dev-loop-run.service';
import {
    CreateDevLoopRunRequestDto,
    FinalizeDevLoopRunRequestDto,
    RecordDevIterationRequestDto,
} from './dto/loop-run.request.dto';
import { LoopRunResponseDto, toLoopRunDto } from './dto/loop-run.response.dto';

/**
 * Dev loop trigger API — the WebIDE 内核循环 panel drives generate→verify→repair interactively
 * (review §4.3: the turn loop is the real driver, not the LoopRunDriver). Each call routes through
 * DevLoopRunService → fenced claim→commit, so dev runs share the loop-runs observability.
 */
@ApiTags('循环工程 - 内核循环')
@AuthenticatedApi()
@Controller('loops/dev')
export class DevLoopRunController {
    constructor(private readonly service: DevLoopRunService) {}

    @Post('runs')
    @ApiOkResponse({ summary: '启动内核循环', description: '创建绑定资产的自主修复循环(generate→verify→repair)', type: LoopRunResponseDto })
    async create(@Body() body: CreateDevLoopRunRequestDto): Promise<LoopRunResponseDto> {
        const run = await this.service.createRun({
            assetId: body.assetId,
            ref: body.ref,
            goal: body.goal,
            maxIterations: body.maxIterations ?? 6,
        });
        return toLoopRunDto(run);
    }

    @Post('runs/:id/iterations')
    @ApiOkResponse({ summary: '记录一轮迭代', description: '追加 generate→verify→repair 一轮的结果', type: LoopRunResponseDto })
    async record(@Param('id') id: string, @Body() body: RecordDevIterationRequestDto): Promise<LoopRunResponseDto> {
        const run = await this.service.recordIteration(
            id,
            {
                turn: body.turn,
                mutatedFiles: body.mutatedFiles,
                verify: { passed: body.verifyPassed, reportId: body.verifyReportId, failedScopes: body.verifyFailedScopes },
                repaired: body.repaired,
                note: body.note,
            },
            { status: body.awaitingHuman ? 'awaiting_human' : 'running', errorSignature: body.errorSignature },
        );
        if (!run) {
            throw new NotFoundException('内核循环运行未找到或已结束');
        }
        return toLoopRunDto(run);
    }

    @Post('runs/:id/finalize')
    @ApiOkResponse({ summary: '终结内核循环', description: '置为 succeeded / failed / terminated / cancelled', type: LoopRunResponseDto })
    async finalize(@Param('id') id: string, @Body() body: FinalizeDevLoopRunRequestDto): Promise<LoopRunResponseDto> {
        const run = await this.service.finalize(id, body.status, body.errorSignature);
        if (!run) {
            throw new NotFoundException('内核循环运行未找到或已结束');
        }
        return toLoopRunDto(run);
    }
}
