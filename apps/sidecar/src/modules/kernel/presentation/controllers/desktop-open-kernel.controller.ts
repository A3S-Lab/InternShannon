import { Controller, Get, Query } from '@nestjs/common';
import { ApiQuery, ApiTags } from '@nestjs/swagger';
import { ApiOkResponse, ApiServerErrorResponse } from '@/shared/api';
import { Public } from '@/shared/security/public.decorator';
import { type AgentSummary, listAgentSummaries } from '../../application/agents/agent-display-metadata';
import { AgentRegistry } from '../../application/agents/agent-registry';
import { AgentSummaryResponseDto } from '../dto/response';

@ApiTags('桌面内核开放接口')
@Public()
@Controller('open/kernel')
export class DesktopOpenKernelController {
    constructor(private readonly agentRegistry: AgentRegistry) {}

    @Get('agents')
    @ApiOkResponse({
        summary: '获取桌面运行时智能体列表',
        description: '返回桌面 sidecar 当前可用的智能体 ID、展示名称和能力介绍。',
        responseDescription: '返回可用智能体列表',
        type: AgentSummaryResponseDto,
        isArray: true,
    })
    @ApiQuery({ name: 'keyword', required: false, description: '按 agentId、名称或描述搜索' })
    @ApiQuery({ name: 'limit', required: false, description: '返回数量上限，默认 20' })
    @ApiServerErrorResponse()
    getAgents(@Query('keyword') keyword?: string, @Query('limit') rawLimit?: string): AgentSummary[] {
        return listAgentSummaries(this.agentRegistry.list(), keyword, rawLimit);
    }
}
