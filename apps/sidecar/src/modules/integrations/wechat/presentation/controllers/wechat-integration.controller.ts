import { Body, Controller, Get, Patch } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ConfigManagementApi } from '@/shared/security/desktop-access';
import { ApiOkResponse } from '@/shared/api/openapi';
import { WechatChannelRuntimeService } from '../../application';

@ApiTags('第三方集成 - 微信（管理员）')
@ConfigManagementApi()
@Controller('integrations/wechat')
export class WechatIntegrationController {
    constructor(private readonly runtime: WechatChannelRuntimeService) {}

    @Get('status')
    @ApiOkResponse({ summary: '获取微信集成全局状态' })
    status(): { enabled: boolean } {
        return { enabled: this.runtime.isGlobalEnabled() };
    }

    @Patch('config')
    @ApiOkResponse({ summary: '启用/停用微信集成（全局开关）' })
    async updateConfig(@Body() body: { enabled?: boolean }): Promise<{ enabled: boolean }> {
        if (body.enabled !== undefined) {
            await this.runtime.setGlobalEnabled(body.enabled);
        }
        return { enabled: this.runtime.isGlobalEnabled() };
    }
}
