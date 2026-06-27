import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createCipheriv, createDecipheriv, randomBytes, scrypt } from 'crypto';
import { promisify } from 'util';

const scryptAsync = promisify(scrypt);

/**
 * Encryption Service for sensitive data like secrets
 * Uses AES-256-GCM for authenticated encryption
 */
@Injectable()
export class EncryptionService {
    private readonly algorithm = 'aes-256-gcm';
    private readonly keyLength = 32; // 256 bits
    private readonly ivLength = 16; // 128 bits
    private readonly saltLength = 32;
    private readonly tagLength = 16;

    constructor(private readonly configService: ConfigService) {}

    /**
     * Encrypt a string value
     * @param plaintext The value to encrypt
     * @returns Base64-encoded encrypted value with format: salt:iv:authTag:ciphertext
     */
    async encrypt(plaintext: string): Promise<string> {
        const masterKey = this.getMasterKey();
        const salt = randomBytes(this.saltLength);
        const key = (await scryptAsync(masterKey, salt, this.keyLength)) as Buffer;
        const iv = randomBytes(this.ivLength);

        const cipher = createCipheriv(this.algorithm, key, iv);
        const encrypted = Buffer.concat([
            cipher.update(plaintext, 'utf8'),
            cipher.final(),
        ]);

        const authTag = cipher.getAuthTag();

        // Format: salt:iv:authTag:ciphertext (all base64)
        return [
            salt.toString('base64'),
            iv.toString('base64'),
            authTag.toString('base64'),
            encrypted.toString('base64'),
        ].join(':');
    }

    /**
     * Decrypt an encrypted value
     * @param encrypted The encrypted value (format: salt:iv:authTag:ciphertext)
     * @returns The decrypted plaintext
     */
    async decrypt(encrypted: string): Promise<string> {
        const masterKey = this.getMasterKey();
        const parts = encrypted.split(':');

        if (parts.length !== 4) {
            throw new Error('Invalid encrypted value format');
        }

        const [saltB64, ivB64, authTagB64, ciphertextB64] = parts;
        const salt = Buffer.from(saltB64, 'base64');
        const iv = Buffer.from(ivB64, 'base64');
        const authTag = Buffer.from(authTagB64, 'base64');
        const ciphertext = Buffer.from(ciphertextB64, 'base64');

        const key = (await scryptAsync(masterKey, salt, this.keyLength)) as Buffer;

        const decipher = createDecipheriv(this.algorithm, key, iv);
        decipher.setAuthTag(authTag);

        const decrypted = Buffer.concat([
            decipher.update(ciphertext),
            decipher.final(),
        ]);

        return decrypted.toString('utf8');
    }

    /**
     * Check if a value is encrypted (has the expected format)
     */
    isEncrypted(value: string): boolean {
        const parts = value.split(':');
        return parts.length === 4;
    }

    /**
     * Get the master encryption key from environment
     * Falls back to a default key for development (NOT for production)
     */
    private getMasterKey(): string {
        const key = this.configService.get<string>('ENCRYPTION_KEY');

        if (!key) {
            // Hard-fail in production: a known/hardcoded fallback key makes every
            // "encrypted-at-rest" value (vault secrets, connection creds) trivially
            // recoverable. Refuse to start rather than silently encrypt with it.
            if (process.env.NODE_ENV === 'production') {
                throw new Error(
                    'ENCRYPTION_KEY is required in production — refusing to start with the insecure development fallback key.',
                );
            }
            // Development fallback - NOT secure for production
            console.warn('ENCRYPTION_KEY not set, using development fallback. DO NOT use in production!');
            return 'dev-encryption-key-change-in-production-32-chars-minimum';
        }

        if (key.length < 32) {
            throw new Error('ENCRYPTION_KEY must be at least 32 characters');
        }

        return key;
    }
}
