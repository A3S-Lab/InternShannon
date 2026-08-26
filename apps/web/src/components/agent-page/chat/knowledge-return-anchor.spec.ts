import assert from "node:assert/strict";
import test from "node:test";
import {
	acknowledgeKnowledgeReturnAnchor,
	consumeKnowledgeReturnAnchor,
	knowledgeReturnRequestIdFromNavigationState,
	knowledgeSourceAnchorId,
	peekKnowledgeReturnAnchor,
	requestedKnowledgeReturnAnchor,
	saveKnowledgeReturnAnchor,
} from "./knowledge-return-anchor.ts";

function memoryStorage(): Storage {
	const values = new Map<string, string>();
	return {
		get length() {
			return values.size;
		},
		clear: () => values.clear(),
		getItem: (key) => values.get(key) ?? null,
		key: (index) => Array.from(values.keys())[index] ?? null,
		removeItem: (key) => {
			values.delete(key);
		},
		setItem: (key, value) => {
			values.set(key, value);
		},
	};
}

test("stores a bounded message return anchor until the matching restore is acknowledged", () => {
	const storage = memoryStorage();
	const saved = saveKnowledgeReturnAnchor(
		{
			sessionId: "session-a",
			messageId: "message-9",
			sourceAnchorId: knowledgeSourceAnchorId(
				"message-9",
				"knowledge://asset-a/raw/sources/01 项目.md",
			),
			viewportOffsetPx: 188,
			scrollerOffsetPx: 96,
		},
		storage,
		1_000,
	);
	assert.equal(saved?.sessionId, "session-a");
	assert.equal(
		peekKnowledgeReturnAnchor(storage, 2_000)?.viewportOffsetPx,
		188,
	);
	assert.equal(peekKnowledgeReturnAnchor(storage, 2_000)?.scrollerOffsetPx, 96);
	assert.equal(
		peekKnowledgeReturnAnchor(storage, 2_000)?.sourceAnchorId,
		"message-9␟knowledge://asset-a/raw/sources/01 项目.md",
	);
	assert.equal(
		acknowledgeKnowledgeReturnAnchor("stale-request", storage, 2_000),
		false,
	);
	assert.equal(
		peekKnowledgeReturnAnchor(storage, 2_000)?.messageId,
		"message-9",
	);
	assert.equal(
		acknowledgeKnowledgeReturnAnchor(saved?.requestId ?? "", storage, 2_000),
		true,
	);
	assert.equal(peekKnowledgeReturnAnchor(storage, 2_000), null);
});

test("keeps the legacy consume helper for explicit fail-closed cleanup", () => {
	const storage = memoryStorage();
	saveKnowledgeReturnAnchor(
		{ sessionId: "session-a", messageId: "message-9" },
		storage,
		1_000,
	);
	assert.equal(
		consumeKnowledgeReturnAnchor(storage, 2_000)?.messageId,
		"message-9",
	);
	assert.equal(peekKnowledgeReturnAnchor(storage, 2_000), null);
});

test("fails closed for expired or malformed anchors", () => {
	const storage = memoryStorage();
	saveKnowledgeReturnAnchor(
		{ sessionId: "session-a", messageId: "message-9" },
		storage,
		1_000,
	);
	assert.equal(peekKnowledgeReturnAnchor(storage, 16 * 60 * 1_000), null);
	storage.setItem("internshannon:knowledge-return-anchor:v1", "{bad json");
	assert.equal(consumeKnowledgeReturnAnchor(storage, 2_000), null);
});

test("resolves only the anchor requested by the current navigation state", () => {
	const storage = memoryStorage();
	const saved = saveKnowledgeReturnAnchor(
		{ sessionId: "session-a", messageId: "message-9" },
		storage,
		1_000,
	);
	assert.ok(saved);
	assert.equal(
		requestedKnowledgeReturnAnchor(
			{ knowledgeReturnRequestId: saved.requestId },
			storage,
			2_000,
		)?.messageId,
		"message-9",
	);
	assert.equal(
		requestedKnowledgeReturnAnchor(
			{ knowledgeReturnRequestId: "stale-request" },
			storage,
			2_000,
		),
		null,
	);
	assert.equal(
		knowledgeReturnRequestIdFromNavigationState({
			knowledgeReturnRequestId: " request-2 ",
		}),
		"request-2",
	);
});

test("prefers the complete navigation-state anchor when storage is unavailable", () => {
	const storage = memoryStorage();
	const saved = saveKnowledgeReturnAnchor(
		{
			sessionId: "session-wisag57",
			messageId: "msg-1786423878506-tmffww",
			sourceAnchorId: knowledgeSourceAnchorId(
				"msg-1786423878506-tmffww",
				"knowledge://asset/raw/sources/03-疏散计算与决策规则.md",
			),
			scrollerOffsetPx: 212,
		},
		storage,
		1_000,
	);
	assert.ok(saved);

	const restored = requestedKnowledgeReturnAnchor(
		{
			knowledgeReturnRequestId: saved.requestId,
			knowledgeReturnAnchor: saved,
		},
		memoryStorage(),
		2_000,
	);
	assert.equal(restored?.requestId, saved.requestId);
	assert.equal(restored?.messageId, saved.messageId);
	assert.equal(restored?.sourceAnchorId, saved.sourceAnchorId);
	assert.equal(restored?.scrollerOffsetPx, 212);
});

test("source-card identities are deterministic and distinguish resources", () => {
	const first = knowledgeSourceAnchorId(" msg-1 ", " raw/sources/a.md ");
	assert.equal(first, "msg-1␟raw/sources/a.md");
	assert.equal(first, knowledgeSourceAnchorId("msg-1", "raw/sources/a.md"));
	assert.notEqual(first, knowledgeSourceAnchorId("msg-1", "raw/sources/b.md"));
});
