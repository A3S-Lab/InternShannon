import './shared/infrastructure/config/load-env';
import { Module } from '@nestjs/common';
import { ConfigModule as NestConfigModule } from '@nestjs/config';
import { DesktopAssetsRuntimeModule } from './desktop-runtime/desktop-assets-runtime.module';
import { DesktopConfigRuntimeModule } from './desktop-runtime/desktop-config-runtime.module';
import { DesktopIntegrationsRuntimeModule } from './desktop-runtime/desktop-integrations-runtime.module';
import { DesktopKernelRuntimeModule } from './desktop-runtime/desktop-kernel-runtime.module';
import { DesktopLoopRuntimeModule } from './desktop-runtime/desktop-loop-runtime.module';
import { DesktopSharedRuntimeModule } from './desktop-runtime/desktop-shared-runtime.module';
import { DesktopModeModule } from './modules/desktop-mode/desktop-mode.module';

process.env.APP_MODE = 'desktop';
process.env.KERNEL_WORKSPACE_STORAGE_PROVIDER ||= 'local';
process.env.PIPELINE_RUNNER_DRIVER = 'none';

@Module({
    imports: [
        NestConfigModule.forRoot({
            isGlobal: true,
            envFilePath: [
                'env/.env.local',
                `env/.env.${process.env.NODE_ENV}`,
                'env/.env',
            ],
            ignoreEnvFile: false,
            expandVariables: true,
        }),
        DesktopSharedRuntimeModule,
        DesktopModeModule,
        DesktopConfigRuntimeModule,
        DesktopAssetsRuntimeModule,
        DesktopKernelRuntimeModule,
        DesktopLoopRuntimeModule,
        DesktopIntegrationsRuntimeModule,
    ],
})
export class ShuxiaoanSidecarModule {}
