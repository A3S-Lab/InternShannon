import { execSync, spawn } from 'node:child_process';
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
    if (signal) {
        process.kill(process.pid, signal);
        return;
    }
    process.exit(code ?? 0);
});
