import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	assertKnowledgeCompleteSearchRoundTrip,
	assertKnowledgeExhaustiveGrounding,
} from "./knowledge-exhaustive-grounding-contract.mjs";

const SOURCE_PATH = "raw/sources/knowledge-smoke.csv";
const EXPECTED_ROWS = [
	...Array.from({ length: 25 }, (_, index) => ({
		record_id: `ROW-${String(index + 1).padStart(4, "0")}`,
		status: "open",
		note: "fixture",
	})),
	{ record_id: "EXACT-LATE", status: "verified", note: "late exact row" },
];

function completeGrounding() {
	const ids = EXPECTED_ROWS.map((row) => row.record_id);
	return {
		status: "ok",
		structuredQuery: {
			status: "ok",
			kind: "enumeration",
			from: SOURCE_PATH,
			columns: ["record_id", "status", "note"],
			// Production JSON serializers may emit object keys in a different order;
			// row order and field values are the contract, object key order is not.
			rows: EXPECTED_ROWS.map(({ record_id, status, note }) => ({
				note,
				record_id,
				status,
			})),
			aggregates: {},
			matchedRows: 26,
			returnedRows: 26,
			structuredPageCount: 2,
			truncated: false,
			matchedRecordIds: [...ids],
			matchedRecordIdsTruncated: false,
			resources: [
				{
					path: SOURCE_PATH,
					resource: `asset://fixture/${SOURCE_PATH}`,
					matchedRecordIds: [...ids],
					matchedRecordIdsTruncated: false,
				},
			],
		},
		coverage: { status: "complete", hasMore: false },
	};
}

const contract = {
	sourcePath: SOURCE_PATH,
	expectedRows: EXPECTED_ROWS,
	expectedPageCount: 2,
};

const COMPLETE_QUERY = "GENERIC-COMPLETE-PAGINATION";
const COMPLETE_SOURCE_COUNT = 12;
const COMPLETE_PAGE_SIZE = 3;
const COMPLETE_REVISION = "revision-complete-search";

function completeSearchGrounding() {
	const hits = Array.from({ length: COMPLETE_SOURCE_COUNT }, (_, index) => ({
		kind: "source",
		assetId: "asset-fixture",
		conceptId: `source:raw/sources/pagination-${index + 1}.md#0`,
		path: `raw/sources/pagination-${index + 1}.md`,
	}));
	return {
		status: "ok",
		search: {
			query: COMPLETE_QUERY,
			hits,
			searchCandidateCount: COMPLETE_SOURCE_COUNT,
			searchOffset: 9,
			searchTruncated: false,
			// An unrelated, non-required catalog page may still be visible in the
			// compact search metadata; coverage decides whether it is executable.
			nextCatalogCursor: "irrelevant-catalog-page",
		},
		reads: hits.map((hit) => ({
			path: hit.path,
			content: `verified ${hit.path}`,
		})),
		coverage: {
			version: 1,
			query: COMPLETE_QUERY,
			mode: "complete",
			status: "complete",
			hasMore: false,
			indexRevision: COMPLETE_REVISION,
			required: 2,
			verified: 2,
			missing: 0,
			unresolved: [],
		},
	};
}

function completedSearchContinuation() {
	return {
		status: "blocked",
		reason: "knowledge_continuation_unavailable",
		search: { hits: [], tableSummaries: [] },
		reads: [],
		coverage: {
			version: 1,
			query: COMPLETE_QUERY,
			mode: "complete",
			status: "complete",
			hasMore: false,
			indexRevision: COMPLETE_REVISION,
			unresolved: [],
		},
	};
}

const completeSearchContract = {
	query: COMPLETE_QUERY,
	expectedSourceCount: COMPLETE_SOURCE_COUNT,
	searchPageSize: COMPLETE_PAGE_SIZE,
	sourcePathFragment: "raw/sources/pagination-",
};

describe("exhaustive knowledge grounding smoke contract", () => {
	it("accepts all 26 ordered unique rows after two signed pages", () => {
		assert.deepEqual(
			assertKnowledgeExhaustiveGrounding(completeGrounding(), contract),
			{
				rowCount: 26,
				pageCount: 2,
				matchedRecordIds: EXPECTED_ROWS.map((row) => row.record_id),
			},
		);
	});

	it("rejects a missing, repeated, or reordered row", () => {
		for (const mutate of [
			(grounding) => grounding.structuredQuery.rows.pop(),
			(grounding) => {
				grounding.structuredQuery.rows[25] = grounding.structuredQuery.rows[24];
			},
			(grounding) => {
				grounding.structuredQuery.rows.reverse();
			},
		]) {
			const grounding = completeGrounding();
			mutate(grounding);
			assert.throws(
				() => assertKnowledgeExhaustiveGrounding(grounding, contract),
				/ordered unique rows/u,
			);
		}
	});

	it("rejects incomplete pagination metadata or coverage", () => {
		for (const mutate of [
			(grounding) => {
				grounding.structuredQuery.structuredPageCount = 1;
			},
			(grounding) => {
				grounding.structuredQuery.truncated = true;
				grounding.structuredQuery.nextCursor = "signed-page-3";
			},
			(grounding) => {
				grounding.coverage.status = "partial";
				grounding.coverage.hasMore = true;
			},
			(grounding) => grounding.structuredQuery.matchedRecordIds.pop(),
		]) {
			const grounding = completeGrounding();
			mutate(grounding);
			assert.throws(
				() => assertKnowledgeExhaustiveGrounding(grounding, contract),
				/ordered unique rows/u,
			);
		}
	});
});

describe("complete search WebSocket grounding contract", () => {
	it("accepts four signed search pages exhausted inside one user turn", () => {
		assert.deepEqual(
			assertKnowledgeCompleteSearchRoundTrip(
				completeSearchGrounding(),
				completedSearchContinuation(),
				completeSearchContract,
			),
			{
				candidateCount: 12,
				lastOffset: 9,
				searchPageCount: 4,
				continuationReason: "knowledge_continuation_unavailable",
			},
		);
	});

	it("rejects the old two-turn partial-search behavior", () => {
		const grounding = completeSearchGrounding();
		grounding.search.hits = grounding.search.hits.slice(0, 10);
		grounding.search.searchOffset = 0;
		grounding.search.searchTruncated = true;
		grounding.search.nextSearchCursor = "signed-page-two";
		grounding.reads = grounding.reads.slice(0, 10);
		grounding.coverage.status = "partial";
		grounding.coverage.hasMore = true;
		grounding.coverage.resultTruncated = true;
		grounding.coverage.nextSearchCursor = "signed-page-two";

		assert.throws(
			() =>
				assertKnowledgeCompleteSearchRoundTrip(
					grounding,
					completedSearchContinuation(),
					completeSearchContract,
				),
			/inside one user turn/u,
		);
	});

	it("rejects an immediate continuation that restarts page one", () => {
		const continuation = completedSearchContinuation();
		continuation.status = "ok";
		continuation.reason = undefined;
		continuation.search = completeSearchGrounding().search;

		assert.throws(
			() =>
				assertKnowledgeCompleteSearchRoundTrip(
					completeSearchGrounding(),
					continuation,
					completeSearchContract,
				),
			/restarted or exposed progress/u,
		);
	});

	it("rejects missing or repeated model-visible evidence", () => {
		for (const mutate of [
			(grounding) => grounding.search.hits.pop(),
			(grounding) => {
				grounding.search.hits[11] = grounding.search.hits[10];
			},
			(grounding) => grounding.reads.pop(),
			(grounding) => {
				grounding.coverage.missing = 1;
				grounding.coverage.unresolved.push({
					id: "search-results",
					status: "partial",
				});
			},
		]) {
			const grounding = completeSearchGrounding();
			mutate(grounding);
			assert.throws(
				() =>
					assertKnowledgeCompleteSearchRoundTrip(
						grounding,
						completedSearchContinuation(),
						completeSearchContract,
					),
				/inside one user turn/u,
			);
		}
	});
});
