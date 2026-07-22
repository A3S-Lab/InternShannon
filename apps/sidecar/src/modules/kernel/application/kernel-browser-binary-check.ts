import { accessSync, constants, statSync } from 'fs';

/**
 * Result of probing the headless browser binary the SDK will spawn for
 * `web_search`. Computed once at API boot and cached for the process lifetime —
 * `LIGHTPANDA` / `CHROME` are stable env vars, re-probing on every tool call
 * would just burn syscalls without catching anything new.
 */
export interface BrowserBinaryStatus {
    available: boolean;
    reasonCode: WebSearchReadinessReason;
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
 * When neither env var is set we return `available: false`. Desktop and
 * production deployments must pin a verified browser path at process start;
 * allowing the SDK fallback here makes the first search non-deterministically
 * scan the host or download an executable during a user request.
 */
export function verifyBrowserBinary(
    env: NodeJS.ProcessEnv = process.env,
    isUsableBinary: (p: string) => boolean = isExecutableFile,
): BrowserBinaryStatus {
    const lightpanda = env.LIGHTPANDA?.trim();
    const chrome = env.CHROME?.trim();

    const broken: string[] = [];
    let usablePinFound = false;
    for (const [envName, path] of [
        ['LIGHTPANDA', lightpanda],
        ['CHROME', chrome],
    ] as const) {
        if (!path) continue;
        if (isUsableBinary(path)) {
            usablePinFound = true;
        } else {
            broken.push(`${envName}='${path}'`);
            delete env[envName];
        }
    }

    if (usablePinFound) {
        cached = { available: true, reasonCode: 'ok', reason: null };
        return cached;
    }

    if (broken.length > 0) {
        const status: BrowserBinaryStatus = {
            available: false,
            reasonCode: 'binary_missing',
            reason:
                `web_search 浏览器二进制不可用：${broken.join(', ')} 不是可执行文件。` +
                ` 已从进程 env 移除避免 SDK 误选；请检查 install-lightpanda initContainer 日志，` +
                ` 或本地运行 \`just install-browser\` 重新拉取。`,
        };
        cached = status;
        return status;
    }

    cached = {
        available: false,
        reasonCode: 'no_pin',
        reason:
            'web_search 当前不可用：启动时未固定 LIGHTPANDA 或 CHROME 浏览器路径。' +
            ' 请在“设置 → 搜索引擎”安装或选择浏览器，然后重启书小安。',
    };
    return cached;
}

function isExecutableFile(path: string): boolean {
    try {
        if (!statSync(path).isFile()) return false;
        if (process.platform !== 'win32') accessSync(path, constants.X_OK);
        return true;
    } catch {
        return false;
    }
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
 *  - `no_pin`         no `LIGHTPANDA` / `CHROME` env set; web_search is blocked
 *                     until the desktop restarts with a verified path.
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
    return { ready: status.available, reason: status.reasonCode };
}

export function webSearchBrowserBlockReason(
    event: Record<string, unknown>,
    status: BrowserBinaryStatus | null = getBrowserBinaryStatus(),
): string | null {
    const toolName = typeof event.toolName === 'string' ? event.toolName.trim().toLowerCase() : '';
    if (toolName !== 'web_search' || status?.available !== false) return null;
    return status.reason || 'web_search 当前不可用：未检测到已固定的浏览器运行时。';
}
