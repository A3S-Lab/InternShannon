import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ApiOkResponse } from '@/shared/api/openapi';
import { ConfigServiceImpl } from '../../application/config.service';
import { SystemInfoResponseDto } from '../dto';
import { Public } from '@/shared/security/public.decorator';

@ApiTags('系统 - 公开配置')
@Public()
@Controller('config/public')
export class ConfigPublicController {
  constructor(private readonly configService: ConfigServiceImpl) {}

  @Get('system-info')
  @ApiOkResponse({
    summary: '获取公开系统信息',
    description: '获取登录页和启动页可展示的应用名称、Logo 和版本信息',
    type: SystemInfoResponseDto,
  })
  async getSystemInfo(): Promise<SystemInfoResponseDto> {
    const settings = await this.configService.getPlatformSettings();
    return {
      appName: settings.appName,
      logoUrl: settings.logoUrl,
      version: process.env.APP_VERSION || '1.0.0',
    };
  }
}
