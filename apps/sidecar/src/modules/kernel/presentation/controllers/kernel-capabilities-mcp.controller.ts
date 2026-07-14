import { Body, Controller, Get, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
import { CapabilitiesMcpService } from '../../application/capabilities-mcp.service';
import { SkipApiResponse } from '@/shared/api';
import { DesktopApi } from '@/shared/security/desktop-access';
import { DesktopOwnerId } from '@/shared/security/decorators/desktop-owner.decorator';

@DesktopApi()
@Controller('kernel/mcp')
export class KernelCapabilitiesMcpController {
    constructor(private readonly mcp: CapabilitiesMcpService) {}

    @Get()
    @SkipApiResponse()
    eventStream(@Res() response: Response): void {
        response.setHeader('Allow', 'POST');
        response.status(405).end();
    }

    @Post()
    @SkipApiResponse()
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
