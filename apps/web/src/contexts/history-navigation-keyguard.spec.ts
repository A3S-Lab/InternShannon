import * as assert from "node:assert/strict";
import { test } from "node:test";
import {
	isEditableHistoryTarget,
	shouldPreventHistoryBackspace,
} from "./history-navigation-keyguard.ts";

function target(
	options: {
		tagName?: string;
		isContentEditable?: boolean;
		closest?: boolean;
	} = {},
) {
	return {
		tagName: options.tagName,
		isContentEditable: options.isContentEditable,
		closest: () => (options.closest ? {} : null),
	} as unknown as EventTarget;
}

test("prevents an unmodified Backspace on a non-editable page target", () => {
	assert.equal(
		shouldPreventHistoryBackspace({ key: "Backspace", target: target() }),
		true,
	);
});

test("preserves Backspace deletion in native and rich text editors", () => {
	for (const editableTarget of [
		target({ tagName: "INPUT" }),
		target({ tagName: "textarea" }),
		target({ isContentEditable: true }),
		target({ closest: true }),
	]) {
		assert.equal(
			shouldPreventHistoryBackspace({
				key: "Backspace",
				target: target(),
				composedPath: () => [editableTarget],
			}),
			false,
		);
	}
});

test("does not intercept modified, composed, handled, or forward Delete keys", () => {
	assert.equal(
		shouldPreventHistoryBackspace({ key: "Backspace", metaKey: true }),
		false,
	);
	assert.equal(
		shouldPreventHistoryBackspace({ key: "Backspace", isComposing: true }),
		false,
	);
	assert.equal(
		shouldPreventHistoryBackspace({ key: "Backspace", defaultPrevented: true }),
		false,
	);
	assert.equal(shouldPreventHistoryBackspace({ key: "Delete" }), false);
});

test("treats native fields and editable ancestors as editable targets", () => {
	assert.equal(
		isEditableHistoryTarget(target({ tagName: "SELECT" }) as never),
		true,
	);
	assert.equal(
		isEditableHistoryTarget(target({ closest: true }) as never),
		true,
	);
	assert.equal(isEditableHistoryTarget(target() as never), false);
});
