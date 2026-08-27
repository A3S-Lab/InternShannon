import * as assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const providerSource = readFileSync(fileURLToPath(new URL("./theme-provider.tsx", import.meta.url)), "utf8");
const editorSource = readFileSync(
  fileURLToPath(new URL("../../desktop/components/code-editor/CodeEditor.tsx", import.meta.url)),
  "utf8",
);
const diffEditorSource = readFileSync(
  fileURLToPath(new URL("../../desktop/components/diff-editor/DiffEditor.tsx", import.meta.url)),
  "utf8",
);
const terminalSource = readFileSync(
  fileURLToPath(new URL("../workspace/integrated-terminal/IntegratedTerminal.tsx", import.meta.url)),
  "utf8",
);

test("forces the app, editors and integrated terminal onto light surfaces", () => {
  assert.match(providerSource, /root\.classList\.remove\("dark"\)/);
  assert.match(providerSource, /root\.classList\.add\("light"\)/);
  assert.match(editorSource, /const editorTheme = INTERN_SHANNON_LIGHT_THEME/);
  assert.match(diffEditorSource, /theme="vs"/);
  assert.doesNotMatch(terminalSource, /"dark flex h-full/);
});
