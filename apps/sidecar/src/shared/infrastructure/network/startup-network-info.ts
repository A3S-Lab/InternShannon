import { hostname as getOsHostname, networkInterfaces as getOsNetworkInterfaces } from 'node:os';

export interface NetworkInterfaceLike {
    address: string;
    family: string | number;
    internal: boolean;
}

export type NetworkInterfacesLike = Record<string, NetworkInterfaceLike[] | undefined>;

export interface StartupNetworkAddress {
    interfaceName: string;
    address: string;
}

export interface StartupNetworkInfo {
    bindHost: string;
    hostname: string;
    lanAccessEnabled: boolean;
    lanHint?: string;
    lanUrls: string[];
    localUrls: string[];
    machineIps: StartupNetworkAddress[];
    port: number;
}

export interface StartupServiceEndpoint {
    label: string;
    value?: string;
    tone?: 'normal' | 'success' | 'warning';
}

export function collectMachineIpv4Addresses(
    interfaces: NetworkInterfacesLike = getOsNetworkInterfaces() as NetworkInterfacesLike,
): StartupNetworkAddress[] {
    return Object.entries(interfaces)
        .flatMap(([interfaceName, entries]) => (entries ?? []).map(entry => ({ interfaceName, entry })))
        .filter(({ entry }) => !entry.internal && normalizeAddressFamily(entry.family) === 'IPv4')
        .map(({ interfaceName, entry }) => ({ interfaceName, address: entry.address }))
        .sort(
            (left, right) =>
                left.interfaceName.localeCompare(right.interfaceName, 'en') ||
                left.address.localeCompare(right.address, 'en'),
        );
}

export function buildStartupNetworkInfo({
    host,
    hostname = getOsHostname(),
    interfaces,
    port,
}: {
    host: string;
    hostname?: string;
    interfaces?: NetworkInterfacesLike;
    port: number;
}): StartupNetworkInfo {
    const bindHost = host.trim() || '0.0.0.0';
    const machineIps = collectMachineIpv4Addresses(interfaces);
    const wildcard = isWildcardHost(bindHost);
    const loopback = isLoopbackHost(bindHost);
    const localUrls = wildcard
        ? [`http://localhost:${port}`, `http://127.0.0.1:${port}`]
        : [`http://${formatUrlHost(bindHost)}:${port}`];
    const lanUrls = wildcard
        ? machineIps.map(({ address }) => `http://${address}:${port}`)
        : loopback
          ? []
          : [`http://${formatUrlHost(bindHost)}:${port}`];
    const lanAccessEnabled = lanUrls.length > 0;

    return {
        bindHost,
        hostname,
        lanAccessEnabled,
        lanHint: getLanHint({ bindHost, hasMachineIp: machineIps.length > 0, lanAccessEnabled }),
        lanUrls,
        localUrls,
        machineIps,
        port,
    };
}

export function formatStartupNetworkInfoLines(options: {
    color?: boolean;
    host: string;
    hostname?: string;
    interfaces?: NetworkInterfacesLike;
    mode: string;
    port: number;
    services?: StartupServiceEndpoint[];
}): string[] {
    const info = buildStartupNetworkInfo(options);
    const color = createAnsiPalette(options.color ?? shouldUseAnsiColor());
    const divider = color.brightCyan('='.repeat(78));
    const subDivider = color.dim('-'.repeat(78));
    const lines = [
        '',
        divider,
        `${color.bold(color.brightGreen('A3S OS API ONLINE'))}  ${color.dim(`mode=${options.mode}`)}`,
        subDivider,
        formatStartupRow('Bind', color.white(`${formatBindAddress(info.bindHost)}:${info.port}`), color),
        formatStartupRow('Hostname', color.white(info.hostname), color),
        ...formatStartupValueRows('API', info.localUrls, url => color.brightGreen(`${url}/api/v1`), color),
        ...formatStartupValueRows(
            'OpenAPI',
            info.localUrls.map(url => `${url}/openapi.json`),
            url => color.cyan(url),
            color,
        ),
        ...formatStartupValueRows('Local', info.localUrls, url => color.green(url), color),
        ...formatStartupValueRows(
            'LAN',
            info.lanUrls,
            url => color.brightGreen(url),
            color,
            info.lanHint ? color.yellow(info.lanHint) : color.dim('none'),
        ),
        ...formatStartupValueRows(
            'IPv4',
            info.machineIps.map(({ interfaceName, address }) => `${interfaceName}  ${address}`),
            value => color.cyan(value),
            color,
            color.dim('none'),
        ),
        ...(options.services?.length
            ? [
                  subDivider,
                  ...options.services.map(service =>
                      formatStartupRow(
                          service.label,
                          colorByTone(service.value ?? 'not configured', service.tone, color),
                          color,
                      ),
                  ),
              ]
            : []),
        divider,
    ];

    return lines;
}

function normalizeAddressFamily(family: string | number): 'IPv4' | 'IPv6' | null {
    if (family === 'IPv4' || family === 4) return 'IPv4';
    if (family === 'IPv6' || family === 6) return 'IPv6';
    return null;
}

function isWildcardHost(host: string): boolean {
    return host === '*' || host === '0.0.0.0' || host === '::' || host === '[::]';
}

function isLoopbackHost(host: string): boolean {
    return host === 'localhost' || host === '::1' || host === '[::1]' || host.startsWith('127.');
}

function formatUrlHost(host: string): string {
    return host.includes(':') && !host.startsWith('[') ? `[${host}]` : host;
}

function formatBindAddress(host: string): string {
    return formatUrlHost(host);
}

function getLanHint({
    bindHost,
    hasMachineIp,
    lanAccessEnabled,
}: {
    bindHost: string;
    hasMachineIp: boolean;
    lanAccessEnabled: boolean;
}): string | undefined {
    if (lanAccessEnabled) return undefined;
    if (!hasMachineIp) return 'no non-loopback IPv4 interface detected';
    if (isLoopbackHost(bindHost)) {
        return `disabled because APP_HOST=${bindHost} only accepts local connections; set APP_HOST=0.0.0.0 on a trusted LAN to enable LAN debugging`;
    }
    return undefined;
}

function formatStartupRow(label: string, value: string, color: AnsiPalette): string {
    return `${color.dim(label.padEnd(10))} ${value}`;
}

function formatStartupValueRows(
    label: string,
    values: string[],
    formatValue: (value: string) => string,
    color: AnsiPalette,
    emptyValue?: string,
): string[] {
    if (values.length === 0) {
        return [formatStartupRow(label, emptyValue ?? color.dim('none'), color)];
    }
    return values.map((value, index) => formatStartupRow(index === 0 ? label : '', formatValue(value), color));
}

function shouldUseAnsiColor(): boolean {
    return process.env.NO_COLOR === undefined;
}

interface AnsiPalette {
    bold: (value: string) => string;
    brightCyan: (value: string) => string;
    brightGreen: (value: string) => string;
    cyan: (value: string) => string;
    dim: (value: string) => string;
    green: (value: string) => string;
    white: (value: string) => string;
    yellow: (value: string) => string;
}

function createAnsiPalette(enabled: boolean): AnsiPalette {
    const wrap = (open: number, close: number) => (value: string) =>
        enabled ? `\u001b[${open}m${value}\u001b[${close}m` : value;

    return {
        bold: wrap(1, 22),
        brightCyan: wrap(96, 39),
        brightGreen: wrap(92, 39),
        cyan: wrap(36, 39),
        dim: wrap(2, 22),
        green: wrap(32, 39),
        white: wrap(97, 39),
        yellow: wrap(33, 39),
    };
}

function colorByTone(value: string, tone: StartupServiceEndpoint['tone'] = 'normal', color: AnsiPalette): string {
    if (tone === 'success') return color.green(value);
    if (tone === 'warning') return color.yellow(value);
    return color.white(value);
}
