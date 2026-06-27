import assert from 'node:assert/strict';
import test from 'node:test';
import {
    classifyApiPortCheck,
    classifyCommandCheck,
    classifyPathCheck,
    classifyWebPortCheck,
    formatDoctorReport,
    hasDoctorFailures,
    parseLsofListenOutput,
    summarizeDoctorChecks,
} from './desktop-doctor-state.mjs';

test('classifyCommandCheck reports available CLI output', () => {
    const check = classifyCommandCheck({
        command: 'pnpm --version',
        exitCode: 0,
        label: 'pnpm',
        stdout: '11.0.0\n',
    });

    assert.equal(check.status, 'ok');
    assert.match(check.summary, /11\.0\.0/);
});

test('classifyCommandCheck escalates required CLI failures', () => {
    const check = classifyCommandCheck({
        command: 'pnpm --dir apps/sidecar exec nest --version',
        exitCode: 1,
        label: 'Nest CLI',
        remediation: 'Run CI=true pnpm install.',
        stderr: 'Command not found: nest',
    });

    assert.equal(check.status, 'fail');
    assert.equal(check.action, 'Run CI=true pnpm install.');
    assert.deepEqual(check.details, ['Command not found: nest', 'Command: pnpm --dir apps/sidecar exec nest --version']);
});

test('classifyPathCheck treats sidecar build output as a warning when missing', () => {
    const check = classifyPathCheck({
        exists: false,
        label: 'Sidecar build',
        path: 'apps/sidecar/dist/main.js',
        remediation: 'Run just sidecar-build.',
    });

    assert.equal(check.status, 'warn');
    assert.match(check.summary, /missing/);
});

test('classifyApiPortCheck fails only when occupied and unhealthy', () => {
    assert.equal(classifyApiPortCheck({ listening: false, port: 29653 }).status, 'ok');
    assert.equal(
        classifyApiPortCheck({
            healthy: true,
            listening: true,
            owner: 'pid=123 node apps/sidecar/dist/main.js',
            port: 29653,
        }).status,
        'ok',
    );

    const unhealthy = classifyApiPortCheck({
        error: 'HTTP 404',
        healthy: false,
        listening: true,
        owner: 'pid=456 other-server',
        port: 29653,
    });

    assert.equal(unhealthy.status, 'fail');
    assert.match(unhealthy.summary, /occupied/);
    assert.match(unhealthy.details.join('\n'), /other-server/);
});

test('classifyWebPortCheck warns because web ports can fall back', () => {
    const check = classifyWebPortCheck({
        listening: true,
        owner: 'pid=789 vite',
        port: 5000,
    });

    assert.equal(check.status, 'warn');
    assert.match(check.action, /PUBLIC_DESKTOP_DEV_PORT/);
});

test('parseLsofListenOutput reads listening process rows', () => {
    const rows = parseLsofListenOutput(`
COMMAND   PID USER   FD   TYPE             DEVICE SIZE/OFF NODE NAME
node    12345 user   22u  IPv4 0x0000000000000000      0t0  TCP 127.0.0.1:29653 (LISTEN)
`);

    assert.deepEqual(rows, [
        {
            command: 'node',
            name: '127.0.0.1:29653 (LISTEN)',
            pid: '12345',
        },
    ]);
});

test('formatDoctorReport summarizes status and result', () => {
    const checks = [
        classifyCommandCheck({
            command: 'just --version',
            exitCode: 0,
            label: 'just',
            stdout: 'just 1.42.4',
        }),
        classifyWebPortCheck({ listening: true, owner: 'pid=1 rsbuild', port: 5000 }),
        classifyApiPortCheck({
            error: 'fetch failed',
            healthy: false,
            listening: true,
            owner: 'pid=2 other',
            port: 29653,
        }),
    ];

    assert.deepEqual(summarizeDoctorChecks(checks), { fail: 1, ok: 1, warn: 1 });
    assert.equal(hasDoctorFailures(checks), true);
    assert.match(formatDoctorReport(checks), /Checks: 1 ok, 1 warn, 1 fail/);
    assert.match(formatDoctorReport(checks), /Result: FAIL/);
});
