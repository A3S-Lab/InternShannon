/**
 * Collaborator Permission Levels
 *
 * Hierarchy (lowest to highest):
 * read < triage < write < maintain < admin
 */
export type Permission = 'read' | 'triage' | 'write' | 'maintain' | 'admin';

export const Permission = {
    READ: 'read' as Permission,
    TRIAGE: 'triage' as Permission,
    WRITE: 'write' as Permission,
    MAINTAIN: 'maintain' as Permission,
    ADMIN: 'admin' as Permission,
};

/**
 * Permission hierarchy levels (higher number = more permissions)
 */
const PERMISSION_LEVELS: Record<Permission, number> = {
    read: 1,
    triage: 2,
    write: 3,
    maintain: 4,
    admin: 5,
};

/**
 * Check if a permission meets or exceeds the minimum required level
 */
export function hasPermissionLevel(actual: Permission, required: Permission): boolean {
    return PERMISSION_LEVELS[actual] >= PERMISSION_LEVELS[required];
}

/**
 * Get all permissions that meet or exceed the minimum level
 */
export function getPermissionsAtLeast(minimum: Permission): Permission[] {
    const minLevel = PERMISSION_LEVELS[minimum];
    return Object.entries(PERMISSION_LEVELS)
        .filter(([_, level]) => level >= minLevel)
        .map(([perm]) => perm as Permission);
}
