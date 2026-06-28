type StorageArea = "local" | "session";
type UserStorageScopeListener = (scope: string) => void;

const AUTH_USER_STORAGE_KEY = "auth_user";
const USER_SCOPED_STORAGE_PREFIX = "user";
const userStorageScopeListeners = new Set<UserStorageScopeListener>();
let lastNotifiedUserStorageScope = currentUserStorageScope();

function getStorage(area: StorageArea): Storage | null {
	if (typeof window === "undefined") return null;
	try {
		return area === "session" ? window.sessionStorage : window.localStorage;
	} catch {
		return null;
	}
}

function normalizeUserStorageSegment(value: string): string {
	return encodeURIComponent(value.trim().toLowerCase()).replace(/%/g, "~");
}

function readCurrentUserId(): string | null {
	const raw = getStorage("local")?.getItem(AUTH_USER_STORAGE_KEY);
	if (!raw) return null;
	try {
		const parsed = JSON.parse(raw) as Record<string, unknown>;
		const id = parsed.id ?? parsed.userId ?? parsed.email ?? parsed.username;
		return typeof id === "string" || typeof id === "number" ? String(id) : null;
	} catch {
		return null;
	}
}

export function currentUserStorageScope(fallback = "local"): string {
	return normalizeUserStorageSegment(readCurrentUserId() || fallback);
}

export function currentUserScopedStorageKey(key: string, fallback = "local"): string {
	return `${USER_SCOPED_STORAGE_PREFIX}:${currentUserStorageScope(fallback)}:${key}`;
}

export function onUserStorageScopeChange(listener: UserStorageScopeListener): () => void {
	userStorageScopeListeners.add(listener);
	return () => userStorageScopeListeners.delete(listener);
}

export function notifyUserStorageScopeChanged(): void {
	const scope = currentUserStorageScope();
	if (scope === lastNotifiedUserStorageScope) return;
	lastNotifiedUserStorageScope = scope;
	for (const listener of userStorageScopeListeners) {
		try {
			listener(scope);
		} catch {
			// Keep notifying the rest of the app even if one model fails to reload.
		}
	}
}

export function readStorage(key: string, fallback: string | null = null, area: StorageArea = "local") {
	try {
		return getStorage(area)?.getItem(key) ?? fallback;
	} catch {
		return fallback;
	}
}

export function writeStorage(key: string, value: string, area: StorageArea = "local") {
	try {
		getStorage(area)?.setItem(key, value);
	} catch {
		// Ignore quota/security errors; callers should keep in-memory state.
	}
}

export function removeStorage(key: string, area: StorageArea = "local") {
	try {
		getStorage(area)?.removeItem(key);
	} catch {
		// Ignore storage errors in restricted browser modes.
	}
}

export function readJsonStorage<T>(key: string, fallback: T, area: StorageArea = "local"): T {
	const raw = readStorage(key, null, area);
	if (!raw) return fallback;
	try {
		return JSON.parse(raw) as T;
	} catch {
		return fallback;
	}
}

export function writeJsonStorage(key: string, value: unknown, area: StorageArea = "local") {
	try {
		writeStorage(key, JSON.stringify(value), area);
	} catch {
		// Ignore circular/non-serializable values.
	}
}

export function hasStorageKey(key: string, area: StorageArea = "local") {
	return readStorage(key, null, area) !== null;
}

export function readUserStorage(key: string, fallback: string | null = null, area: StorageArea = "local") {
	return readStorage(currentUserScopedStorageKey(key), fallback, area);
}

export function writeUserStorage(key: string, value: string, area: StorageArea = "local") {
	writeStorage(currentUserScopedStorageKey(key), value, area);
}

export function removeUserStorage(key: string, area: StorageArea = "local") {
	removeStorage(currentUserScopedStorageKey(key), area);
}

export function readUserJsonStorage<T>(key: string, fallback: T, area: StorageArea = "local"): T {
	return readJsonStorage<T>(currentUserScopedStorageKey(key), fallback, area);
}

export function writeUserJsonStorage(key: string, value: unknown, area: StorageArea = "local") {
	writeJsonStorage(currentUserScopedStorageKey(key), value, area);
}

export function hasUserStorageKey(key: string, area: StorageArea = "local") {
	return hasStorageKey(currentUserScopedStorageKey(key), area);
}
