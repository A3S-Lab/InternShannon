import { Module } from '@nestjs/common';
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';
import { ApiResponseInterceptor } from '@/shared/api/api-response';
import { ApiVersioningInterceptor } from '@/shared/api/api-versioning';
import { GlobalErrorFilter } from '@/shared/common/errors';
import { HealthController } from '@/shared/observability/health/health.controller';
import { MetricsModule } from '@/shared/observability/metrics';

@Module({
    imports: [MetricsModule],
    controllers: [HealthController],
    providers: [
        {
            provide: APP_INTERCEPTOR,
            useClass: ApiVersioningInterceptor,
        },
        {
            provide: APP_INTERCEPTOR,
            useClass: ApiResponseInterceptor,
        },
        {
            provide: APP_FILTER,
            useClass: GlobalErrorFilter,
        },
    ],
})
export class DesktopSharedRuntimeModule {}
