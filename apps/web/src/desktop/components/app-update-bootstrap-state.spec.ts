import * as assert from "node:assert/strict";
import { test } from "node:test";
import { shouldRunStartupUpdateCheck } from "./app-update-bootstrap-state.ts";

test("skips startup update checks in development", () => {
	assert.equal(
		shouldRunStartupUpdateCheck({
			isDev: true,
			startupCheckedValue: null,
		}),
		false,
	);
});

test("runs startup update checks once in production", () => {
	assert.equal(
		shouldRunStartupUpdateCheck({
			isDev: false,
			startupCheckedValue: null,
		}),
		true,
	);
	assert.equal(
		shouldRunStartupUpdateCheck({
			isDev: false,
			startupCheckedValue: "true",
		}),
		false,
	);
});
