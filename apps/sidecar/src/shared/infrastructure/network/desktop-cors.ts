import type { CorsOptions } from '@nestjs/common/interfaces/external/cors-options.interface';

const TAURI_ORIGINS = new Set([
    'tauri://localhost',
    'http://tauri.localhost',
    'https://tauri.localhost',
]);

function configuredOrigins(env: NodeJS.ProcessEnv): Set<string> {
    return new Set(
        String(env.INTERNSHANNON_ALLOWED_ORIGINS || '')
            .split(',')
            .map(origin => origin.trim().replace(/\/$/, ''))
            .filter(Boolean),
    );
}

function isDevelopmentLoopbackOrigin(origin: string, env: NodeJS.ProcessEnv): boolean {
    if (env.NODE_ENV === 'production') return false;
    try {
        const parsed = new URL(origin);
        return (
            (parsed.protocol === 'http:' || parsed.protocol === 'https:') &&
            (parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost' || parsed.hostname === '[::1]')
        );
    } catch {
        return false;
    }
}

/**
 * Desktop API access is restricted to the packaged Tauri WebView, explicitly
 * configured hosts, and loopback development servers. Requests without an
 * Origin header remain available to the native bridge and local diagnostics;
 * browser pages always send an Origin for CORS/WebSocket access.
 */
export function isTrustedDesktopOrigin(origin: string | undefined, env: NodeJS.ProcessEnv = process.env): boolean {
    if (!origin) return true;
    const normalized = origin.trim().replace(/\/$/, '');
    return (
        TAURI_ORIGINS.has(normalized) ||
        configuredOrigins(env).has(normalized) ||
        isDevelopmentLoopbackOrigin(normalized, env)
    );
}

export const desktopCorsOrigin: NonNullable<CorsOptions['origin']> = (origin, callback) => {
    if (isTrustedDesktopOrigin(origin)) {
        callback(null, true);
        return;
    }
    // Omit CORS headers without turning an untrusted page probe into a noisy
    // application error. The browser blocks access to the response.
    callback(null, false);
};

export function desktopSocketAllowRequest(
    request: { headers?: { origin?: string } },
    callback: (error: string | null, success: boolean) => void,
): void {
    callback(null, isTrustedDesktopOrigin(request.headers?.origin));
}
