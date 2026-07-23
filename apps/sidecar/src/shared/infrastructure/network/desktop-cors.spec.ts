import { desktopSocketAllowRequest, isTrustedDesktopOrigin } from './desktop-cors';

describe('desktop CORS origin policy', () => {
    it('allows native/no-origin traffic and packaged Tauri origins in production', () => {
        const env = { NODE_ENV: 'production' } as NodeJS.ProcessEnv;
        expect(isTrustedDesktopOrigin(undefined, env)).toBe(true);
        expect(isTrustedDesktopOrigin('tauri://localhost', env)).toBe(true);
        expect(isTrustedDesktopOrigin('http://tauri.localhost', env)).toBe(true);
    });

    it('rejects arbitrary web origins and production loopback pages', () => {
        const env = { NODE_ENV: 'production' } as NodeJS.ProcessEnv;
        expect(isTrustedDesktopOrigin('https://attacker.example', env)).toBe(false);
        expect(isTrustedDesktopOrigin('http://127.0.0.1:5001', env)).toBe(false);
    });

    it('allows loopback browser development and explicit origins', () => {
        const dev = { NODE_ENV: 'development' } as NodeJS.ProcessEnv;
        const production = {
            NODE_ENV: 'production',
            INTERNSHANNON_ALLOWED_ORIGINS: 'https://desktop.example, http://127.0.0.1:5001/',
        } as NodeJS.ProcessEnv;
        expect(isTrustedDesktopOrigin('http://localhost:5000', dev)).toBe(true);
        expect(isTrustedDesktopOrigin('http://127.0.0.1:5001', dev)).toBe(true);
        expect(isTrustedDesktopOrigin('https://desktop.example', production)).toBe(true);
        expect(isTrustedDesktopOrigin('http://127.0.0.1:5001', production)).toBe(true);
    });

    it('rejects untrusted WebSocket handshakes at the server', () => {
        const callback = jest.fn();
        desktopSocketAllowRequest({ headers: { origin: 'https://attacker.example' } }, callback);
        expect(callback).toHaveBeenCalledWith(null, false);
    });
});
