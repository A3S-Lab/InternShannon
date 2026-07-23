import { REDACTED_SECRET } from '@/shared/common/security/secret-redaction';
import { redactConfigResponseSecrets } from './config-secret-redaction.interceptor';

describe('config response secret redaction', () => {
    it('never returns raw credentials to a desktop loopback caller', () => {
        const result = redactConfigResponseSecrets({
            providers: [{ name: 'model-provider', apiKey: 'do-not-return-this-key' }],
            oauth: { clientSecret: 'do-not-return-this-secret' },
        }) as {
            providers: Array<{ apiKey: string }>;
            oauth: { clientSecret: string };
        };

        expect(result.providers[0].apiKey).toBe(REDACTED_SECRET);
        expect(result.oauth.clientSecret).toBe(REDACTED_SECRET);
        expect(JSON.stringify(result)).not.toContain('do-not-return');
    });
});
