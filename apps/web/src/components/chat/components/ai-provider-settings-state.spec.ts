import * as assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildProviderModelImportRows,
  filterProviderModelImportRows,
  hydrateSelectedProviderModels,
  providerConnectionPatchFromDraft,
  pruneProviderConnectionDrafts,
  readProviderConnectionDraftMemory,
  resetProviderConnectionDraftMemory,
  resolveProviderConnectionDraft,
  storeProviderConnectionDraft,
  writeProviderConnectionDraftMemory,
} from "./ai-provider-settings-state.ts";

const openaiProvider = {
  name: "openai",
  apiKey: "old-openai-key",
  baseUrl: "https://api.openai.com/v1",
};

test("resolves provider connection inputs from persisted provider config when there is no draft", () => {
  assert.deepEqual(resolveProviderConnectionDraft(openaiProvider, {}), {
    apiKey: "old-openai-key",
    baseUrl: "https://api.openai.com/v1",
  });
});

test("keeps an edited provider connection draft across provider selection changes", () => {
  const drafts = storeProviderConnectionDraft({}, "openai", {
    apiKey: "new-openai-key",
    baseUrl: "https://gateway.example/v1",
  });

  assert.deepEqual(resolveProviderConnectionDraft(openaiProvider, drafts), {
    apiKey: "new-openai-key",
    baseUrl: "https://gateway.example/v1",
  });
});

test("keeps edited provider connection drafts across AI settings page remounts", () => {
  resetProviderConnectionDraftMemory();
  writeProviderConnectionDraftMemory(
    storeProviderConnectionDraft(readProviderConnectionDraftMemory(), "openai", {
      apiKey: "new-openai-key",
      baseUrl: "https://gateway.example/v1",
    }),
  );

  const remountedDrafts = readProviderConnectionDraftMemory();

  assert.deepEqual(resolveProviderConnectionDraft(openaiProvider, remountedDrafts), {
    apiKey: "new-openai-key",
    baseUrl: "https://gateway.example/v1",
  });
});

test("keeps provider connection drafts isolated by provider name", () => {
  const drafts = storeProviderConnectionDraft(
    storeProviderConnectionDraft({}, "openai", {
      apiKey: "new-openai-key",
      baseUrl: "https://gateway.example/v1",
    }),
    "anthropic",
    {
      apiKey: "new-anthropic-key",
      baseUrl: "https://api.anthropic.com",
    },
  );

  assert.equal(resolveProviderConnectionDraft(openaiProvider, drafts).apiKey, "new-openai-key");
  assert.equal(
    resolveProviderConnectionDraft({ name: "anthropic", apiKey: "old-anthropic-key", baseUrl: "" }, drafts).apiKey,
    "new-anthropic-key",
  );
});

test("prunes drafts for providers that no longer exist", () => {
  resetProviderConnectionDraftMemory();
  const drafts = pruneProviderConnectionDrafts(
    {
      openai: { apiKey: "openai-key", baseUrl: "" },
      removed: { apiKey: "removed-key", baseUrl: "" },
    },
    [{ name: "openai" }],
  );

  assert.deepEqual(drafts, {
    openai: { apiKey: "openai-key", baseUrl: "" },
  });
});

test("prunes provider connection draft memory for removed providers", () => {
  resetProviderConnectionDraftMemory();
  writeProviderConnectionDraftMemory({
    openai: { apiKey: "openai-key", baseUrl: "" },
    removed: { apiKey: "removed-key", baseUrl: "" },
  });

  const pruned = pruneProviderConnectionDrafts(readProviderConnectionDraftMemory(), [{ name: "openai" }]);
  writeProviderConnectionDraftMemory(pruned);

  assert.deepEqual(readProviderConnectionDraftMemory(), {
    openai: { apiKey: "openai-key", baseUrl: "" },
  });
});

test("trims provider connection drafts before applying them to settings", () => {
  assert.deepEqual(
    providerConnectionPatchFromDraft({
      apiKey: "  next-key  ",
      baseUrl: "  ",
    }),
    {
      apiKey: "next-key",
      baseUrl: undefined,
    },
  );
});

test("keeps a redacted configured API key marker when applying an unchanged connection draft", () => {
  assert.deepEqual(
    providerConnectionPatchFromDraft({
      apiKey: " [configured] ",
      baseUrl: " https://gateway.example/v1 ",
    }),
    {
      apiKey: "[configured]",
      baseUrl: "https://gateway.example/v1",
    },
  );
});

test("builds fetched model import rows with zero default selection", () => {
  const rows = buildProviderModelImportRows(
    [
      { id: "gpt-4o-mini", name: "GPT-4o Mini" },
      { id: "deepseek-chat", name: "DeepSeek Chat" },
    ],
    [],
  );

  assert.deepEqual(rows, [
    { id: "gpt-4o-mini", name: "GPT-4o Mini", status: "new", selected: false },
    { id: "deepseek-chat", name: "DeepSeek Chat", status: "new", selected: false },
  ]);
});

test("marks existing fetched models as non-selectable import rows", () => {
  const rows = buildProviderModelImportRows(
    [
      { id: "gpt-4o-mini", name: "GPT-4o Mini" },
      { id: "deepseek-chat", name: "DeepSeek Chat" },
    ],
    [{ id: "gpt-4o-mini" }],
    new Set(["gpt-4o-mini", "deepseek-chat"]),
  );

  assert.deepEqual(rows, [
    { id: "gpt-4o-mini", name: "GPT-4o Mini", status: "existing", selected: false },
    { id: "deepseek-chat", name: "DeepSeek Chat", status: "new", selected: true },
  ]);
});

test("filters fetched model import rows by search query and status", () => {
  const rows = buildProviderModelImportRows(
    [
      { id: "gpt-4o-mini", name: "GPT-4o Mini" },
      { id: "deepseek-chat", name: "DeepSeek Chat" },
      { id: "qwen-long", name: "Qwen Long" },
    ],
    [{ id: "deepseek-chat" }],
  );

  assert.deepEqual(
    filterProviderModelImportRows(rows, "gpt", "all").map((row) => row.id),
    ["gpt-4o-mini"],
  );
  assert.deepEqual(
    filterProviderModelImportRows(rows, "", "new").map((row) => row.id),
    ["gpt-4o-mini", "qwen-long"],
  );
  assert.deepEqual(
    filterProviderModelImportRows(rows, "chat", "existing").map((row) => row.id),
    ["deepseek-chat"],
  );
});

test("hydrates only selected new fetched models into local model config", () => {
  const rows = buildProviderModelImportRows(
    [
      { id: "gpt-4o-mini", name: "GPT-4o Mini" },
      { id: "deepseek-reasoner", name: "DeepSeek Reasoner" },
    ],
    [{ id: "gpt-4o-mini" }],
    new Set(["gpt-4o-mini", "deepseek-reasoner"]),
  );

  assert.deepEqual(hydrateSelectedProviderModels(rows), [
    {
      id: "deepseek-reasoner",
      name: "DeepSeek Reasoner",
      family: "reasoning",
      toolCall: true,
      temperature: true,
      attachment: false,
      reasoning: true,
      modalities: { input: ["text"], output: ["text"] },
      limit: {
        context: 128000,
        output: 8192,
      },
    },
  ]);
});
