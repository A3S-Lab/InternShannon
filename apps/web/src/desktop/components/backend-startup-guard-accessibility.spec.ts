import * as assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const source = readFileSync(fileURLToPath(new URL("./backend-startup-guard.tsx", import.meta.url)), "utf8");

function assertOrderedSnippets(snippets: string[]) {
  let cursor = 0;
  for (const snippet of snippets) {
    const next = source.indexOf(snippet, cursor);
    assert.notEqual(next, -1, `Expected snippet after offset ${cursor}: ${snippet}`);
    cursor = next + snippet.length;
  }
}

test("exposes the backend startup gate as a labelled modal dialog with live status", () => {
  assertOrderedSnippets([
    'const BACKEND_STARTUP_DIALOG_TITLE_ID = "backend-startup-dialog-title";',
    "const BACKEND_STARTUP_DIALOG_DESCRIPTION_ID =",
    "ref={dialogRef}",
    'role="dialog"',
    'aria-modal="true"',
    "aria-labelledby={BACKEND_STARTUP_DIALOG_TITLE_ID}",
    "aria-describedby={BACKEND_STARTUP_DIALOG_DESCRIPTION_ID}",
    "tabIndex={-1}",
    "id={BACKEND_STARTUP_DIALOG_TITLE_ID}",
    "<output",
    "id={BACKEND_STARTUP_DIALOG_DESCRIPTION_ID}",
    'aria-live="polite"',
    'aria-atomic="true"',
  ]);
});

test("moves focus to the startup dialog once per checking or error phase", () => {
  assertOrderedSnippets([
    "const lastFocusedPhaseRef = useRef<string | null>(null);",
    'if (ui.phase === "ready") {',
    "lastFocusedPhaseRef.current = null;",
    "if (lastFocusedPhaseRef.current === ui.phase) return;",
    "lastFocusedPhaseRef.current = ui.phase;",
    "window.requestAnimationFrame(() => dialogRef.current?.focus());",
  ]);
});

test("shows a recovery hint before raw startup diagnostics", () => {
  assertOrderedSnippets([
    "const recoveryHint = resolveBackendStartupRecoveryHint({",
    "{recoveryHint.title}",
    "{recoveryHint.description}",
    "{ui.showDiagnostics || (!isChecking && ui.details) ? (",
  ]);
});
