const DEFAULT_DESKTOP_DEV_PORT = 5000;
const DEFAULT_DESKTOP_API_PORT = 29653;
const PORT_SEARCH_WINDOW = 50;

export function resolveRequestedDesktopPort(env = {}) {
    const requested = Number(env.PUBLIC_DESKTOP_DEV_PORT || env.PORT || DEFAULT_DESKTOP_DEV_PORT);
    return Number.isFinite(requested) && requested > 0 ? Math.floor(requested) : DEFAULT_DESKTOP_DEV_PORT;
}

export function resolveDesktopGatewayUrl(env = {}) {
    const configured = String(env.PUBLIC_DESKTOP_GATEWAY_URL || '').trim();
    if (configured) return normalizeUrl(configured);

    return `http://127.0.0.1:${DEFAULT_DESKTOP_API_PORT}`;
}

export async function selectDesktopDevPort({ requestedPort, canListen }) {
    for (let port = requestedPort; port < requestedPort + PORT_SEARCH_WINDOW; port += 1) {
        if (await canListen(port)) {
            return {
                requested: requestedPort,
                selected: port,
            };
        }
    }

    throw new Error(
        `No available desktop dev port found in range ${requestedPort}-${requestedPort + PORT_SEARCH_WINDOW - 1}`,
    );
}

export function formatPortFallbackMessage({ requestedPort, selectedPort }) {
    if (selectedPort === requestedPort) return '';
    return `[desktop-dev] Port ${requestedPort} is busy; using ${selectedPort} for the Tauri dev server.`;
}

export function formatTauriDevStartupMessage({ requestedPort, selectedPort, webUrl, gatewayUrl }) {
    const lines = [
        '',
        '[desktop-dev] Starting Tauri desktop shell',
        `  Web      ${normalizeUrl(webUrl)}`,
        `  API      ${normalizeUrl(gatewayUrl)}/api/v1`,
        `  Health   ${normalizeUrl(gatewayUrl)}/api/v1/health`,
        `  Smoke    PUBLIC_DESKTOP_URL=${normalizeUrl(webUrl)} PUBLIC_DESKTOP_GATEWAY_URL=${normalizeUrl(gatewayUrl)} just desktop-smoke`,
    ];

    if (selectedPort !== requestedPort) {
        lines.push(`  Note     requested web port ${requestedPort} was busy; using ${selectedPort}`);
    }

    lines.push('');
    return lines.join('\n');
}

function normalizeUrl(value) {
    return String(value ?? '')
        .trim()
        .replace(/\/+$/, '');
}
