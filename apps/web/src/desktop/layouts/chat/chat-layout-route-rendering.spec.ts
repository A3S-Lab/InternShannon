import * as assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const source = readFileSync(fileURLToPath(new URL("./ChatLayout.tsx", import.meta.url)), "utf8");

function assertOrderedSnippets(snippets: string[]) {
  let cursor = 0;
  for (const snippet of snippets) {
    const next = source.indexOf(snippet, cursor);
    assert.notEqual(next, -1, `Expected snippet after offset ${cursor}: ${snippet}`);
    cursor = next + snippet.length;
  }
}

test("renders the route outlet inside the current route cache key", () => {
  assert.doesNotMatch(source, /\buseOutlet\b/);
  assertOrderedSnippets([
    'import { Outlet, useLocation } from "react-router-dom";',
    "const currentCacheKey = useMemo(() => {",
    'key={currentCacheKey}',
    "<Outlet />",
  ]);
});
