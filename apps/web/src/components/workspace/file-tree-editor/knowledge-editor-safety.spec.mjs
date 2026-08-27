import * as assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const fileTreeEditorSource = readFileSync(
	fileURLToPath(new URL("./FileTreeEditor.tsx", import.meta.url)),
	"utf8",
);
const fileTreeEditorStyles = readFileSync(
	fileURLToPath(new URL("./styles.css", import.meta.url)),
	"utf8",
);
const monacoEnvironmentSource = readFileSync(
	fileURLToPath(
		new URL("../../../desktop/lib/monaco-env.ts", import.meta.url),
	),
	"utf8",
);
const codeEditorSource = readFileSync(
	fileURLToPath(
		new URL("../../../desktop/components/code-editor/CodeEditor.tsx", import.meta.url),
	),
	"utf8",
);
const knowledgePageSource = readFileSync(
	fileURLToPath(
		new URL(
			"../../../desktop/pages/knowledge/KnowledgePage.tsx",
			import.meta.url,
		),
	),
	"utf8",
);
const knowledgeExplorerPaneSource = readFileSync(
	fileURLToPath(
		new URL(
			"../../../desktop/pages/knowledge/components/knowledge-explorer-pane.tsx",
			import.meta.url,
		),
	),
	"utf8",
);
const knowledgeGraphPaneSource = readFileSync(
	fileURLToPath(
		new URL(
			"../../../desktop/pages/knowledge/components/knowledge-graph-pane.tsx",
			import.meta.url,
		),
	),
	"utf8",
);
const knowledgeCurationPaneSource = readFileSync(
	fileURLToPath(
		new URL(
			"../../../desktop/pages/knowledge/components/knowledge-curation-pane.tsx",
			import.meta.url,
		),
	),
	"utf8",
);
const knowledgeSettingsPaneSource = readFileSync(
	fileURLToPath(
		new URL(
			"../../../desktop/pages/knowledge/components/knowledge-settings-pane.tsx",
			import.meta.url,
		),
	),
	"utf8",
);
const knowledgePageUtilsSource = readFileSync(
	fileURLToPath(
		new URL(
			"../../../desktop/pages/knowledge/knowledge-page-utils.ts",
			import.meta.url,
		),
	),
	"utf8",
);
const desktopRustSource = readFileSync(
	fileURLToPath(
		new URL(
			"../../../../../desktop/src-tauri/src/lib.rs",
			import.meta.url,
		),
	),
	"utf8",
);

test("KnowledgePage forces Markdown source mode so OKF frontmatter survives saves", () => {
	assert.match(
		knowledgePageSource,
		/<AssetFileManager[\s\S]*?enableRichMarkdown=\{false\}/,
	);
	assert.match(knowledgePageSource, /manualSaveOnly/);
});

test("source-card knowledge previews are visibly read-only and remove mutation panes", () => {
	assert.match(knowledgePageSource, /来源临时预览：当前页面只读/);
	assert.match(knowledgePageSource, /readOnly=\{fromChatSource\}/);
	assert.match(
		knowledgePageSource,
		/overviewSidebarPane=\{\s*fromChatSource\s*\?\s*undefined/,
	);
	assert.match(knowledgePageSource, /\.\.\.\(\s*!fromChatSource\s*\?\s*\[/);
});

test("Monaco retains text focus and uses visible packaged editing feedback", () => {
	assert.match(
		fileTreeEditorSource,
		/if \(event\.target === event\.currentTarget\)/,
	);
	assert.match(
		fileTreeEditorSource,
		/data-menu-shortcut-scope="custom-editor"[\s\S]*?onPointerDown=\{\(event\) => \{[\s\S]*?event\.target === event\.currentTarget/,
	);
	assert.match(fileTreeEditorSource, /toast\.error\(`保存失败:/);
	assert.match(
		fileTreeEditorSource,
		/options=\{\{[\s\S]*?readOnly,[\s\S]*?contextmenu: false/,
	);
	assert.match(
		fileTreeEditorStyles,
		/\.file-tree-editor-root[\s\S]*?\.view-overlays[\s\S]*?\.cslr\.selected-text[\s\S]*?background:/,
	);
	assert.match(
		fileTreeEditorStyles,
		/\.file-tree-editor-root \.monaco-editor \.cursors-layer > \.cursor[\s\S]*?background-color:/,
	);
	assert.match(fileTreeEditorSource, /editContext: false/);
	assert.match(fileTreeEditorSource, /experimentalGpuAcceleration: "off"/);
	assert.match(fileTreeEditorSource, /disableLayerHinting: true/);
	assert.match(fileTreeEditorSource, /roundedSelection: false/);
	assert.match(fileTreeEditorSource, /hostOwnedCommandIds=\{\["editor\.save"\]\}/);
	assert.match(fileTreeEditorStyles, /\.context-view\.monaco-menu-container/);
	assert.match(
		fileTreeEditorStyles,
		/\.monaco-menu ul,[\s\S]*?list-style: none/,
	);
	assert.match(
		fileTreeEditorStyles,
		/\.monaco-action-bar\.vertical \.actions-container[\s\S]*?flex-direction: column/,
	);
	assert.match(
		monacoEnvironmentSource,
		/import "monaco-editor\/min\/vs\/editor\/editor\.main\.css"/,
	);
	assert.match(
		monacoEnvironmentSource,
		/setMonarchTokensProvider\("markdown", markdownLanguage\)/,
	);
	assert.match(fileTreeEditorSource, /aria-label="文本选择操作"/);
	assert.match(fileTreeEditorSource, /aria-label="复制选中文本"/);
	assert.match(fileTreeEditorSource, /resolveSelectionToolbarPosition\(\{/);
	assert.match(fileTreeEditorSource, /await writeClipboardText\(state\.selectionText\)/);
	assert.match(fileTreeEditorSource, /file-tree-editor-user-selection/);
	assert.match(fileTreeEditorSource, /buildMarkdownSourceDecorations/);
	assert.match(fileTreeEditorStyles, /\.file-tree-editor-md-heading/);
	assert.match(fileTreeEditorStyles, /\.file-tree-editor-md-code/);
	assert.match(codeEditorSource, /monaco\.editor\.setModelLanguage\(model, language\)/);
	assert.match(
		codeEditorSource,
		/monaco\.editor\.setTheme\(editorTheme\)/,
	);
});

test("macOS native undo and redo are forwarded to the focused application editor", () => {
	assert.match(desktopRustSource, /with_id\("edit-undo", "Undo"\)/);
	assert.match(desktopRustSource, /accelerator\("CmdOrCtrl\+Z"\)/);
	assert.match(desktopRustSource, /"edit-undo" => Some\("undo"\)/);
	assert.match(desktopRustSource, /app\.emit\("menu-event", payload\)/);
	assert.doesNotMatch(
		desktopRustSource,
		/PredefinedMenuItem::undo\(handle, None\)/,
	);
	assert.match(fileTreeEditorSource, /if \(!api\.isActive\) return;/);
	assert.match(
		fileTreeEditorSource,
		/monacoEditor\.trigger\("native-menu", "undo", null\)/,
	);
	assert.match(
		fileTreeEditorSource,
		/runMarkdownCommand\(command, \{ allowActivePanel: true \}\)/,
	);
});

test("manual file saves report success without racing workbench save-all", () => {
	assert.match(fileTreeEditorSource, /toast\.success\(`已保存：\$\{currentFileName\}`\)/);
	assert.match(
		fileTreeEditorSource,
		/const promise = handleSave\(\{ notify: true \}\)/,
	);
	assert.match(fileTreeEditorSource, /return "saved";/);
	assert.match(
		fileTreeEditorSource,
		/dispatchFileEditorSave\(activePath, commandScope\)/,
	);
	assert.match(
		fileTreeEditorSource,
		/document\.addEventListener\("keydown", handleKeyDown, true\)/,
	);
	assert.match(fileTreeEditorSource, /getModel\(\)\?\.getValue\(\)/);
	assert.match(fileTreeEditorSource, /detail\.path !== pathRef\.current/);
	assert.equal(
		fileTreeEditorSource.match(/onEditorInstance: setEditorInstance/g)?.length,
		4,
		"new, pending, restored, and ready-pending text panels must all register their Monaco instance",
	);
	assert.match(
		codeEditorSource,
		/applyKeybindings\([\s\S]{0,180}\{ excludedCommandIds: hostOwnedCommandIds \}/,
	);
	assert.match(
		fileTreeEditorSource,
		/previousRequest\?\.path === requestIdentity\.path[\s\S]{0,100}previousRequest\?\.content === requestIdentity\.content[\s\S]{0,180}previousRequest\.promise/,
	);
	assert.match(fileTreeEditorSource, /if \(request\?\.promise !== promise \|\| request\.notified\) return;/);
	assert.match(
		fileTreeEditorSource,
		/hasEditorBufferChanged\([\s\S]{0,100}persistedContentRef\.current/,
	);
	assert.match(fileTreeEditorSource, /handleSaveRef\.current\(\{ notify: false \}\)/);
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
	assert.match(
		workspaceApiSource,
		/writeBinaryFile:[\s\S]*?parseAssetWorkspacePath\(path\)/,
	);
	assert.match(workspaceApiSource, /encoding: "base64"/);
	assert.match(
		workspaceApiSource,
		/encodeBase64Bytes\(Uint8Array\.from\(data\)\)/,
	);
	assert.doesNotMatch(
		workspaceApiSource,
		/writeBinaryFile:[\s\S]{0,250}unsupportedAssetWorkspaceOperation\("写入二进制文件"\)/,
	);
});

test("KnowledgePage exposes separate OKF import and export commands", () => {
	assert.match(knowledgePageSource, /assetsApi\.wikiImportOkf/);
	assert.match(knowledgePageSource, /assetsApi\.wikiExportOkf/);
	assert.match(knowledgePageSource, /aria-label="导入 OKF 知识包"/);
	assert.match(knowledgePageSource, /aria-label="导出 OKF 知识包"/);
});

test("KnowledgePage searches indexed OKF content instead of filtering titles only", () => {
	assert.match(
		knowledgePageSource,
		/assetsApi[\s\S]*?\.wikiSearch\(asset\.id, normalized, 24/,
	);
	assert.match(knowledgePageSource, /searchHits=\{searchHits\}/);
});

test("KnowledgePage opens overview results without replacing the overview sidebar", () => {
	assert.match(
		knowledgePageSource,
		/dispatchFileTreeEditorCommand\(\s*"open-file-preserve-sidebar",\s*"desktop-knowledge",\s*`\$\{assetRoot\}\/\$\{path\}`/,
	);
	assert.match(
		fileTreeEditorSource,
		/command === "open-file-preserve-sidebar"/,
	);
	assert.match(
		knowledgeExplorerPaneSource,
		/onClick=\{\(\) => props\.onOpenPath\(page\.path\)\}/,
	);
});

test("KnowledgePage can restore and persist the local retrieval defaults", () => {
	assert.match(
		knowledgePageUtilsSource,
		/DEFAULT_KNOWLEDGE_EMBEDDING[\s\S]*?model: "local-hash-v1"/,
	);
	assert.match(
		knowledgePageUtilsSource,
		/keywordWeight: 1[\s\S]*?vectorWeight: 6[\s\S]*?mmrLambda: 0\.78/,
	);
	assert.match(knowledgeSettingsPaneSource, />\s*\u6062\u590d\u9ed8\u8ba4\s*</);
	assert.match(knowledgeSettingsPaneSource, /props\.onSave\(defaults\)/);
});

test("KnowledgePage renders real graph edges without a synthetic Vault center", () => {
	assert.match(knowledgeGraphPaneSource, /visibleEdges\.map/);
	assert.match(knowledgeGraphPaneSource, /<line/);
	assert.match(knowledgeGraphPaneSource, /forceGraphLayout/);
	assert.match(
		knowledgeGraphPaneSource,
		/markerEnd="url\(#knowledge-graph-arrow\)"/,
	);
	assert.match(
		knowledgeGraphPaneSource,
		/setSelectedEdgeKey\(edgeKey\(edge\)\)/,
	);
	assert.match(knowledgeGraphPaneSource, /高亮关系/);
	assert.match(knowledgeGraphPaneSource, /matchedPaths\.has\(edge\.source\)/);
	assert.doesNotMatch(knowledgeGraphPaneSource, />Vault</);
});

test("KnowledgePage exposes review controls for curation suggestions", () => {
	const assetsApiSource = readFileSync(
		fileURLToPath(new URL("../../../lib/api/assets.ts", import.meta.url)),
		"utf8",
	);
	assert.match(assetsApiSource, /wikiListCurationSuggestions/);
	assert.match(assetsApiSource, /wikiRefreshCurationSuggestions/);
	assert.match(assetsApiSource, /wikiReviewCurationSuggestion/);
	assert.match(knowledgeCurationPaneSource, /aria-label="接受建链建议"/);
	assert.match(knowledgeCurationPaneSource, /aria-label="拒绝建链建议"/);
});

test("KnowledgePage exposes ingest progress, audit, storage migration, and embedding configuration", () => {
	assert.match(knowledgePageSource, /wikiListIngestJobs/);
	assert.match(knowledgePageSource, /wikiAuditLog/);
	assert.match(knowledgePageSource, /wikiMigrateStorage/);
	assert.match(knowledgePageSource, /wikiUpdateConfig/);
	assert.match(
		knowledgePageSource,
		/decision: "accept" \| "reject" \| "revert"/,
	);
	assert.match(knowledgePageSource, /ingest: true/);
	assert.match(knowledgePageSource, /const job = uploaded\.job/);
	assert.match(knowledgePageSource, /uploads=\{pendingUploads\}/);
	assert.match(knowledgePageSource, /panel: "custom:operations"/);
});

test("curation reloads clean open files and protects unsaved editor content", () => {
	assert.match(knowledgePageSource, /activeSaveStatus !== "saved"/);
	assert.match(
		knowledgePageSource,
		/dispatchFileTreeEditorCommand\(\s*"reload-file"/,
	);
	assert.match(fileTreeEditorSource, /command === "reload-file"/);
	assert.match(fileTreeEditorSource, /dirtyFilesRef\.current\.has\(path\)/);
	assert.match(
		fileTreeEditorSource,
		/replaceEditorPanelContent\(path, content\)/,
	);
});

test("KnowledgePage keeps the original knowledge-base name and summary", () => {
	assert.match(knowledgeExplorerPaneSource, />\s*书小安知识库\s*</);
	assert.match(
		knowledgeExplorerPaneSource,
		/formatRelativeTime\(props\.health\.lastIngestedAt\)/,
	);
});

test("KnowledgePage keeps generated knowledge review-only and exposes graph exploration controls", () => {
	assert.match(knowledgeCurationPaneSource, /suggestion\.kind === "summary"/);
	assert.match(knowledgeCurationPaneSource, /suggestion\.kind === "merge"/);
	assert.match(knowledgeCurationPaneSource, /撤销已接受的建议/);
	assert.match(knowledgeGraphPaneSource, /placeholder="搜索节点"/);
	assert.match(knowledgeGraphPaneSource, /全部类型/);
	assert.match(knowledgeGraphPaneSource, /community/);
});

test("Office editors keep one runtime per file and avoid competing DOM cleanup", () => {
	const sources = [
		"univer-document-panel.tsx",
		"univer-spreadsheet-panel.tsx",
		"univer-presentation-panel.tsx",
	].map((name) =>
		readFileSync(fileURLToPath(new URL(`./${name}`, import.meta.url)), "utf8"),
	);
	for (const source of sources) {
		assert.match(source, /const paramsRef = useRef\(params\)/);
		assert.match(source, /disposeUniverAfterReactCommit/);
		assert.doesNotMatch(source, /replaceChildren\(/);
	}
	assert.match(sources[2], /UniverDocsCorePreset/);
	assert.match(sources[2], /aria-label="幻灯片文本内容"/);
	assert.match(sources[2], /runtime\.slide\.updatePage/);
	assert.match(sources[2], /runtime\.canvasView\.createObjectToPage/);
	assert.match(
		sources[2],
		/runtime\.canvasView\.activePage\(entry\.pageId, runtime\.slide\.getUnitId\(\)\)/,
	);
	assert.match(sources[2], /installSlidesRenderViewportFallback/);
	assert.match(sources[2], /key=\{`\$\{path\}:\$\{retryCount\}`\}/);
	assert.match(sources[0], /\[markDirty, path, readOnly, retryCount\]/);
	assert.match(sources[1], /\[markDirty, path, readOnly, retryCount\]/);
	assert.match(sources[2], /\[markDirty, path, readOnly, retryCount\]/);
	assert.match(sources[2], /setSelectedTextKey\(entries\[0\]\.key\)/);
	assert.match(sources[0], /univerDocumentSnapshotToPreservedDocxBytes/);
	assert.match(sources[0], /originalBytes: runtimeRef\.current\.originalBytes/);
	assert.match(
		sources[0],
		/baselineSnapshot: runtimeRef\.current\.baselineSnapshot/,
	);
	assert.match(
		sources[0],
		/baselineSnapshot: structuredClone\(document\.getSnapshot\(\)\)/,
	);
	assert.match(sources[1], /univerWorkbookSnapshotToPreservedXlsxBytes/);
	assert.match(sources[1], /originalBytes: runtimeRef\.current\.originalBytes/);
	assert.match(
		sources[1],
		/baselineSnapshot: runtimeRef\.current\.baselineSnapshot/,
	);
	assert.match(
		sources[1],
		/baselineSnapshot: structuredClone\(workbook\.save\(\)\)/,
	);

	const lifecycleSource = readFileSync(
		fileURLToPath(new URL("./univer-runtime-lifecycle.ts", import.meta.url)),
		"utf8",
	);
	assert.match(lifecycleSource, /UNIVER_DISPOSE_GRACE_MS = 400/);
	assert.match(lifecycleSource, /setTimeout\([\s\S]*?UNIVER_DISPOSE_GRACE_MS/);
});

test("DOCX browser conversion does not call the Node Buffer global directly", () => {
	const docxSource = readFileSync(
		fileURLToPath(
			new URL(
				"../../../../../../packages/ooxml/src/docx/index.ts",
				import.meta.url,
			),
		),
		"utf8",
	);
	const docxExportSource = readFileSync(
		fileURLToPath(
			new URL(
				"../../../../../../packages/ooxml/src/docx/univer-to-docx.ts",
				import.meta.url,
			),
		),
		"utf8",
	);
	assert.doesNotMatch(docxSource, /\bBuffer\.from\(/);
	assert.doesNotMatch(docxExportSource, /\bBuffer\.from\(/);
});
