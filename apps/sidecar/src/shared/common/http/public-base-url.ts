/**
 * Resolves the public base URL for absolute links the backend embeds into
 * outbound channels (invitation emails, OAuth landings, share links, ...).
 *
 * Goal: an intranet user and an extranet user should each receive links that
 * point back to the address THEY used, instead of a single hard-coded host.
 * The caller passes the request `Origin` (the address the SPA was loaded from)
 * and a configured `fallback` (the env default). Works for raw IP:port entries
 * and for domain names (with HTTP/HTTPS scheme normalisation) alike.
 *
 * Two modes, chosen by whether `PUBLIC_TRUSTED_BASE_URLS` is set:
 *
 *   - AUTOMATIC (default, env unset): the well-formed request origin is followed
 *     as-is — intranet vs extranet, IP or domain — so intranet/extranet links
 *     work with ZERO per-deployment config. Safe for the current callers
 *     (invitation links), which are gated behind an authenticated admin and
 *     whose `Origin` header is browser-set (not forgeable from page JS).
 *   - STRICT (env set): the origin is only honoured when it matches the
 *     canonical `fallback` host or an allowlist entry; anything else falls back
 *     to `fallback`. Use this to lock links to an explicit set of hosts.
 *
 * Each `PUBLIC_TRUSTED_BASE_URLS` entry (comma-separated) is either an exact
 * origin (`https://os.example.com`, `http://10.0.0.5:30080`) or a
 * single-label-leading wildcard subdomain (`https://*.example.com`, which
 * matches `https://a.example.com` and `https://a.b.example.com` but NOT the
 * apex `https://example.com`, nor `https://evil-example.com`, nor a different
 * scheme/port).
 *
 * SECURITY: following the request origin is a host-header / origin-injection
 * vector for links sent to *unauthenticated / arbitrary* recipients (e.g.
 * password-reset). If such a flow ever reuses this helper, that deployment
 * should run in STRICT mode (set `PUBLIC_TRUSTED_BASE_URLS`). A malformed origin
 * always falls back, so the worst case is never an unparseable/non-http host.
 */
export const TRUSTED_BASE_URLS_ENV = 'PUBLIC_TRUSTED_BASE_URLS';

export interface ResolveTrustedBaseUrlParams {
    /** The request `Origin` header (scheme://host[:port]); usually the SPA entry. */
    requestOrigin?: string;
    /** Configured default base URL (env); used when the origin isn't trusted. */
    fallback: string;
    /**
     * Override the trusted-origin allowlist (defaults to the
     * `PUBLIC_TRUSTED_BASE_URLS` env). Injectable for tests / config callers.
     */
    trustedBaseUrls?: string;
}

interface OriginMatcher {
    test(candidateOrigin: string): boolean;
}

export function resolveTrustedBaseUrl(params: ResolveTrustedBaseUrlParams): string {
    const fallback = stripTrailingSlash(params.fallback);
    const candidate = toOrigin(params.requestOrigin);
    if (!candidate) {
        return fallback;
    }

    // AUTOMATIC mode: no allowlist configured → follow the (well-formed) address
    // the user actually accessed, zero config. Set PUBLIC_TRUSTED_BASE_URLS to
    // opt into STRICT mode below.
    const raw = params.trustedBaseUrls ?? process.env[TRUSTED_BASE_URLS_ENV];
    if (!raw || !raw.trim()) {
        return candidate;
    }

    // STRICT mode: the canonical public URL always resolves to itself, plus any
    // explicitly allowlisted origin / wildcard; everything else falls back.
    const fallbackOrigin = toOrigin(fallback);
    if (fallbackOrigin && candidate === fallbackOrigin) {
        return candidate;
    }
    const matchers = compileMatchers(raw);
    return matchers.some((m) => m.test(candidate)) ? candidate : fallback;
}

function compileMatchers(raw: string | undefined): OriginMatcher[] {
    if (!raw) {
        return [];
    }
    const out: OriginMatcher[] = [];
    for (const part of raw.split(',')) {
        const matcher = compileEntry(part.trim());
        if (matcher) {
            out.push(matcher);
        }
    }
    return out;
}

function compileEntry(entry: string): OriginMatcher | null {
    if (!entry) {
        return null;
    }
    if (entry.includes('*')) {
        return compileWildcard(entry);
    }
    const origin = toOrigin(entry);
    return origin ? { test: (candidate) => candidate === origin } : null;
}

/**
 * Compiles a `scheme://*.base.domain[:port]` wildcard into a matcher. Only a
 * single leading-label wildcard is supported; anything else returns null (and
 * is silently ignored, like a malformed entry).
 */
function compileWildcard(entry: string): OriginMatcher | null {
    const match = /^(https?):\/\/\*\.([a-z0-9.-]+?)(?::(\d+))?\/?$/i.exec(entry.trim());
    if (!match) {
        return null;
    }
    const scheme = `${match[1].toLowerCase()}:`;
    const baseHost = match[2].toLowerCase();
    const port = normalizePort(match[1].toLowerCase(), match[3] ?? '');
    const suffix = `.${baseHost}`;

    return {
        test(candidateOrigin) {
            let url: URL;
            try {
                url = new URL(candidateOrigin);
            } catch {
                return false;
            }
            if (url.protocol !== scheme || url.port !== port) {
                return false;
            }
            const host = url.hostname.toLowerCase();
            // Strict subdomain: at least one extra label before the dotted base,
            // and the base must sit at the very end of the host.
            return host.length > suffix.length && host.endsWith(suffix);
        },
    };
}

function normalizePort(scheme: string, port: string): string {
    if ((scheme === 'http' && port === '80') || (scheme === 'https' && port === '443')) {
        return '';
    }
    return port;
}

/**
 * Normalises any URL-ish string to its origin (scheme://host[:port]),
 * lowercased and without a trailing slash. Default ports (80/443) are dropped.
 * Returns undefined when it is not a parseable absolute http(s) URL.
 */
function toOrigin(value: string | undefined): string | undefined {
    if (!value) {
        return undefined;
    }
    try {
        const url = new URL(value.trim());
        if (url.protocol !== 'http:' && url.protocol !== 'https:') {
            return undefined;
        }
        return url.origin.toLowerCase();
    } catch {
        return undefined;
    }
}

function stripTrailingSlash(value: string): string {
    return value.replace(/\/+$/, '');
}
