export interface KnowledgeReturnAnchor {
	sessionId: string;
	messageId: string;
	/** Stable identity of the exact source card that opened the preview. */
	sourceAnchorId?: string;
	viewportOffsetPx?: number;
	scrollerOffsetPx?: number;
	createdAt: number;
	requestId: string;
}

const STORAGE_KEY = "internshannon:knowledge-return-anchor:v1";
const MAX_AGE_MS = 15 * 60 * 1000;

/**
 * Build a selector-safe, deterministic identity for the exact source card.
 * The value is compared through HTMLElement.dataset (never interpolated into
 * a CSS selector), so resource paths may contain spaces or punctuation.
 */
export function knowledgeSourceAnchorId(
	messageId: string,
	resource: string,
): string {
	return `${messageId.trim()}\u241f${resource.trim()}`;
}

function defaultStorage(): Storage | null {
	if (typeof window === "undefined") return null;
	try {
		return window.sessionStorage;
	} catch {
		return null;
	}
}

function validAnchor(
	value: unknown,
	now: number,
): KnowledgeReturnAnchor | null {
	if (!value || typeof value !== "object" || Array.isArray(value)) return null;
	const record = value as Record<string, unknown>;
	const sessionId =
		typeof record.sessionId === "string" ? record.sessionId.trim() : "";
	const messageId =
		typeof record.messageId === "string" ? record.messageId.trim() : "";
	const requestId =
		typeof record.requestId === "string" ? record.requestId.trim() : "";
	const sourceAnchorId =
		typeof record.sourceAnchorId === "string"
			? record.sourceAnchorId.trim()
			: undefined;
	const createdAt =
		typeof record.createdAt === "number" ? record.createdAt : Number.NaN;
	if (!sessionId || !messageId || !requestId || !Number.isFinite(createdAt))
		return null;
	if (createdAt > now + 5_000 || now - createdAt > MAX_AGE_MS) return null;
	const viewportOffsetPx =
		typeof record.viewportOffsetPx === "number" &&
		Number.isFinite(record.viewportOffsetPx)
			? record.viewportOffsetPx
			: undefined;
	const scrollerOffsetPx =
		typeof record.scrollerOffsetPx === "number" &&
		Number.isFinite(record.scrollerOffsetPx)
			? record.scrollerOffsetPx
			: undefined;
	return {
		sessionId,
		messageId,
		sourceAnchorId: sourceAnchorId || undefined,
		requestId,
		createdAt,
		viewportOffsetPx,
		scrollerOffsetPx,
	};
}

export function saveKnowledgeReturnAnchor(
	anchor: Omit<KnowledgeReturnAnchor, "createdAt" | "requestId">,
	storage = defaultStorage(),
	now = Date.now(),
): KnowledgeReturnAnchor | null {
	if (!storage || !anchor.sessionId.trim() || !anchor.messageId.trim())
		return null;
	const value: KnowledgeReturnAnchor = {
		...anchor,
		sessionId: anchor.sessionId.trim(),
		messageId: anchor.messageId.trim(),
		createdAt: now,
		requestId: `knowledge-return-${now}-${Math.random().toString(36).slice(2, 9)}`,
	};
	storage.setItem(STORAGE_KEY, JSON.stringify(value));
	return value;
}

export function peekKnowledgeReturnAnchor(
	storage = defaultStorage(),
	now = Date.now(),
): KnowledgeReturnAnchor | null {
	if (!storage) return null;
	try {
		return validAnchor(JSON.parse(storage.getItem(STORAGE_KEY) ?? "null"), now);
	} catch {
		return null;
	}
}

export function knowledgeReturnRequestIdFromNavigationState(
	state: unknown,
): string | null {
	if (!state || typeof state !== "object" || Array.isArray(state)) return null;
	const requestId = (state as { knowledgeReturnRequestId?: unknown })
		.knowledgeReturnRequestId;
	return typeof requestId === "string" && requestId.trim()
		? requestId.trim()
		: null;
}

export function requestedKnowledgeReturnAnchor(
	state: unknown,
	storage = defaultStorage(),
	now = Date.now(),
): KnowledgeReturnAnchor | null {
	const requestId = knowledgeReturnRequestIdFromNavigationState(state);
	if (!requestId) return null;
	if (state && typeof state === "object" && !Array.isArray(state)) {
		const stateAnchor = validAnchor(
			(state as { knowledgeReturnAnchor?: unknown }).knowledgeReturnAnchor,
			now,
		);
		if (stateAnchor?.requestId === requestId) return stateAnchor;
	}
	const anchor = peekKnowledgeReturnAnchor(storage, now);
	return anchor?.requestId === requestId ? anchor : null;
}

export function consumeKnowledgeReturnAnchor(
	storage = defaultStorage(),
	now = Date.now(),
): KnowledgeReturnAnchor | null {
	if (!storage) return null;
	const value = peekKnowledgeReturnAnchor(storage, now);
	storage.removeItem(STORAGE_KEY);
	return value;
}

/** Remove only the anchor that was actually restored; stale renders cannot consume a newer click. */
export function acknowledgeKnowledgeReturnAnchor(
	requestId: string,
	storage = defaultStorage(),
	now = Date.now(),
): boolean {
	if (!storage || !requestId.trim()) return false;
	const value = peekKnowledgeReturnAnchor(storage, now);
	if (!value || value.requestId !== requestId.trim()) return false;
	storage.removeItem(STORAGE_KEY);
	return true;
}
