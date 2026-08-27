import * as assert from "node:assert/strict";
import { test } from "node:test";
import {
	normalizeKnowledgeSourceReferences,
	parseKnowledgeAssetCitation,
} from "./knowledge-citation.ts";

test("parses an indexed knowledge source citation", () => {
	assert.deepEqual(
		parseKnowledgeAssetCitation("asset://personal-1/raw/sources/plan.txt"),
		{
			assetId: "personal-1",
			relativePath: "raw/sources/plan.txt",
		},
	);
});
test("trims prose punctuation and rejects non-asset links", () => {
	assert.deepEqual(
		parseKnowledgeAssetCitation("asset://personal-1/wiki/plan.md。"),
		{
			assetId: "personal-1",
			relativePath: "wiki/plan.md",
		},
	);
	assert.equal(parseKnowledgeAssetCitation("https://example.com"), null);
});

test("rejects malformed and traversal knowledge citations", () => {
	assert.equal(
		parseKnowledgeAssetCitation("asset://personal-1/raw//plan.txt"),
		null,
	);
	assert.equal(
		parseKnowledgeAssetCitation("asset://personal-1/raw/../plan.txt"),
		null,
	);
	assert.equal(
		parseKnowledgeAssetCitation("asset://personal-1/raw\\plan.txt"),
		null,
	);
	assert.equal(
		parseKnowledgeAssetCitation("asset://personal-1/%E0%A4%A"),
		null,
	);
	assert.equal(
		parseKnowledgeAssetCitation("asset://…/raw/sources/plan.txt"),
		null,
	);
	assert.equal(
		parseKnowledgeAssetCitation("asset://.../raw/sources/plan.txt"),
		null,
	);
});

test("normalizes internally consistent structured sources and deduplicates locators", () => {
	const resource = "asset://personal-1/raw/sources/orders.csv";
	assert.deepEqual(
		normalizeKnowledgeSourceReferences([
			{
				protocolVersion: 1,
				ref: "K1",
				assetId: "personal-1",
				relativePath: "raw/sources/orders.csv",
				title: "orders.csv",
				resource,
				evidence: "read",
				locators: [{ kind: "record", value: "OR-9" }],
			},
			{
				protocolVersion: 1,
				ref: "K1",
				assetId: "personal-1",
				relativePath: "raw/sources/orders.csv",
				title: "orders.csv",
				resource,
				evidence: "read",
				locators: [{ kind: "record", value: "OR-9" }],
			},
		]),
		[
			{
				protocolVersion: 1,
				ref: "K1",
				assetId: "personal-1",
				relativePath: "raw/sources/orders.csv",
				title: "orders.csv",
				resource,
				evidence: "read",
				locators: [{ kind: "record", value: "OR-9" }],
			},
		],
	);
});

test("fails closed when a structured source resource disagrees with its identity", () => {
	assert.equal(
		normalizeKnowledgeSourceReferences([
			{
				protocolVersion: 1,
				ref: "K1",
				assetId: "asset-a",
				relativePath: "raw/sources/orders.csv",
				title: "orders.csv",
				resource: "asset://asset-b/raw/sources/orders.csv",
				evidence: "read",
				locators: [],
			},
		]),
		undefined,
	);
});
