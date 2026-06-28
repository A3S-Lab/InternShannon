import { Global, Module } from '@nestjs/common';
import { APP_MODE, isCloud, isDesktop } from '@/shared/constants';

export const APP_MODE_TOKEN = Symbol('APP_MODE');

export interface AppModeConfig {
    mode: string;
    isCloud: boolean;
    isDesktop: boolean;
}

@Global()
@Module({
    providers: [
        {
            provide: APP_MODE_TOKEN,
            useValue: {
                mode: APP_MODE,
                isCloud: isCloud(),
                isDesktop: isDesktop(),
            } as AppModeConfig,
        },
    ],
    exports: [APP_MODE_TOKEN],
})
export class DesktopModeModule {}
