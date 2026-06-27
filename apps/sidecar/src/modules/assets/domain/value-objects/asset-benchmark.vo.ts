export type AssetBenchmarkSuite = 'smoke' | 'release_gate' | 'regression' | 'security' | 'performance';
export type AssetBenchmarkRunStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';
export type AssetBenchmarkCheckSeverity = 'error' | 'warning' | 'info';
export type AssetBenchmarkCheckStatus = 'passed' | 'failed' | 'warning' | 'skipped';
export type AssetBenchmarkMetricDirection = 'higher_is_better' | 'lower_is_better' | 'target';

export interface AssetBenchmarkMetric {
    name: string;
    value: number;
    threshold?: number;
    unit?: string;
    direction?: AssetBenchmarkMetricDirection;
    passed?: boolean;
}

export interface AssetBenchmarkCheck {
    id: string;
    name: string;
    category: string;
    severity: AssetBenchmarkCheckSeverity;
    status: AssetBenchmarkCheckStatus;
    message: string;
    score?: number;
    weight: number;
    metric?: AssetBenchmarkMetric;
    details?: Record<string, unknown>;
}

export interface AssetBenchmarkGate {
    suite: AssetBenchmarkSuite;
    passed: boolean;
    blocking: boolean;
    requiredScore: number;
    score: number;
    reasons: string[];
}

export interface AssetBenchmarkRun {
    id: string;
    assetId: string;
    suite: AssetBenchmarkSuite;
    status: AssetBenchmarkRunStatus;
    passed: boolean;
    score: number;
    grade: 'A' | 'B' | 'C' | 'D' | 'F';
    targetRef?: string;
    targetVersion?: string;
    summary: string;
    checks: AssetBenchmarkCheck[];
    metrics: AssetBenchmarkMetric[];
    gate: AssetBenchmarkGate;
    triggeredBy?: string;
    metadata: Record<string, unknown>;
    startedAt: string;
    completedAt?: string;
    createdAt: string;
    updatedAt: string;
}

export interface AssetBenchmarkMetadata {
    latestRunId?: string;
    latestScore?: number;
    latestPassed?: boolean;
    latestSuite?: AssetBenchmarkSuite;
    gate?: AssetBenchmarkGate & { runId: string; updatedAt: string };
    runs: AssetBenchmarkRun[];
}

export const ASSET_BENCHMARK_SUITES: AssetBenchmarkSuite[] = ['smoke', 'release_gate', 'regression', 'security', 'performance'];

export const ASSET_BENCHMARK_SUITE_LABELS: Record<AssetBenchmarkSuite, string> = {
    smoke: '基础冒烟',
    release_gate: '发布门禁',
    regression: '回归评测',
    security: '安全检查',
    performance: '性能评测',
};

export function isAssetBenchmarkSuite(value: unknown): value is AssetBenchmarkSuite {
    return typeof value === 'string' && ASSET_BENCHMARK_SUITES.includes(value as AssetBenchmarkSuite);
}

export function defaultBenchmarkGateScore(suite: AssetBenchmarkSuite): number {
    if (suite === 'release_gate') return 80;
    if (suite === 'regression') return 75;
    if (suite === 'security') return 90;
    if (suite === 'performance') return 70;
    return 60;
}
