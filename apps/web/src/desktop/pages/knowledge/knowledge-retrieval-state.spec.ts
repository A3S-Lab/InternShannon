import assert from "node:assert/strict";
import test from "node:test";
import {
  KNOWLEDGE_RETRIEVAL_PRESETS,
  retrievalPresetId,
} from "./knowledge-retrieval-state.ts";

test("recognizes every built-in knowledge retrieval preset", () => {
  for (const [id, preset] of Object.entries(KNOWLEDGE_RETRIEVAL_PRESETS)) {
    assert.equal(
      retrievalPresetId({
        keywordWeight: preset.keywordWeight,
        vectorWeight: preset.vectorWeight,
        mmrLambda: preset.mmrLambda,
      }),
      id,
    );
  }
});

test("preserves custom retrieval settings instead of coercing them to a preset", () => {
  assert.equal(
    retrievalPresetId({
      keywordWeight: 3,
      vectorWeight: 5,
      mmrLambda: 0.5,
    }),
    "custom",
  );
});
