// ============================================================================
// Metrics Controller - Exposes /metrics endpoint for Prometheus
// ============================================================================

import { Controller, Get, Header } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ApiOkResponse, ApiRawResponse, SkipApiResponse } from '../../api';
import { MetricsService } from './metrics.service';
import { Public } from '@/shared/security/public.decorator';

@ApiTags('健康与指标 - Prometheus 指标')
@Public()
@Controller('metrics')
export class MetricsController {
    constructor(private readonly metricsService: MetricsService) {}

    @Get()
    @Header('Content-Type', 'text/plain')
    @SkipApiResponse()
    @ApiRawResponse({ summary: '获取 Prometheus 指标', description: '以 Prometheus 文本格式返回运行指标', contentType: 'text/plain' })
    getMetrics(): string {
        return this.metricsService.toPrometheusFormat();
    }

    @Get('json')
    @ApiOkResponse({ summary: '获取 JSON 指标', description: '以 JSON 格式返回运行指标' })
    getMetricsJson(): Record<string, unknown> {
        return this.metricsService.toJSON();
    }
}
