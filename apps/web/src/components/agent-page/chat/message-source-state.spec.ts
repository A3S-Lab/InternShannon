import * as assert from "node:assert/strict";
import { test } from "node:test";
import { splitUniqueFileMentions } from "./message-source-state.ts";

test("renders one source card when resource and citations repeat the same knowledge file", () => {
	const segments = splitUniqueFileMentions(
		"resource:\nasset://personal-knowledge/raw/sources/renewal-freeze-plan.txt\n- citations:\nasset://personal-knowledge/raw/sources/renewal-freeze-plan.txt",
	);

	assert.equal(
		segments.filter((segment) => segment.type === "citation").length,
		1,
	);
	assert.equal(
		segments
			.filter((segment) => segment.type === "text")
			.map((segment) => segment.value)
			.join(""),
		"\n\n",
	);
});

test("hides resource field labels while preserving user-facing source headings", () => {
	const segments = splitUniqueFileMentions(
		"引用来源\nresource:\nasset://personal-knowledge/wiki/a.md",
	);

	assert.equal(
		segments
			.filter((segment) => segment.type === "text")
			.map((segment) => segment.value)
			.join(""),
		"引用来源\n",
	);
});

test("keeps distinct knowledge files independently openable", () => {
	const segments = splitUniqueFileMentions(
		"asset://personal-knowledge/wiki/a.md\nasset://personal-knowledge/wiki/b.md",
	);
	assert.deepEqual(
		segments
			.filter((segment) => segment.type === "citation")
			.map((segment) => segment.value),
		[
			"asset://personal-knowledge/wiki/a.md",
			"asset://personal-knowledge/wiki/b.md",
		],
	);
});
