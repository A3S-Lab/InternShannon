const STABLE_IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9_-]{1,159}$/u;
const EXPLICIT_RECORD_IDENTIFIER =
	/(?:记录(?:\s*(?:ID|编号|号))?|\brecord(?:[\s_-]*id)?)\s*[：:#]?\s*([A-Za-z0-9][A-Za-z0-9_-]{0,159})/giu;

function escapedPattern(value) {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function identifierPattern(identifier, global = false) {
	return new RegExp(
		`(^|[^\\p{L}\\p{N}_-])(${escapedPattern(identifier)})(?=$|[^\\p{L}\\p{N}_-])`,
		global ? "giu" : "iu",
	);
}

function messageText(message) {
	if (typeof message?.content === "string") return message.content;
	if (!Array.isArray(message?.content)) return "";
	return message.content
		.flatMap((part) =>
			typeof part === "string"
				? [part]
				: typeof part?.text === "string"
					? [part.text]
					: [],
		)
		.join("\n");
}

function occurrenceIsFilename(value, identifier) {
	const pattern = identifierPattern(identifier, true);
	let sawOccurrence = false;
	for (const match of value.matchAll(pattern)) {
		sawOccurrence = true;
		const candidateStart = (match.index ?? 0) + (match[1]?.length ?? 0);
		const candidateEnd = candidateStart + (match[2]?.length ?? 0);
		if (
			!/^\.[A-Za-z0-9]{1,12}(?=$|[^\p{L}\p{N}_-])/u.test(
				value.slice(candidateEnd),
			)
		) {
			return false;
		}
	}
	return sawOccurrence;
}

/**
 * Extract domain-neutral stable identifiers from the current provider turn.
 * The mock mirrors the product contract: an identifier supplied by the user
 * may be repeated without claiming that knowledge evidence proved it.
 */
export function requestedKnowledgeIdentifiersFromMessages(messages) {
	const latestUserMessage = Array.isArray(messages)
		? [...messages].reverse().find((message) => message?.role === "user")
		: undefined;
	const value = messageText(latestUserMessage).normalize("NFKC");
	if (!value) return [];

	const candidates = [];
	for (const match of value.matchAll(/`([^`\r\n]+)`/gu)) {
		const candidate = (match[1] ?? "").trim();
		if (
			STABLE_IDENTIFIER.test(candidate) &&
			/[-_]/u.test(candidate) &&
			!occurrenceIsFilename(value, candidate)
		) {
			candidates.push(candidate);
		}
	}
	for (const match of value.matchAll(EXPLICIT_RECORD_IDENTIFIER)) {
		const candidate = (match[1] ?? "").trim();
		if (candidate && STABLE_IDENTIFIER.test(candidate)) {
			candidates.push(candidate);
		}
	}
	for (const match of value.matchAll(/[A-Za-z0-9][A-Za-z0-9_-]{2,159}/gu)) {
		const candidate = match[0];
		if (
			/[A-Za-z]/u.test(candidate) &&
			/\d/u.test(candidate) &&
			!occurrenceIsFilename(value, candidate)
		) {
			candidates.push(candidate);
		}
	}

	const seen = new Set();
	return candidates
		.filter((candidate) => {
			const key = candidate.toLowerCase();
			if (seen.has(key)) return false;
			seen.add(key);
			return true;
		})
		.slice(0, 64);
}

function appendRequiredIdentifiers(response, requiredIdentifiers) {
	const missing = [];
	const seen = new Set();
	for (const rawIdentifier of Array.isArray(requiredIdentifiers)
		? requiredIdentifiers
		: []) {
		const identifier = String(rawIdentifier ?? "")
			.normalize("NFKC")
			.trim();
		const key = identifier.toLowerCase();
		if (
			!STABLE_IDENTIFIER.test(identifier) ||
			seen.has(key) ||
			identifierPattern(identifier).test(response)
		) {
			continue;
		}
		seen.add(key);
		missing.push(identifier);
	}
	return missing.length > 0
		? `${response}；用户要求标识符：${missing.join("、")}`
		: response;
}

function sourceRefs(value, refs = new Set()) {
	if (Array.isArray(value)) {
		for (const item of value) sourceRefs(item, refs);
		return refs;
	}
	if (!value || typeof value !== "object") return refs;
	if (
		typeof value.sourceRef === "string" &&
		/^K\d{1,2}$/u.test(value.sourceRef)
	) {
		refs.add(value.sourceRef);
	}
	for (const item of Object.values(value)) sourceRefs(item, refs);
	return refs;
}

function firstCsvField(line) {
	const trimmed = String(line ?? "").trim();
	if (!trimmed) return "";
	if (trimmed.startsWith('"')) {
		const end = trimmed.indexOf('"', 1);
		return end > 0 ? trimmed.slice(1, end).replace(/""/gu, '"') : "";
	}
	return (trimmed.split(/[\t,;]/u, 1)[0] ?? "").trim();
}

function collectIdsFromEvidenceRecord(record, ids) {
	if (!record || typeof record !== "object" || Array.isArray(record)) return;
	for (const id of Array.isArray(record.matchedRecordIds)
		? record.matchedRecordIds
		: []) {
		if (typeof id === "string" && id.trim()) ids.add(id.trim());
	}
	const content =
		typeof record.content === "string"
			? record.content
			: typeof record.body === "string"
				? record.body
				: typeof record.snippet === "string"
					? record.snippet
					: "";
	if (content) {
		for (const line of content.split(/\r?\n/u).slice(1)) {
			const id = firstCsvField(line);
			if (id) ids.add(id);
		}
	}
}

function verifiedRecordIds(grounding) {
	const ids = new Set();
	for (const read of Array.isArray(grounding?.reads) ? grounding.reads : []) {
		collectIdsFromEvidenceRecord(read, ids);
	}
	for (const hit of Array.isArray(grounding?.search?.hits)
		? grounding.search.hits
		: []) {
		collectIdsFromEvidenceRecord(hit, ids);
	}
	for (const row of Array.isArray(grounding?.structuredQuery?.rows)
		? grounding.structuredQuery.rows
		: []) {
		if (typeof row?.record_id === "string" && row.record_id.trim()) {
			ids.add(row.record_id.trim());
		}
	}
	return ids;
}

/**
 * Build a deterministic mock answer from evidence visible to the provider.
 *
 * Query filters are deliberately not treated as evidence: a requested ID may
 * have zero matching rows. In that case the mock may cite the verified file,
 * but must not manufacture a record locator that the finalizer will reject.
 */
export function mockKnowledgeProviderResponse({
	responseMarker,
	grounding,
	recordId,
	displayName = "错误显示名.csv",
	probeOnlyCitationRecordId,
	requiredIdentifiers = [],
}) {
	if (!grounding || typeof grounding !== "object") return responseMarker;
	const refs = Array.from(sourceRefs(grounding)).sort(
		(left, right) => Number(left.slice(1)) - Number(right.slice(1)),
	);
	const ref = refs[0];
	if (!ref) return responseMarker;
	// Probe-only escape hatch: a deterministic provider must be able to cite a
	// record that is deliberately absent from the model-visible evidence so the
	// application-owned, post-stream citation repair path can be exercised over
	// a real WebSocket. Production-like mock responses remain evidence-bound
	// unless the caller opts into this explicit parameter.
	if (
		typeof probeOnlyCitationRecordId === "string" &&
		probeOnlyCitationRecordId.trim()
	) {
		return appendRequiredIdentifiers(
			`${responseMarker}；知识记录待补取［${displayName}: ${probeOnlyCitationRecordId.trim()}｜${ref}］`,
			requiredIdentifiers,
		);
	}
	if (verifiedRecordIds(grounding).has(recordId)) {
		return appendRequiredIdentifiers(
			`${responseMarker}；知识记录已命中［${displayName}: ${recordId}｜${ref}］`,
			requiredIdentifiers,
		);
	}
	return appendRequiredIdentifiers(
		`${responseMarker}；知识库结果已核对[[${ref}]]`,
		requiredIdentifiers,
	);
}
