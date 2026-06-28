import * as assert from "node:assert/strict";
import { test } from "node:test";
import { buildMarkdownHeadingItems, buildMarkdownToc, createMarkdownHeadingBaseId } from "./markdown-outline.ts";

test("builds stable heading ids from markdown headings", () => {
  assert.deepEqual(buildMarkdownHeadingItems(`# 标题\n\n## API Token\n\n### API Token\n\n#### Git / OCI\n`), [
    { id: "标题", level: 1, text: "标题", line: 1 },
    { id: "api-token", level: 2, text: "API Token", line: 3 },
    { id: "api-token-2", level: 3, text: "API Token", line: 5 },
    { id: "git-oci", level: 4, text: "Git / OCI", line: 7 },
  ]);
});

test("ignores fenced code headings when building markdown outline", () => {
  assert.deepEqual(buildMarkdownToc("## Visible\n\n```md\n## Hidden\n```\n\n### Also visible"), [
    { id: "visible", level: 2, text: "Visible" },
    { id: "also-visible", level: 3, text: "Also visible" },
  ]);
});

test("normalizes inline markdown in heading ids", () => {
  assert.equal(createMarkdownHeadingBaseId("**资产** [`manifest.acl`](./manifest)"), "资产-manifestacl");
});
