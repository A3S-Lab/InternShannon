#!/usr/bin/env node

import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { io } from 'socket.io-client';

const DEFAULT_RESOURCES_DIR = 'src-tauri/target/release/bundle/macos/internShannon.app/Contents/Resources';
const DEFAULT_TIMEOUT_MS = 90_000;
const RESPONSE_MARKER = '中文 provider WebSocket 回归通过';
const PROVIDER_NAME = '智谱';
const MODEL_ID = 'unicode-provider-smoke';
const PAIRED_API_KEY = 'unicode-smoke-paired-key';
const LOG_LIMIT = 16_000;

function parseArgs(argv) {
    const args = { dir: DEFAULT_RESOURCES_DIR, timeoutMs: DEFAULT_TIMEOUT_MS };
    for (let index = 0; index < argv.length; index += 1) {
        const token = argv[index];
        if (token === '--dir') {
            args.dir = argv[index + 1];
            index += 1;
        } else if (token === '--timeout-ms') {
            args.timeoutMs = Number(argv[index + 1]);
            index += 1;
        } else if (token === '--help' || token === '-h') {
            args.help = true;
        } else {
            throw new Error(`Unknown argument: ${token}`);
        }
    }
    if (!Number.isFinite(args.timeoutMs) || args.timeoutMs <= 0) {
        throw new Error(`Invalid --timeout-ms value: ${args.timeoutMs}`);
    }
    return args;
}

function printHelp() {
    console.log(
        [
            'Usage: node scripts/smoke-unicode-provider-websocket.mjs [--dir <path>] [--timeout-ms <ms>]',
            '',
            'Starts the sidecar from a packaged app, configures a Unicode provider,',
            'and completes a user-message round trip over a real WebSocket transport.',
        ].join('\n'),
    );
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
    if (isFile(path.join(resolved, 'main.js'))) return resolved;
    if (isFile(path.join(resolved, 'sidecar', 'main.js'))) return path.join(resolved, 'sidecar');
    throw new Error(`Could not find packaged sidecar main.js under ${resolved}`);
}

function findBundledNode(sidecarDir) {
    const candidates = [
        path.join(sidecarDir, 'node', 'bin', 'node'),
        path.join(sidecarDir, 'node', 'node.exe'),
        path.join(path.dirname(sidecarDir), 'node', 'bin', 'node'),
        path.join(path.dirname(sidecarDir), 'node', 'node.exe'),
    ];
    return candidates.find(isFile);
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
            server.close(() => resolve(address.port));
        });
    });
}

function appendLog(current, chunk) {
    const updated = `${current}${chunk.toString()}`;
    return updated.length <= LOG_LIMIT ? updated : updated.slice(updated.length - LOG_LIMIT);
}

function sidecarFailure(message, logs) {
    return new Error(
        [message, logs.stderr ? `sidecar stderr:\n${logs.stderr}` : '', logs.stdout ? `sidecar stdout:\n${logs.stdout}` : '']
            .filter(Boolean)
            .join('\n\n'),
    );
}

function waitForHealth(port, timeoutMs, child, logs) {
    const deadline = Date.now() + timeoutMs;
    return new Promise((resolve, reject) => {
        let settled = false;
        const finish = (callback, value) => {
            if (settled) return;
            settled = true;
            child.off('exit', onExit);
            callback(value);
        };
        const onExit = (code, signal) => {
            finish(reject, sidecarFailure(`Sidecar exited before health: code=${code} signal=${signal}`, logs));
        };
        const poll = async () => {
            if (settled) return;
            if (Date.now() >= deadline) {
                finish(reject, sidecarFailure(`Timed out waiting for sidecar health on port ${port}`, logs));
                return;
            }
            try {
                const response = await fetch(`http://127.0.0.1:${port}/api/v1/health`);
                if (response.ok) {
                    finish(resolve, response.status);
                    return;
                }
            } catch {
                // The process is still starting.
            }
            setTimeout(poll, 250);
        };
        child.on('exit', onExit);
        setTimeout(poll, 100);
    });
}

function terminateChild(child) {
    return new Promise(resolve => {
        if (!child || child.exitCode !== null || child.signalCode !== null) {
            resolve();
            return;
        }
        const killTimer = setTimeout(() => child.kill('SIGKILL'), 3_000);
        child.once('exit', () => {
            clearTimeout(killTimer);
            resolve();
        });
        child.kill('SIGTERM');
    });
}

function closeServer(server) {
    return new Promise(resolve => {
        if (!server.listening) {
            resolve();
            return;
        }
        server.close(() => resolve());
        server.closeAllConnections?.();
    });
}

async function readRequestBody(request) {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    return Buffer.concat(chunks).toString('utf8');
}

async function startMockOpenAi() {
    const requests = [];
    const server = http.createServer(async (request, response) => {
        const bodyText = await readRequestBody(request);
        let body = null;
        try {
            body = bodyText ? JSON.parse(bodyText) : null;
        } catch {
            body = bodyText;
        }
        requests.push({
            method: request.method,
            url: request.url,
            authorization: request.headers.authorization,
            body,
        });

        if (request.method === 'GET' && request.url?.endsWith('/models')) {
            response.writeHead(200, { 'content-type': 'application/json' });
            response.end(JSON.stringify({ object: 'list', data: [{ id: MODEL_ID, object: 'model' }] }));
            return;
        }

        if (request.method !== 'POST' || !request.url?.endsWith('/v1/chat/completions')) {
            response.writeHead(404, { 'content-type': 'application/json' });
            response.end(JSON.stringify({ error: { message: `Unexpected mock path: ${request.url}` } }));
            return;
        }

        response.writeHead(200, {
            'cache-control': 'no-cache',
            connection: 'keep-alive',
            'content-type': 'text/event-stream',
        });
        const chunkBase = {
            id: 'chatcmpl-unicode-provider-smoke',
            object: 'chat.completion.chunk',
            created: Math.floor(Date.now() / 1000),
            model: MODEL_ID,
        };
        response.write(
            `data: ${JSON.stringify({ ...chunkBase, choices: [{ index: 0, delta: { role: 'assistant', content: RESPONSE_MARKER }, finish_reason: null }] })}\n\n`,
        );
        response.write(
            `data: ${JSON.stringify({ ...chunkBase, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } })}\n\n`,
        );
        response.end('data: [DONE]\n\n');
    });
    const port = await getFreePort();
    await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, '127.0.0.1', resolve);
    });
    return { port, requests, server };
}

async function apiRequest(apiBase, pathname, init = {}) {
    const response = await fetch(`${apiBase}${pathname}`, {
        ...init,
        headers: {
            Origin: 'tauri://localhost',
            ...(init.body ? { 'Content-Type': 'application/json' } : {}),
            ...init.headers,
        },
    });
    const text = await response.text();
    let parsed = null;
    try {
        parsed = text ? JSON.parse(text) : null;
    } catch {
        parsed = text;
    }
    if (!response.ok) {
        throw new Error(`${init.method ?? 'GET'} ${pathname} failed with ${response.status}: ${JSON.stringify(parsed)}`);
    }
    return parsed && typeof parsed === 'object' && 'data' in parsed ? parsed.data : parsed;
}

function waitForSocket(socket, eventName, predicate = () => true, timeoutMs = 10_000) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            cleanup();
            reject(new Error(`${eventName} timed out after ${timeoutMs}ms`));
        }, timeoutMs);
        const handler = payload => {
            if (!predicate(payload)) return;
            cleanup();
            resolve(payload);
        };
        const cleanup = () => {
            clearTimeout(timer);
            socket.off(eventName, handler);
        };
        socket.on(eventName, handler);
    });
}

function connectSocket(socket, timeoutMs = 10_000) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            cleanup();
            reject(new Error(`WebSocket connection timed out after ${timeoutMs}ms`));
        }, timeoutMs);
        const onConnect = () => {
            cleanup();
            resolve();
        };
        const onError = error => {
            cleanup();
            reject(error instanceof Error ? error : new Error(String(error)));
        };
        const cleanup = () => {
            clearTimeout(timer);
            socket.off('connect', onConnect);
            socket.off('connect_error', onError);
        };
        socket.on('connect', onConnect);
        socket.on('connect_error', onError);
    });
}

function textFromMessage(message) {
    if (!message || typeof message !== 'object') return '';
    if (message.type === 'stream_event' && typeof message.event?.text === 'string') return message.event.text;
    if (message.type !== 'assistant') return '';
    if (typeof message.content === 'string') return message.content;
    if (Array.isArray(message.content)) {
        return message.content
            .map(block => (typeof block?.text === 'string' ? block.text : typeof block?.content === 'string' ? block.content : ''))
            .join('');
    }
    return '';
}

function waitForAssistantRoundTrip(socket, sessionId, timeoutMs) {
    return new Promise((resolve, reject) => {
        let text = '';
        const timer = setTimeout(() => {
            cleanup();
            reject(new Error(`assistant WebSocket response timed out after ${timeoutMs}ms; partial=${JSON.stringify(text)}`));
        }, timeoutMs);
        const handler = message => {
            if (message?.type === 'error') {
                cleanup();
                reject(new Error(`sidecar WebSocket error: ${message.message ?? 'unknown error'}`));
                return;
            }
            text += textFromMessage(message);
            if (text.includes(RESPONSE_MARKER)) {
                cleanup();
                resolve(text);
            }
        };
        const cleanup = () => {
            clearTimeout(timer);
            socket.off('message', handler);
        };
        socket.on('message', handler);
        socket.emit('message', {
            sessionId,
            type: 'user_message',
            content: `只回复：${RESPONSE_MARKER}`,
        });
    });
}

async function main() {
    const args = parseArgs(process.argv.slice(2));
    if (args.help) {
        printHelp();
        return;
    }

    const sourceSidecarDir = findSidecarDir(args.dir);
    const resourcesDir = path.basename(sourceSidecarDir) === 'sidecar' ? path.dirname(sourceSidecarDir) : sourceSidecarDir;
    const isolatedRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'internshannon-unicode-ws.'));
    const isolatedSidecarDir = path.join(isolatedRoot, 'sidecar');
    const dataDir = path.join(isolatedRoot, 'data');
    fs.cpSync(sourceSidecarDir, isolatedSidecarDir, { recursive: true, verbatimSymlinks: true });
    fs.mkdirSync(dataDir, { recursive: true });

    const mock = await startMockOpenAi();
    const sidecarPort = await getFreePort();
    const logs = { stdout: '', stderr: '' };
    const nodeExecutable = findBundledNode(resourcesDir) ?? process.execPath;
    const child = spawn(nodeExecutable, [path.join(isolatedSidecarDir, 'main.js')], {
        cwd: isolatedSidecarDir,
        env: {
            ...process.env,
            APP_PORT: String(sidecarPort),
            APP_HOST: '127.0.0.1',
            APP_MODE: 'desktop',
            KERNEL_WORKSPACE_STORAGE_PROVIDER: 'local',
            KERNEL_MODELS_CONFIG_TTL_MS: '0',
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

    let socket = null;
    let sessionId = null;
    try {
        await waitForHealth(sidecarPort, args.timeoutMs, child, logs);
        const gatewayUrl = `http://127.0.0.1:${sidecarPort}`;
        const apiBase = `${gatewayUrl}/api/v1`;
        await apiRequest(apiBase, '/config/categories/llm', {
            method: 'PUT',
            body: JSON.stringify({
                defaultModel: `${PROVIDER_NAME}/${MODEL_ID}`,
                providers: [
                    {
                        name: PROVIDER_NAME,
                        apiKey: PAIRED_API_KEY,
                        baseUrl: `http://127.0.0.1:${mock.port}`,
                        models: [
                            {
                                id: MODEL_ID,
                                name: 'Unicode Provider Smoke',
                                family: 'openai',
                                attachment: false,
                                reasoning: false,
                                toolCall: false,
                                temperature: true,
                            },
                        ],
                    },
                ],
            }),
        });

        const created = await apiRequest(apiBase, '/kernel/sessions', {
            method: 'POST',
            body: JSON.stringify({
                agentId: 'default',
                title: 'Unicode provider packaged WebSocket smoke',
                model: `${PROVIDER_NAME}/${MODEL_ID}`,
                builtinSkills: false,
                planningMode: 'disabled',
            }),
        });
        sessionId = created?.session?.sessionId;
        if (!sessionId) throw new Error('Session creation did not return sessionId');

        socket = io(`${gatewayUrl}/ws/kernel`, {
            transports: ['websocket'],
            extraHeaders: { Origin: 'tauri://localhost' },
            timeout: 10_000,
            reconnection: false,
            forceNew: true,
        });
        await connectSocket(socket, 10_000);
        if (socket.io.engine.transport.name !== 'websocket') {
            throw new Error(`Expected websocket transport, received ${socket.io.engine.transport.name}`);
        }
        const subscribed = waitForSocket(socket, 'subscribed', payload => payload?.sessionId === sessionId, 10_000);
        socket.emit('subscribe', { sessionId });
        await subscribed;
        await waitForAssistantRoundTrip(socket, sessionId, args.timeoutMs);

        const chatRequest = mock.requests.find(request => request.url?.endsWith('/v1/chat/completions'));
        if (!chatRequest) throw new Error('Mock provider did not receive /v1/chat/completions');
        if (chatRequest.authorization !== `Bearer ${PAIRED_API_KEY}`) {
            throw new Error('Mock provider received the wrong Authorization value');
        }
        if (chatRequest.body?.model !== MODEL_ID) {
            throw new Error(`Mock provider received model=${JSON.stringify(chatRequest.body?.model)}, expected ${MODEL_ID}`);
        }

        console.log(
            [
                'Unicode provider packaged WebSocket smoke OK:',
                'transport=websocket',
                `provider=${PROVIDER_NAME}`,
                `model=${MODEL_ID}`,
                'url=/v1/chat/completions',
                'authorization=paired',
                `assistant=${RESPONSE_MARKER}`,
            ].join(' '),
        );
    } catch (error) {
        throw sidecarFailure(error instanceof Error ? error.message : String(error), logs);
    } finally {
        socket?.close();
        if (sessionId) {
            try {
                await fetch(`http://127.0.0.1:${sidecarPort}/api/v1/kernel/sessions/${encodeURIComponent(sessionId)}`, {
                    method: 'DELETE',
                    headers: { Origin: 'tauri://localhost' },
                });
            } catch {
                // Cleanup is best-effort inside the isolated data directory.
            }
        }
        await terminateChild(child);
        await closeServer(mock.server);
        fs.rmSync(isolatedRoot, { recursive: true, force: true });
    }
}

main().catch(error => {
    console.error(`smoke-unicode-provider-websocket: ${error.message}`);
    process.exit(1);
});
