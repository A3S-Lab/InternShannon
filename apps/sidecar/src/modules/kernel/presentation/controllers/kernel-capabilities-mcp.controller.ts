import { Body, Controller, Get, HttpStatus, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
import { CapabilitiesMcpService } from '../../application/capabilities-mcp.service';
import { ApiRawResponse, SkipApiResponse } from '@/shared/api';
import { DesktopApi } from '@/shared/security/desktop-access';
import { DesktopOwnerId } from '@/shared/security/decorators/desktop-owner.decorator';

@DesktopApi()
@Controller('kernel/mcp')
export class KernelCapabilitiesMcpController {
    constructor(private readonly mcp: CapabilitiesMcpService) {}

    @Get()
    @SkipApiResponse()
    @ApiRawResponse({
        status: HttpStatus.METHOD_NOT_ALLOWED,
        summary: '拒绝通过 GET 调用 MCP',
        description: '知识库 MCP 使用无状态 JSON-RPC POST 传输，GET 请求仅返回允许的方法。',
    })
    eventStream(@Res() response: Response): void {
        response.setHeader('Allow', 'POST');
        response.status(405).end();
    }

    @Post()
    @SkipApiResponse()
    @ApiRawResponse({
        summary: '调用知识库 MCP JSON-RPC 接口',
        description: '处理 MCP 初始化、工具发现以及只读知识库搜索和读取调用。',
        contentType: 'application/json',
    })
    async handle(
        @Body() body: unknown,
        @DesktopOwnerId() userId: string,
        @Res({ passthrough: true }) response: Response,
    ): Promise<Record<string, unknown> | undefined> {
        const result = await this.mcp.handle(body, userId || 'desktop-user');
        response.status(result.status);
        return result.body;
    }
}
