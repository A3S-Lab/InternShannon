export const APP_MODE = process.env.APP_MODE || 'desktop';
export const isCloud = () => APP_MODE === 'cloud';
export const isDesktop = () => APP_MODE === 'desktop';

/**
 * Desktop sidecar trusts the caller because it binds to loopback by default
 * (main.ts). If APP_HOST is overridden to a non-loopback interface (0.0.0.0,
 * LAN IP, etc.), callers outside the local machine may be able to reach the
 * process. Returns true only when desktop + loopback are both true.
 */
const LOOPBACK_HOSTS = new Set(['127.0.0.1', '::1', 'localhost', '0:0:0:0:0:0:0:1']);
export const isDesktopLoopback = (): boolean => {
    if (APP_MODE !== 'desktop') return false;
    const host = (process.env.APP_HOST || '127.0.0.1').trim();
    return LOOPBACK_HOSTS.has(host);
};
