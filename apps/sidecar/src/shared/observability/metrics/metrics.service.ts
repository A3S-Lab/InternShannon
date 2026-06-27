// ============================================================================
// Metrics Service - local desktop sidecar metrics
// ============================================================================

import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';

/**
 * Counter metric - for counting events (e.g., requests, errors)
 */
export interface CounterMetric {
    name: string;
    help: string;
    labelNames?: string[];
}

/**
 * Gauge metric - for current values (e.g., queue size, memory usage)
 */
export interface GaugeMetric {
    name: string;
    help: string;
    labelNames?: string[];
}

/**
 * Histogram metric - for distributions (e.g., request duration, response size)
 */
export interface HistogramMetric {
    name: string;
    help: string;
    labelNames?: string[];
    buckets?: number[];
}

/**
 * Default buckets for HTTP request duration
 */
export const DEFAULT_HISTOGRAM_BUCKETS = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];

/**
 * Default buckets for HTTP request size in bytes
 */
export const DEFAULT_SIZE_BUCKETS = [100, 1000, 10000, 100000, 1000000, 10000000];

/**
 * Buckets for local kernel run durations (seconds).
 */
export const KERNEL_RUN_BUCKETS = [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 20, 30, 60, 90, 120, 180];

/**
 * Metrics Service - provides Prometheus-compatible metrics
 */
@Injectable()
export class MetricsService implements OnModuleDestroy {
    private readonly logger = new Logger(MetricsService.name);
    private readonly counters: Map<string, number> = new Map();
    private readonly gauges: Map<string, number> = new Map();
    private readonly histograms: Map<string, number[]> = new Map();

    // Default metrics
    private readonly defaultCounters: CounterMetric[] = [
        { name: 'http_requests_total', help: 'Total HTTP requests', labelNames: ['method', 'path', 'status'] },
        { name: 'http_errors_total', help: 'Total HTTP errors', labelNames: ['method', 'path', 'status'] },
        {
            name: 'kernel_runtime_agent_created_total',
            help: 'Kernel SDK `Agent.create()` 累计调用次数。SDK 3.2.x 的 Agent 无 close() API,每次创建都会让 napi 内部的 tokio 任务图增长一截 —— 这条指标 / kernel_active_runtime_sessions 的斜率比对就是当前 leak 程度的代理指标。',
        },
        {
            name: 'kernel_runtime_session_closed_total',
            help: 'Kernel runtime session close 累计计数,按原因分桶。labels: reason=explicit|reset|runtime_key_change|idle_sweep|shutdown。idle_sweep 持续上涨 = 客户端没正确 disconnect,sweeper 在兜底；shutdown 在 PM2 reload / SIGTERM 时一次性出现。',
            labelNames: ['reason'],
        },
    ];

    private readonly defaultGauges: GaugeMetric[] = [
        { name: 'http_active_requests', help: 'Active HTTP requests' },
        {
            name: 'kernel_web_search_ready',
            help: 'web_search backend readiness (1=ok, 0=binary missing). Reason label is one of: "ok" (binary pinned and present), "binary_missing" (pin set but file gone), "no_pin" (no env pin — SDK will lazily auto-detect on first call).',
            labelNames: ['reason'],
        },
        {
            name: 'kernel_active_runtime_sessions',
            help: '当前进程内 active kernel runtime session 数量(KernelSessionRuntimeStateService.activeSessions.size)。idle sweeper 会在 30 min(KERNEL_RUNTIME_IDLE_TIMEOUT_MS)无活动后回收;持续走高表明客户端 disconnect 没触发或仍有 leak。',
        },
    ];

    private readonly defaultHistograms: HistogramMetric[] = [
        {
            name: 'http_request_duration_seconds',
            help: 'HTTP request duration',
            labelNames: ['method', 'path'],
            buckets: DEFAULT_HISTOGRAM_BUCKETS,
        },
        {
            name: 'http_request_size_bytes',
            help: 'HTTP request size',
            labelNames: ['method', 'path'],
            buckets: DEFAULT_SIZE_BUCKETS,
        },
        {
            name: 'http_response_size_bytes',
            help: 'HTTP response size',
            labelNames: ['method', 'path'],
            buckets: DEFAULT_SIZE_BUCKETS,
        },
        {
            name: 'kernel_run_duration_seconds',
            help: 'Desktop kernel message run duration. labels: status=succeeded|failed|cancelled.',
            labelNames: ['status'],
            buckets: KERNEL_RUN_BUCKETS,
        },
    ];

    constructor() {
        this.initializeMetrics();
    }

    private initializeMetrics(): void {
        // Series are now keyed by (name + sorted label values), so we cannot
        // pre-seed labeled series at boot — we don't know the values yet.
        // Pre-seed only the unlabeled defaults so an empty `/metrics` scrape
        // still surfaces "counter X exists, value 0" instead of nothing.
        for (const counter of this.defaultCounters) {
            if (!counter.labelNames || counter.labelNames.length === 0) {
                this.counters.set(this.getKey(counter.name), 0);
            }
        }
        for (const gauge of this.defaultGauges) {
            if (!gauge.labelNames || gauge.labelNames.length === 0) {
                this.gauges.set(this.getKey(gauge.name), 0);
            }
        }
        // Histograms are zero-pruned in toPrometheusFormat (we skip empty
        // series), so there's no point pre-creating an empty observation list.

        this.logger.log('Metrics initialized');
    }

    /**
     * Encode a (metric name, label set) tuple into the storage key.
     *
     * Label *values* are part of the key so that `incCounter('foo', {tool:
     * 'web_search'})` and `incCounter('foo', {tool: 'bash'})` end up in
     * separate series instead of incrementing one shared counter (which is
     * what the older `name:labelNames.join(',')` shape did — a Prometheus
     * correctness bug masquerading as a hash function).
     *
     * Label keys are sorted alphabetically so a caller passing `{a:1, b:2}`
     * and `{b:2, a:1}` always lands on the same series.
     */
    private getKey(name: string, labels?: Record<string, string>): string {
        if (!labels || Object.keys(labels).length === 0) return name;
        const entries = Object.entries(labels)
            .filter(([, v]) => v !== undefined && v !== null)
            .map(([k, v]) => [k, String(v)] as const)
            .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
        if (entries.length === 0) return name;
        const labelStr = entries.map(([k, v]) => `${k}=${v}`).join(',');
        return `${name}{${labelStr}}`;
    }

    private parseKey(key: string): { name: string; labels: Record<string, string> } {
        const openIndex = key.indexOf('{');
        if (openIndex < 0 || !key.endsWith('}')) {
            return { name: key, labels: {} };
        }
        const name = key.slice(0, openIndex);
        const inner = key.slice(openIndex + 1, -1);
        const labels: Record<string, string> = {};
        if (inner) {
            for (const pair of inner.split(',')) {
                const eq = pair.indexOf('=');
                if (eq < 0) continue;
                labels[pair.slice(0, eq)] = pair.slice(eq + 1);
            }
        }
        return { name, labels };
    }

    private formatPromLabels(labels: Record<string, string>, extra?: Record<string, string>): string {
        const merged = { ...labels, ...(extra ?? {}) };
        const entries = Object.entries(merged).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
        if (entries.length === 0) return '';
        const inner = entries
            .map(([k, v]) => `${k}="${String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`)
            .join(',');
        return `{${inner}}`;
    }

    // =========================================================================
    // Counter Operations
    // =========================================================================

    /**
     * Increment a counter
     */
    incCounter(name: string, labels?: Record<string, string>, amount = 1): void {
        const key = this.getKey(name, labels);
        const current = this.counters.get(key) ?? 0;
        this.counters.set(key, current + amount);
    }

    /**
     * Get counter value
     */
    getCounter(name: string, labels?: Record<string, string>): number {
        const key = this.getKey(name, labels);
        return this.counters.get(key) ?? 0;
    }

    // =========================================================================
    // Gauge Operations
    // =========================================================================

    /**
     * Set a gauge value
     */
    setGauge(name: string, value: number, labels?: Record<string, string>): void {
        const key = this.getKey(name, labels);
        this.gauges.set(key, value);
    }

    /**
     * Increment a gauge
     */
    incGauge(name: string, labels?: Record<string, string>, amount = 1): void {
        const key = this.getKey(name, labels);
        const current = this.gauges.get(key) ?? 0;
        this.gauges.set(key, current + amount);
    }

    /**
     * Decrement a gauge
     */
    decGauge(name: string, labels?: Record<string, string>, amount = 1): void {
        const key = this.getKey(name, labels);
        const current = this.gauges.get(key) ?? 0;
        this.gauges.set(key, current - amount);
    }

    /**
     * Get gauge value
     */
    getGauge(name: string, labels?: Record<string, string>): number {
        const key = this.getKey(name, labels);
        return this.gauges.get(key) ?? 0;
    }

    // =========================================================================
    // Histogram Operations
    // =========================================================================

    /**
     * Observe a value in histogram
     */
    observeHistogram(name: string, value: number, labels?: Record<string, string>): void {
        const key = this.getKey(name, labels);
        const values = this.histograms.get(key) ?? [];
        values.push(value);
        this.histograms.set(key, values);
    }

    /**
     * Get histogram values
     */
    getHistogram(name: string, labels?: Record<string, string>): number[] {
        const key = this.getKey(name, labels);
        return this.histograms.get(key) ?? [];
    }

    /**
     * Calculate histogram statistics
     */
    getHistogramStats(
        name: string,
        labels?: Record<string, string>,
    ): { count: number; sum: number; min: number; max: number; avg: number; p50: number; p95: number; p99: number } {
        const values = this.getHistogram(name, labels);
        if (values.length === 0) {
            return { count: 0, sum: 0, min: 0, max: 0, avg: 0, p50: 0, p95: 0, p99: 0 };
        }

        const sorted = [...values].sort((a, b) => a - b);
        const sum = sorted.reduce((a, b) => a + b, 0);
        const count = sorted.length;

        return {
            count,
            sum,
            min: sorted[0],
            max: sorted[count - 1],
            avg: sum / count,
            p50: sorted[Math.floor(count * 0.5)],
            p95: sorted[Math.floor(count * 0.95)],
            p99: sorted[Math.floor(count * 0.99)],
        };
    }

    /**
     * Resolve the bucket boundaries for a histogram metric name. Falls back to
     * {@link DEFAULT_HISTOGRAM_BUCKETS} when the metric is observed without
     * having been pre-registered in {@link defaultHistograms}.
     */
    private bucketsForName(name: string): number[] {
        const registered = this.defaultHistograms.find(item => item.name === name);
        return (registered?.buckets && registered.buckets.length > 0 ? registered.buckets : DEFAULT_HISTOGRAM_BUCKETS)
            .slice()
            .sort((a, b) => a - b);
    }

    // =========================================================================
    // Convenience Methods
    // =========================================================================

    /**
     * Record HTTP request
     */
    recordHttpRequest(method: string, path: string, status: number, duration: number): void {
        const labels = { method, path, status: status.toString() };
        this.incCounter('http_requests_total', labels);
        if (status >= 400) {
            this.incCounter('http_errors_total', labels);
        }
        this.observeHistogram('http_request_duration_seconds', duration, { method, path });
    }

    // =========================================================================
    // Export
    // =========================================================================

    /**
     * Get all metrics in Prometheus 0.0.4 text exposition format.
     *
     * Counters and gauges are emitted as `<name>{label="value"} <value>`.
     * Histograms emit the canonical `<name>_bucket{le="…"}`, `<name>_count`,
     * and `<name>_sum` series so Prometheus / Grafana can compute proper
     * quantiles via `histogram_quantile()`.
     */
    toPrometheusFormat(): string {
        const lines: string[] = [];

        // Counters: group by metric name so HELP/TYPE are emitted once.
        const countersByName = this.groupSeriesByName(this.counters);
        for (const [name, series] of countersByName) {
            lines.push(`# HELP ${name} counter`);
            lines.push(`# TYPE ${name} counter`);
            for (const { labels, value } of series) {
                lines.push(`${name}${this.formatPromLabels(labels)} ${value}`);
            }
        }

        // Gauges
        const gaugesByName = this.groupSeriesByName(this.gauges);
        for (const [name, series] of gaugesByName) {
            lines.push(`# HELP ${name} gauge`);
            lines.push(`# TYPE ${name} gauge`);
            for (const { labels, value } of series) {
                lines.push(`${name}${this.formatPromLabels(labels)} ${value}`);
            }
        }

        // Histograms — emit proper _bucket{le}, _count, _sum series.
        const histogramsByName = new Map<string, Array<{ labels: Record<string, string>; values: number[] }>>();
        for (const [key, values] of this.histograms.entries()) {
            if (values.length === 0) continue;
            const { name, labels } = this.parseKey(key);
            const arr = histogramsByName.get(name) ?? [];
            arr.push({ labels, values });
            histogramsByName.set(name, arr);
        }
        for (const [name, series] of histogramsByName) {
            const buckets = this.bucketsForName(name);
            lines.push(`# HELP ${name} histogram`);
            lines.push(`# TYPE ${name} histogram`);
            for (const { labels, values } of series) {
                // Cumulative-bucket counts: each bucket counts all observations
                // with value <= le. Final +Inf bucket equals total count.
                for (const le of buckets) {
                    const count = values.reduce((acc, v) => acc + (v <= le ? 1 : 0), 0);
                    lines.push(`${name}_bucket${this.formatPromLabels(labels, { le: String(le) })} ${count}`);
                }
                lines.push(`${name}_bucket${this.formatPromLabels(labels, { le: '+Inf' })} ${values.length}`);
                const sum = values.reduce((acc, v) => acc + v, 0);
                lines.push(`${name}_count${this.formatPromLabels(labels)} ${values.length}`);
                lines.push(`${name}_sum${this.formatPromLabels(labels)} ${sum}`);
            }
        }

        return lines.join('\n');
    }

    private groupSeriesByName(
        store: Map<string, number>,
    ): Map<string, Array<{ labels: Record<string, string>; value: number }>> {
        const grouped = new Map<string, Array<{ labels: Record<string, string>; value: number }>>();
        for (const [key, value] of store.entries()) {
            const { name, labels } = this.parseKey(key);
            const arr = grouped.get(name) ?? [];
            arr.push({ labels, value });
            grouped.set(name, arr);
        }
        return grouped;
    }

    /**
     * Get all metrics as JSON
     */
    toJSON(): Record<string, unknown> {
        return {
            counters: Object.fromEntries(this.counters),
            gauges: Object.fromEntries(this.gauges),
            histograms: Object.fromEntries(
                [...this.histograms.entries()].map(([key, values]) => {
                    const { labels } = this.parseKey(key);
                    return [
                        key,
                        {
                            labels,
                            ...this.getHistogramStats(this.parseKey(key).name, labels),
                            count: values.length,
                        },
                    ];
                }),
            ),
        };
    }

    onModuleDestroy(): void {
        this.logger.log('Metrics service destroyed');
    }
}
