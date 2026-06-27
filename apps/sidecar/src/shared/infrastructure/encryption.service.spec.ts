import type { ConfigService } from '@nestjs/config';
import { EncryptionService } from './encryption.service';

function make(key?: string): EncryptionService {
    const config = { get: jest.fn().mockReturnValue(key) } as unknown as ConfigService;
    return new EncryptionService(config);
}

describe('EncryptionService master key', () => {
    const originalEnv = process.env.NODE_ENV;
    afterEach(() => {
        process.env.NODE_ENV = originalEnv;
    });

    it('hard-fails in production when ENCRYPTION_KEY is unset (no silent dev-fallback encryption)', async () => {
        process.env.NODE_ENV = 'production';
        await expect(make(undefined).encrypt('x')).rejects.toThrow(/ENCRYPTION_KEY is required in production/);
    });

    it('uses the dev fallback outside production and round-trips', async () => {
        process.env.NODE_ENV = 'test';
        const svc = make(undefined);
        expect(await svc.decrypt(await svc.encrypt('hello'))).toBe('hello');
    });

    it('round-trips with a provided key', async () => {
        const svc = make('a'.repeat(40));
        expect(await svc.decrypt(await svc.encrypt('secret-value'))).toBe('secret-value');
    });
});
