import { spawnSync } from 'node:child_process';
import { CliSrtCodeRunner, composeChildEnv, __resetSrtBinaryCache } from '../srt-code-runner';

/**
 * Smoke tests for the srt CLI runner. They only run when `srt` is actually
 * installed on PATH; otherwise the suite is skipped (CI without the binary,
 * Windows, contributor laptops without `npm i -g @anthropic-ai/sandbox-runtime`).
 *
 * For deterministic CI, add the install step to the runner setup and unset
 * this guard.
 */
const SRT_AVAILABLE = (() => {
    if (process.platform === 'win32') return false;
    const probe = spawnSync('command', ['-v', 'srt'], { shell: true });
    return probe.status === 0 && !!probe.stdout?.toString().trim();
})();

const describeIfSrt = SRT_AVAILABLE ? describe : describe.skip;

describeIfSrt('CliSrtCodeRunner (requires srt on PATH)', () => {
    let runner: CliSrtCodeRunner;

    beforeEach(() => {
        __resetSrtBinaryCache();
        runner = new CliSrtCodeRunner();
    });

    it('reports binary as available', () => {
        expect(runner.isAvailable()).toBe(true);
    });

    it('returns the result of main({ params })', async () => {
        const result = await runner.run({
            code: `function main({ params }) { return { sum: params.a + params.b }; }`,
            params: { a: 3, b: 4 },
        });
        expect(result.outputs).toEqual({ sum: 7 });
    });

    it('wraps non-object return into { result }', async () => {
        const result = await runner.run({
            code: `function main({ params }) { return params.value * 2; }`,
            params: { value: 21 },
        });
        expect(result.outputs).toEqual({ result: 42 });
    });

    it('surfaces user errors thrown inside main', async () => {
        await expect(
            runner.run({
                code: `function main() { throw new Error('boom from user code'); }`,
                params: {},
            }),
        ).rejects.toThrow(/boom from user code/);
    });

    it('blocks network egress when allowedDomains is empty', async () => {
        // Default policy = no network at all. fetch('https://example.com') must fail.
        await expect(
            runner.run({
                code: `async function main() { await fetch('https://example.com'); return { ok: true }; }`,
                params: {},
                timeoutMs: 10_000,
            }),
        ).rejects.toThrow();
    });

    it('blocks writes outside the per-spawn tmp dir', async () => {
        // Writing to $HOME (denied by default — only the per-spawn workDir is in allowWrite).
        await expect(
            runner.run({
                code: `function main() {
                    const fs = require('node:fs');
                    fs.writeFileSync(require('node:os').homedir() + '/srt-test-should-fail.txt', 'pwned');
                    return { ok: true };
                }`,
                params: {},
            }),
        ).rejects.toThrow();
    });

    it('enforces hard timeout', async () => {
        await expect(
            runner.run({
                code: `function main() { return new Promise(() => {}); }`, // never resolves
                params: {},
                timeoutMs: 500,
            }),
        ).rejects.toThrow(/timeout/);
    });
});

describe('composeChildEnv — host env scrubbing', () => {
    const HOST_ENV: NodeJS.ProcessEnv = {
        // Safe defaults — should pass through
        PATH: '/usr/local/bin:/usr/bin',
        HOME: '/home/test',
        NODE_ENV: 'production',
        TZ: 'UTC',
        LC_CTYPE: 'en_US.UTF-8',
        LANG: 'en_US.UTF-8',
        // Secrets — must NOT leak to child
        OPENAI_API_KEY: 'sk-secret-xxx',
        AUTH_ACCESS_SECRET: 'auth-secret-yyy',
        DB_PASSWORD: 'pgsql-secret-zzz',
        REGISTRY_PASSWORD: 'oci-secret-uuu',
        A3S_SOURCE_ASSET_ID: 'asset-internal-id',
        RUNTIME_SOURCE_ARCHIVE_SECRET: 'hmac-secret-vvv',
        ANTHROPIC_API_KEY: 'sk-ant-secret',
    };

    it('drops every host env that is not on the safe list', () => {
        const env = composeChildEnv(undefined, HOST_ENV);
        expect(env.PATH).toBe('/usr/local/bin:/usr/bin');
        expect(env.HOME).toBe('/home/test');
        expect(env.NODE_ENV).toBe('production');
        expect(env.OPENAI_API_KEY).toBeUndefined();
        expect(env.AUTH_ACCESS_SECRET).toBeUndefined();
        expect(env.DB_PASSWORD).toBeUndefined();
        expect(env.REGISTRY_PASSWORD).toBeUndefined();
        expect(env.A3S_SOURCE_ASSET_ID).toBeUndefined();
        expect(env.RUNTIME_SOURCE_ARCHIVE_SECRET).toBeUndefined();
        expect(env.ANTHROPIC_API_KEY).toBeUndefined();
    });

    it('includes LC_* prefix vars (locale config)', () => {
        const env = composeChildEnv(undefined, { ...HOST_ENV, LC_TIME: 'en_US.UTF-8' });
        expect(env.LC_CTYPE).toBe('en_US.UTF-8');
        expect(env.LC_TIME).toBe('en_US.UTF-8');
    });

    it('inheritFromHost lets specific extra host keys through', () => {
        const env = composeChildEnv(
            { env: { inheritFromHost: ['OPENAI_API_KEY'] } },
            HOST_ENV,
        );
        expect(env.OPENAI_API_KEY).toBe('sk-secret-xxx');
        // Others still scrubbed
        expect(env.AUTH_ACCESS_SECRET).toBeUndefined();
    });

    it('values injects explicit env (not from host)', () => {
        const env = composeChildEnv(
            { env: { values: { MY_API_KEY: 'literal-injected', DEBUG: '1' } } },
            HOST_ENV,
        );
        expect(env.MY_API_KEY).toBe('literal-injected');
        expect(env.DEBUG).toBe('1');
        // Host secrets still scrubbed
        expect(env.OPENAI_API_KEY).toBeUndefined();
    });

    it('values can override safe defaults (escape hatch)', () => {
        const env = composeChildEnv(
            { env: { values: { NODE_ENV: 'test', PATH: '/custom/bin' } } },
            HOST_ENV,
        );
        expect(env.NODE_ENV).toBe('test');
        expect(env.PATH).toBe('/custom/bin');
    });

    it('inheritFromHost + values: values wins on conflict', () => {
        const env = composeChildEnv(
            {
                env: {
                    inheritFromHost: ['OPENAI_API_KEY'],
                    values: { OPENAI_API_KEY: 'overridden' },
                },
            },
            HOST_ENV,
        );
        expect(env.OPENAI_API_KEY).toBe('overridden');
    });

    it('inheritFromHost silently drops keys that do not exist on host', () => {
        const env = composeChildEnv(
            { env: { inheritFromHost: ['NONEXISTENT_VAR'] } },
            HOST_ENV,
        );
        expect(env.NONEXISTENT_VAR).toBeUndefined();
    });
});

describe('CliSrtCodeRunner (no srt binary)', () => {
    it('reports unavailable + throws a clear install hint when run', async () => {
        // Force the detection to fail regardless of host state by stubbing PATH.
        const originalPath = process.env.PATH;
        process.env.PATH = '/__a3s_test_no_srt__';
        __resetSrtBinaryCache();
        try {
            const runner = new CliSrtCodeRunner();
            expect(runner.isAvailable()).toBe(false);
            await expect(
                runner.run({ code: 'function main(){return 1;}', params: {} }),
            ).rejects.toThrow(/srt binary not found/);
        } finally {
            process.env.PATH = originalPath;
            __resetSrtBinaryCache();
        }
    });
});
