// ============================================================================
// Health Controller - Health check endpoints (stubbed)
// ============================================================================

import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ApiOkResponse } from '../../api/openapi';
import { Public } from '@/shared/security/public.decorator';

@ApiTags('健康与指标 - 健康检查')
@Public()
@Controller()
export class HealthController {
    @Get('health')
    @ApiOkResponse({ summary: '健康检查', description: '服务健康' })
    async check(): Promise<{ status: string }> {
        return { status: 'ok' };
    }

    @Get('health/live')
    @ApiOkResponse({ summary: '存活探针', description: '服务存活' })
    live(): { status: string } {
        return { status: 'ok' };
    }

    @Get('health/ready')
    @ApiOkResponse({ summary: '就绪探针', description: '服务就绪' })
    async ready(): Promise<{ status: string }> {
        return { status: 'ok' };
    }
}
