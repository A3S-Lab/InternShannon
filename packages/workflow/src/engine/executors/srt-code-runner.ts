import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CancellationToken } from '../cancellation-token';

/**
 * Per-node policy declared in node.data.sandboxPolicy. Drives the srt
 * `~/.srt-settings.json` written for the spawn. Conservative defaults:
 *   - no network at all
 *   - no writes outside the per-spawn tmp dir
 *   - reads denied for sensitive paths even if user code asks
 */
export interface CodeSandboxPolicy {
    network?: {
        /** Hostnames to permit egress to. Empty / undefined = no network. */
        allowedDomains?: string[];
        deniedDomains?: string[];
    };
    filesystem?: {
        /** Extra write paths beyond the per-spawn tmp dir. Use sparingly. */
        allowWrite?: string[];
        /** Paths to deny writes to even when allowWrite would otherwise match. */
        denyWrite?: string[];
        /** Paths to deny reads for. Useful for clamping `~`, `/Users`, etc. */
        denyRead?: string[];
        /** Paths to explicitly re-allow read access to (takes precedence over denyRead). */
        allowRead?: string[];
    };
    env?: {
        /**
         * Names of env vars to inherit from the host process. Useful when the
         * node needs PATH-like config but not secrets. By default ONLY the
         * minimal system safe list is inherited (PATH / HOME / TMPDIR / NODE_ENV
         * / LANG / LC_* / TZ); everything else is scrubbed.
         */
        inheritFromHost?: string[];
        /**
         * Explicit env values to inject. Use for secrets the node DOES need
         * (e.g. a per-node API key), keyed by the env name the user code reads.
         * Plaintext only here — secret-vault resolution should happen upstream.
         */
        values?: Record<string, string>;
    };
}

/**
 * Env vars that are safe to inherit by default. Anything sensitive (OPENAI_API_KEY,
 * AUTH_ACCESS_SECRET, DB_PASSWORD, REGISTRY_PASSWORD, A3S_*, RUNTIME_*) MUST NOT
 * be on this list — keep the deny-by-default posture. User code that legitimately
 * needs a secret must declare it through `sandboxPolicy.env.values`.
 */
const SAFE_HOST_ENV_KEYS: readonly string[] = [
    'PATH',
    'HOME',
    'TMPDIR',
    'TMP',
    'TEMP',
    'NODE_ENV',
    'LANG',
    'LC_ALL',
    'LC_CTYPE',
    'TZ',
    // Node.js internal — needed for `require` to resolve
    'NODE_PATH',
];

const SAFE_HOST_ENV_PREFIXES: readonly string[] = ['LC_'];

export interface SrtRunOptions {
    /** User code, must export `main({ params })` like the legacy AsyncFunction path. */
    code: string;
    /** Input passed to `main({ params })`. Serialized to JSON over the wrapper. */
    params: Record<string, unknown>;
    /** Per-node sandbox policy (see CodeSandboxPolicy). */
    policy?: CodeSandboxPolicy;
    /** Hard timeout in ms. Defaults to 60s. */
    timeoutMs?: number;
    cancellationToken?: CancellationToken;
}

export interface SrtRunResult {
    outputs: Record<string, unknown>;
}

export interface SrtCodeRunner {
    isAvailable(): boolean;
    run(options: SrtRunOptions): Promise<SrtRunResult>;
}

const DEFAULT_TIMEOUT_MS = 60_000;
const MAX_OUTPUT_BYTES = 8 * 1024 * 1024; // 8 MB total stdout — kills runaway prints

/**
 * Resolves the `srt` binary location, caches the result. Returns null when
 * the binary is missing (Windows, container without srt installed, etc.) so
 * callers can decide whether to fail or fall back.
 */
function detectSrtBinary(): string | null {
    if (process.platform === 'win32') return null;
    const probe = spawnSync('command', ['-v', 'srt'], { shell: true });
    const path = probe.stdout?.toString().trim();
    return probe.status === 0 && path ? path : null;
}

let cachedSrtPath: string | null | undefined;

export class CliSrtCodeRunner implements SrtCodeRunner {
    isAvailable(): boolean {
        if (cachedSrtPath === undefined) cachedSrtPath = detectSrtBinary();
        return cachedSrtPath !== null;
    }

    async run(options: SrtRunOptions): Promise<SrtRunResult> {
        if (!this.isAvailable()) {
            throw new Error(
                'srt binary not found in PATH. Install Anthropic Sandbox Runtime '
                + '(`npm install -g @anthropic-ai/sandbox-runtime`) or set '
                + 'A3S_CODE_SANDBOX=none to fall back to the unsandboxed AsyncFunction path.',
            );
        }
        const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
        const workDir = mkdtempSync(join(tmpdir(), 'a3s-srt-'));
        const codePath = join(workDir, 'main.js');
        const settingsPath = join(workDir, 'srt-settings.json');
        const paramsPath = join(workDir, 'params.json');

        try {
            writeFileSync(codePath, this.wrapUserCode(options.code, paramsPath));
            writeFileSync(paramsPath, JSON.stringify(options.params ?? {}));
            writeFileSync(settingsPath, JSON.stringify(this.buildSrtSettings(options.policy, workDir)));

            const childEnv = this.composeChildEnv(options.policy);
            return await this.spawnSrt(cachedSrtPath!, settingsPath, codePath, timeoutMs, options.cancellationToken, childEnv);
        } finally {
            rmSync(workDir, { recursive: true, force: true });
        }
    }

    private composeChildEnv(policy: CodeSandboxPolicy | undefined): Record<string, string> {
        return composeChildEnv(policy, process.env);
    }

    /**
     * Wrap user code so:
     *   - it can read `params` synchronously via a module-scoped variable
     *   - the result of `main({ params })` is written as a single JSON line
     *     to stdout with a marker prefix, so we ignore noisy console.log
     *     output from user code
     *   - errors are caught and reported through the same envelope
     */
    private wrapUserCode(userCode: string, paramsPath: string): string {
        // Marker chosen to be improbable in arbitrary user output.
        return `'use strict';
const __fs = require('node:fs');
const params = JSON.parse(__fs.readFileSync(${JSON.stringify(paramsPath)}, 'utf8'));
const __emit = (envelope) => process.stdout.write('\\n__A3S_SRT_RESULT__' + JSON.stringify(envelope) + '__A3S_SRT_END__\\n');
(async () => {
    try {
        let __result__;
${userCode}
        if (typeof main !== 'function') {
            __emit({ ok: false, error: 'main function is required' });
            return;
        }
        __result__ = await main({ params });
        __emit({ ok: true, result: __result__ });
    } catch (err) {
        __emit({ ok: false, error: err && err.message ? err.message : String(err) });
    }
})();
`;
    }

    /**
     * Compose srt settings. Network defaults to no egress (allowedDomains:[]),
     * filesystem defaults to writes only inside the per-spawn workDir.
     */
    private buildSrtSettings(policy: CodeSandboxPolicy | undefined, workDir: string): Record<string, unknown> {
        const network = policy?.network ?? {};
        const fs = policy?.filesystem ?? {};
        return {
            network: {
                allowedDomains: network.allowedDomains ?? [],
                deniedDomains: network.deniedDomains ?? [],
            },
            filesystem: {
                allowWrite: [workDir, ...(fs.allowWrite ?? [])],
                denyWrite: fs.denyWrite ?? [],
                denyRead: fs.denyRead ?? [],
                allowRead: [workDir, ...(fs.allowRead ?? [])],
            },
        };
    }

    /**
     * Spawn `srt --settings <settings> node <code>`. Streams stdout/stderr,
     * stops on timeout or cancellation, parses the marker-wrapped result.
     */
    private spawnSrt(
        srtPath: string,
        settingsPath: string,
        codePath: string,
        timeoutMs: number,
        token: CancellationToken | undefined,
        childEnv: Record<string, string>,
    ): Promise<SrtRunResult> {
        return new Promise<SrtRunResult>((resolve, reject) => {
            const child = spawn(srtPath, ['--settings', settingsPath, 'node', codePath], {
                stdio: ['ignore', 'pipe', 'pipe'],
                env: childEnv,
            });

            const stdoutChunks: Buffer[] = [];
            const stderrChunks: Buffer[] = [];
            let stdoutBytes = 0;
            let killedReason: string | null = null;

            const killTree = (reason: string) => {
                if (killedReason || child.killed) return;
                killedReason = reason;
                try { child.kill('SIGTERM'); } catch { /* already dead */ }
                setTimeout(() => { if (!child.exitCode && !child.killed) child.kill('SIGKILL'); }, 5_000).unref?.();
            };

            const timer = setTimeout(() => killTree(`timeout after ${timeoutMs}ms`), timeoutMs);
            timer.unref?.();

            const onCancel = () => killTree('cancelled by caller');
            token?.onCancelled(onCancel);

            child.stdout.on('data', chunk => {
                stdoutBytes += chunk.length;
                if (stdoutBytes > MAX_OUTPUT_BYTES) {
                    killTree(`stdout exceeded ${MAX_OUTPUT_BYTES} bytes`);
                    return;
                }
                stdoutChunks.push(chunk);
            });
            child.stderr.on('data', chunk => stderrChunks.push(chunk));
            child.on('error', err => {
                clearTimeout(timer);
                reject(new Error(`srt spawn failed: ${err.message}`));
            });
            child.on('close', code => {
                clearTimeout(timer);
                if (killedReason) {
                    reject(new Error(`Code execution aborted: ${killedReason}`));
                    return;
                }
                const stdout = Buffer.concat(stdoutChunks).toString('utf8');
                const stderr = Buffer.concat(stderrChunks).toString('utf8');
                if (code !== 0) {
                    reject(new Error(`Code execution exited with code ${code}: ${stderr.trim() || stdout.trim() || '(no output)'}`));
                    return;
                }
                const envelope = this.parseEnvelope(stdout);
                if (!envelope) {
                    reject(new Error(`Code execution produced no parseable result. stderr: ${stderr.trim() || '(empty)'}`));
                    return;
                }
                if (!envelope.ok) {
                    reject(new Error(envelope.error ?? 'unknown error'));
                    return;
                }
                resolve({ outputs: this.toOutputs(envelope.result) });
            });
        });
    }

    private parseEnvelope(stdout: string): { ok: true; result?: unknown } | { ok: false; error?: string } | null {
        // Marker chosen to be improbable in arbitrary user output;
        // pick the LAST occurrence in case user code logs the marker itself.
        const startMarker = '__A3S_SRT_RESULT__';
        const endMarker = '__A3S_SRT_END__';
        const start = stdout.lastIndexOf(startMarker);
        if (start < 0) return null;
        const end = stdout.indexOf(endMarker, start);
        if (end < 0) return null;
        const json = stdout.slice(start + startMarker.length, end);
        try {
            return JSON.parse(json);
        } catch {
            return null;
        }
    }

    private toOutputs(result: unknown): Record<string, unknown> {
        if (result && typeof result === 'object' && !Array.isArray(result)) {
            return result as Record<string, unknown>;
        }
        return { result };
    }
}

/**
 * Compose the env handed to the srt child. Default-deny: scrub all host env
 * (which includes things like OPENAI_API_KEY, AUTH_ACCESS_SECRET, DB_PASSWORD,
 * REGISTRY_*, A3S_*, RUNTIME_*) and rebuild from:
 *   1. SAFE_HOST_ENV_KEYS — minimal system bits (PATH, HOME, NODE_ENV, …)
 *   2. policy.env.inheritFromHost — extra host keys the node explicitly allowlists
 *   3. policy.env.values — explicit key/value injections (e.g. a secret-vault-resolved API key)
 * Later entries win on conflict, so `values` can override even safe defaults if needed.
 *
 * Exposed at module scope so unit tests can verify the scrubbing policy without
 * having to spawn an actual srt subprocess.
 */
export function composeChildEnv(
    policy: CodeSandboxPolicy | undefined,
    hostEnv: NodeJS.ProcessEnv,
): Record<string, string> {
    const result: Record<string, string> = {};

    const includeKey = (key: string) => {
        const value = hostEnv[key];
        if (typeof value === 'string') result[key] = value;
    };

    for (const key of SAFE_HOST_ENV_KEYS) includeKey(key);
    for (const key of Object.keys(hostEnv)) {
        if (SAFE_HOST_ENV_PREFIXES.some(prefix => key.startsWith(prefix))) includeKey(key);
    }
    for (const key of policy?.env?.inheritFromHost ?? []) includeKey(key);
    for (const [key, value] of Object.entries(policy?.env?.values ?? {})) {
        if (typeof value === 'string') result[key] = value;
    }
    return result;
}

/** Reset the cached binary lookup. Test-only. */
export function __resetSrtBinaryCache(): void {
    cachedSrtPath = undefined;
}
