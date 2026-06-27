import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { AuthenticatedApi } from '@/shared/security/desktop-access';
import { ApiOkResponse } from '@/shared/api/openapi';
import { ConfigServiceImpl } from '../application/config.service';
import { MenuPlugin } from '../domain/services/settings-schema';

/**
 * 菜单插件读取端点。Desktop 前端读取「启用」的插件来合并本地侧栏菜单。
 * 旧版 superAdminOnly / permission 字段仅作为前端兼容元数据保留。
 * 管理(增删改)走平台配置保存，不在此端点。
 */
@ApiTags('系统 - 菜单插件')
@AuthenticatedApi()
@Controller('plugins')
export class PluginsController {
    constructor(private readonly configService: ConfigServiceImpl) {}

    @Get('menu')
    @ApiOkResponse({
        summary: '获取启用的菜单插件',
        description: '返回所有 enabled 插件;前端据此合并本地侧栏',
        type: [MenuPlugin],
    })
    async listMenuPlugins(): Promise<MenuPlugin[]> {
        const settings = await this.configService.getPlatformSettings();
        return (settings.menuPlugins ?? []).filter(plugin => plugin.enabled !== false);
    }
}
