#!/usr/bin/env node

import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

const DEFAULT_RESOURCES_DIR = 'src-tauri/target/release/bundle/macos/internShannon.app/Contents/Resources';
const DEFAULT_TIMEOUT_MS = 45_000;
const LOG_LIMIT = 8_000;

function usage() {
    console.log(`Usage: node scripts/smoke-standalone-sidecar.mjs [--dir <path>] [--port <port>] [--timeout-ms <ms>] [--no-isolate]

Starts the bundled NestJS desktop sidecar, waits for /api/v1/health, then
terminates it. By default the resources are copied into a temporary directory
before launch so the smoke cannot accidentally resolve workspace node_modules.
`);
}

function parseArgs(argv) {
    const args = {
        dir: DEFAULT_RESOURCES_DIR,
        port: undefined,
        timeoutMs: DEFAULT_TIMEOUT_MS,
        isolate: true,
    };

    for (let index = 0; index < argv.length; index += 1) {
        const token = argv[index];
        if (token === '--dir') {
            args.dir = argv[index + 1];
            index += 1;
        } else if (token === '--port') {
            args.port = Number(argv[index + 1]);
            index += 1;
        } else if (token === '--timeout-ms') {
            args.timeoutMs = Number(argv[index + 1]);
            index += 1;
        } else if (token === '--no-isolate') {
            args.isolate = false;
        } else if (token === '--help' || token === '-h') {
            args.help = true;
        } else {
            throw new Error(`Unknown argument: ${token}`);
        }
    }

    if (args.port !== undefined && (!Number.isInteger(args.port) || args.port <= 0 || args.port > 65_535)) {
        throw new Error(`Invalid --port value: ${args.port}`);
    }
    if (!Number.isFinite(args.timeoutMs) || args.timeoutMs <= 0) {
        throw new Error(`Invalid --timeout-ms value: ${args.timeoutMs}`);
    }

    return args;
}

function isFile(filePath) {
    try {
        return fs.statSync(filePath).isFile();
    } catch {
        return false;
    }
}

function findSidecarDir(startDir) {
    const resolved = path.resolve(startDir);
    if (isFile(path.join(resolved, 'main.js'))) {
        return resolved;
    }

    const nested = path.join(resolved, 'sidecar');
    if (isFile(path.join(nested, 'main.js'))) {
        return nested;
    }

    throw new Error(`Could not find sidecar main.js under ${resolved}. Build a standalone desktop app first.`);
}

function findBundledNode(startDir) {
    const candidates = [
        path.join(startDir, 'node', 'bin', 'node'),
        path.join(startDir, 'node', 'node.exe'),
        path.join(path.dirname(startDir), 'node', 'bin', 'node'),
        path.join(path.dirname(startDir), 'node', 'node.exe'),
    ];
    return candidates.find(isFile);
}

function trimLog(value) {
    if (value.length <= LOG_LIMIT) return value;
    return `${value.slice(value.length - LOG_LIMIT)}\n[smoke log truncated to last ${LOG_LIMIT} chars]`;
}

function appendLog(current, chunk) {
    return trimLog(`${current}${chunk.toString()}`);
}

function getFreePort() {
    return new Promise((resolve, reject) => {
        const server = net.createServer();
        server.unref();
        server.on('error', reject);
        server.listen(0, '127.0.0.1', () => {
            const address = server.address();
            if (!address || typeof address === 'string') {
                server.close(() => reject(new Error('Failed to allocate a loopback port')));
                return;
            }
            const { port } = address;
            server.close(() => resolve(port));
        });
    });
}

function waitForHealth(port, timeoutMs, child, logs) {
    const startedAt = Date.now();

    return new Promise((resolve, reject) => {
        let timer;
        let settled = false;

        const finish = (callback, value) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            child.off('exit', onExit);
            callback(value);
        };

        const onExit = (code, signal) => {
            finish(
                reject,
                new Error(
                    [
                        `Sidecar exited before health was ready: code=${code ?? 'null'} signal=${signal ?? 'null'}`,
                        logs.stderr ? `stderr:\n${logs.stderr}` : '',
                        logs.stdout ? `stdout:\n${logs.stdout}` : '',
                    ]
                        .filter(Boolean)
                        .join('\n\n'),
                ),
            );
        };

        const poll = () => {
            if (Date.now() - startedAt > timeoutMs) {
                finish(
                    reject,
                    new Error(
                        [
                            `Timed out waiting for http://127.0.0.1:${port}/api/v1/health after ${timeoutMs}ms`,
                            logs.stderr ? `stderr:\n${logs.stderr}` : '',
                            logs.stdout ? `stdout:\n${logs.stdout}` : '',
                        ]
                            .filter(Boolean)
                            .join('\n\n'),
                    ),
                );
                return;
            }

            const request = http.get(
                {
                    host: '127.0.0.1',
                    port,
                    path: '/api/v1/health',
                    timeout: 1_500,
                },
                response => {
                    let body = '';
                    response.on('data', chunk => {
                        body = appendLog(body, chunk);
                    });
                    response.on('end', () => {
                        if (response.statusCode && response.statusCode >= 200 && response.statusCode < 300) {
                            finish(resolve, { statusCode: response.statusCode, body });
                            return;
                        }
                        setTimeout(poll, 500);
                    });
                },
            );
            request.on('timeout', () => {
                request.destroy();
            });
            request.on('error', () => {
                setTimeout(poll, 500);
            });
        };

        child.on('exit', onExit);
        timer = setTimeout(poll, 250);
    });
}

function terminateChild(child) {
    return new Promise(resolve => {
        if (child.exitCode !== null || child.signalCode !== null) {
            resolve();
            return;
        }
        const killTimer = setTimeout(() => {
            child.kill('SIGKILL');
        }, 3_000);
        child.once('exit', () => {
            clearTimeout(killTimer);
            resolve();
        });
        child.kill('SIGTERM');
    });
}

function copyToIsolatedDir(sidecarDir) {
    const isolatedRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'internshannon-sidecar-smoke.'));
    const isolatedSidecarDir = path.join(isolatedRoot, 'sidecar');
    fs.cpSync(sidecarDir, isolatedSidecarDir, { recursive: true, verbatimSymlinks: true });
    return { isolatedRoot, isolatedSidecarDir };
}

async function main() {
    const args = parseArgs(process.argv.slice(2));
    if (args.help) {
        usage();
        return;
    }

    const sourceSidecarDir = findSidecarDir(args.dir);
    const port = args.port ?? (await getFreePort());
    let isolatedRoot = null;
    const sidecarDir = args.isolate
        ? (() => {
              const isolated = copyToIsolatedDir(sourceSidecarDir);
              isolatedRoot = isolated.isolatedRoot;
              return isolated.isolatedSidecarDir;
          })()
        : sourceSidecarDir;
    const logs = { stdout: '', stderr: '' };
    let child = null;
    let dataDir = null;

    try {
        dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'internshannon-sidecar-data.'));
        const nodeExecutable = findBundledNode(sidecarDir) ?? process.execPath;
        child = spawn(nodeExecutable, [path.join(sidecarDir, 'main.js')], {
            cwd: sidecarDir,
            env: {
                ...process.env,
                APP_PORT: String(port),
                APP_HOST: '127.0.0.1',
                APP_MODE: 'desktop',
                KERNEL_WORKSPACE_STORAGE_PROVIDER: 'local',
                NODE_ENV: 'production',
                RUST_LOG: 'info',
                INTERNSHANNON_DATA_DIR: dataDir,
            },
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        child.stdout.on('data', chunk => {
            logs.stdout = appendLog(logs.stdout, chunk);
        });
        child.stderr.on('data', chunk => {
            logs.stderr = appendLog(logs.stderr, chunk);
        });

        const health = await waitForHealth(port, args.timeoutMs, child, logs);
        console.log(`Standalone sidecar smoke OK: http://127.0.0.1:${port}/api/v1/health -> ${health.statusCode}`);
    } finally {
        if (child) {
            await terminateChild(child);
        }
        if (isolatedRoot) {
            fs.rmSync(isolatedRoot, { recursive: true, force: true });
        }
        if (dataDir) {
            fs.rmSync(dataDir, { recursive: true, force: true });
        }
    }
}

main().catch(error => {
    console.error(`smoke-standalone-sidecar: ${error.message}`);
    process.exit(1);
});
