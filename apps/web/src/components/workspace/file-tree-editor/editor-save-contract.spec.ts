import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	createEditorLoadIdentity,
	hasEditorBufferChanged,
	hasPendingEditorSave,
} from "./editor-save-contract.ts";

describe("knowledge editor save contract", () => {
	it("treats either the local editor or workbench registry as dirty", () => {
		assert.equal(hasPendingEditorSave(true, false), true);
		assert.equal(hasPendingEditorSave(false, true), true);
		assert.equal(hasPendingEditorSave(true, true), true);
		assert.equal(hasPendingEditorSave(false, false), false);
		assert.equal(hasPendingEditorSave(false, undefined), false);
	});

	it("reloads only when the file or explicit content version changes", () => {
		const original = createEditorLoadIdentity({
			path: "/vault/raw/example.md",
			contentVersion: "tree:1",
			externalContentVersion: "external:1",
		});
		assert.equal(
			original,
			createEditorLoadIdentity({
				path: "/vault/raw/example.md",
				contentVersion: "tree:1",
				externalContentVersion: "external:1",
			}),
		);
		assert.notEqual(
			original,
			createEditorLoadIdentity({
				path: "/vault/raw/other.md",
				contentVersion: "tree:1",
				externalContentVersion: "external:1",
			}),
		);
		assert.notEqual(
			original,
			createEditorLoadIdentity({
				path: "/vault/raw/example.md",
				contentVersion: "tree:2",
				externalContentVersion: "external:1",
			}),
		);
	});

	it("uses the persisted buffer as the final save authority", () => {
		assert.equal(hasEditorBufferChanged("saved", "saved"), false);
		assert.equal(hasEditorBufferChanged("saved + edit", "saved"), true);
	});
});
