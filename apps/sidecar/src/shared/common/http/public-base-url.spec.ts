import { resolveTrustedBaseUrl } from './public-base-url';

describe('resolveTrustedBaseUrl', () => {
    const fallback = 'https://os.example.com';

    it('returns the fallback when no request origin is supplied', () => {
        expect(resolveTrustedBaseUrl({ fallback })).toBe(fallback);
        expect(resolveTrustedBaseUrl({ requestOrigin: undefined, fallback })).toBe(fallback);
        expect(resolveTrustedBaseUrl({ requestOrigin: '', fallback })).toBe(fallback);
    });

    describe('automatic mode (no allowlist configured)', () => {
        it('follows an arbitrary IP:port origin the user accessed', () => {
            expect(resolveTrustedBaseUrl({ requestOrigin: 'http://10.0.0.5:30080', fallback })).toBe(
                'http://10.0.0.5:30080',
            );
        });

        it('follows an arbitrary domain origin the user accessed', () => {
            expect(resolveTrustedBaseUrl({ requestOrigin: 'https://os.corp.internal', fallback })).toBe(
                'https://os.corp.internal',
            );
            expect(resolveTrustedBaseUrl({ requestOrigin: 'http://os.corp.internal', fallback })).toBe(
                'http://os.corp.internal',
            );
        });

        it('treats a blank / whitespace allowlist as automatic', () => {
            expect(resolveTrustedBaseUrl({ requestOrigin: 'https://anything.test', fallback, trustedBaseUrls: '   ' })).toBe(
                'https://anything.test',
            );
        });

        it('still rejects a malformed origin and falls back', () => {
            expect(resolveTrustedBaseUrl({ requestOrigin: 'not-a-url', fallback })).toBe(fallback);
        });

        it('switches to strict the moment an allowlist is set (unlisted origin → fallback)', () => {
            expect(
                resolveTrustedBaseUrl({
                    requestOrigin: 'http://10.0.0.5:30080',
                    fallback,
                    trustedBaseUrls: 'https://os.example.com',
                }),
            ).toBe(fallback);
        });
    });

    it('always trusts the canonical fallback origin itself (zero-config single host)', () => {
        // External user reaches the SPA via the configured public host → links
        // resolve back to that same host even without any allowlist entry.
        expect(resolveTrustedBaseUrl({ requestOrigin: 'https://os.example.com', fallback })).toBe(
            'https://os.example.com',
        );
    });

    it('follows an intranet origin once it is listed in the allowlist', () => {
        expect(
            resolveTrustedBaseUrl({
                requestOrigin: 'http://10.0.0.5:30080',
                fallback,
                trustedBaseUrls: 'http://10.0.0.5:30080',
            }),
        ).toBe('http://10.0.0.5:30080');
    });

    it('parses a comma-separated allowlist and ignores blank / malformed entries', () => {
        expect(
            resolveTrustedBaseUrl({
                requestOrigin: 'http://intranet.local:8080',
                fallback,
                trustedBaseUrls: ' https://a.example.com , , not-a-url , http://intranet.local:8080/ ',
            }),
        ).toBe('http://intranet.local:8080');
    });

    it('falls back when the origin is not trusted (host-injection guard)', () => {
        expect(
            resolveTrustedBaseUrl({
                requestOrigin: 'https://evil.attacker.test',
                fallback,
                trustedBaseUrls: 'http://10.0.0.5:30080',
            }),
        ).toBe(fallback);
    });

    it('ignores non-http(s) and unparseable origins', () => {
        for (const bad of ['javascript:alert(1)', 'ftp://host', 'file:///etc', '://nope', 'http://']) {
            expect(resolveTrustedBaseUrl({ requestOrigin: bad, fallback, trustedBaseUrls: bad })).toBe(fallback);
        }
    });

    it('matches origin case-insensitively and strips path / trailing slash noise', () => {
        expect(
            resolveTrustedBaseUrl({
                requestOrigin: 'HTTP://Intranet.Local:8080/register?x=1',
                fallback,
                trustedBaseUrls: 'http://intranet.local:8080',
            }),
        ).toBe('http://intranet.local:8080');
    });

    it('treats a differing port as a distinct, untrusted origin', () => {
        expect(
            resolveTrustedBaseUrl({
                requestOrigin: 'http://10.0.0.5:9999',
                fallback,
                trustedBaseUrls: 'http://10.0.0.5:30080',
            }),
        ).toBe(fallback);
    });

    it('normalises a fallback that carries a trailing slash', () => {
        expect(resolveTrustedBaseUrl({ fallback: 'https://os.example.com/' })).toBe('https://os.example.com');
    });

    it('trusts an exact domain origin listed in the allowlist (https)', () => {
        expect(
            resolveTrustedBaseUrl({
                requestOrigin: 'https://intranet.corp.example',
                fallback,
                trustedBaseUrls: 'https://intranet.corp.example',
            }),
        ).toBe('https://intranet.corp.example');
    });

    it('normalises default ports so :443 / :80 entries match port-less origins', () => {
        expect(
            resolveTrustedBaseUrl({
                requestOrigin: 'https://intranet.corp.example',
                fallback,
                trustedBaseUrls: 'https://intranet.corp.example:443',
            }),
        ).toBe('https://intranet.corp.example');
        expect(
            resolveTrustedBaseUrl({
                requestOrigin: 'http://intranet.corp.example',
                fallback,
                trustedBaseUrls: 'http://intranet.corp.example:80',
            }),
        ).toBe('http://intranet.corp.example');
    });

    describe('wildcard subdomain entries', () => {
        const trustedBaseUrls = 'https://*.example.com';

        it('matches single- and multi-level subdomains', () => {
            expect(resolveTrustedBaseUrl({ requestOrigin: 'https://a.example.com', fallback, trustedBaseUrls })).toBe(
                'https://a.example.com',
            );
            expect(
                resolveTrustedBaseUrl({ requestOrigin: 'https://a.b.example.com', fallback, trustedBaseUrls }),
            ).toBe('https://a.b.example.com');
        });

        it('does NOT match the apex domain itself', () => {
            expect(resolveTrustedBaseUrl({ requestOrigin: 'https://example.com', fallback, trustedBaseUrls })).toBe(
                fallback,
            );
        });

        it('does NOT match a look-alike suffix without a dot boundary', () => {
            expect(
                resolveTrustedBaseUrl({ requestOrigin: 'https://evil-example.com', fallback, trustedBaseUrls }),
            ).toBe(fallback);
        });

        it('does NOT match when the base domain is not at the end of the host', () => {
            expect(
                resolveTrustedBaseUrl({
                    requestOrigin: 'https://a.example.com.evil.com',
                    fallback,
                    trustedBaseUrls,
                }),
            ).toBe(fallback);
        });

        it('enforces the scheme of the wildcard entry', () => {
            expect(resolveTrustedBaseUrl({ requestOrigin: 'http://a.example.com', fallback, trustedBaseUrls })).toBe(
                fallback,
            );
        });

        it('enforces the port (default vs explicit)', () => {
            expect(
                resolveTrustedBaseUrl({ requestOrigin: 'https://a.example.com:8443', fallback, trustedBaseUrls }),
            ).toBe(fallback);
            expect(
                resolveTrustedBaseUrl({
                    requestOrigin: 'https://a.example.com:8443',
                    fallback,
                    trustedBaseUrls: 'https://*.example.com:8443',
                }),
            ).toBe('https://a.example.com:8443');
        });

        it('works alongside exact entries in the same allowlist', () => {
            const mixed = 'https://os.example.com, https://*.intranet.corp';
            expect(resolveTrustedBaseUrl({ requestOrigin: 'https://os.example.com', fallback, trustedBaseUrls: mixed })).toBe(
                'https://os.example.com',
            );
            expect(
                resolveTrustedBaseUrl({ requestOrigin: 'https://team-a.intranet.corp', fallback, trustedBaseUrls: mixed }),
            ).toBe('https://team-a.intranet.corp');
            expect(
                resolveTrustedBaseUrl({ requestOrigin: 'https://team-a.other.corp', fallback, trustedBaseUrls: mixed }),
            ).toBe(fallback);
        });
    });

    it('reads the allowlist from PUBLIC_TRUSTED_BASE_URLS when not injected', () => {
        const prev = process.env.PUBLIC_TRUSTED_BASE_URLS;
        process.env.PUBLIC_TRUSTED_BASE_URLS = 'http://10.0.0.5:30080';
        try {
            expect(resolveTrustedBaseUrl({ requestOrigin: 'http://10.0.0.5:30080', fallback })).toBe(
                'http://10.0.0.5:30080',
            );
        } finally {
            if (prev === undefined) {
                delete process.env.PUBLIC_TRUSTED_BASE_URLS;
            } else {
                process.env.PUBLIC_TRUSTED_BASE_URLS = prev;
            }
        }
    });
});
