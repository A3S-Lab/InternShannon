import * as assert from "node:assert/strict";
import { test } from "node:test";
import { isAgentationEnabled } from "./agentation-flag.ts";

test("enables Agentation by default", () => {
	assert.equal(isAgentationEnabled(undefined), true);
	assert.equal(isAgentationEnabled(null), true);
	assert.equal(isAgentationEnabled(""), true);
});

test("keeps Agentation enabled for explicit truthy or unknown values", () => {
	assert.equal(isAgentationEnabled("true"), true);
	assert.equal(isAgentationEnabled("1"), true);
	assert.equal(isAgentationEnabled("enabled"), true);
});

test("allows Agentation to be disabled explicitly", () => {
	assert.equal(isAgentationEnabled("false"), false);
	assert.equal(isAgentationEnabled("0"), false);
	assert.equal(isAgentationEnabled("OFF"), false);
	assert.equal(isAgentationEnabled(" no "), false);
});
