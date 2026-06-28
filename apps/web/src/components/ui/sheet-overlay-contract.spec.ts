import * as assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const sheetSource = readFileSync(fileURLToPath(new URL("./sheet.tsx", import.meta.url)), "utf8");
const agentPageSource = readFileSync(
  fileURLToPath(new URL("../../desktop/pages/agent/AgentPage.tsx", import.meta.url)),
  "utf8",
);

function assertOrderedSnippets(source: string, snippets: string[]) {
  let cursor = 0;
  for (const snippet of snippets) {
    const next = source.indexOf(snippet, cursor);
    assert.notEqual(next, -1, `Expected snippet after offset ${cursor}: ${snippet}`);
    cursor = next + snippet.length;
  }
}

test("renders the sheet overlay before the sheet content", () => {
  assertOrderedSnippets(sheetSource, [
    "<SheetPortal>",
    "<SheetOverlay />",
    "<SheetPrimitive.Content",
  ]);
});

test("renders an accessible close button inside sheet content", () => {
  assertOrderedSnippets(sheetSource, [
    "{children}",
    "<SheetPrimitive.Close",
    'aria-label="关闭"',
    '<X className="h-4 w-4" />',
    '<span className="sr-only">关闭</span>',
  ]);
});

test("labels the mobile agent sheet and keeps its close button clear of the new-session action", () => {
  assertOrderedSnippets(agentPageSource, [
    "SheetTitle",
    "<SheetContent",
    'side="left"',
    '[&>button]:right-12',
    '<SheetTitle className="sr-only">书小安会话列表</SheetTitle>',
    '<SheetDescription className="sr-only">查看、切换和管理书小安会话。</SheetDescription>',
  ]);
});

test("detects wrapped sheet titles before adding the fallback title", () => {
  assertOrderedSnippets(sheetSource, [
    "function hasSheetTitleChild(children: React.ReactNode): boolean {",
    "return hasElementWithDisplayName(",
    'SheetPrimitive.Title.displayName ?? "SheetTitle"',
    "{hasSheetTitleChild(children) ? null : (",
    '<SheetPrimitive.Title className="sr-only">侧边面板</SheetPrimitive.Title>',
  ]);
});
