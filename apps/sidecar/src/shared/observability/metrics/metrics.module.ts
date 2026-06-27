// ============================================================================
// Metrics Module — exposes Prometheus /metrics endpoint and a globally
// injectable MetricsService for any module to record counters / histograms.
// ============================================================================

import { Global, Module } from '@nestjs/common';
import { MetricsController } from './metrics.controller';
import { MetricsService } from './metrics.service';

@Global()
@Module({
    controllers: [MetricsController],
    providers: [MetricsService],
    exports: [MetricsService],
})
export class MetricsModule {}
