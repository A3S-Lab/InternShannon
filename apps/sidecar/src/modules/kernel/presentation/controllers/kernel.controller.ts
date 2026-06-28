import {
    BadRequestException,
    Body,
    Controller,
    Delete,
    Get,
    HttpCode,
    HttpStatus,
    Inject,
    Param,
    Patch,
    Post,
    Query,
} from '@nestjs/common';
import { CommandBus, QueryBus } from '@nestjs/cqrs';
import { ApiQuery, ApiTags } from '@nestjs/swagger';
import { AssetAccessService } from '@/modules/assets/application/asset-access.service';
import { Asset } from '@/modules/assets/domain/entities/asset.entity';
import { DesktopApi, RequireDesktopCapabilities } from '@/shared/security/desktop-access';
import { ApiCreatedResponse, ApiNoContentResponse, ApiOkResponse, ApiPaginatedResponse } from '@/shared/api/openapi';
import {
    PaginatedResponseDto,
    PaginationQueryDto,
    parsePaginationOptions,
    toPaginatedResponse,
} from '@/shared/api/presentation/dto/pagination.dto';
import { DesktopOwnerId } from '@/shared/security/decorators/desktop-owner.decorator';
import {
    applyLockedAgentMetadata,
    isLockedAgent,
    lockedSessionViolation,
} from '../../application/agents/locked-agent.policy';
import type { CapabilityResult } from '../../application/capabilities-tool.service';
import { CapabilitiesToolService } from '../../application/capabilities-tool.service';
import { CreateSessionCommand } from '../../application/commands/create-session';
import { EndSessionCommand } from '../../application/commands/end-session';
import { KernelSessionAccessService } from '../../application/kernel-session-access.service';
import { CountSessionsQuery } from '../../application/queries/count-sessions';
import { ListSessionsQuery } from '../../application/queries/list-sessions';
import { SessionService } from '../../application/session.service';
import { Message } from '../../domain/entities/message.entity';
import { Session } from '../../domain/entities/session.entity';
import { IKernelService, KERNEL_SERVICE } from '../../domain/services/kernel-service.interface';
import { CapabilitiesQueryDto, CreateSessionRequestDto, ListSessionsQueryDto } from '../dto/request';
import {
    CreateSessionResponseDto,
    MessageResponseDto,
    SessionBoundAssetResponseDto,
    SessionResponseDto,
} from '../dto/response';

@ApiTags('内核')
@DesktopApi()
@Controller('kernel')
export class KernelController {
    constructor(
        private readonly commandBus: CommandBus,
        private readonly queryBus: QueryBus,
        @Inject(KERNEL_SERVICE)
        private readonly kernelService: IKernelService,
        private readonly sessionService: SessionService,
        private readonly capabilitiesTool: CapabilitiesToolService,
        private readonly sessionAccess: KernelSessionAccessService,
        private readonly assetAccess: AssetAccessService,
    ) {}

    @Post('sessions')
    @RequireDesktopCapabilities('agent:deploy')
    @ApiCreatedResponse({
        summary: '创建新会话',
        description:
            '在内核中创建一个新的会话实例（部署进程），用于执行智能体任务和管理工作区。需要 agent:deploy 权限（member/admin 默认具备，viewer 不可部署）。',
        type: CreateSessionResponseDto,
    })
    async createSession(
        @Body() dto: CreateSessionRequestDto,
        @DesktopOwnerId() userId: string,
    ): Promise<CreateSessionResponseDto> {
        const resolvedUserId = this.resolveUserId(userId);
        await this.sessionAccess.assertWorkspacePathAccess(dto.cwd, resolvedUserId);
        const violation = lockedSessionViolation(dto.agentId, dto);
        if (violation) throw new BadRequestException(violation);
        const locked = isLockedAgent(dto.agentId);
        const baseMetadata = this.toSessionMetadata(dto);
        if (locked) {
            baseMetadata.titleSource = typeof dto.title === 'string' && dto.title.trim() ? 'manual' : 'temporary';
        }
        const metadata = locked ? applyLockedAgentMetadata(baseMetadata) : baseMetadata;
        const session = await this.commandBus.execute(
            new CreateSessionCommand(dto.agentId, resolvedUserId, dto.title, dto.cwd, metadata),
        );
        return {
            success: true,
            session: {
                sessionId: session.id,
                title: session.title,
                cwd: session.cwd,
                agentId: session.agentId,
                model: this.sessionService.stringMeta(session, 'model'),
                followDefaultModel: this.sessionService.booleanMeta(session, 'followDefaultModel'),
                permissionMode: this.sessionService.stringMeta(session, 'permissionMode'),
                metadata: this.sessionService.pickPublicSessionMetadata(session.metadata),
                assetId: this.sessionService.stringMeta(session, 'assetId'),
                agentPhase: this.sessionService.stringMeta(session, 'agentPhase'),
                workingDirectory: session.cwd,
            },
        };
    }

    @Get('sessions')
    @ApiPaginatedResponse({
        summary: '获取会话列表',
        description: '查询当前用户的所有会话，支持分页和按状态过滤',
        type: SessionResponseDto,
    })
    async listSessions(
        @DesktopOwnerId() userId: string,
        // 用户总览页传 conversational=true：只看「真正的对话」，排除资产开发/编排/devops/系统等
        // 功能内部运行时会话。后台「会话」管理页不传，仍看全部。过滤同时作用于列表与 total，
        // 否则分页语义会错乱。`conversational` 必须在 DTO 白名单内，否则 cloud 模式
        // forbidNonWhitelisted 会判其为多余属性直接 400（见 ListSessionsQueryDto）。
        @Query() pagination: ListSessionsQueryDto,
    ): Promise<PaginatedResponseDto<SessionResponseDto>> {
        const { page, limit, offset } = parsePaginationOptions(pagination);
        const conversationalOnly = pagination.conversational === 'true' || pagination.conversational === '1';
        // Desktop 默认只有本地用户；保留 includeAllUsers 形态以兼容旧的分页查询路径。
        const includeAllUsers = await this.sessionAccess.isPlatformBypassUser(userId);
        const resolvedUserId = this.resolveUserId(userId);
        // 列表已在 SQL 层 LIMIT/OFFSET 分页；total 走独立 COUNT(*)，不再用「当前页行数」冒充总数
        // （旧逻辑 total=items.length 会被 limit 钳住，删会话也不见少，看起来像「删了还在算」）。
        const [sessions, total] = await Promise.all([
            this.queryBus.execute<ListSessionsQuery, Session[]>(
                new ListSessionsQuery(resolvedUserId, limit, offset, includeAllUsers, conversationalOnly),
            ),
            this.queryBus.execute<CountSessionsQuery, number>(
                new CountSessionsQuery(resolvedUserId, includeAllUsers, conversationalOnly),
            ),
        ]);
        // sessions 已是当前页（service 分页返回），直接映射，不再二次 slice（旧 slice 对 page>1 会清空）。
        const items = await Promise.all(sessions.map(session => this.toSessionResponse(session)));
        return toPaginatedResponse({
            items,
            total,
            page,
            limit,
        });
    }

    @Get('sessions/:id')
    @ApiOkResponse({
        summary: '获取会话详情',
        description: '根据会话ID获取详细信息，包括配置、状态和元数据',
        type: SessionResponseDto,
    })
    async getSession(@Param('id') id: string, @DesktopOwnerId() userId: string) {
        const session = await this.sessionAccess.requireOwnedSession(id, userId);
        return this.toSessionResponse(session, userId, true);
    }

    @Patch('sessions/:id')
    @HttpCode(HttpStatus.OK)
    @ApiOkResponse({
        summary: '更新会话配置',
        description: '修改会话的名称、模型、权限模式等配置项',
        type: SessionResponseDto,
    })
    async updateSession(
        @Param('id') id: string,
        @Body() patch: Record<string, unknown>,
        @DesktopOwnerId() userId: string,
    ): Promise<SessionResponseDto | null> {
        const current = await this.sessionAccess.requireOwnedSession(id, userId);
        const violation = lockedSessionViolation(current?.agentId, patch);
        if (violation) throw new BadRequestException(violation);
        const locked = isLockedAgent(current?.agentId);
        if (typeof patch.cwd === 'string') {
            await this.sessionAccess.assertWorkspacePathAccess(patch.cwd, userId);
        }
        const effectivePatchBase = this.markManualTitleSource(patch);
        const effectivePatch = locked ? applyLockedAgentMetadata(effectivePatchBase) : effectivePatchBase;
        const session = await this.kernelService.updateSession(id, effectivePatch);
        return session ? this.toSessionResponse(session) : null;
    }

    @Delete('sessions/:id')
    @HttpCode(HttpStatus.NO_CONTENT)
    @ApiNoContentResponse('结束并删除指定的会话，释放相关资源')
    async endSession(@Param('id') id: string, @DesktopOwnerId() userId: string) {
        await this.sessionAccess.requireOwnedSession(id, userId);
        const command = new EndSessionCommand(id);
        return this.commandBus.execute(command);
    }

    @Get('sessions/:id/messages')
    @ApiPaginatedResponse({
        summary: '获取消息列表',
        description: '查询指定会话的所有消息记录，支持分页查询',
        type: MessageResponseDto,
    })
    async getSessionMessages(
        @Param('id') id: string,
        @Query() pagination: PaginationQueryDto,
        @DesktopOwnerId() userId: string,
    ): Promise<PaginatedResponseDto<MessageResponseDto>> {
        await this.sessionAccess.requireOwnedSession(id, userId);
        const { page, limit, offset } = parsePaginationOptions(pagination);
        const messages = await this.kernelService.getSessionMessages(id);
        const items = messages.map(message => this.toMessageResponse(message));
        return toPaginatedResponse({
            items: items.slice(offset, offset + limit),
            total: items.length,
            page,
            limit,
        });
    }

    @Get('capabilities')
    @HttpCode(HttpStatus.OK)
    @ApiQuery({
        name: 'action',
        required: false,
        enum: ['list', 'describe', 'search'],
    })
    @ApiQuery({
        name: 'module',
        required: false,
        description: '模块名称（用于 describe）',
    })
    @ApiQuery({
        name: 'query',
        required: false,
        description: '搜索关键词（用于 search）',
    })
    @ApiOkResponse({
        summary: '渐进式 API 能力发现',
        description: '通过单一端点列出、描述或搜索内核 API 能力信息',
        type: Object,
    })
    async getCapabilities(
        @Query() dto: CapabilitiesQueryDto,
        @DesktopOwnerId() userId: string,
    ): Promise<CapabilityResult> {
        try {
            return await this.capabilitiesTool.dispatch(dto, userId);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            throw new BadRequestException(message);
        }
    }

    private resolveUserId(userId?: string | null): string {
        return this.sessionAccess.resolveUserId(userId);
    }

    private toSessionMetadata(dto: CreateSessionRequestDto): Record<string, unknown> {
        return {
            ...this.sessionService.pickSessionMetadata(dto.metadata),
            model: dto.model,
            followDefaultModel: dto.followDefaultModel ?? !dto.model,
            permissionMode: dto.permissionMode,
            systemPrompt: dto.systemPrompt,
            skills: dto.skills,
            skillDirs: dto.skillDirs,
            mcpServers: dto.mcpServers,
            builtinSkills: dto.builtinSkills,
            enforceActiveSkillToolRestrictions: dto.enforceActiveSkillToolRestrictions,
            planningMode: dto.planningMode,
            goalTracking: dto.goalTracking,
            maxToolRounds: dto.maxToolRounds,
            maxParseRetries: dto.maxParseRetries,
            circuitBreakerThreshold: dto.circuitBreakerThreshold,
            continuationEnabled: dto.continuationEnabled,
            maxContinuationTurns: dto.maxContinuationTurns,
            autoCompact: dto.autoCompact,
            autoCompactThreshold: dto.autoCompactThreshold,
            temperature: dto.temperature,
            thinkingBudget: dto.thinkingBudget,
            searchConfig: dto.searchConfig,
            clawSentry: dto.clawSentry,
            workerAgents: dto.workerAgents,
            inlineSkills: dto.inlineSkills,
            autoDelegation: dto.autoDelegation,
            autoParallel: dto.autoParallel,
            maxParallelTasks: dto.maxParallelTasks,
            artifactStoreLimits: dto.artifactStoreLimits,
            retentionLimits: dto.retentionLimits,
            toolTimeoutMs: dto.toolTimeoutMs,
            queueTimeoutMs: dto.queueTimeoutMs,
            maxExecutionTimeMs: dto.maxExecutionTimeMs,
            streamStallWarningMs: dto.streamStallWarningMs,
            streamStallHardMs: dto.streamStallHardMs,
            streamStallActiveToolHardMs: dto.streamStallActiveToolHardMs,
            maxConsecutiveToolErrors: dto.maxConsecutiveToolErrors,
            maxStreamRetries: dto.maxStreamRetries,
        };
    }

    private markManualTitleSource(patch: Record<string, unknown>): Record<string, unknown> {
        const hasTitlePatch =
            (typeof patch.title === 'string' && patch.title.trim()) ||
            (typeof patch.name === 'string' && patch.name.trim());
        if (!hasTitlePatch) return patch;

        const metadataPatch =
            patch.metadata && typeof patch.metadata === 'object' && !Array.isArray(patch.metadata)
                ? (patch.metadata as Record<string, unknown>)
                : undefined;
        if (patch.titleSource !== undefined || metadataPatch?.titleSource !== undefined) {
            return patch;
        }
        return { ...patch, titleSource: 'manual' };
    }

    private async toSessionResponse(
        session: Session,
        userId?: string,
        includeBoundAsset = false,
    ): Promise<SessionResponseDto> {
        const assetId = this.sessionService.stringMeta(session, 'assetId');
        return {
            id: session.id,
            sessionId: session.id,
            agentId: session.agentId || '',
            userId: session.userId,
            title: session.title,
            cwd: session.cwd,
            status: session.status,
            createdAt: session.createdAt,
            updatedAt: session.updatedAt,
            model: this.sessionService.stringMeta(session, 'model'),
            followDefaultModel: this.sessionService.booleanMeta(session, 'followDefaultModel'),
            permissionMode: this.sessionService.stringMeta(session, 'permissionMode'),
            metadata: this.sessionService.pickPublicSessionMetadata(session.metadata),
            assetId,
            boundAsset: includeBoundAsset && assetId ? await this.resolveBoundAsset(assetId, userId) : undefined,
            agentPhase: this.sessionService.stringMeta(session, 'agentPhase'),
            workingDirectory: session.cwd,
        };
    }

    private async resolveBoundAsset(
        assetId: string,
        userId?: string,
    ): Promise<SessionBoundAssetResponseDto | undefined> {
        try {
            return this.toBoundAssetResponse(await this.assetAccess.requireRead(assetId, userId));
        } catch {
            return undefined;
        }
    }

    private toBoundAssetResponse(asset: Asset): SessionBoundAssetResponseDto {
        const lifecycle = asset.metadata?.assetLifecycle;
        const lifecycleState =
            lifecycle && typeof lifecycle === 'object' && !Array.isArray(lifecycle)
                ? ((lifecycle as Record<string, unknown>).state as string | undefined)
                : undefined;
        return {
            id: asset.id,
            name: asset.name,
            category: asset.category,
            visibility: asset.visibility,
            description: asset.description,
            lifecycleState,
            starCount: asset.starCount ?? 0,
            forkCount: asset.forkCount ?? 0,
            createdAt: asset.createdAt,
            updatedAt: asset.updatedAt,
        };
    }

    private toMessageResponse(message: Message): MessageResponseDto {
        return {
            id: message.id,
            sessionId: message.sessionId,
            role: message.role,
            content: message.content,
            metadata: message.metadata,
            createdAt: message.createdAt,
        };
    }
}
