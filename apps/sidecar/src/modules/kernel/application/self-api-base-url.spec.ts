import { resolveSelfApiBaseUrl } from './self-api-base-url';

describe('resolveSelfApiBaseUrl', () => {
    const originalAppPort = process.env.APP_PORT;
    const originalSelfApiBaseUrl = process.env.SELF_API_BASE_URL;

    afterEach(() => {
        restoreEnv('APP_PORT', originalAppPort);
        restoreEnv('SELF_API_BASE_URL', originalSelfApiBaseUrl);
    });

    it('prefers SELF_API_BASE_URL and removes trailing slashes', () => {
        process.env.SELF_API_BASE_URL = 'http://127.0.0.1:3010///';
        process.env.APP_PORT = '29670';

        expect(resolveSelfApiBaseUrl()).toBe('http://127.0.0.1:3010');
    });

    it('uses APP_PORT when no self API override is configured', () => {
        delete process.env.SELF_API_BASE_URL;
        process.env.APP_PORT = '29670';

        expect(resolveSelfApiBaseUrl()).toBe('http://127.0.0.1:29670');
    });

    it('uses the sidecar default port when both environment variables are unset', () => {
        delete process.env.SELF_API_BASE_URL;
        delete process.env.APP_PORT;

        expect(resolveSelfApiBaseUrl()).toBe('http://127.0.0.1:29653');
    });
});

function restoreEnv(name: string, value: string | undefined) {
    if (value === undefined) {
        delete process.env[name];
        return;
    }
    process.env[name] = value;
}
