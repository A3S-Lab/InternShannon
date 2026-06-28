import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { DesktopCapabilityApi } from '@/shared/security/desktop-access';
import { ApiOkResponse } from '@/shared/api/openapi';
import {
    ClawSentrySupervisorService,
    type ClawSentryPublicStatus,
} from '../../application/clawsentry-supervisor.service';

@ApiTags('内核 - 安全')
@DesktopCapabilityApi('platform:runtime:access')
@Controller('kernel/security')
export class KernelSecurityController {
    constructor(private readonly clawSentry: ClawSentrySupervisorService) {}

    @Get('clawsentry/status')
    @ApiOkResponse({ summary: '获取 ClawSentry 安全网关状态', type: Object })
    status(): ClawSentryPublicStatus {
        return this.clawSentry.status();
    }
}
