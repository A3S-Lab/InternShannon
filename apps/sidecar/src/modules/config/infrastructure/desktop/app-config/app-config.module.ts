import { Module } from '@nestjs/common';
import { AppConfigRepository } from './app-config.repository';
import { AppConfigService } from './app-config.service';

export const APP_CONFIG_SERVICE = 'APP_CONFIG_SERVICE';

@Module({
  providers: [
    AppConfigRepository,
    AppConfigService,
    { provide: APP_CONFIG_SERVICE, useExisting: AppConfigService },
  ],
  exports: [AppConfigService, APP_CONFIG_SERVICE],
})
export class AppConfigModule {}
