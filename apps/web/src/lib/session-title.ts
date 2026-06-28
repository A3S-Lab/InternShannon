export function sessionShortId(sessionId: string, length = 8): string {
	const uuidPrefix = sessionId.match(/^[0-9a-f]{8}/i)?.[0];
	if (uuidPrefix) return uuidPrefix.slice(0, length);
	const parts = sessionId.split(/[^a-zA-Z0-9]+/).filter(Boolean);
	const lastPart = parts[parts.length - 1];
	if (lastPart && lastPart.toLowerCase() !== "session") {
		return lastPart.slice(0, length);
	}
	const normalized = sessionId.replace(/[^a-zA-Z0-9]/g, "");
	return (normalized || sessionId).slice(0, length);
}

export function defaultSessionTitle(sessionId: string): string {
	return `会话 ${sessionShortId(sessionId)}`;
}
