export type AssetSecretKind = 'api_key' | 'token' | 'password' | 'webhook' | 'ssh_key' | 'certificate' | 'generic';

export interface AssetSecretEntry {
    id: string;
    name: string;
    kind: AssetSecretKind;
    encryptedValue: string;
    valueFingerprint: string;
    description?: string;
    labels: string[];
    metadata: Record<string, unknown>;
    createdBy?: string;
    updatedBy?: string;
    expiresAt?: string;
    createdAt: string;
    updatedAt: string;
}

export interface AssetSecretVault {
    version: 1;
    entries: AssetSecretEntry[];
}

export const ASSET_SECRET_KINDS: AssetSecretKind[] = [
    'api_key',
    'token',
    'password',
    'webhook',
    'ssh_key',
    'certificate',
    'generic',
];

export function isAssetSecretKind(value: unknown): value is AssetSecretKind {
    return typeof value === 'string' && ASSET_SECRET_KINDS.includes(value as AssetSecretKind);
}

export function normalizeAssetSecretName(name: string): string {
    const normalized = name.trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(normalized)) {
        throw new Error('Secret name must start with a letter or underscore and contain only letters, numbers, and underscores');
    }
    return normalized;
}
