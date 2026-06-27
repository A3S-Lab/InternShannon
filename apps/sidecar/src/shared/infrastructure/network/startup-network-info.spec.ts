import {
    buildStartupNetworkInfo,
    collectMachineIpv4Addresses,
    formatStartupNetworkInfoLines,
    type NetworkInterfacesLike,
} from './startup-network-info';

const interfaces: NetworkInterfacesLike = {
    lo0: [{ address: '127.0.0.1', family: 'IPv4', internal: true }],
    en0: [{ address: '192.168.1.23', family: 'IPv4', internal: false }],
    utun0: [{ address: '10.8.0.2', family: 4, internal: false }],
    en1: [{ address: 'fe80::1', family: 'IPv6', internal: false }],
};

describe('startup network info', () => {
    it('collects non-loopback IPv4 addresses with interface names', () => {
        expect(collectMachineIpv4Addresses(interfaces)).toEqual([
            { interfaceName: 'en0', address: '192.168.1.23' },
            { interfaceName: 'utun0', address: '10.8.0.2' },
        ]);
    });

    it('builds LAN URLs when binding to all interfaces', () => {
        const info = buildStartupNetworkInfo({
            host: '0.0.0.0',
            hostname: 'devbox',
            interfaces,
            port: 29653,
        });

        expect(info.localUrls).toEqual(['http://localhost:29653', 'http://127.0.0.1:29653']);
        expect(info.lanUrls).toEqual(['http://192.168.1.23:29653', 'http://10.8.0.2:29653']);
        expect(info.lanAccessEnabled).toBe(true);
        expect(info.lanHint).toBeUndefined();
    });

    it('explains why LAN URLs are disabled for loopback binds', () => {
        const lines = formatStartupNetworkInfoLines({
            color: false,
            host: '127.0.0.1',
            hostname: 'devbox',
            interfaces,
            mode: 'desktop',
            port: 29653,
        });

        expect(lines).toContain('IPv4       en0  192.168.1.23');
        expect(lines).toContain('           utun0  10.8.0.2');
        expect(lines).toContain(
            'LAN        disabled because APP_HOST=127.0.0.1 only accepts local connections; set APP_HOST=0.0.0.0 on a trusted LAN to enable LAN debugging',
        );
    });

    it('formats an easy-to-scan colored startup summary', () => {
        const lines = formatStartupNetworkInfoLines({
            color: true,
            host: '0.0.0.0',
            hostname: 'devbox',
            interfaces,
            mode: 'cloud',
            port: 29653,
        });

        expect(lines[1]).toContain('\u001b[96m');
        expect(lines).toContain('\u001b[2mLAN       \u001b[22m \u001b[92mhttp://192.168.1.23:29653\u001b[39m');
        expect(lines).toContain('\u001b[2m          \u001b[22m \u001b[92mhttp://10.8.0.2:29653\u001b[39m');
    });
});
