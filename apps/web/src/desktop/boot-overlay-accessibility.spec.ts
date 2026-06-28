import * as assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const indexHtml = readFileSync(fileURLToPath(new URL("./index.html", import.meta.url)), "utf8");

function assertOrderedSnippets(source: string, snippets: string[]) {
  let cursor = 0;
  for (const snippet of snippets) {
    const next = source.indexOf(snippet, cursor);
    assert.notEqual(next, -1, `Expected snippet after offset ${cursor}: ${snippet}`);
    cursor = next + snippet.length;
  }
}

test("restores the boot overlay when startup rendering resumes", () => {
  assertOrderedSnippets(indexHtml, [
    "function render(title, message, details) {",
    "nodes.root.hidden = false;",
    'nodes.root.removeAttribute("aria-hidden");',
    "nodes.root.inert = false;",
    'nodes.root.classList.remove("hidden");',
  ]);
});

test("removes the completed boot overlay from the accessibility tree", () => {
  assertOrderedSnippets(indexHtml, [
    "#internshannon-bootstrap[hidden] {",
    "display: none !important;",
    "ready() {",
    "boot.ready = true;",
    'nodes.root.setAttribute("aria-hidden", "true");',
    "nodes.root.inert = true;",
    'nodes.root.classList.add("hidden");',
    "window.setTimeout(() => {",
    "if (boot.ready) nodes.root.hidden = true;",
  ]);
});
