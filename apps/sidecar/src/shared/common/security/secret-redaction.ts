/**
 * Secret redaction for the config read/write path.
 *
 * The category GET endpoints return whole settings objects (LLM providers/models,
 * OAuth, email, search…) that carry credentials. Returning raw `apiKey`/`password`
 * to any caller that can read config is a credential leak. We redact secret-named
 * fields to a sentinel on READ, and on WRITE restore the sentinel back to the
 * stored value so the round-trip can't overwrite a real key with the mask.
 *
 * Restore is id-aware: provider/model array items are matched by `id`/`name`
 * (not position), so reordering providers in the UI can't cross-wire keys.
 */

export const REDACTED_SECRET = '[configured]';

// Normalized (underscore-stripped, lower-cased) field names treated as secrets.
const SECRET_FIELD_NAMES = new Set([
    'apikey',
    'apisecret',
    'secret',
    'secretkey',
    'clientsecret',
    'password',
    'smtppassword',
    'accesssecret',
]);

function isSecretField(key: string): boolean {
    return SECRET_FIELD_NAMES.has(key.replace(/_/g, '').toLowerCase());
}

/** Return a deep copy with non-empty secret-named string fields replaced by the sentinel. */
export function redactSecrets(value: unknown): unknown {
    if (Array.isArray(value)) {
        return value.map(redactSecrets);
    }
    if (value && typeof value === 'object') {
        const out: Record<string, unknown> = {};
        for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
            out[key] = typeof val === 'string' && isSecretField(key) && val.length > 0 ? REDACTED_SECRET : redactSecrets(val);
        }
        return out;
    }
    return value;
}

// Distinctive secret value patterns — for masking secrets that appear in NON-secret-
// named places (a token echoed inside a node output, a reflected error body) where
// field-name redaction can't help. Conservative on purpose: only well-known,
// high-signal formats, so legitimate output (UUIDs, hashes) isn't mangled.
const SECRET_VALUE_PATTERNS: RegExp[] = [
    /sk-[A-Za-z0-9]{16,}/g, // OpenAI-style API keys
    /a3s_pat_[A-Za-z0-9]{12,}/g, // ShuanOS personal access tokens
    /gh[pousr]_[A-Za-z0-9]{16,}/g, // GitHub tokens
    /AKIA[0-9A-Z]{16}/g, // AWS access key id
    /eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, // Three-part bearer tokens
    /(?:Bearer|Basic)\s+[A-Za-z0-9._~+/-]{16,}=*/gi, // Authorization header values
];

/** Mask any well-known secret token pattern inside a free-text string. */
export function redactSecretValuesInText(text: string): string {
    let out = text;
    for (const pattern of SECRET_VALUE_PATTERNS) {
        out = out.replace(pattern, REDACTED_SECRET);
    }
    return out;
}

/**
 * Deep redaction for UNTRUSTED payloads (node outputs, event details, reflected error
 * bodies) that egress to the events table / SSE stream / debug drawer: masks secret-
 * NAMED fields AND secret-PATTERN string values anywhere in the tree. Use this when you
 * don't control the shape; use redactSecrets() for known config objects.
 */
export function redactDeep(value: unknown): unknown {
    if (typeof value === 'string') {
        return redactSecretValuesInText(value);
    }
    if (Array.isArray(value)) {
        return value.map(redactDeep);
    }
    if (value && typeof value === 'object') {
        const out: Record<string, unknown> = {};
        for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
            out[key] = typeof val === 'string' && isSecretField(key) && val.length > 0 ? REDACTED_SECRET : redactDeep(val);
        }
        return out;
    }
    return value;
}

function itemKey(item: unknown): string | number | undefined {
    if (item && typeof item === 'object') {
        const rec = item as Record<string, unknown>;
        const id = rec.id ?? rec.name;
        if (typeof id === 'string' || typeof id === 'number') {
            return id;
        }
    }
    return undefined;
}

function matchExisting(existing: unknown, item: unknown, index: number): unknown {
    if (!Array.isArray(existing)) {
        return undefined;
    }
    const key = itemKey(item);
    if (key !== undefined) {
        const found = existing.find((candidate) => itemKey(candidate) === key);
        if (found !== undefined) {
            return found;
        }
    }
    return existing[index];
}

/**
 * Return `incoming` with any secret-named field whose value is the sentinel restored
 * from the matching field in `existing`. Non-sentinel values pass through unchanged
 * (so a genuinely new key is honored).
 */
export function restoreSecrets(incoming: unknown, existing: unknown): unknown {
    if (Array.isArray(incoming)) {
        return incoming.map((item, index) => restoreSecrets(item, matchExisting(existing, item, index)));
    }
    if (incoming && typeof incoming === 'object') {
        const existingRec = existing && typeof existing === 'object' && !Array.isArray(existing) ? (existing as Record<string, unknown>) : {};
        const out: Record<string, unknown> = {};
        for (const [key, val] of Object.entries(incoming as Record<string, unknown>)) {
            if (typeof val === 'string' && isSecretField(key) && val === REDACTED_SECRET) {
                out[key] = existingRec[key] ?? '';
            } else {
                out[key] = restoreSecrets(val, existingRec[key]);
            }
        }
        return out;
    }
    return incoming;
}
