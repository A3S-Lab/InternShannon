import { Module } from '@nestjs/common';
import { CqrsModule } from '@nestjs/cqrs';
import { WechatAgentBridgeService, WechatChannelRuntimeService } from '@/modules/integrations/wechat/application';
import { WECHAT_CHANNEL_FACTORY, WECHAT_INTEGRATION_CONFIG_REPOSITORY } from '@/modules/integrations/wechat/domain';
import {
    ConfigServiceWechatConfigRepository,
    OpenClawWechatChannelFactory,
} from '@/modules/integrations/wechat/infrastructure';
import { WechatIntegrationController } from '@/modules/integrations/wechat/presentation/controllers/wechat-integration.controller';
import { DesktopConfigRuntimeModule } from './desktop-config-runtime.module';
import { DesktopKernelRuntimeModule } from './desktop-kernel-runtime.module';

@Module({
    imports: [DesktopConfigRuntimeModule, DesktopKernelRuntimeModule, CqrsModule],
    controllers: [WechatIntegrationController],
    providers: [
        WechatChannelRuntimeService,
        WechatAgentBridgeService,
        ConfigServiceWechatConfigRepository,
        OpenClawWechatChannelFactory,
        {
            provide: WECHAT_CHANNEL_FACTORY,
            useExisting: OpenClawWechatChannelFactory,
        },
        {
            provide: WECHAT_INTEGRATION_CONFIG_REPOSITORY,
            useExisting: ConfigServiceWechatConfigRepository,
        },
    ],
})
export class DesktopWechatIntegrationModule {}
