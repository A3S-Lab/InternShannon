import { fileURLToPath } from 'node:url';

const REMOTE_WORKSPACE_URI_RE = /^([a-z][a-z0-9+.-]*):\/{1,2}/i;
const WINDOWS_DRIVE_PATH_RE = /^[a-zA-Z]:[\\/]/;

export function isWindowsDrivePath(value: string | null | undefined): boolean {
    return WINDOWS_DRIVE_PATH_RE.test((value ?? '').trim());
}

export function workspaceUriScheme(value: string | null | undefined): string | undefined {
    const trimmed = (value ?? '').trim();
    if (!trimmed || isWindowsDrivePath(trimmed)) return undefined;

    return trimmed.match(REMOTE_WORKSPACE_URI_RE)?.[1]?.toLowerCase();
}

export function isRemoteWorkspacePath(value: string | null | undefined): boolean {
    const scheme = workspaceUriScheme(value);
    return Boolean(scheme && scheme !== 'file');
}

export function normalizeLocalWorkspacePath(value: string): string {
    const trimmed = value.trim();
    if (/^file:\/\//i.test(trimmed)) {
        return fileURLToPath(trimmed);
    }
    return trimmed;
}
