#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    classifyApiPortCheck,
    classifyCommandCheck,
    classifyPathCheck,
    classifyWebPortCheck,
    formatDoctorReport,
    hasDoctorFailures,
    parseLsofListenOutput,
} from './desktop-doctor-state.mjs';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '../../..');
const DEFAULT_API_PORT = 29653;
const DEFAULT_WEB_PORT = 5000;

const checks = [
    runCommandCheck({
        args: ['--version'],
        command: 'just',
        label: 'just',
        remediation: 'Install just, or run the underlying pnpm scripts manually.',
    }),
    runCommandCheck({
        args: ['--version'],
        command: 'pnpm',
        label: 'pnpm',
        remediation: 'Install pnpm, then run CI=true pnpm install from the repo root.',
    }),
    runCommandCheck({
        args: ['--dir', 'apps/sidecar', 'exec', 'nest', '--version'],
        command: 'pnpm',
        displayCommand: 'pnpm --dir apps/sidecar exec nest --version',
        label: 'Nest CLI',
        remediation: 'Run CI=true pnpm install from the repo root.',
    }),
    runCommandCheck({
        args: ['--dir', 'apps/desktop', 'exec', 'tauri', '--version'],
        command: 'pnpm',
        displayCommand: 'pnpm --dir apps/desktop exec tauri --version',
        label: 'Tauri CLI',
        remediation: 'Run CI=true pnpm install from the repo root.',
    }),
    classifyPathCheck({
        exists: existsSync(path.join(repoRoot, 'apps/sidecar/dist/main.js')),
        label: 'Desktop sidecar build',
        path: 'apps/sidecar/dist/main.js',
        remediation: 'Run just sidecar-build before launching dev or packaging.',
    }),
    classifyPathCheck({
        exists: existsSync(path.join(repoRoot, 'apps/desktop/frontend/index.html')),
        label: 'Desktop frontend',
        path: 'apps/desktop/frontend/index.html',
        remediation: 'Restore the desktop frontend entrypoint before launching dev or packaging.',
        required: true,
    }),
];

const apiPort = resolvePort(process.env.APP_PORT, DEFAULT_API_PORT);
const webPort = resolvePort(process.env.PUBLIC_DESKTOP_DEV_PORT || process.env.PORT, DEFAULT_WEB_PORT);
const apiPortState = readListeningPort(apiPort);
const apiHealth = apiPortState.listening === true ? await probeHealth(apiPort) : { healthy: false };

checks.push(
    classifyApiPortCheck({
        error: apiHealth.error || apiPortState.error,
        healthy: apiHealth.healthy,
        listening: apiPortState.listening,
        owner: apiPortState.owner,
        port: apiPort,
    }),
);

const webPortState = readListeningPort(webPort);
checks.push(
    classifyWebPortCheck({
        error: webPortState.error,
        listening: webPortState.listening,
        owner: webPortState.owner,
        port: webPort,
    }),
);

console.log(formatDoctorReport(checks));
process.exitCode = hasDoctorFailures(checks) ? 1 : 0;

function runCommandCheck({ args, command, displayCommand = [command, ...args].join(' '), label, remediation }) {
    const result = spawnSync(command, args, {
        cwd: repoRoot,
        encoding: 'utf8',
        env: {
            ...process.env,
            CI: 'true',
        },
    });

    return classifyCommandCheck({
        command: displayCommand,
        exitCode: result.error ? null : result.status,
        label,
        remediation,
        stderr: result.error ? result.error.message : result.stderr,
        stdout: result.stdout,
    });
}

function readListeningPort(port) {
    const result = spawnSync('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN'], {
        cwd: repoRoot,
        encoding: 'utf8',
    });

    if (result.error) {
        return {
            error: result.error.message,
            listening: 'unknown',
        };
    }

    const records = parseLsofListenOutput(result.stdout);
    if (records.length > 0) {
        return {
            listening: true,
            owner: unique(records.map(formatPortOwner)).join('; '),
        };
    }

    if (result.status === 0 || result.status === 1) {
        return { listening: false };
    }

    return {
        error: firstNonEmptyLine(result.stderr) || `lsof exited with ${result.status}`,
        listening: 'unknown',
    };
}

async function probeHealth(port) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2000);

    try {
        const response = await fetch(`http://127.0.0.1:${port}/api/v1/health`, {
            signal: controller.signal,
        });
        return {
            error: response.ok ? '' : `HTTP ${response.status}`,
            healthy: response.ok,
        };
    } catch (error) {
        return {
            error: error instanceof Error ? error.message : String(error),
            healthy: false,
        };
    } finally {
        clearTimeout(timer);
    }
}

function formatPortOwner(record) {
    const command = readProcessCommand(record.pid);
    return [`pid=${record.pid}`, command || record.command, record.name].filter(Boolean).join(' ');
}

function readProcessCommand(pid) {
    const result = spawnSync('ps', ['-p', pid, '-o', 'command='], {
        cwd: repoRoot,
        encoding: 'utf8',
    });

    if (result.error || result.status !== 0) return '';
    return result.stdout.trim();
}

function resolvePort(value, fallback) {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function unique(values) {
    return [...new Set(values.filter(Boolean))];
}

function firstNonEmptyLine(value) {
    return (
        String(value || '')
            .split(/\r?\n/)
            .map(line => line.trim())
            .find(Boolean) || ''
    );
}
