import * as assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const source = readFileSync(fileURLToPath(new URL("./startup-config-dialog.tsx", import.meta.url)), "utf8");

function assertContains(snippet: string) {
  assert.match(source, new RegExp(escapeRegExp(snippet)), `Expected source to contain: ${snippet}`);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

test("keeps the first-run configuration dialog inside narrow desktop-local viewports", () => {
  assertContains("w-[342px]");
  assertContains("max-w-[calc(100vw-3rem)]");
  assertContains("sm:w-[84vw]");
  assertContains("sm:max-w-5xl");
  assertContains(
    'wrapperClassName="items-start justify-start overflow-x-hidden py-4 sm:items-center sm:justify-center sm:p-4"',
  );
  assertContains("onOpenAutoFocus={handleOpenAutoFocus}");
  assertContains("min-w-0 flex-1 overflow-y-auto");
  assertContains("grid min-w-0 gap-4");
  assertContains('className="w-full sm:w-auto"');
});
