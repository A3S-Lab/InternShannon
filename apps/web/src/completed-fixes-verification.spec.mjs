import * as assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../..", import.meta.url));
const read = (path) => readFileSync(`${root}/${path}`, "utf8");

test("SXA-001 restricts desktop origins and redacts every config response", () => {
  const cors = read("apps/sidecar/src/shared/infrastructure/network/desktop-cors.ts");
  const main = read("apps/sidecar/src/main.ts");
  const gateway = read("apps/sidecar/src/modules/kernel/presentation/gateways/kernel.gateway.ts");
  const redaction = read(
    "apps/sidecar/src/modules/config/presentation/interceptors/config-secret-redaction.interceptor.ts",
  );
  assert.match(cors, /TAURI_ORIGINS/);
  assert.match(cors, /callback\(null, false\)/);
  assert.match(main, /origin: desktopCorsOrigin/);
  assert.match(gateway, /allowRequest: desktopSocketAllowRequest/);
  assert.match(redaction, /return redactSecrets\(body\)/);
  assert.doesNotMatch(redaction, /127\.0\.0\.1|localhost/);
});

test("SXA-002 wraps the lazy mention tree in loading and error boundaries", () => {
  const source = read("apps/web/src/components/tiptap-editor/mention-list.tsx");
  assert.match(source, /const ReadonlyFileTree = lazy/);
  assert.match(source, /<ErrorBoundary/);
  assert.match(source, /<Suspense/);
  assert.match(source, /正在加载文件列表/);
});

test("SXA-003 applies one internal-path visibility rule to tree and search", async () => {
  const { isWorkspaceMentionVisibleName } = await import(
    "./components/tiptap-editor/workspace-mention-visibility.ts"
  );
  for (const name of [".memory", ".sessions", ".internshannon", "traces", "subagent_tasks"]) {
    assert.equal(isWorkspaceMentionVisibleName(name), false, name);
  }
  assert.equal(isWorkspaceMentionVisibleName("用户资料.md"), true);
  assert.match(read("apps/web/src/components/tiptap-editor/mention-list.tsx"), /isWorkspaceMentionVisibleName/);
  assert.match(
    read("apps/web/src/components/workspace/file-tree-editor/readonly-file-tree.tsx"),
    /filterWorkspaceMentionNodes/,
  );
});

test("SXA-004 keeps Agentation opt-in and forces it off in production builds", async () => {
  const { isAgentationEnabled } = await import("./lib/agentation-flag.ts");
  assert.equal(isAgentationEnabled(undefined), false);
  assert.equal(isAgentationEnabled("anything-else"), false);
  assert.equal(isAgentationEnabled("true"), true);
  assert.match(read("apps/web/scripts/build-desktop.mjs"), /PUBLIC_ENABLE_AGENTATION: "false"/);
});

test("SXA-005 treats empty searches as failures and opens both circuit scopes", async () => {
  const { isWebSearchEmptyResult, toolFailureCircuitDecision } = await import(
    "../../sidecar/src/modules/kernel/application/kernel-tool-failure-policy.ts"
  );
  assert.equal(isWebSearchEmptyResult("web_search", "No search results"), true);
  assert.deepEqual(
    toolFailureCircuitDecision({
      toolName: "web_search",
      consecutiveFailures: 2,
      totalFailures: 2,
      sameToolThreshold: 5,
    }),
    { open: true, threshold: 2, scope: "same_tool" },
  );
  assert.equal(
    toolFailureCircuitDecision({
      toolName: "Read",
      consecutiveFailures: 1,
      totalFailures: 4,
      sameToolThreshold: 3,
    }).scope,
    "all_tools",
  );
});

test("SXA-006 defaults content logging to metadata-only redaction", () => {
  const source = read("apps/sidecar/src/modules/kernel/application/kernel-content-logging.ts");
  const intake = read("apps/sidecar/src/modules/kernel/application/kernel-message-run-intake.service.ts");
  assert.match(source, /INTERNSHANNON_DIAGNOSTIC_CONTENT_LOGS/);
  assert.match(source, /\[redacted length=\$\{text\.length\}\]/);
  assert.match(source, /redactSecretValuesInText/);
  assert.match(intake, /kernelContentLogValue\(input\.content/);
});

test("SXA-007 distinguishes idle sessions and excludes them from active totals", async () => {
  const { isSessionSidebarActive, resolveSessionSidebarStatus } = await import(
    "./components/agent-page/agent-session-sidebar-state.ts"
  );
  assert.deepEqual(resolveSessionSidebarStatus({ sessionState: "idle" }), {
    label: "空闲",
    tone: "idle",
  });
  assert.equal(isSessionSidebarActive({ sessionState: "idle" }), false);
  assert.equal(isSessionSidebarActive({ sessionState: "running", connectionStatus: "connected" }), true);
});

test("SXA-008 renders distinct knowledge search lifecycle states", () => {
  const source = [
    read("apps/web/src/desktop/pages/knowledge/KnowledgePage.tsx"),
    read("apps/web/src/desktop/pages/knowledge/components/knowledge-explorer-pane.tsx"),
  ].join("\n");
  assert.match(source, /searchState: "idle" \| "loading" \| "ready" \| "error"/);
  assert.match(source, /搜索中/);
  assert.match(source, /搜索失败/);
  assert.match(source, /未找到结果/);
});

test("SXA-009 parses asset citations and provides a source-opening deep link", async () => {
  const { parseKnowledgeAssetCitation } = await import("./lib/knowledge-citation.ts");
  const citation = parseKnowledgeAssetCitation("asset://bundle-1/notes/来源.md");
  assert.equal(citation?.assetId, "bundle-1");
  assert.equal(citation?.relativePath, "notes/来源.md");
  assert.match(read("apps/web/src/components/agent-page/chat/message-item.tsx"), /KnowledgeCitationCard/);
  assert.match(read("apps/web/src/components/agent-page/chat/message-item.tsx"), /\/knowledge\?source=/);
  assert.match(read("apps/web/src/desktop/pages/knowledge/KnowledgePage.tsx"), /searchParams\.get\("source"\)/);
});

test("SXA-010 exposes ingest progress, failure reason, and per-source recovery", () => {
  const source = [
    read("apps/web/src/desktop/pages/knowledge/KnowledgePage.tsx"),
    read("apps/web/src/desktop/pages/knowledge/components/knowledge-explorer-pane.tsx"),
    read("apps/web/src/desktop/pages/knowledge/components/knowledge-operations-pane.tsx"),
  ].join("\n");
  assert.match(source, /来源重新抽取已启动/);
  assert.match(source, /配置后重试/);
  assert.match(source, /重新抽取此来源/);
  assert.match(source, /activeIngestJob/);
  assert.match(source, /job\.failedReason/);
});

test("SXA-011 localizes and compacts audit rows with result details", () => {
  const source = read("apps/web/src/desktop/pages/knowledge/components/knowledge-operations-pane.tsx");
  assert.match(source, /KNOWLEDGE_AUDIT_LABELS/);
  assert.match(source, /compactAudit/);
  assert.match(source, /durationMs/);
  assert.match(source, /fromTarget/);
  assert.match(source, /metadata\.failedReason/);
});

test("SXA-012 offers retrieval presets and validates advanced values", () => {
  const source = [
    read("apps/web/src/desktop/pages/knowledge/KnowledgePage.tsx"),
    read("apps/web/src/desktop/pages/knowledge/components/knowledge-settings-pane.tsx"),
    read("apps/web/src/desktop/pages/knowledge/knowledge-retrieval-state.ts"),
  ].join("\n");
  assert.match(source, /balanced: \{ label: "平衡（推荐）"/);
  assert.match(source, /precise: \{ label: "精确匹配"/);
  assert.match(source, /recall: \{ label: "高召回"/);
  assert.match(source, /<details/);
  assert.match(source, /min=\{1\}\s+max=\{4096\}/);
  assert.match(source, /embedding\.keywordWeight <= 0 && embedding\.vectorWeight <= 0/);
  assert.match(source, /!embedding\.provider\.trim\(\) \|\| !embedding\.model\.trim\(\)/);
});

test("SXA-013 names MCP and Office controls for assistive technology", () => {
  const mcp = read("apps/web/src/desktop/pages/settings/components/mcp-section.tsx");
  const document = read("apps/web/src/components/workspace/file-tree-editor/univer-document-panel.tsx");
  const sheet = read("apps/web/src/components/workspace/file-tree-editor/univer-spreadsheet-panel.tsx");
  const slides = read("apps/web/src/components/workspace/file-tree-editor/univer-presentation-panel.tsx");
  for (const label of ["MCP 服务名", "MCP 传输方式", "MCP 启动命令", "MCP HTTP 地址"]) {
    assert.ok(mcp.includes(`aria-label=\"${label}\"`), label);
  }
  assert.match(document, /role="application" aria-label="文档编辑器工具栏与正文"/);
  assert.match(sheet, /role="application" aria-label="电子表格编辑器工具栏与工作表"/);
  assert.match(slides, /aria-label="演示文稿编辑器工具栏与画布"/);
});

test("SXA-014 never reports latest when update versions are unavailable", () => {
  const api = read("apps/web/src/desktop/lib/update-api.ts");
  const section = read("apps/web/src/desktop/pages/settings/components/update-section.tsx");
  assert.match(api, /throw new Error\(desktopOnlyMessage\("检查更新"\)\)/);
  assert.match(section, /!info\?\.currentVersion\?\.trim\(\) \|\| !info\.latestVersion\?\.trim\(\)/);
  assert.match(section, /state\.info\?\.currentVersion\?\.trim\(\) && state\.info\.latestVersion\?\.trim\(\)/);
});

test("SXA-015 declares and enforces a Node runtime capable of TS specs", () => {
  const pkg = JSON.parse(read("package.json"));
  assert.equal(pkg.engines.node, ">=22.18.0");
  assert.match(read(".nvmrc"), /^22\./);
  assert.match(read("apps/web/scripts/desktop-state-tests.mjs"), /Node >=22\.18 is required/);
});

test("SXA-016 uses named Nest wildcard routes", () => {
  const source = read("apps/sidecar/src/main.ts");
  assert.match(source, /git\/\*path/);
  assert.match(source, /v1\/\*path/);
  assert.match(source, /v2\/\*path/);
  assert.doesNotMatch(source, /path: 'git\/\*'/);
  assert.doesNotMatch(source, /path: 'v[12]\/\*'/);
});

test("SXA-017 localizes common tool failures and retains diagnostics", async () => {
  const { normalizeToolErrorActivity } = await import("./kernel/session/tool-error-activity.ts");
  const event = normalizeToolErrorActivity(
    { toolName: "web_search", reason: "browser binary missing" },
    { timestamp: 1 },
  );
  assert.match(event.detail ?? "", /搜索浏览器不可用/);
  assert.equal(event.diagnosticDetail, "browser binary missing");
});

test("SXA-018 describes known and runtime-provided slash commands", async () => {
  const { resolveAgentSlashCommandSuggestions } = await import(
    "./components/agent-page/chat/agent-slash-command-state.ts"
  );
  const suggestions = resolveAgentSlashCommandSuggestions(["history", "mcp", "tools", "skills", "status", "x-extra"]);
  const byName = new Map(suggestions.map((item) => [item.name, item.description]));
  assert.match(byName.get("history") ?? "", /消息历史/);
  assert.match(byName.get("mcp") ?? "", /MCP/);
  assert.match(byName.get("tools") ?? "", /工具/);
  assert.equal(byName.get("x-extra"), "由当前内核提供的扩展命令");
});

test("SXA-019 gives Sidecar a decorator-aware zero-error lint baseline", () => {
  const biome = JSON.parse(read("apps/sidecar/biome.json"));
  const pkg = JSON.parse(read("apps/sidecar/package.json"));
  assert.equal(biome.root, true);
  assert.equal(biome.javascript?.parser?.unsafeParameterDecoratorsEnabled, true);
  assert.match(pkg.scripts?.["lint:check"] ?? "", /biome lint src scripts test/);
  assert.doesNotMatch(pkg.scripts?.["lint:check"] ?? "", /sql:check/);
});

test("SXA-020 splits heavy desktop editors and enforces production bundle budgets", async () => {
  const config = read("apps/web/rsbuild.desktop.config.ts");
  const build = read("apps/web/scripts/build-desktop.mjs");
  const { DESKTOP_BUNDLE_BUDGETS, evaluateDesktopBundle } = await import(
    "../scripts/check-desktop-bundle-size.mjs"
  );
  assert.match(config, /"lib-office-univer"/);
  assert.match(config, /"lib-editor-monaco"/);
  assert.match(config, /"lib-visualization"/);
  assert.match(config, /chunks: "async"/);
  assert.match(build, /check-desktop-bundle-size\.mjs/);
  const report = evaluateDesktopBundle({
    files: [{ relativePath: "static/js/index.js", bytes: 1024 }],
    initialJavaScriptPaths: ["static/js/index.js"],
  });
  assert.deepEqual(report.failures, []);
  assert.equal(DESKTOP_BUNDLE_BUDGETS.maxJavaScriptChunkBytes, 4 * 1024 * 1024);
});

test("SXA-021 blocks unpinned search browsers and stages a checksum-verified desktop runtime", async () => {
  const {
    __resetBrowserBinaryStatusForTests,
    verifyBrowserBinary,
    webSearchBrowserBlockReason,
  } = await import("../../sidecar/src/modules/kernel/application/kernel-browser-binary-check.ts");
  __resetBrowserBinaryStatusForTests();
  const status = verifyBrowserBinary({}, () => false);
  assert.equal(status.available, false);
  assert.equal(status.reasonCode, "no_pin");
  assert.match(webSearchBrowserBlockReason({ toolName: "web_search" }, status) ?? "", /设置 → 搜索引擎/);

  const stage = read("apps/desktop/scripts/stage-search-browser-resource.mjs");
  const tauri = JSON.parse(read("apps/desktop/src-tauri/tauri.conf.json"));
  const rust = read("apps/desktop/src-tauri/src/lib.rs");
  const server = read("apps/desktop/src-tauri/src/server.rs");
  assert.match(stage, /assertBrowserChecksum\(bytes, entry\.sha256\)/);
  assert.match(stage, /process\.argv\.includes\("--download"\)/);
  assert.match(stage, /AbortSignal\.timeout\(30_000\)/);
  assert.match(stage, /skipped network download during build/);
  assert.equal(tauri.bundle.resources["resources/search-browser/"], "search-browser/");
  assert.match(rust, /verify_lightpanda_file/);
  assert.match(rust, /Downloaded Lightpanda failed the pinned SHA-256 check/);
  assert.match(rust, /Microsoft Edge\.app\/Contents\/MacOS\/Microsoft Edge/);
  assert.match(server, /command\.env\(runtime\.env_name, &runtime\.path\)/);
});

test("SXA-022 separates the WebView, API, and plugin sandbox CSP boundaries", async () => {
  const { DEFAULT_CDN_ALLOWLIST, composeSandboxDocument } = await import(
    "./runtime/agent-ui/sandbox-bridge.ts"
  );
  const sidecarCsp = read("apps/sidecar/src/shared/infrastructure/network/desktop-csp.ts");
  const sidecarBuild = JSON.parse(read("apps/sidecar/tsconfig.build.json"));
  const settings = read("apps/sidecar/src/modules/config/domain/services/settings-schema.ts");
  const tauri = JSON.parse(read("apps/desktop/src-tauri/tauri.conf.json"));
  assert.deepEqual(DEFAULT_CDN_ALLOWLIST, []);
  assert.doesNotMatch(settings, /https:\/\/unpkg\.com/);
  assert.match(settings, /不依赖公网 CDN/);
  assert.doesNotMatch(sidecarCsp, /unsafe-inline|unsafe-eval/);
  assert.ok(sidecarBuild.include.includes("src/shared/infrastructure/network/desktop-csp.ts"));
  assert.match(tauri.app.security.csp, /script-src 'self'/);
  assert.doesNotMatch(tauri.app.security.csp, /unsafe-eval/);
  const sandbox = composeSandboxDocument("<script>document.body.dataset.ready='1'</script>");
  assert.match(sandbox, /connect-src 'none'/);
  assert.doesNotMatch(sandbox, /https:\/\/unpkg\.com|cdn\.jsdelivr\.net|esm\.sh/);
});
