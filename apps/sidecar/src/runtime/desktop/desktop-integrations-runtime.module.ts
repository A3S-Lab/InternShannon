import { Module } from '@nestjs/common';
import { DesktopWechatIntegrationModule } from './desktop-wechat-integration.module';

@Module({
    imports: [DesktopWechatIntegrationModule],
})
export class DesktopIntegrationsRuntimeModule {}
