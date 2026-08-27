import * as assert from "node:assert/strict";
import { test } from "node:test";
import { parseAnsiText } from "./ansi-text.ts";

test("keeps markup-like terminal text as inert text", () => {
	assert.deepEqual(parseAnsiText('<img src=x onerror="alert(1)">'), [
		{
			offset: 0,
			text: '<img src=x onerror="alert(1)">',
			className: "",
		},
	]);
});

test("converts ANSI SGR colors and resets to stable text segments", () => {
	assert.deepEqual(
		parseAnsiText("plain \u001b[31;1mred\u001b[0m tail").map(
			({ text, className }) => ({ text, className }),
		),
		[
			{ text: "plain ", className: "" },
			{ text: "red", className: "font-bold text-red-600" },
			{ text: " tail", className: "" },
		],
	);
});

test("preserves malformed escape text instead of dropping user output", () => {
	const malformed = "before \u001b[not-sgr after";
	assert.equal(parseAnsiText(malformed).map((segment) => segment.text).join(""), malformed);
});
