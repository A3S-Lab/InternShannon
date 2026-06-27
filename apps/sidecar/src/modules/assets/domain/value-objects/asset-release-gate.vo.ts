import { AssetBenchmarkSuite } from './asset-benchmark.vo';

export type AssetReleaseGateTarget = 'release' | 'publish' | 'launch';
export type AssetReleaseGateCheckStatus = 'passed' | 'failed' | 'warning' | 'skipped';
export type AssetReleaseGateCheckSeverity = 'error' | 'warning' | 'info';

export interface AssetReleaseGateCheck {
    id: string;
    name: string;
    category: string;
    severity: AssetReleaseGateCheckSeverity;
    status: AssetReleaseGateCheckStatus;
    blocking: boolean;
    message: string;
    score: number;
    weight: number;
    details?: Record<string, unknown>;
}

export interface AssetReleaseGate {
    assetId: string;
    target: AssetReleaseGateTarget;
    benchmarkSuite: AssetBenchmarkSuite;
    passed: boolean;
    score: number;
    grade: 'A' | 'B' | 'C' | 'D' | 'F';
    summary: string;
    blockingReasons: string[];
    checks: AssetReleaseGateCheck[];
    evaluatedAt: string;
}

export const ASSET_RELEASE_GATE_TARGETS: AssetReleaseGateTarget[] = ['release', 'publish', 'launch'];

export function isAssetReleaseGateTarget(value: unknown): value is AssetReleaseGateTarget {
    return typeof value === 'string' && ASSET_RELEASE_GATE_TARGETS.includes(value as AssetReleaseGateTarget);
}
