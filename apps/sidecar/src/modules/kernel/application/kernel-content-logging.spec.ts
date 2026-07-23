import { REDACTED_SECRET } from '@/shared/common/security/secret-redaction';
import { isKernelContentLoggingEnabled, kernelContentLogValue } from './kernel-content-logging';

describe('kernel content logging', () => {
    it('redacts message content by default and reports only its length', () => {
        expect(kernelContentLogValue('personal prompt', 100, {})).toBe('[redacted length=15]');
        expect(isKernelContentLoggingEnabled({})).toBe(false);
    });

    it('requires an explicit diagnostics flag and still masks recognizable secrets', () => {
        const env = { INTERNSHANNON_DIAGNOSTIC_CONTENT_LOGS: 'true' } as NodeJS.ProcessEnv;
        expect(isKernelContentLoggingEnabled(env)).toBe(true);
        expect(kernelContentLogValue('key sk-ABCDEFGHIJKLMNOPQRSTUV', 100, env)).toBe(`key ${REDACTED_SECRET}`);
    });
});
