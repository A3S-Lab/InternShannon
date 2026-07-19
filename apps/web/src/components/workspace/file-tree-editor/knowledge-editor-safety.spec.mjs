import * as assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const fileTreeEditorSource = readFileSync(fileURLToPath(new URL("./FileTreeEditor.tsx", import.meta.url)), "utf8");
const knowledgePageSource = readFileSync(
  fileURLToPath(new URL("../../../desktop/pages/knowledge/KnowledgePage.tsx", import.meta.url)),
  "utf8",
);
const readKnowledgeSource = (path) =>
  readFileSync(fileURLToPath(new URL(`../../../desktop/pages/knowledge/${path}`, import.meta.url)), "utf8");
const knowledgeExplorerSource = readKnowledgeSource("components/knowledge-explorer-pane.tsx");
const knowledgeGraphSource = readKnowledgeSource("components/knowledge-graph-pane.tsx");
const knowledgeCurationSource = readKnowledgeSource("components/knowledge-curation-pane.tsx");
const knowledgeSettingsSource = readKnowledgeSource("components/knowledge-settings-pane.tsx");
const knowledgeUtilsSource = readKnowledgeSource("knowledge-page-utils.ts");

test("KnowledgePage forces Markdown source mode so OKF frontmatter survives saves", () => {
  assert.match(knowledgePageSource, /<AssetFileManager[\s\S]*?enableRichMarkdown=\{false\}/);
});

test("workspace file trees hide internal snapshot storage", () => {
  assert.match(fileTreeEditorSource, /entry\.name !== "\.shuan-os-snapshots"/);
  assert.match(fileTreeEditorSource, /entry\.name !== "\.internshannon"/);
});

test("asset workspaces persist Office edits through the base64 blob contract", () => {
  const workspaceApiSource = readFileSync(
    fileURLToPath(new URL("../../../lib/workspace-api.ts", import.meta.url)),
    "utf8",
  );
  assert.match(workspaceApiSource, /writeBinaryFile:[\s\S]*?parseAssetWorkspacePath\(path\)/);
  assert.match(workspaceApiSource, /encoding: "base64"/);
  assert.match(workspaceApiSource, /encodeBase64Bytes\(Uint8Array\.from\(data\)\)/);
  assert.doesNotMatch(workspaceApiSource, /writeBinaryFile:[\s\S]{0,250}unsupportedAssetWorkspaceOperation\("写入二进制文件"\)/);
});

test("KnowledgePage exposes separate OKF import and export commands", () => {
  assert.match(knowledgePageSource, /assetsApi\.wikiImportOkf/);
  assert.match(knowledgePageSource, /assetsApi\.wikiExportOkf/);
  assert.match(knowledgePageSource, /aria-label="导入 OKF 知识包"/);
  assert.match(knowledgePageSource, /aria-label="导出 OKF 知识包"/);
});

test("KnowledgePage searches indexed OKF content instead of filtering titles only", () => {
  assert.match(knowledgePageSource, /assetsApi[\s\S]*?\.wikiSearch\(asset\.id, normalized, 24/);
  assert.match(knowledgePageSource, /searchHits=\{searchHits\}/);
});

test("KnowledgePage opens overview results without replacing the overview sidebar", () => {
  assert.match(
    knowledgePageSource,
    /dispatchFileTreeEditorCommand\(\s*"open-file-preserve-sidebar",\s*"desktop-knowledge",\s*`\$\{assetRoot\}\/\$\{path\}`,\s*\)/,
  );
  assert.match(fileTreeEditorSource, /command === "open-file-preserve-sidebar"/);
  assert.match(knowledgePageSource, /<OverviewPane/);
  assert.match(knowledgeExplorerSource, /onClick=\{\(\) => props\.onOpenPath\(page\.path\)\}/);
});

test("KnowledgePage can restore and persist the local retrieval defaults", () => {
  assert.match(knowledgePageSource, /<KnowledgeSettingsPane/);
  assert.match(knowledgeUtilsSource, /DEFAULT_KNOWLEDGE_EMBEDDING[\s\S]*?model: "local-hash-v1"/);
  assert.match(knowledgeUtilsSource, /keywordWeight: 1[\s\S]*?vectorWeight: 6[\s\S]*?mmrLambda: 0\.78/);
  assert.match(knowledgeSettingsSource, />\s*\u6062\u590d\u9ed8\u8ba4\s*</);
  assert.match(knowledgeSettingsSource, /props\.onSave\(defaults\)/);
});

test("KnowledgePage renders real graph edges without a synthetic Vault center", () => {
  assert.match(knowledgePageSource, /<GraphPane graph=\{graph\}/);
  assert.match(knowledgeGraphSource, /visibleEdges\.map/);
  assert.match(knowledgeGraphSource, /<line/);
  assert.match(knowledgeGraphSource, /forceGraphLayout/);
  assert.match(knowledgeGraphSource, /markerEnd="url\(#knowledge-graph-arrow\)"/);
  assert.match(knowledgeGraphSource, /setSelectedEdgeKey\(edgeKey\(edge\)\)/);
  assert.match(knowledgeGraphSource, /高亮关系/);
  assert.match(knowledgeGraphSource, /matchedPaths\.has\(edge\.source\)/);
  assert.doesNotMatch(knowledgeGraphSource, />Vault</);
});

test("KnowledgePage exposes review controls for curation suggestions", () => {
  const assetsApiSource = readFileSync(fileURLToPath(new URL("../../../lib/api/assets.ts", import.meta.url)), "utf8");
  assert.match(assetsApiSource, /wikiListCurationSuggestions/);
  assert.match(assetsApiSource, /wikiRefreshCurationSuggestions/);
  assert.match(assetsApiSource, /wikiReviewCurationSuggestion/);
  assert.match(knowledgePageSource, /<CurationPane/);
  assert.match(knowledgeCurationSource, /aria-label="接受建链建议"/);
  assert.match(knowledgeCurationSource, /aria-label="拒绝建链建议"/);
});

test("KnowledgePage exposes ingest progress, audit, storage migration, and embedding configuration", () => {
  assert.match(knowledgePageSource, /wikiListIngestJobs/);
  assert.match(knowledgePageSource, /wikiAuditLog/);
  assert.match(knowledgePageSource, /wikiMigrateStorage/);
  assert.match(knowledgePageSource, /wikiUpdateConfig/);
  assert.match(knowledgePageSource, /decision: "accept" \| "reject" \| "revert"/);
  assert.match(knowledgePageSource, /ingest: true/);
  assert.match(knowledgePageSource, /const job = uploaded\.job/);
  assert.match(knowledgePageSource, /uploads=\{pendingUploads\}/);
  assert.match(knowledgePageSource, /panel: "custom:operations"/);
});

test("curation reloads clean open files and protects unsaved editor content", () => {
  assert.match(knowledgePageSource, /activeSaveStatus !== "saved"/);
  assert.match(knowledgePageSource, /dispatchFileTreeEditorCommand\("reload-file"/);
  assert.match(fileTreeEditorSource, /command === "reload-file"/);
  assert.match(fileTreeEditorSource, /dirtyFilesRef\.current\.has\(path\)/);
  assert.match(fileTreeEditorSource, /replaceEditorPanelContent\(path, content\)/);
});

test("KnowledgePage keeps the original knowledge-base name and summary", () => {
  assert.match(knowledgePageSource, /<ExplorerHeader health=\{health\}/);
  assert.match(knowledgeExplorerSource, />\s*书小安知识库\s*</);
  assert.match(knowledgeExplorerSource, /formatRelativeTime\(props\.health\.lastIngestedAt\)/);
});

test("KnowledgePage keeps generated knowledge review-only and exposes graph exploration controls", () => {
  assert.match(knowledgePageSource, /<CurationPane/);
  assert.match(knowledgePageSource, /<GraphPane/);
  assert.match(knowledgeCurationSource, /suggestion\.kind === "summary"/);
  assert.match(knowledgeCurationSource, /suggestion\.kind === "merge"/);
  assert.match(knowledgeCurationSource, /撤销已接受的建议/);
  assert.match(knowledgeGraphSource, /placeholder="搜索节点"/);
  assert.match(knowledgeGraphSource, /全部类型/);
  assert.match(knowledgeGraphSource, /community/);
});

test("Office editors keep one runtime per file and avoid competing DOM cleanup", () => {
  const sources = [
    "univer-document-panel.tsx",
    "univer-spreadsheet-panel.tsx",
    "univer-presentation-panel.tsx",
  ].map((name) => readFileSync(fileURLToPath(new URL(`./${name}`, import.meta.url)), "utf8"));
  for (const source of sources) {
    assert.match(source, /const paramsRef = useRef\(params\)/);
    assert.match(source, /disposeUniverAfterReactCommit/);
    assert.doesNotMatch(source, /replaceChildren\(/);
  }
  assert.match(sources[2], /UniverDocsCorePreset/);
  assert.match(sources[2], /aria-label="幻灯片文本内容"/);
  assert.match(sources[2], /runtime\.slide\.updatePage/);
  assert.match(sources[2], /runtime\.canvasView\.createObjectToPage/);
  assert.match(sources[0], /\[markDirty, path, readOnly, retryCount\]/);
  assert.match(sources[1], /\[markDirty, path, readOnly, retryCount\]/);
  assert.match(sources[2], /\[markDirty, path, readOnly, retryCount, selectTextEntry\]/);
});

test("DOCX browser conversion does not call the Node Buffer global directly", () => {
  const docxSource = readFileSync(
    fileURLToPath(new URL("../../../../../../packages/ooxml/src/docx/index.ts", import.meta.url)),
    "utf8",
  );
  const docxExportSource = readFileSync(
    fileURLToPath(new URL("../../../../../../packages/ooxml/src/docx/univer-to-docx.ts", import.meta.url)),
    "utf8",
  );
  assert.doesNotMatch(docxSource, /\bBuffer\.from\(/);
  assert.doesNotMatch(docxExportSource, /\bBuffer\.from\(/);
});
