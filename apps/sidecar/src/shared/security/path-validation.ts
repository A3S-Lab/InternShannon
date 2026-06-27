import * as path from 'node:path';

/**
 * Path security validation utilities
 *
 * Provides centralized path validation and normalization to prevent:
 * - Path traversal attacks (../)
 * - Access to blocked paths
 * - Access outside allowed directories
 */
export class PathSecurityValidator {
    /**
     * Check if path contains path traversal patterns
     * @param pathStr - Path to check
     * @returns true if path traversal detected
     */
    static hasPathTraversal(pathStr: string): boolean {
        return pathStr.split(/[\\/]+/).some(part => part === '..');
    }

    /**
     * Normalize path by resolving . and .. segments
     * @param pathStr - Path to normalize
     * @returns Normalized absolute path
     */
    static normalizePath(pathStr: string): string {
        // Remove trailing slashes
        let normalized = pathStr.replace(/\/+$/, '');

        // Resolve relative paths
        const parts = normalized.split('/');
        const resolved: string[] = [];

        for (const part of parts) {
            if (part === '..') {
                resolved.pop();
            } else if (part !== '.' && part !== '') {
                resolved.push(part);
            }
        }

        return '/' + resolved.join('/');
    }

    /**
     * Check if path is within a root directory
     * @param pathStr - Path to check
     * @param root - Root directory
     * @returns true if path is within root
     */
    static isWithinRoot(pathStr: string, root: string): boolean {
        const normalizedPath = path.normalize(pathStr);
        const normalizedRoot = path.normalize(root);
        return normalizedPath === normalizedRoot || normalizedPath.startsWith(normalizedRoot + path.sep);
    }

    /**
     * Check if path starts with a prefix (exact match or subdirectory)
     * @param pathStr - Path to check
     * @param prefix - Prefix to match
     * @returns true if path starts with prefix
     */
    static pathStartsWith(pathStr: string, prefix: string): boolean {
        return pathStr === prefix || pathStr.startsWith(`${prefix}/`);
    }

    /**
     * Resolve and validate a relative path against a base root
     * Strips leading path traversal and ensures result stays within root
     *
     * @param baseRoot - Base root directory (must be absolute)
     * @param relativePath - Relative path to resolve
     * @returns Absolute validated path
     * @throws Error if resolved path escapes root
     */
    static resolveAndValidate(baseRoot: string, relativePath: string): string {
        // Normalize and remove leading path traversal attempts
        const normalized = path.normalize(relativePath).replace(/^(\.\.(\/|\\|$))+/, '');

        // Resolve against base root
        const absolutePath = path.join(baseRoot, normalized);

        // Security check: ensure resolved path is still within root
        if (!absolutePath.startsWith(baseRoot)) {
            throw new Error('Invalid path: path traversal detected');
        }

        return absolutePath;
    }

    /**
     * Validate path against blocked and allowed lists
     * @param pathStr - Path to validate
     * @param options - Validation options
     * @returns Validation result with any violations
     */
    static validatePathAccess(
        pathStr: string,
        options: {
            blockedPaths?: string[];
            allowedPaths?: string[];
        } = {}
    ): { valid: boolean; violations: string[] } {
        const violations: string[] = [];
        const { blockedPaths = [], allowedPaths = [] } = options;

        // Check for path traversal
        if (this.hasPathTraversal(pathStr)) {
            violations.push('Path traversal detected');
        }

        // Normalize path for comparison
        const normalizedPath = this.normalizePath(pathStr.startsWith('/') ? pathStr : `/${pathStr}`);

        // Check blocked paths
        for (const blockedPath of blockedPaths) {
            if (this.pathStartsWith(normalizedPath, blockedPath)) {
                violations.push(`Access to blocked path: ${blockedPath}`);
            }
        }

        // Check allowed paths (if specified)
        if (allowedPaths.length > 0) {
            const isAllowed = allowedPaths.some(allowedPath =>
                this.pathStartsWith(normalizedPath, allowedPath)
            );

            if (!isAllowed) {
                violations.push('Path not in allowed list');
            }
        }

        return {
            valid: violations.length === 0,
            violations,
        };
    }

    /**
     * Sanitize path by removing dangerous patterns
     * @param pathStr - Path to sanitize
     * @returns Sanitized path
     */
    static sanitizePath(pathStr: string): string {
        return pathStr
            .replace(/\0/g, '') // Remove null bytes
            .replace(/^(\.\.(\/|\\|$))+/, '') // Remove leading ../
            .replace(/[\r\n]/g, ''); // Remove newlines
    }
}
