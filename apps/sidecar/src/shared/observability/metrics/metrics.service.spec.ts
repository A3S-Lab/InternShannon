import { MetricsService } from './metrics.service';

describe('MetricsService', () => {
    it('keeps counters with different label values in separate series', () => {
        const metrics = new MetricsService();

        metrics.incCounter('kernel_tool_errors_total', { tool: 'web_search' });
        metrics.incCounter('kernel_tool_errors_total', { tool: 'web_search' });
        metrics.incCounter('kernel_tool_errors_total', { tool: 'bash' });

        expect(metrics.getCounter('kernel_tool_errors_total', { tool: 'web_search' })).toBe(2);
        expect(metrics.getCounter('kernel_tool_errors_total', { tool: 'bash' })).toBe(1);
        // Without labels the unlabeled series exists from initializeMetrics
        // defaults but the labeled values must NOT have aliased onto it.
        expect(metrics.getCounter('kernel_tool_errors_total')).toBe(0);
    });

    it('is insensitive to label key ordering when looking up a series', () => {
        const metrics = new MetricsService();

        metrics.incCounter('kernel_tool_errors_total', { tool: 'web_search', region: 'cn' });
        // Same logical series, different key order
        expect(metrics.getCounter('kernel_tool_errors_total', { region: 'cn', tool: 'web_search' })).toBe(1);
    });

    it('emits Prometheus bucket histogram lines with labels and +Inf bucket', () => {
        const metrics = new MetricsService();
        metrics.observeHistogram('kernel_tool_duration_seconds', 0.005, { tool: 'ls', status: 'success' });
        metrics.observeHistogram('kernel_tool_duration_seconds', 1.2, { tool: 'ls', status: 'success' });
        metrics.observeHistogram('kernel_tool_duration_seconds', 9.9, { tool: 'ls', status: 'success' });

        const output = metrics.toPrometheusFormat();

        // Each bucket line should be cumulative-count format
        expect(output).toContain(
            'kernel_tool_duration_seconds_bucket{le="0.01",status="success",tool="ls"} 1',
        );
        expect(output).toContain(
            'kernel_tool_duration_seconds_bucket{le="2.5",status="success",tool="ls"} 2',
        );
        expect(output).toContain(
            'kernel_tool_duration_seconds_bucket{le="+Inf",status="success",tool="ls"} 3',
        );
        expect(output).toContain(
            'kernel_tool_duration_seconds_count{status="success",tool="ls"} 3',
        );
        expect(output).toMatch(/kernel_tool_duration_seconds_sum\{status="success",tool="ls"\} 11\.10[0-9]*/);
    });

    it('emits Prometheus counter lines with sorted labels', () => {
        const metrics = new MetricsService();
        metrics.incCounter('kernel_stream_stalled_total', { active_tool: 'web_search' });
        metrics.incCounter('kernel_stream_stalled_total', { active_tool: 'none' });

        const output = metrics.toPrometheusFormat();

        expect(output).toContain('# TYPE kernel_stream_stalled_total counter');
        expect(output).toContain('kernel_stream_stalled_total{active_tool="web_search"} 1');
        expect(output).toContain('kernel_stream_stalled_total{active_tool="none"} 1');
    });

    it('escapes special characters in label values so a quoted name does not break the format', () => {
        const metrics = new MetricsService();
        metrics.incCounter('kernel_tool_errors_total', { tool: 'evil"\\name' });

        const output = metrics.toPrometheusFormat();
        expect(output).toContain('kernel_tool_errors_total{tool="evil\\"\\\\name"} 1');
    });

    it('treats decGauge symmetrically and surfaces the live value through getGauge', () => {
        const metrics = new MetricsService();
        metrics.setGauge('http_active_requests', 5);
        metrics.decGauge('http_active_requests');
        expect(metrics.getGauge('http_active_requests')).toBe(4);
    });
});
