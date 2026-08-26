import assert from "node:assert/strict";
import test from "node:test";
import {
	mockKnowledgeProviderResponse,
	requestedKnowledgeIdentifiersFromMessages,
} from "./mock-knowledge-provider-response.mjs";

const marker = "provider smoke passed";

test("cites an exact record only when current-turn evidence contains it", () => {
	const response = mockKnowledgeProviderResponse({
		responseMarker: marker,
		recordId: "EXACT-LATE",
		grounding: {
			reads: [
				{
					sourceRef: "K1",
					matchedRecordIds: ["EXACT-LATE"],
					content: "record_id,status\nEXACT-LATE,verified",
				},
			],
		},
	});
	assert.match(response, /［错误显示名\.csv: EXACT-LATE｜K1］/u);
});

test("does not turn a zero-result query filter into verified record evidence", () => {
	const response = mockKnowledgeProviderResponse({
		responseMarker: marker,
		recordId: "EXACT-LATE",
		grounding: {
			structuredQuery: {
				status: "ok",
				filters: [
					{ column: "status", op: "eq", value: "open" },
					{ column: "record_id", op: "eq", value: "EXACT-LATE" },
				],
				rows: [],
				matchedRows: 0,
				resources: [
					{
						path: "raw/sources/knowledge-smoke.csv",
						sourceRef: "K1",
					},
				],
			},
		},
	});
	assert.equal(response, `${marker}；知识库结果已核对[[K1]]`);
	assert.doesNotMatch(response, /EXACT-LATE/u);
});

test("probe-only mode can cite a deliberately absent record for citation repair", () => {
	const response = mockKnowledgeProviderResponse({
		responseMarker: marker,
		recordId: "EXACT-LATE",
		probeOnlyCitationRecordId: "ROW-0001",
		grounding: {
			reads: [
				{
					sourceRef: "K1",
					matchedRecordIds: ["EXACT-LATE"],
					content: "record_id,status\nEXACT-LATE,verified",
				},
			],
		},
	});
	assert.match(response, /［错误显示名\.csv: ROW-0001｜K1］/u);
	assert.doesNotMatch(response, /EXACT-LATE/u);
});

test("emits no citation when the provider received no verified source handle", () => {
	const response = mockKnowledgeProviderResponse({
		responseMarker: marker,
		recordId: "EXACT-LATE",
		grounding: {
			structuredQuery: {
				status: "blocked",
				filters: [{ column: "record_id", op: "eq", value: "EXACT-LATE" }],
			},
		},
	});
	assert.equal(response, marker);
});

test("extracts stable identifiers only from the current user turn", () => {
	assert.deepEqual(
		requestedKnowledgeIdentifiersFromMessages([
			{ role: "user", content: "上一轮核对记录 OLD-0001" },
			{ role: "assistant", content: "已完成" },
			{
				role: "user",
				content: [
					{
						type: "text",
						text: "请核对记录 ROW-0025，并保留 `EXIT-W`；不要把 orders-2026.csv 当作记录。",
					},
				],
			},
		]),
		["EXIT-W", "ROW-0025"],
	);
});

test("preserves required user identifiers without inventing a verified locator", () => {
	const response = mockKnowledgeProviderResponse({
		responseMarker: marker,
		recordId: "EXACT-LATE",
		probeOnlyCitationRecordId: "ROW-0001",
		requiredIdentifiers: ["ROW-0025", "row-0025"],
		grounding: {
			reads: [
				{
					sourceRef: "K1",
					matchedRecordIds: ["ROW-0025"],
					content: "record_id,status\nROW-0025,open",
				},
			],
		},
	});
	assert.match(response, /［错误显示名\.csv: ROW-0001｜K1］/u);
	assert.match(response, /用户要求标识符：ROW-0025/u);
	assert.equal(response.match(/ROW-0025/gu)?.length, 1);
});
