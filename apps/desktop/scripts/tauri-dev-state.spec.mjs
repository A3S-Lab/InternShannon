import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import {
    formatPortFallbackMessage,
    formatTauriDevStartupMessage,
    resolveDesktopGatewayUrl,
    resolveRequestedDesktopPort,
    selectDesktopDevPort,
} from './tauri-dev-state.mjs';

test('resolves requested desktop dev ports from environment', () => {
    assert.equal(resolveRequestedDesktopPort({ PUBLIC_DESKTOP_DEV_PORT: '5010' }), 5010);
    assert.equal(resolveRequestedDesktopPort({ PORT: '5002' }), 5002);
    assert.equal(resolveRequestedDesktopPort({ PORT: 'not-a-port' }), 5000);
});

test('selects the first available desktop dev port', async () => {
    const selected = await selectDesktopDevPort({
        canListen: async port => port === 5002,
        requestedPort: 5000,
    });

    assert.deepEqual(selected, {
        requested: 5000,
        selected: 5002,
    });
});

test('formats port fallback and startup messages', () => {
    assert.equal(
        formatPortFallbackMessage({ requestedPort: 5000, selectedPort: 5002 }),
        '[desktop-dev] Port 5000 is busy; using 5002 for the Tauri dev server.',
    );
    assert.equal(formatPortFallbackMessage({ requestedPort: 5000, selectedPort: 5000 }), '');

    assert.equal(
        formatTauriDevStartupMessage({
            gatewayUrl: 'http://127.0.0.1:29653/',
            requestedPort: 5000,
            selectedPort: 5002,
            webUrl: 'http://127.0.0.1:5002/',
        }),
        [
            '',
            '[desktop-dev] Starting Tauri desktop shell',
            '  Web      http://127.0.0.1:5002',
            '  API      http://127.0.0.1:29653/api/v1',
            '  Health   http://127.0.0.1:29653/api/v1/health',
            '  Smoke    PUBLIC_DESKTOP_URL=http://127.0.0.1:5002 PUBLIC_DESKTOP_GATEWAY_URL=http://127.0.0.1:29653 just desktop-smoke',
            '  Note     requested web port 5000 was busy; using 5002',
            '',
        ].join('\n'),
    );
});

test('resolves desktop gateway URL from environment', () => {
    assert.equal(
        resolveDesktopGatewayUrl({ PUBLIC_DESKTOP_GATEWAY_URL: ' http://127.0.0.1:29680/ ' }),
        'http://127.0.0.1:29680',
    );
    assert.equal(resolveDesktopGatewayUrl({ APP_PORT: '29681' }), 'http://127.0.0.1:29653');
    assert.equal(resolveDesktopGatewayUrl({ APP_PORT: 'not-a-port' }), 'http://127.0.0.1:29653');
});
