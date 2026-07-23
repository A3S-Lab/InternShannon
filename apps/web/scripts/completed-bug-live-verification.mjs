#!/usr/bin/env node

import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { io } from "socket.io-client";
import {
  DESKTOP_BUNDLE_BUDGETS,
  evaluateDesktopBundle,
  formatMiB,
  readDesktopBundle,
} from "./check-desktop-bundle-size.mjs";

const projectRoot = fileURLToPath(new URL("../../..", import.meta.url));
const gatewayUrl = (process.env.DESKTOP_GATEWAY_URL || "http://127.0.0.1:29653").replace(/\/+$/, "");
const webUrl = (process.env.DESKTOP_WEB_URL || "http://127.0.0.1:5001").replace(/\/+$/, "");
const sidecarLogPath = process.env.SIDECAR_LOG_PATH || "";
const apiBase = `${gatewayUrl}/api/v1`;
const bugIds = Array.from({ length: 22 }, (_, index) => `SXA-${String(index + 1).padStart(3, "0")}`);
const results = [];

function record(id, layer, scenario, status, detail) {
  const row = { id, layer, scenario, status, detail };
  results.push(row);
  console.log(`[completed-bug-live] ${id} ${layer}/${scenario} ${status}: ${detail}`);
}

async function request(path, init = {}) {
  const response = await fetch(`${apiBase}${path}`, init);
  const text = await response.text();
  let parsed = null;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = text;
    }
  }
  return { response, parsed, data: parsed && typeof parsed === "object" && "data" in parsed ? parsed.data : parsed };
}

async function createSession(id) {
  const { response, data } = await request("/kernel/sessions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: "tauri://localhost" },
    body: JSON.stringify({ title: `${id} live verification`, agentId: "default" }),
  });
  assert.equal(response.status, 201);
  const sessionId = data?.session?.sessionId;
  assert.ok(sessionId, `${id} create session did not return sessionId`);
  return sessionId;
}

async function deleteSession(sessionId) {
  await request(`/kernel/sessions/${encodeURIComponent(sessionId)}`, {
    method: "DELETE",
    headers: { Origin: "tauri://localhost" },
  });
}

function openSocket(origin = "tauri://localhost") {
  return io(`${gatewayUrl}/ws/kernel`, {
    transports: ["websocket"],
    extraHeaders: { Origin: origin },
    timeout: 2500,
    reconnection: false,
    forceNew: true,
  });
}

function waitForSocket(socket, eventName, predicate = () => true, timeoutMs = 3000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`${eventName} timed out`));
    }, timeoutMs);
    const handler = (payload) => {
      if (!predicate(payload)) return;
      cleanup();
      resolve(payload);
    };
    const cleanup = () => {
      clearTimeout(timer);
      socket.off(eventName, handler);
    };
    socket.on(eventName, handler);
  });
}

async function connectTrusted() {
  const socket = openSocket();
  await waitForSocket(socket, "connect", () => true);
  return socket;
}

async function scenarioSubscribeSnapshot(id, sessionId) {
  const socket = await connectTrusted();
  try {
    const subscribed = waitForSocket(socket, "subscribed", (payload) => payload?.sessionId === sessionId);
    const initialized = waitForSocket(socket, "message", (message) => message?.type === "session_init");
    const connected = waitForSocket(socket, "message", (message) => message?.type === "cli_connected");
    socket.emit("subscribe", { sessionId });
    await Promise.all([subscribed, initialized, connected]);
    record(id, "websocket", "A-可信订阅与快照", "PASS", "connected → subscribed → session_init → cli_connected");
  } finally {
    socket.close();
  }
}

async function scenarioStateRoundTrip(id, sessionId) {
  const socket = await connectTrusted();
  try {
    const subscribed = waitForSocket(socket, "subscribed", (payload) => payload?.sessionId === sessionId);
    socket.emit("subscribe", { sessionId });
    await subscribed;

    const permissionUpdate = waitForSocket(
      socket,
      "message",
      (message) => message?.type === "session_update" && message?.session?.permissionMode === "plan",
    );
    socket.emit("message", { sessionId, type: "set_permissionMode", mode: "plan" });
    await permissionUpdate;

    const executeUpdate = waitForSocket(
      socket,
      "message",
      (message) => message?.type === "session_update" && message?.session?.autoExecute === true,
    );
    socket.emit("message", { sessionId, type: "set_autoExecute", enabled: true });
    await executeUpdate;

    const cancelled = waitForSocket(socket, "message", (message) => message?.type === "cancelled");
    socket.emit("message", { sessionId, type: "cancel" });
    await cancelled;
    record(id, "websocket", "B-状态更新与取消", "PASS", "permissionMode → autoExecute → cancelled 均经房间广播返回");
  } finally {
    socket.close();
  }
}

async function scenarioSecurityAndRecovery(id, sessionId) {
  const attacker = openSocket("https://attacker.example");
  try {
    const outcome = await Promise.race([
      waitForSocket(attacker, "connect", () => true).then(() => "connected"),
      waitForSocket(attacker, "connect_error", () => true).then(() => "rejected"),
    ]);
    assert.equal(outcome, "rejected");
  } finally {
    attacker.close();
  }

  const socket = await connectTrusted();
  try {
    const denied = waitForSocket(
      socket,
      "message",
      (message) => message?.type === "error" && /not found|access denied/i.test(String(message.message)),
    );
    socket.emit("subscribe", { sessionId: `${sessionId}-missing` });
    await denied;

    const subscribed = waitForSocket(socket, "subscribed", (payload) => payload?.sessionId === sessionId);
    socket.emit("subscribe", { sessionId });
    await subscribed;
    record(id, "websocket", "C-恶意来源与错误恢复", "PASS", "攻击 Origin 被拒；无效会话报错后同一客户端可订阅有效会话");
  } finally {
    socket.close();
  }
}

function collectJsFiles(path, output = []) {
  for (const entry of readdirSync(path)) {
    const target = `${path}/${entry}`;
    const stats = statSync(target);
    if (stats.isDirectory()) collectJsFiles(target, output);
    else if (entry.endsWith(".js")) output.push(target);
  }
  return output;
}

let bundleTextCache;
function productionBundleText() {
  if (bundleTextCache === undefined) {
    const base = `${projectRoot}/apps/web/dist/workspace/static/js`;
    bundleTextCache = collectJsFiles(base).map((file) => readFileSync(file, "utf8")).join("\n");
  }
  return bundleTextCache;
}

async function expectWebShell(path) {
  const response = await fetch(`${webUrl}${path}`);
  const html = await response.text();
  assert.equal(response.status, 200);
  assert.match(html, /<title>书小安<\/title>/);
  assert.match(html, /id="root"/);
}

function assertSecretsMasked(value) {
  let found = 0;
  let unsafe = 0;
  const visit = (current) => {
    if (!current || typeof current !== "object") return;
    for (const [key, child] of Object.entries(current)) {
      if (/(api.?key|secret|token|password|credential)/i.test(key) && typeof child === "string" && child) {
        found += 1;
        if (!["[configured]", "[redacted]", "********"].includes(child)) unsafe += 1;
      }
      visit(child);
    }
  };
  visit(value);
  assert.ok(found >= 1, "expected at least one populated secret field");
  assert.equal(unsafe, 0, "response contained an unmasked secret field");
}

async function runProbe(id, sessionId) {
  switch (id) {
    case "SXA-001": {
      const trusted = await fetch(`${apiBase}/config`, { headers: { Origin: "tauri://localhost" } });
      const attacker = await fetch(`${apiBase}/config`, { headers: { Origin: "https://attacker.example" } });
      assert.equal(trusted.status, 200);
      assert.equal(trusted.headers.get("access-control-allow-origin"), "tauri://localhost");
      assert.equal(attacker.headers.get("access-control-allow-origin"), null);
      assertSecretsMasked(await trusted.json());
      assertSecretsMasked(await attacker.json());
      break;
    }
    case "SXA-002":
      assert.match(productionBundleText(), /正在加载文件列表/);
      assert.match(productionBundleText(), /无法加载文件列表/);
      break;
    case "SXA-003":
      assert.match(productionBundleText(), /subagent_tasks/);
      assert.match(productionBundleText(), /\.internshannon/);
      break;
    case "SXA-004":
      assert.doesNotMatch(productionBundleText(), /Block page interactions|agentation\.com|Agentation/);
      break;
    case "SXA-005": {
      const health = await request("/health");
      assert.equal(health.data?.status, "ok");
      const search = await request("/config/categories/search");
      assert.ok(Array.isArray(search.data?.enabledEngines));
      break;
    }
    case "SXA-006": {
      assert.ok(sidecarLogPath, "SIDECAR_LOG_PATH is required for log probe");
      const marker = `SXA006_PRIVATE_${Date.now()}`;
      const socket = await connectTrusted();
      try {
        const subscribed = waitForSocket(socket, "subscribed", (payload) => payload?.sessionId === sessionId);
        socket.emit("subscribe", { sessionId });
        await subscribed;
        const intake = waitForSocket(
          socket,
          "message",
          (message) => message?.type === "stream_event" && message?.event?.phase === "intake",
          5000,
        );
        socket.emit("message", { sessionId, type: "user_message", content: marker });
        await intake;
        await new Promise((resolve) => setTimeout(resolve, 120));
      } finally {
        socket.close();
      }
      const logs = readFileSync(sidecarLogPath, "utf8");
      assert.doesNotMatch(logs, new RegExp(marker));
      assert.match(logs, /content=\[redacted length=/);
      break;
    }
    case "SXA-007": {
      const detail = await request(`/kernel/sessions/${encodeURIComponent(sessionId)}`);
      assert.ok(detail.data?.sessionId === sessionId || detail.data?.id === sessionId);
      break;
    }
    case "SXA-008":
      await expectWebShell("/knowledge");
      assert.match(productionBundleText(), /搜索中/);
      assert.match(productionBundleText(), /未找到结果/);
      break;
    case "SXA-009":
      await expectWebShell("/knowledge?source=asset%3A%2F%2Fprobe%2Fnotes%2Fsource.md");
      assert.match(productionBundleText(), /打开知识来源/);
      break;
    case "SXA-010":
      await expectWebShell("/knowledge");
      assert.match(productionBundleText(), /来源重新抽取已启动/);
      break;
    case "SXA-011":
      assert.match(productionBundleText(), /最近审计/);
      assert.match(productionBundleText(), /重命名页面/);
      break;
    case "SXA-012":
      assert.match(productionBundleText(), /平衡（推荐）/);
      assert.match(productionBundleText(), /高召回/);
      break;
    case "SXA-013":
      await expectWebShell("/settings");
      assert.match(productionBundleText(), /MCP 服务名/);
      assert.match(productionBundleText(), /电子表格编辑器工具栏与工作表/);
      break;
    case "SXA-014":
      await expectWebShell("/settings");
      assert.match(productionBundleText(), /当前已是最新版本/);
      assert.match(productionBundleText(), /检查更新/);
      break;
    case "SXA-015":
      assert.ok(Number(process.versions.node.split(".")[0]) >= 22);
      assert.equal((await request("/health")).response.status, 200);
      break;
    case "SXA-016": {
      const openapi = await fetch(`${gatewayUrl}/openapi.json`).then((response) => response.json());
      assert.ok(openapi.paths["/api/v1/health"]);
      assert.ok(openapi.paths["/api/v1/config"]);
      break;
    }
    case "SXA-017":
      assert.match(productionBundleText(), /工具执行失败，请展开查看诊断详情/);
      assert.match(productionBundleText(), /搜索浏览器不可用/);
      break;
    case "SXA-018":
      assert.match(productionBundleText(), /查看当前会话的消息历史与最近操作/);
      assert.match(productionBundleText(), /由当前内核提供的扩展命令/);
      break;
    case "SXA-019": {
      const biome = JSON.parse(readFileSync(`${projectRoot}/apps/sidecar/biome.json`, "utf8"));
      const pkg = JSON.parse(readFileSync(`${projectRoot}/apps/sidecar/package.json`, "utf8"));
      assert.equal(biome.javascript?.parser?.unsafeParameterDecoratorsEnabled, true);
      assert.match(pkg.scripts?.["lint:check"] ?? "", /biome lint src scripts test/);
      break;
    }
    case "SXA-020": {
      const report = evaluateDesktopBundle(
        readDesktopBundle(`${projectRoot}/apps/web/dist/workspace`),
        DESKTOP_BUNDLE_BUDGETS,
      );
      assert.deepEqual(report.failures, []);
      assert.ok(report.javascriptChunkCount > 1);
      record(
        id,
        "probe-evidence",
        "生产包体积",
        "PASS",
        `largest=${formatMiB(report.largestJavaScriptChunkBytes)} initial=${formatMiB(report.initialJavaScriptBytes)} total=${formatMiB(report.totalJavaScriptBytes)}`,
      );
      break;
    }
    case "SXA-021": {
      assert.ok(sidecarLogPath, "SIDECAR_LOG_PATH is required for browser readiness probe");
      const expectedBinary = process.env.LIGHTPANDA || process.env.CHROME;
      assert.ok(expectedBinary, "live Sidecar must start with a pinned LIGHTPANDA or CHROME path");
      assert.equal(statSync(expectedBinary).isFile(), true);
      const compiled = [
        readFileSync(
          `${projectRoot}/apps/sidecar/dist/modules/kernel/application/kernel-session-runtime-factory.service.js`,
          "utf8",
        ),
        readFileSync(
          `${projectRoot}/apps/sidecar/dist/modules/kernel/application/kernel-browser-binary-check.js`,
          "utf8",
        ),
      ].join("\n");
      assert.match(compiled, /web-search-browser-readiness/);
      assert.match(compiled, /web_search 当前不可用/);
      const logs = readFileSync(sidecarLogPath, "utf8");
      assert.doesNotMatch(logs, /启动时未固定 LIGHTPANDA 或 CHROME/);
      break;
    }
    case "SXA-022": {
      const health = await fetch(`${apiBase}/health`, { headers: { Origin: "tauri://localhost" } });
      assert.equal(health.status, 200);
      const csp = health.headers.get("content-security-policy") ?? "";
      assert.match(csp, /default-src 'none'/);
      assert.match(csp, /script-src 'none'/);
      assert.doesNotMatch(csp, /unsafe-inline|unsafe-eval/);
      const platform = await request("/config/categories/platform");
      assert.doesNotMatch(JSON.stringify(platform.data), /https:\/\/unpkg\.com|cdn\.jsdelivr\.net|esm\.sh/);
      const tauri = JSON.parse(readFileSync(`${projectRoot}/apps/desktop/src-tauri/tauri.conf.json`, "utf8"));
      assert.match(tauri.app.security.csp, /script-src 'self'/);
      assert.doesNotMatch(tauri.app.security.csp, /unsafe-eval/);
      break;
    }
    default:
      throw new Error(`missing probe for ${id}`);
  }
  record(id, "probe", "运行态/部署产物", "PASS", "编号专属断言通过");
}

async function seedMaskedSecret() {
  const response = await request("/config/categories/oauth", {
    method: "PUT",
    headers: { "Content-Type": "application/json", Origin: "tauri://localhost" },
    body: JSON.stringify({
      github: {
        enabled: false,
        clientId: "verification-client",
        clientSecret: "verification-secret-must-not-leak",
        callbackUrl: `${gatewayUrl}/verification/callback`,
        scopes: [],
      },
    }),
  });
  assert.equal(response.response.status, 200);
}

async function main() {
  assert.equal((await request("/health")).response.status, 200, "sidecar health probe failed");
  await expectWebShell("/");
  await seedMaskedSecret();

  for (const id of bugIds) {
    const sessionId = await createSession(id);
    try {
      await runProbe(id, sessionId);
      await scenarioSubscribeSnapshot(id, sessionId);
      await scenarioStateRoundTrip(id, sessionId);
      await scenarioSecurityAndRecovery(id, sessionId);
    } catch (error) {
      record(id, "verification", "failure", "FAIL", error instanceof Error ? error.message : String(error));
      throw error;
    } finally {
      await deleteSession(sessionId);
    }
  }

  const passedProbes = results.filter((row) => row.layer === "probe" && row.status === "PASS").length;
  const passedSockets = results.filter((row) => row.layer === "websocket" && row.status === "PASS").length;
  assert.equal(passedProbes, bugIds.length);
  assert.equal(passedSockets, bugIds.length * 3);
  console.log(
    `[completed-bug-live] SUMMARY probes=${passedProbes}/${bugIds.length} ` +
      `websocket=${passedSockets}/${bugIds.length * 3} status=PASS`,
  );
}

main().catch((error) => {
  console.error(`[completed-bug-live] FAILED ${error instanceof Error ? error.stack : String(error)}`);
  process.exitCode = 1;
});
