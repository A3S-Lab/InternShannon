import * as assert from "node:assert/strict";
import { test } from "node:test";
import {
	hasMeasurableMessageFocusGeometry,
	isMessageFocusRestorePending,
	isMessageFocusTargetVisible,
} from "./message-focus-restoration.ts";

const visibleGeometry = {
	scrollerTop: 100,
	scrollerBottom: 700,
	scrollerWidth: 900,
	scrollerHeight: 600,
	targetTop: 280,
	targetBottom: 360,
	targetWidth: 720,
	targetHeight: 80,
};

test("accepts a measurable target inside the chat viewport", () => {
	assert.equal(hasMeasurableMessageFocusGeometry(visibleGeometry), true);
	assert.equal(isMessageFocusTargetVisible(visibleGeometry), true);
});

test("rejects a hidden chat layout even when its zero coordinates appear aligned", () => {
	const hidden = {
		...visibleGeometry,
		scrollerTop: 0,
		scrollerBottom: 0,
		scrollerHeight: 0,
		targetTop: 0,
		targetBottom: 0,
		targetHeight: 0,
	};
	assert.equal(hasMeasurableMessageFocusGeometry(hidden), false);
	assert.equal(isMessageFocusTargetVisible(hidden), false);
});

test("requires the target to intersect the scroll viewport", () => {
	assert.equal(
		isMessageFocusTargetVisible({
			...visibleGeometry,
			targetTop: 760,
			targetBottom: 840,
		}),
		false,
	);
});

test("suppresses bottom following only while a concrete focus restore request is pending", () => {
	assert.equal(
		isMessageFocusRestorePending({
			focusMessageId: "message-source-1",
			focusMessageRequest: 2,
		}),
		true,
	);
	assert.equal(
		isMessageFocusRestorePending({
			focusMessageId: "message-source-1",
			focusMessageRequest: 0,
		}),
		false,
	);
	assert.equal(isMessageFocusRestorePending({ focusMessageRequest: 2 }), false);
});
