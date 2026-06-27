import { existsSync } from 'fs';

/**
 * Result of probing the headless browser binary the SDK will spawn for
 * `web_search`. Computed once at API boot and cached for the process lifetime —
 * `LIGHTPANDA` / `CHROME` are stable env vars, re-probing on every tool call
 * would just burn syscalls without catching anything new.
 */
export interface BrowserBinaryStatus {
    available: boolean;
    /**
     * Human-readable explanation when `available` is false. Surfaced through
     * `webSearchUnavailabilityReason` so the cloud-workspace-guard can block
     * web_search calls with this reason before the SDK falls through to its
     * own auto-download path (which can hang for minutes inside an air-gapped
     * cluster or behind a strict egress policy).
     */
    reason: string | null;
}

let cached: BrowserBinaryStatus | null = null;

/**
 * Probe the SDK's headless-browser env vars at boot. Side effects:
 *
 *  - When `LIGHTPANDA` / `CHROME` points at a file that does not exist, we
 *    delete the env var so the SDK does NOT prefer a broken pin over its
 *    PATH / cache / auto-download fallback chain. Leaving a non-existent path
 *    in the env causes the SDK to still treat it as "best candidate" and
 *    surface confusing failures later.
 *  - We cache the resulting status. Callers reading after boot get the same
 *    answer; the policy layer reads it on every hook invocation.
 *
 * When neither env var is set we return `available: true` because the SDK has
 * a legitimate fallback chain (PATH → well-known paths → cached download →
 * on-demand fetch). That fallback may still fail at call time — the hook
 * layer cannot know in advance — but we deliberately do NOT pre-block here,
 * since most operators rely on the SDK's auto-resolution.
 */
export function verifyBrowserBinary(
    env: NodeJS.ProcessEnv = process.env,
    fsExists: (p: string) => boolean = existsSync,
): BrowserBinaryStatus {
    const lightpanda = env.LIGHTPANDA?.trim();
    const chrome = env.CHROME?.trim();

    const broken: string[] = [];
    if (lightpanda && !fsExists(lightpanda)) {
        broken.push(`LIGHTPANDA='${lightpanda}'`);
        delete env.LIGHTPANDA;
    }
    if (chrome && !fsExists(chrome)) {
        broken.push(`CHROME='${chrome}'`);
        delete env.CHROME;
    }

    if (broken.length > 0) {
        const status: BrowserBinaryStatus = {
            available: false,
            reason:
                `web_search 浏览器二进制不可用：${broken.join(', ')} 指向的文件不存在。` +
                ` 已从进程 env 移除避免 SDK 误选；请检查 install-lightpanda initContainer 日志，` +
                ` 或本地运行 \`just install-browser\` 重新拉取。`,
        };
        cached = status;
        return status;
    }

    cached = { available: true, reason: null };
    return cached;
}

/**
 * Cached status from the last `verifyBrowserBinary` call. Returns `null`
 * before boot has run (treat as available so we don't block prematurely).
 */
export function getBrowserBinaryStatus(): BrowserBinaryStatus | null {
    return cached;
}

/** Reset the cached status. Test-only. */
export function __resetBrowserBinaryStatusForTests(): void {
    cached = null;
}

/**
 * Readiness label emitted to the `kernel_web_search_ready` Prometheus gauge.
 * Kept as a small enum (low-cardinality) so dashboards can group on it:
 *
 *  - `ok`             a binary path is pinned via env AND it exists on disk
 *  - `binary_missing` a path was pinned via env but the file does not exist
 *                     (e.g. initContainer failed, mount got wiped, dev
 *                     deleted the cached binary)
 *  - `no_pin`         no `LIGHTPANDA` / `CHROME` env set; the SDK will lazily
 *                     auto-detect on first call. Not necessarily broken —
 *                     just non-deterministic, hence surfaced as its own state
 *                     so diagnostics can report sessions without a pin.
 */
export type WebSearchReadinessReason = 'ok' | 'binary_missing' | 'no_pin';

/**
 * Pure classifier for the readiness gauge. Takes a snapshot of `(env, status)`
 * and returns `(ready: boolean, reason: ...)`. Separating this from the side-
 * effecting verifier keeps the metric semantics testable in isolation and
 * lets us extend the enum without touching wiring code.
 */
export function classifyWebSearchReadiness(
    env: NodeJS.ProcessEnv,
    status: BrowserBinaryStatus,
): { ready: boolean; reason: WebSearchReadinessReason } {
    if (!status.available) return { ready: false, reason: 'binary_missing' };
    if (!env.LIGHTPANDA && !env.CHROME) return { ready: true, reason: 'no_pin' };
    return { ready: true, reason: 'ok' };
}
