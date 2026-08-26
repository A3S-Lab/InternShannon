function fail(message, grounding) {
	throw new Error(`${message}: ${JSON.stringify(grounding)}`);
}

function recordId(row) {
	return typeof row?.record_id === "string" ? row.record_id : "";
}

function normalizedRow(row) {
	return {
		record_id: typeof row?.record_id === "string" ? row.record_id : "",
		status: typeof row?.status === "string" ? row.status : "",
		note: typeof row?.note === "string" ? row.note : "",
	};
}

function knowledgeHitKey(hit) {
	return `${hit?.assetId ?? ""}:${hit?.conceptId ?? ""}:${hit?.path ?? ""}`;
}

function containsExecutableCursor(value) {
	if (Array.isArray(value)) {
		return value.some(containsExecutableCursor);
	}
	if (!value || typeof value !== "object") return false;
	for (const [key, item] of Object.entries(value)) {
		if (
			[
				"nextSearchCursor",
				"nextCatalogCursor",
				"nextStructuredCursor",
				"nextCursor",
			].includes(key) &&
			typeof item === "string" &&
			item.length > 0
		) {
			return true;
		}
		if (
			key === "pendingSearchPages" &&
			Array.isArray(item) &&
			item.length > 0
		) {
			return true;
		}
		if (containsExecutableCursor(item)) return true;
	}
	return false;
}

/**
 * Assert the model-visible contract for an exhaustive structured table result.
 *
 * The caller supplies the exact fixture rows so this gate proves that signed
 * cursor pagination neither loses, repeats, nor reorders a record before the
 * provider sees the grounding payload.
 */
export function assertKnowledgeExhaustiveGrounding(
	grounding,
	{ sourcePath, expectedRows, expectedPageCount },
) {
	if (!grounding || typeof grounding !== "object" || Array.isArray(grounding)) {
		fail("Exhaustive grounding is not an object", grounding);
	}
	if (
		typeof sourcePath !== "string" ||
		!sourcePath ||
		!Array.isArray(expectedRows) ||
		expectedRows.length === 0 ||
		!Number.isSafeInteger(expectedPageCount) ||
		expectedPageCount < 1
	) {
		throw new TypeError("Invalid exhaustive grounding assertion contract");
	}

	const structured = grounding.structuredQuery;
	const rows = Array.isArray(structured?.rows) ? structured.rows : [];
	const expectedIds = expectedRows.map(recordId);
	const rowIds = rows.map(recordId);
	const normalizedRows = rows.map(normalizedRow);
	const normalizedExpectedRows = expectedRows.map(normalizedRow);
	const matchedRecordIds = Array.isArray(structured?.matchedRecordIds)
		? structured.matchedRecordIds
		: [];
	const targetResource = Array.isArray(structured?.resources)
		? structured.resources.find((resource) => resource?.path === sourcePath)
		: undefined;
	const resourceRecordIds = Array.isArray(targetResource?.matchedRecordIds)
		? targetResource.matchedRecordIds
		: [];

	if (
		grounding.status !== "ok" ||
		structured?.status !== "ok" ||
		structured?.kind !== "enumeration" ||
		structured?.from !== sourcePath ||
		structured?.structuredPageCount !== expectedPageCount ||
		structured?.matchedRows !== expectedRows.length ||
		structured?.returnedRows !== expectedRows.length ||
		structured?.truncated !== false ||
		structured?.nextCursor !== undefined ||
		structured?.matchedRecordIdsTruncated !== false ||
		JSON.stringify(structured?.columns) !==
			JSON.stringify(["record_id", "status", "note"]) ||
		JSON.stringify(normalizedRows) !== JSON.stringify(normalizedExpectedRows) ||
		JSON.stringify(rowIds) !== JSON.stringify(expectedIds) ||
		new Set(rowIds).size !== expectedRows.length ||
		JSON.stringify(matchedRecordIds) !== JSON.stringify(expectedIds) ||
		new Set(matchedRecordIds).size !== expectedRows.length ||
		!targetResource ||
		targetResource.matchedRecordIdsTruncated !== false ||
		JSON.stringify(resourceRecordIds) !== JSON.stringify(expectedIds) ||
		grounding.coverage?.status !== "complete" ||
		grounding.coverage?.hasMore !== false ||
		grounding.coverage?.nextStructuredCursor !== undefined
	) {
		fail(
			`Exhaustive structured grounding did not preserve all ${expectedRows.length} ordered unique rows across ${expectedPageCount} pages`,
			grounding,
		);
	}

	return {
		rowCount: rows.length,
		pageCount: structured.structuredPageCount,
		matchedRecordIds: [...matchedRecordIds],
	};
}

/**
 * Assert the model-visible contract for a complete text search followed
 * immediately by the explicit continuation control turn.
 *
 * A complete request must consume every signed search page inside its first
 * user turn. The following control turn must therefore be rejected as already
 * complete; it must never restart search page one.
 */
export function assertKnowledgeCompleteSearchRoundTrip(
	first,
	continuation,
	{ query, expectedSourceCount, searchPageSize, sourcePathFragment },
) {
	if (
		typeof query !== "string" ||
		!query ||
		!Number.isSafeInteger(expectedSourceCount) ||
		expectedSourceCount < 2 ||
		!Number.isSafeInteger(searchPageSize) ||
		searchPageSize < 1 ||
		expectedSourceCount <= searchPageSize ||
		typeof sourcePathFragment !== "string" ||
		!sourcePathFragment
	) {
		throw new TypeError(
			"Invalid complete search round-trip assertion contract",
		);
	}

	const search = first?.search;
	const coverage = first?.coverage;
	const hits = Array.isArray(search?.hits) ? search.hits : [];
	const reads = Array.isArray(first?.reads) ? first.reads : [];
	const hitKeys = hits.map(knowledgeHitKey);
	const readPaths = reads.map((read) => String(read?.path ?? ""));
	const unresolved = Array.isArray(coverage?.unresolved)
		? coverage.unresolved
		: [];
	const expectedLastOffset =
		Math.floor((expectedSourceCount - 1) / searchPageSize) * searchPageSize;
	const expectedSearchPages = Math.ceil(expectedSourceCount / searchPageSize);
	const continuationHits = Array.isArray(continuation?.search?.hits)
		? continuation.search.hits
		: [];
	const continuationReads = Array.isArray(continuation?.reads)
		? continuation.reads
		: [];

	if (
		first?.status !== "ok" ||
		search?.query !== query ||
		search?.searchCandidateCount !== expectedSourceCount ||
		search?.searchOffset !== expectedLastOffset ||
		search?.searchTruncated !== false ||
		hits.length !== expectedSourceCount ||
		new Set(hitKeys).size !== expectedSourceCount ||
		hitKeys.some((key) => !key.includes(sourcePathFragment)) ||
		reads.length !== expectedSourceCount ||
		new Set(readPaths).size !== expectedSourceCount ||
		readPaths.some((readPath) => !readPath.includes(sourcePathFragment)) ||
		coverage?.query !== query ||
		coverage?.mode !== "complete" ||
		coverage?.status !== "complete" ||
		coverage?.hasMore !== false ||
		coverage?.resultTruncated === true ||
		typeof coverage?.indexRevision !== "string" ||
		!coverage.indexRevision ||
		coverage?.required !== coverage?.verified ||
		coverage?.missing !== 0 ||
		unresolved.length !== 0 ||
		(typeof search?.nextSearchCursor === "string" &&
			search.nextSearchCursor.length > 0) ||
		(Array.isArray(search?.pendingSearchPages) &&
			search.pendingSearchPages.length > 0) ||
		containsExecutableCursor(coverage)
	) {
		fail(
			`Complete search did not exhaust ${expectedSourceCount} candidates across ${expectedSearchPages} signed pages inside one user turn`,
			first,
		);
	}

	if (
		continuation?.status !== "blocked" ||
		continuation?.reason !== "knowledge_continuation_unavailable" ||
		continuationHits.length !== 0 ||
		continuationReads.length !== 0 ||
		continuation?.coverage?.query !== query ||
		continuation?.coverage?.mode !== "complete" ||
		continuation?.coverage?.status !== "complete" ||
		continuation?.coverage?.hasMore !== false ||
		continuation?.coverage?.indexRevision !== coverage?.indexRevision ||
		!Array.isArray(continuation?.coverage?.unresolved) ||
		continuation.coverage.unresolved.length !== 0 ||
		containsExecutableCursor(continuation)
	) {
		fail(
			"Immediate continuation restarted or exposed progress after a completed search",
			continuation,
		);
	}

	return {
		candidateCount: expectedSourceCount,
		lastOffset: expectedLastOffset,
		searchPageCount: expectedSearchPages,
		continuationReason: continuation.reason,
	};
}
