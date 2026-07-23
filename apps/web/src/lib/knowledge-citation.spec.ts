import * as assert from "node:assert/strict";
import { test } from "node:test";
import { parseKnowledgeAssetCitation } from "./knowledge-citation.ts";

test("parses an indexed knowledge source citation", () => {
  assert.deepEqual(parseKnowledgeAssetCitation("asset://personal-1/raw/sources/plan.txt"), {
    assetId: "personal-1",
    relativePath: "raw/sources/plan.txt",
  });
});
test("trims prose punctuation and rejects non-asset links", () => {
  assert.deepEqual(parseKnowledgeAssetCitation("asset://personal-1/wiki/plan.md。"), {
    assetId: "personal-1",
    relativePath: "wiki/plan.md",
  });
  assert.equal(parseKnowledgeAssetCitation("https://example.com"), null);
});
