import { REDACTED_SECRET, redactDeep, redactSecrets, restoreSecrets } from './secret-redaction';

describe('config secret redaction', () => {
    const stored = {
        defaultModel: 'gpt-4',
        providers: [
            { name: 'openai', apiKey: 'sk-real-openai', baseUrl: 'https://api.openai.com/v1', models: [{ id: 'gpt-4', apiKey: 'sk-model-override' }] },
            { name: 'anthropic', apiKey: 'sk-real-anthropic', baseUrl: 'https://api.anthropic.com', models: [{ id: 'opus', apiKey: '' }] },
        ],
    };

    it('redacts non-empty secret fields to the sentinel, leaves non-secrets + empties alone', () => {
        const redacted = redactSecrets(stored) as typeof stored;
        expect(redacted.providers[0].apiKey).toBe(REDACTED_SECRET);
        expect(redacted.providers[0].models[0].apiKey).toBe(REDACTED_SECRET);
        expect(redacted.providers[1].models[0].apiKey).toBe(''); // empty stays empty (not configured)
        expect(redacted.providers[0].baseUrl).toBe('https://api.openai.com/v1'); // baseUrl is not a secret
        expect(redacted.defaultModel).toBe('gpt-4');
    });

    it('round-trip: redact then restore against the stored value yields the original secrets', () => {
        const redacted = redactSecrets(stored);
        const restored = restoreSecrets(redacted, stored) as typeof stored;
        expect(restored.providers[0].apiKey).toBe('sk-real-openai');
        expect(restored.providers[0].models[0].apiKey).toBe('sk-model-override');
        expect(restored.providers[1].apiKey).toBe('sk-real-anthropic');
    });

    it('honors a genuinely new key (non-sentinel value passes through)', () => {
        const incoming = redactSecrets(stored) as typeof stored;
        incoming.providers[0].apiKey = 'sk-brand-new'; // user typed a new key
        const restored = restoreSecrets(incoming, stored) as typeof stored;
        expect(restored.providers[0].apiKey).toBe('sk-brand-new');
        expect(restored.providers[1].apiKey).toBe('sk-real-anthropic'); // untouched one restored
    });

    it('reorder-safe: matches providers by name, not position, so keys can\'t cross-wire', () => {
        const redacted = redactSecrets(stored) as typeof stored;
        // user reorders providers in the UI but does not change keys (both stay sentinel)
        const reordered = { ...redacted, providers: [redacted.providers[1], redacted.providers[0]] };
        const restored = restoreSecrets(reordered, stored) as typeof stored;
        expect(restored.providers[0].name).toBe('anthropic');
        expect(restored.providers[0].apiKey).toBe('sk-real-anthropic'); // matched by name, not index
        expect(restored.providers[1].apiKey).toBe('sk-real-openai');
    });

    it('redacts flat categories (e.g. email/oauth secrets) too', () => {
        const email = { smtpHost: 'smtp.x.com', smtpUser: 'u', smtpPassword: 'p@ss', from: 'a@b.c' };
        const redacted = redactSecrets(email) as typeof email;
        expect(redacted.smtpPassword).toBe(REDACTED_SECRET);
        expect(redacted.smtpUser).toBe('u');
        const restored = restoreSecrets(redacted, email) as typeof email;
        expect(restored.smtpPassword).toBe('p@ss');
    });
});

describe('redactDeep (untrusted payloads — value-pattern + field-name)', () => {
    it('masks secret-named fields AND secret-pattern values anywhere in the tree', () => {
        const out = redactDeep({
            apiKey: 'whatever',
            answer: 'your key is sk-ABCDEFGHIJKLMNOPQRSTUV and pat a3s_pat_abc123def456',
            note: 'all fine',
        }) as { apiKey: string; answer: string; note: string };
        expect(out.apiKey).toBe(REDACTED_SECRET); // field-name
        expect(out.answer).toBe(`your key is ${REDACTED_SECRET} and pat ${REDACTED_SECRET}`); // value-pattern
        expect(out.note).toBe('all fine'); // untouched
    });

    it('masks bearer token values; leaves ordinary text/UUIDs intact (low false-positive)', () => {
        expect(redactDeep('Bearer abcdefABCDEF0123456789')).toBe(REDACTED_SECRET);
        expect(redactDeep('token=eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf done')).toBe(`token=${REDACTED_SECRET} done`);
        expect(redactDeep('order 12345 for 550e8400-e29b-41d4-a716-446655440000')).toBe('order 12345 for 550e8400-e29b-41d4-a716-446655440000');
    });
});
