import * as assert from "node:assert/strict";
import { test } from "node:test";
import { isAgentationEnabled } from "./agentation-flag.ts";

test("disables Agentation by default", () => {
	assert.equal(isAgentationEnabled(undefined), false);
	assert.equal(isAgentationEnabled(null), false);
	assert.equal(isAgentationEnabled(""), false);
});

test("keeps Agentation enabled only for explicit truthy values", () => {
	assert.equal(isAgentationEnabled("true"), true);
	assert.equal(isAgentationEnabled("1"), true);
	assert.equal(isAgentationEnabled("enabled"), true);
	assert.equal(isAgentationEnabled("yes"), true);
});

test("allows Agentation to be disabled explicitly", () => {
	assert.equal(isAgentationEnabled("false"), false);
	assert.equal(isAgentationEnabled("0"), false);
	assert.equal(isAgentationEnabled("OFF"), false);
	assert.equal(isAgentationEnabled(" no "), false);
	assert.equal(isAgentationEnabled("anything-else"), false);
});
