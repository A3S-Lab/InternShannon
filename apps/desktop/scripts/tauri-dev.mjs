import { execSync, spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import net from 'net';
import path from 'path';
import {
    formatPortFallbackMessage,
    formatTauriDevStartupMessage,
    resolveDesktopGatewayUrl,
    resolveRequestedDesktopPort,
    selectDesktopDevPort,
} from './tauri-dev-state.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const appRoot = path.resolve(__dirname, '..');
const debugDir = path.join(appRoot, 'src-tauri', 'target', 'debug');
const boxLibDir = path.join(debugDir, 'box', 'lib');
const frontendDir = path.join(appRoot, 'frontend');
const sidecarResourceEntrypoint = path.join(appRoot, 'src-tauri', 'resources', 'sidecar', 'main.js');

// Resolve pnpm to full path (fixes Windows spawn issue)
function resolvePnpm() {
    if (process.platform === 'win32') {
        const result = execSync('where pnpm', { encoding: 'utf-8', shell: true });
        const lines = result.split(/\r?\n/).filter(Boolean);
        // Prefer .cmd file on Windows
        return lines.find(l => l.endsWith('.cmd')) || lines[0];
    }
    // Unix-like: use which to find pnpm
    return execSync('which pnpm', { encoding: 'utf-8' }).trim();
}
const pnpmPath = resolvePnpm();

const env = { ...process.env };

function canListen(port) {
    return new Promise(resolve => {
        const server = net.createServer();
        server.once('error', () => resolve(false));
        server.once('listening', () => {
            server.close(() => resolve(true));
        });
        server.listen(port, '127.0.0.1');
    });
}

function contentType(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    if (ext === '.html') return 'text/html; charset=utf-8';
    if (ext === '.js') return 'text/javascript; charset=utf-8';
    if (ext === '.css') return 'text/css; charset=utf-8';
    if (ext === '.svg') return 'image/svg+xml';
    if (ext === '.json') return 'application/json; charset=utf-8';
    return 'application/octet-stream';
}

function fileForRequest(url = '/') {
    const parsed = new URL(url, 'http://127.0.0.1');
    const decodedPath = decodeURIComponent(parsed.pathname);
    const normalizedPath = decodedPath === '/' ? '/index.html' : decodedPath;
    const candidate = path.normalize(path.join(frontendDir, normalizedPath));
    if (!candidate.startsWith(frontendDir + path.sep)) {
        return path.join(frontendDir, 'index.html');
    }
    return candidate;
}

function startFrontendServer(port) {
    const indexPath = path.join(frontendDir, 'index.html');
    if (!fs.existsSync(indexPath)) {
        throw new Error(`Desktop frontend entrypoint is missing: ${indexPath}`);
    }

    const server = http.createServer((req, res) => {
        const filePath = fileForRequest(req.url);
        const resolvedPath = fs.existsSync(filePath) && fs.statSync(filePath).isFile() ? filePath : indexPath;
        res.writeHead(200, {
            'Cache-Control': 'no-store',
            'Content-Type': contentType(resolvedPath),
        });
        fs.createReadStream(resolvedPath).pipe(res);
    });

    return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, '127.0.0.1', () => {
            server.off('error', reject);
            resolve(server);
        });
    });
}

function ensureSidecarResources() {
    if (fs.existsSync(sidecarResourceEntrypoint)) return;

    const result = spawnSync(process.execPath, ['scripts/stage-sidecar-resources.mjs', '--dist-only'], {
        cwd: appRoot,
        env,
        stdio: 'inherit',
    });
    if (result.error) {
        throw new Error(`Failed to stage sidecar resources: ${result.error.message}`);
    }
    if (result.status !== 0) {
        throw new Error(`Failed to stage sidecar resources: stage script exited with ${result.status}`);
    }
}

async function resolveDesktopPort() {
    return selectDesktopDevPort({
        canListen,
        requestedPort: resolveRequestedDesktopPort(env),
    });
}

const { requested: requestedDesktopPort, selected: desktopPort } = await resolveDesktopPort();
const portFallbackMessage = formatPortFallbackMessage({
    requestedPort: requestedDesktopPort,
    selectedPort: desktopPort,
});
if (portFallbackMessage) console.warn(portFallbackMessage);

const gatewayUrl = resolveDesktopGatewayUrl(env);
const webUrl = `http://127.0.0.1:${desktopPort}`;
env.PUBLIC_DESKTOP_DEV_PORT = String(desktopPort);
env.PORT = String(desktopPort);
env.PUBLIC_DESKTOP_URL = webUrl;
env.PUBLIC_DESKTOP_GATEWAY_URL = gatewayUrl;

console.log(
    formatTauriDevStartupMessage({
        gatewayUrl,
        requestedPort: requestedDesktopPort,
        selectedPort: desktopPort,
        webUrl,
    }),
);

if (process.platform === 'darwin') {
    const fallback = [debugDir, boxLibDir].filter(Boolean).join(':');
    env.DYLD_FALLBACK_LIBRARY_PATH = env.DYLD_FALLBACK_LIBRARY_PATH
        ? `${fallback}:${env.DYLD_FALLBACK_LIBRARY_PATH}`
        : fallback;

    // Skip codesign in dev mode - macOS auto-ad-hoc signs dylibs on load.
    // Re-signing every time modifies xattrs and triggers file watcher rebuild loops.
}

if (env.TAURI_DEV_DRY_RUN === '1') {
    process.exit(0);
}

ensureSidecarResources();
const frontendServer = await startFrontendServer(desktopPort);

const tauriArgs = [
    'exec',
    'tauri',
    'dev',
    '--config',
    JSON.stringify({ build: { devUrl: `http://127.0.0.1:${desktopPort}` } }),
];

const child = spawn(pnpmPath, tauriArgs, {
    cwd: appRoot,
    env,
    stdio: 'inherit',
    shell: process.platform === 'win32',
});

child.on('exit', (code, signal) => {
    frontendServer.close();
    if (signal) {
        process.kill(process.pid, signal);
        return;
    }
    process.exit(code ?? 0);
});
