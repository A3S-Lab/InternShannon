import './shared/infrastructure/config/load-env';
import { Module } from '@nestjs/common';
import { ConfigModule as NestConfigModule } from '@nestjs/config';
import { DesktopAssetsRuntimeModule } from './runtime/desktop/desktop-assets-runtime.module';
import { DesktopConfigRuntimeModule } from './runtime/desktop/desktop-config-runtime.module';
import { DesktopIntegrationsRuntimeModule } from './runtime/desktop/desktop-integrations-runtime.module';
import { DesktopKernelRuntimeModule } from './runtime/desktop/desktop-kernel-runtime.module';
import { DesktopLoopRuntimeModule } from './runtime/desktop/desktop-loop-runtime.module';
import { DesktopSharedRuntimeModule } from './runtime/desktop/desktop-shared-runtime.module';
import { DesktopModeModule } from './runtime/desktop/desktop-mode.module';

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
export class InternShannonSidecarModule {}
