import assert from "node:assert/strict";
import test from "node:test";
import {
	resolveSessionRuntimeBusy,
	runtimeCancellationMatches,
	runtimeTerminalMatches,
} from "./session-runtime-busy-state.ts";

test("keeps a session busy across preparing, running, compacting, and tool activity", () => {
	assert.equal(resolveSessionRuntimeBusy({ runtimeBusy: true }), true);
	assert.equal(
		resolveSessionRuntimeBusy({ runtimeStatus: "processing" }),
		true,
	);
	assert.equal(resolveSessionRuntimeBusy({ isCompacting: true }), true);
	assert.equal(resolveSessionRuntimeBusy({ activeToolCount: 1 }), true);
	assert.equal(resolveSessionRuntimeBusy({ hasLiveRuntimeEvent: true }), true);
	assert.equal(resolveSessionRuntimeBusy({ runtimeStatus: "idle" }), false);
});

test("ignores a stale terminal event when both sides carry different run ids", () => {
	assert.equal(runtimeTerminalMatches("run-new", "run-old"), false);
	assert.equal(runtimeTerminalMatches("run-new", "run-new"), true);
	assert.equal(runtimeTerminalMatches(undefined, "legacy-run"), true);
	assert.equal(runtimeTerminalMatches("run-new", undefined), true);
});

test("never lets a stale or uncorrelated cancellation clear a newer active run", () => {
	assert.equal(runtimeCancellationMatches("run-new", "run-old"), false);
	assert.equal(runtimeCancellationMatches("run-new", undefined), false);
	assert.equal(runtimeCancellationMatches("run-new", "run-new"), true);
	assert.equal(runtimeCancellationMatches(undefined, "run-old"), true);
	assert.equal(runtimeCancellationMatches(undefined, undefined), true);
});
