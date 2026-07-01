import { readFileSync, readdirSync, statSync } from "node:fs";
import os from "node:os";
import { pathToFileURL } from "node:url";
import { io } from "socket.io-client";

const configuredGatewayUrl = process.env.PUBLIC_DESKTOP_GATEWAY_URL || process.env.DESKTOP_GATEWAY_URL;
const configuredWebUrl = process.env.PUBLIC_DESKTOP_URL || process.env.DESKTOP_WEB_URL;
const sessionTitle = `Desktop smoke ${new Date().toISOString()}`;
const USER_MESSAGE_OUTCOME_TIMEOUT_MS = positiveIntegerFromEnv("DESKTOP_SMOKE_USER_MESSAGE_TIMEOUT_MS", 45_000);
const FORBIDDEN_HITL_LOG_PATTERNS = [
  /confirmation_timeout/i,
  /confirmation_not_found/i,
  /confirmation_required event missing toolId/i,
  /Tool '' execution was REJECTED/i,
  /user confirmation timed out/i,
];

let gatewayUrl = "http://127.0.0.1:29653";
let apiBase = `${gatewayUrl}/api/v1`;
let createdSessionId = null;

async function main() {
  gatewayUrl = await resolveGatewayUrl();
  apiBase = `${gatewayUrl}/api/v1`;
  const webUrl = await resolveWebUrl();
  log(`gateway=${gatewayUrl}`);
  log(`web=${webUrl}`);

  await expectOk("web root", webUrl, { method: "HEAD" });
  const webAssets = await expectWebShell(webUrl);
  await expectDesktopEntryBundle(webAssets);
  await expectDesktopDeepLinkShells(webUrl);
  await expectData("health", `${apiBase}/health`, (data) => data?.status === "ok");
  await expectData("agents", `${apiBase}/open/kernel/agents?limit=1`, (data) => Array.isArray(data) && data.length > 0);
  await expectData(
    "default agent metadata",
    `${apiBase}/open/kernel/agents?keyword=${encodeURIComponent("书小安")}&limit=1`,
    (data) => Array.isArray(data) && data[0]?.id === "default" && data[0]?.name === "书小安",
  );
  const workspace = await expectWorkspacePrerequisites();
  await expectSettingsPrerequisites();
  await expectSkillsWorkspaceRoundTrip(workspace.skillRoots[0]);

  const created = await requestJson("create session", `${apiBase}/kernel/sessions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title: sessionTitle, agentId: "default" }),
  });
  createdSessionId = created?.session?.sessionId;
  assert(createdSessionId, "create session did not return session.sessionId");
  log(`created session=${createdSessionId}`);

  await expectData(
    "session detail",
    `${apiBase}/kernel/sessions/${encodeURIComponent(createdSessionId)}`,
    (data) => data?.sessionId === createdSessionId || data?.id === createdSessionId,
  );
  await expectData(
    "session list",
    `${apiBase}/kernel/sessions?conversational=true&page=1&limit=20`,
    (data) =>
      Array.isArray(data?.items) &&
      data.items.some((item) => item.sessionId === createdSessionId || item.id === createdSessionId),
  );

  await expectSocketMessaging(createdSessionId);

  log("desktop smoke passed");
}

async function expectSocketMessaging(sessionId) {
  const socketUrl = `${gatewayUrl}/ws/kernel`;
  const socket = io(socketUrl, { transports: ["websocket"], timeout: 5000 });
  const events = [];
  const sidecarLogCursor = captureSidecarLogCursor();

  socket.on("connect", () => {
    events.push({ type: "connect", id: socket.id });
    socket.emit("subscribe", { sessionId });
  });
  socket.on("subscribed", (message) => events.push({ type: "subscribed", message }));
  socket.on("message", (message) => events.push({ type: "message", message }));
  socket.on("tool_confirmation_request", (request) => {
    events.push({ type: "tool_confirmation_request", request });
    try {
      respondToSmokeToolConfirmation(socket, sessionId, request);
    } catch (error) {
      events.push({ type: "tool_confirmation_response_error", message: formatError(error) });
    }
  });
  socket.on("connect_error", (error) => events.push({ type: "connect_error", message: error.message }));

  try {
    await waitForEvent(events, (event) => event.type === "subscribed", "socket subscribed");
    socket.emit("message", { sessionId, type: "session_status" });
    await waitForEvent(
      events,
      (event) => event.type === "message" && event.message?.type === "session_status",
      "socket session_status",
    );

    const content = `desktop smoke user message ${Date.now()}`;
    await runSocketUserMessage(socket, events, sessionId, content, "user_message");
    log("user message outcome ok");
    await expectSessionSnapshotRun(sessionId, content);
    await expectSocketMessageHistoryReplay(sessionId, content);

    await expectReadOnlyQueryNoHitl(socket, events, sessionId, sidecarLogCursor);
    await expectWriteHitlResolves(socket, events, sessionId, sidecarLogCursor);
    assertNoForbiddenHitlFailure(
      "socket messaging",
      events,
      readSidecarLogSince(sidecarLogCursor),
      sessionId,
    );

    socket.emit("message", { sessionId, type: "cancel" });
    await waitForEvent(
      events,
      (event) => event.type === "message" && event.message?.type === "cancelled",
      "socket cancel",
    );
    socket.emit("message", { sessionId, type: "clear_session" });
    await waitForEvent(
      events,
      (event) =>
        event.type === "message" && event.message?.type === "command_response" && event.message?.command === "/clear",
      "socket clear_session",
    );
  } finally {
    socket.close();
  }

  assert(
    events.some((event) => event.type === "subscribed"),
    `socket subscribe failed: ${JSON.stringify(events)}`,
  );
  assert(
    events.some((event) => event.type === "message" && event.message?.type === "session_status"),
    `socket session_status failed: ${JSON.stringify(events)}`,
  );
  assert(
    events.some((event) => event.type === "message" && event.message?.type === "cancelled"),
    `socket cancel failed: ${JSON.stringify(events)}`,
  );
  assert(
    events.some(
      (event) =>
        event.type === "message" && event.message?.type === "command_response" && event.message?.command === "/clear",
    ),
    `socket clear_session failed: ${JSON.stringify(events)}`,
  );
  log("socket messaging ok");
}

async function runSocketUserMessage(socket, events, sessionId, content, label) {
  const runStartIndex = events.length;
  socket.emit("message", { sessionId, type: "user_message", content });
  await waitForEvent(
    events,
    (event) =>
      event.type === "message" &&
      event.message?.type === "stream_event" &&
      event.message?.event?.type === "main_agent_activity" &&
      event.message?.event?.phase === "intake",
    `${label} intake activity`,
    { timeoutMs: 8000, startIndex: runStartIndex },
  );
  log(`${label} intake ok`);

  try {
    await waitForEvent(
      events,
      (event) => event.type === "message" && isSocketRunOutcomeMessage(event.message),
      `${label} assistant/result outcome`,
      { timeoutMs: USER_MESSAGE_OUTCOME_TIMEOUT_MS, startIndex: runStartIndex },
    );
  } catch (error) {
    socket.emit("message", { sessionId, type: "cancel" });
    await waitForEvent(
      events,
      (event) => event.type === "message" && event.message?.type === "cancelled",
      `socket cancel after missing ${label} outcome`,
    ).catch(() => null);
    throw error;
  }

  const runEvents = events.slice(runStartIndex);
  assertSocketRunOutcome(label, runEvents);
  return runEvents;
}

async function expectReadOnlyQueryNoHitl(socket, events, sessionId, sidecarLogCursor) {
  const content = "请只查看当前工作目录并用一句话总结，不要写入或修改任何文件。";
  const runEvents = await runSocketUserMessage(socket, events, sessionId, content, "read-only-query-no-hitl");
  const confirmationRequests = findToolConfirmationRequests(runEvents);

  assert(
    confirmationRequests.length === 0,
    [
      "read-only-query-no-hitl received tool_confirmation_request; query-lane read-only tools should not enter HITL.",
      buildHitlSmokeDiagnostics("read-only-query-no-hitl", sessionId, runEvents, readSidecarLogSince(sidecarLogCursor)),
    ].join("\n"),
  );
  assertNoForbiddenHitlFailure(
    "read-only-query-no-hitl",
    runEvents,
    readSidecarLogSince(sidecarLogCursor),
    sessionId,
  );
  log("read-only-query-no-hitl ok");
}

async function expectWriteHitlResolves(socket, events, sessionId, sidecarLogCursor) {
  const filename = `hitl-smoke-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.txt`;
  const content = `请在当前工作目录创建一个很小的文件 ${filename}，内容为 HITL smoke test。`;
  const runEvents = await runSocketUserMessage(socket, events, sessionId, content, "write-hitl-resolves");
  const confirmationRequests = findToolConfirmationRequests(runEvents);

  assert(
    confirmationRequests.length > 0,
    [
      "write-hitl-resolves did not receive tool_confirmation_request; this smoke must exercise the real HITL path.",
      buildHitlSmokeDiagnostics("write-hitl-resolves", sessionId, runEvents, readSidecarLogSince(sidecarLogCursor)),
    ].join("\n"),
  );
  assertNoForbiddenHitlFailure(
    "write-hitl-resolves",
    runEvents,
    readSidecarLogSince(sidecarLogCursor),
    sessionId,
  );
  log(`write-hitl-resolves ok (${confirmationRequests.length} confirmation request(s))`);
}

function findToolConfirmationRequests(events) {
  return events.filter((event) => event?.type === "tool_confirmation_request");
}

function respondToSmokeToolConfirmation(socket, sessionId, request) {
  const response = buildSmokeToolConfirmationResponse(sessionId, request);
  socket.emit("tool_confirmation_response", response);
  log(`auto-approved smoke tool confirmation (${response.toolName})`);
  return response;
}

export function buildSmokeToolConfirmationResponse(sessionId, request) {
  const requestId = typeof request?.requestId === "string" ? request.requestId : "";
  const requestSessionId = typeof request?.sessionId === "string" ? request.sessionId : "";
  const toolName = typeof request?.toolName === "string" ? request.toolName : "";
  assert(requestId.trim().length > 0, `tool_confirmation_request missing requestId: ${formatSmokeJson(request, 500)}`);
  assert(
    requestSessionId.trim().length > 0,
    `tool_confirmation_request missing sessionId: ${formatSmokeJson(request, 500)}`,
  );
  assert(
    requestSessionId === sessionId,
    `tool_confirmation_request session mismatch: expected ${sessionId}, got ${requestSessionId}`,
  );
  assert(toolName.trim().length > 0, `tool_confirmation_request missing toolName: ${formatSmokeJson(request, 500)}`);

  return {
    requestId,
    approved: true,
    scope: "session",
    toolName,
  };
}

export function assertNoForbiddenHitlFailure(label, events, sidecarLogText = "", sessionId = "unknown") {
  const violations = collectForbiddenHitlDiagnostics(events, sidecarLogText);
  assert(
    violations.length === 0,
    [
      `${label} saw forbidden HITL failure diagnostics: ${violations.join(", ")}`,
      buildHitlSmokeDiagnostics(label, sessionId, events, sidecarLogText),
    ].join("\n"),
  );
}

export function collectForbiddenHitlDiagnostics(events, sidecarLogText = "") {
  const violations = [];
  const eventText = formatSmokeJson(events, 20_000);
  for (const pattern of FORBIDDEN_HITL_LOG_PATTERNS) {
    if (pattern.test(eventText) || pattern.test(sidecarLogText)) {
      violations.push(pattern.source);
    }
  }
  return violations;
}

export function buildHitlSmokeDiagnostics(label, sessionId, events, sidecarLogText = "") {
  const recentEvents = events.slice(-20);
  const confirmationEvents = events.filter((event) => event?.type === "tool_confirmation_request").slice(-10);
  const forbiddenLogLines = sidecarLogText
    .split(/\r?\n/)
    .filter((line) => FORBIDDEN_HITL_LOG_PATTERNS.some((pattern) => pattern.test(line)))
    .slice(-20);

  return [
    `[${label}] sessionId=${sessionId}`,
    `recent events=${formatSmokeJson(recentEvents, 4000)}`,
    `tool confirmation events=${formatSmokeJson(confirmationEvents, 4000)}`,
    forbiddenLogLines.length > 0 ? `sidecar forbidden log lines=${forbiddenLogLines.join("\n")}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

async function expectSessionSnapshotRun(sessionId, userContent) {
  const snapshot = await requestJson(
    "session snapshot replay",
    `${apiBase}/kernel/sessions/${encodeURIComponent(sessionId)}/snapshot`,
  );
  assertSessionSnapshotContainsRun("session snapshot replay", snapshot, userContent);
  log("session snapshot replay ok");
}

async function expectSocketMessageHistoryReplay(sessionId, userContent) {
  const socketUrl = `${gatewayUrl}/ws/kernel`;
  const socket = io(socketUrl, { transports: ["websocket"], timeout: 5000 });
  const events = [];

  socket.on("connect", () => {
    events.push({ type: "connect", id: socket.id });
    socket.emit("subscribe", { sessionId });
  });
  socket.on("subscribed", (message) => events.push({ type: "subscribed", message }));
  socket.on("message", (message) => events.push({ type: "message", message }));
  socket.on("connect_error", (error) => events.push({ type: "connect_error", message: error.message }));

  try {
    await waitForEvent(events, (event) => event.type === "subscribed", "socket replay subscribed");
    const history = await waitForEvent(
      events,
      (event) => event.type === "message" && event.message?.type === "message_history",
      "socket message_history replay",
      { timeoutMs: 8000 },
    );
    assertSocketMessageHistoryContainsRun("socket message_history replay", history.message, userContent);
    log("socket message_history replay ok");
  } finally {
    socket.close();
  }
}

export function isSocketRunOutcomeMessage(message) {
  if (!message || typeof message !== "object") return false;
  return message.type === "assistant" || message.type === "result";
}

export function assertSessionSnapshotContainsRun(label, snapshot, userContent) {
  const messages = Array.isArray(snapshot?.messages) ? snapshot.messages : [];
  const userIndex = messages.findIndex(
    (message) => message?.type === "user_message" && message.content === userContent,
  );
  assert(userIndex >= 0, `${label} missing smoke user message: ${formatSmokeJson(snapshot, 1000)}`);

  const assistant = messages.slice(userIndex + 1).find(isReplayableAssistantMessage);
  assert(
    assistant,
    `${label} missing assistant response after smoke user message: ${formatSmokeJson(snapshot, 1000)}`,
  );
}

export function assertSocketMessageHistoryContainsRun(label, historyMessage, userContent) {
  assert(
    historyMessage?.type === "message_history",
    `${label} did not receive a message_history payload: ${formatSmokeJson(historyMessage, 1000)}`,
  );
  assertSessionSnapshotContainsRun(label, { messages: historyMessage.messages }, userContent);
}

export function assertSocketRunOutcome(label, events) {
  const messages = events
    .filter((event) => event?.type === "message" && event.message && typeof event.message === "object")
    .map((event) => event.message);

  const socketError = messages.find((message) => message.type === "error");
  assert(
    !socketError,
    `${label} received a socket error before outcome: ${formatSmokeJson(socketError, 500)}`,
  );

  assert(
    messages.some(isSocketRunIntakeMessage),
    `${label} did not receive intake activity: ${formatSmokeJson(events, 1000)}`,
  );

  const outcome = messages.find(isSocketRunOutcomeMessage);
  assert(
    outcome,
    `${label} did not receive an assistant or result message after intake: ${formatSmokeJson(events, 1000)}`,
  );
}

function isSocketRunIntakeMessage(message) {
  return (
    message?.type === "stream_event" &&
    message.event?.type === "main_agent_activity" &&
    message.event?.phase === "intake"
  );
}

function isReplayableAssistantMessage(message) {
  if (message?.type !== "assistant" || !message.message || typeof message.message !== "object") return false;
  const blocks = Array.isArray(message.message.content) ? message.message.content : [];
  return blocks.some((block) => {
    if (!block || typeof block !== "object") return false;
    if (block.type === "text") return typeof block.text === "string" && block.text.trim().length > 0;
    return block.type === "tool_use" || block.type === "tool_result";
  });
}

function formatSmokeJson(value, limit) {
  const text = JSON.stringify(value);
  return typeof text === "string" ? text.slice(0, limit) : String(value);
}

async function waitForEvent(events, predicate, label, options = {}) {
  const timeoutMs = options.timeoutMs || 5000;
  const intervalMs = options.intervalMs || 50;
  const startIndex = options.startIndex || 0;
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const event = events.slice(startIndex).find(predicate);
    if (event) return event;
    await wait(intervalMs);
  }

  throw new Error(`${label} timed out: ${JSON.stringify(events).slice(0, 1000)}`);
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function captureSidecarLogCursor() {
  const file = findMostRecentSidecarStdoutLog();
  if (!file) return null;
  try {
    return { file, size: statSync(file).size };
  } catch {
    return null;
  }
}

function readSidecarLogSince(cursor) {
  if (!cursor?.file) return "";
  try {
    const text = readFileSync(cursor.file, "utf8");
    return text.slice(Math.min(cursor.size || 0, text.length));
  } catch {
    return "";
  }
}

function findMostRecentSidecarStdoutLog() {
  const dirs = [...new Set([process.env.TMPDIR, os.tmpdir()].filter(Boolean))];
  let newest = null;
  for (const dir of dirs) {
    let entries = [];
    try {
      entries = readdirSync(dir);
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!/^internshannon_sidecar_stdout_.*\.log$/.test(entry)) continue;
      const file = `${dir.replace(/\/+$/, "")}/${entry}`;
      try {
        const stats = statSync(file);
        if (!newest || stats.mtimeMs > newest.mtimeMs) {
          newest = { file, mtimeMs: stats.mtimeMs };
        }
      } catch {
        // Ignore files that disappear between directory scan and stat.
      }
    }
  }
  return newest?.file ?? null;
}

function positiveIntegerFromEnv(name, fallback) {
  const parsed = Number.parseInt(process.env[name] || "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

async function cleanup() {
  if (!createdSessionId) return;
  try {
    await fetchForSmoke("cleanup session", `${apiBase}/kernel/sessions/${encodeURIComponent(createdSessionId)}`, {
      method: "DELETE",
    });
    log(`deleted session=${createdSessionId}`);
  } catch (error) {
    console.warn(`[desktop-smoke] failed to delete session ${createdSessionId}: ${formatError(error)}`);
  }
}

async function resolveGatewayUrl() {
  if (configuredGatewayUrl?.trim()) {
    const normalized = normalizeGatewayUrl(configuredGatewayUrl);
    const rawNormalized = normalizeUrl(configuredGatewayUrl);
    if (normalized !== rawNormalized) {
      console.warn(
        `[desktop-smoke] normalized gateway URL from ${rawNormalized} to ${normalized}; PUBLIC_DESKTOP_GATEWAY_URL should point at the sidecar origin, not an API path`,
      );
    }
    return normalized;
  }

  const attempts = [];
  for (let port = 29653; port <= 29703; port += 1) {
    const candidate = `http://127.0.0.1:${port}`;
    try {
      const response = await fetch(`${candidate}/api/v1/health`);
      if (!response.ok) {
        recordProbeAttempt(attempts, candidate, `health returned HTTP ${response.status}`);
        continue;
      }
      const parsed = await response.json();
      if (parsed?.data?.status === "ok" || parsed?.status === "ok") {
        return candidate;
      }
      recordProbeAttempt(attempts, candidate, `health payload was not ok: ${JSON.stringify(parsed).slice(0, 160)}`);
    } catch (error) {
      recordProbeAttempt(attempts, candidate, describeProbeError(error));
    }
  }

  throw new Error(
    [
      "Cannot find desktop API server on http://127.0.0.1:29653-29703.",
      "Start `just desktop-local` first.",
      formatProbeAttempts(attempts),
    ]
      .filter(Boolean)
      .join(" "),
  );
}

async function resolveWebUrl() {
  if (configuredWebUrl?.trim()) return normalizeUrl(configuredWebUrl);

  const attempts = [];
  for (let port = 5000; port <= 5050; port += 1) {
    const candidate = `http://127.0.0.1:${port}`;
    try {
      const response = await fetch(candidate);
      if (!response.ok) {
        recordProbeAttempt(attempts, candidate, `root returned HTTP ${response.status}`);
        continue;
      }
      const html = await response.text();
      if (html.includes("<title>书小安</title>") || html.includes("internshannon-bootstrap")) {
        return candidate;
      }
      if (html.trim()) {
        recordProbeAttempt(attempts, candidate, "root responded but did not look like the desktop shell");
      }
    } catch (error) {
      recordProbeAttempt(attempts, candidate, describeProbeError(error));
    }
  }

  throw new Error(
    [
      "Cannot find desktop web server on http://127.0.0.1:5000-5050.",
      "Start `just desktop-local` first.",
      formatProbeAttempts(attempts),
    ]
      .filter(Boolean)
      .join(" "),
  );
}

async function requestJson(label, url, init) {
  const response = await fetchForSmoke(label, url, init);
  const text = await response.text();
  assert(response.ok, `${label} returned HTTP ${response.status}: ${text.slice(0, 500)}`);
  const parsed = text ? JSON.parse(text) : null;
  if (parsed && typeof parsed === "object" && "data" in parsed) {
    return parsed.data;
  }
  return parsed;
}

async function expectOk(label, url, init) {
  const response = await fetchForSmoke(label, url, init);
  assert(response.ok, `${label} returned HTTP ${response.status}`);
  log(`${label} ok`);
}

async function expectWebShell(webUrl) {
  const response = await fetchForSmoke("web shell", webUrl);
  const html = await response.text();

  assertDesktopShellHtml("web shell", response, html);
  log("web shell ok");

  const assets = collectInitialAssets(html, webUrl);
  assert(
    assets.some((asset) => asset.kind === "script"),
    `web shell did not include an initial script asset: ${html.slice(0, 500)}`,
  );

  for (const asset of assets) {
    await expectAsset(asset);
  }
  log(`web assets ok (${assets.length})`);
  return assets;
}

async function expectDesktopDeepLinkShells(webUrl) {
  const routes = ["/settings", "/skills", "/agent/default/config"];
  for (const route of routes) {
    const url = new URL(route, `${webUrl}/`).toString();
    const response = await fetchForSmoke(`web route ${route}`, url);
    const html = await response.text();
    assertDesktopShellHtml(`web route ${route}`, response, html);
  }
  log(`web route shells ok (${routes.length})`);
}

export function assertDesktopShellHtml(label, response, html) {
  assert(response.ok, `${label} returned HTTP ${response.status}: ${html.slice(0, 500)}`);
  const missing = [
    html.includes("<title>书小安</title>") ? null : "desktop title",
    html.includes('id="internshannon-bootstrap"') ? null : "bootstrap guard",
    html.includes('id="root"') ? null : "React root",
  ].filter(Boolean);

  assert(
    missing.length === 0,
    `${label} does not look like the desktop shell; missing ${missing.join(", ")}. ${describeHtmlFingerprint(html)}`,
  );
}

async function expectDesktopEntryBundle(assets) {
  const scripts = assets.filter((asset) => asset.kind === "script");
  const entry = findDesktopEntryScript(scripts);

  assert(
    entry,
    `web shell did not include the desktop entry script. Scripts: ${scripts.map((asset) => asset.url).join(", ") || "(none)"}`,
  );

  const text = await expectAsset(entry);
  const markers = [
    { label: "startup reload guard", text: "internshannon-chunk-reload-once" },
    { label: "startup failure bridge", text: "react-bootstrap" },
    { label: "sidecar HTTP bridge", text: "loopback_http_request" },
    { label: "sidecar health probe", text: "/api/v1/health" },
    { label: "resolved gateway URL", text: gatewayUrl },
  ];
  const missing = markers.filter((marker) => !text.includes(marker.text));

  assert(
    missing.length === 0,
    `desktop entry ${entry.url} is missing marker(s): ${missing.map((marker) => marker.label).join(", ")}`,
  );
  log("desktop entry bundle ok");
}

function findDesktopEntryScript(scripts) {
  return scripts.find((asset) => {
    try {
      const basename = new URL(asset.url).pathname.split("/").pop() || "";
      return /^index(?:[.-].*)?\.js$/i.test(basename);
    } catch {
      return false;
    }
  });
}

function collectInitialAssets(html, webUrl) {
  const assets = [];
  const seen = new Set();

  for (const tag of html.matchAll(/<script\b[^>]*>/gi)) {
    addAsset(assets, seen, "script", getHtmlAttribute(tag[0], "src"), webUrl);
  }

  for (const tag of html.matchAll(/<link\b[^>]*>/gi)) {
    const relTokens = new Set((getHtmlAttribute(tag[0], "rel") || "").toLowerCase().split(/\s+/).filter(Boolean));
    const asType = (getHtmlAttribute(tag[0], "as") || "").toLowerCase();
    const href = getHtmlAttribute(tag[0], "href");

    if (relTokens.has("stylesheet")) {
      addAsset(assets, seen, "style", href, webUrl);
    } else if (relTokens.has("modulepreload")) {
      addAsset(assets, seen, "script", href, webUrl);
    } else if (relTokens.has("preload") && (asType === "script" || asType === "style")) {
      addAsset(assets, seen, asType === "style" ? "style" : "script", href, webUrl);
    }
  }

  return assets;
}

function addAsset(assets, seen, kind, rawUrl, webUrl) {
  const url = resolveSameOriginUrl(rawUrl, webUrl);
  if (!url || seen.has(url)) return;
  seen.add(url);
  assets.push({ kind, url });
}

function resolveSameOriginUrl(rawUrl, webUrl) {
  if (!rawUrl || rawUrl.startsWith("#")) return null;

  try {
    const url = new URL(rawUrl, webUrl);
    const base = new URL(webUrl);
    if ((url.protocol === "http:" || url.protocol === "https:") && url.origin === base.origin) {
      return url.toString();
    }
  } catch {
    return null;
  }

  return null;
}

function getHtmlAttribute(tag, name) {
  const match = tag.match(new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'>=]+))`, "i"));
  return match?.[1] ?? match?.[2] ?? match?.[3] ?? null;
}

async function expectAsset(asset) {
  const response = await fetchForSmoke(`${asset.kind} asset`, asset.url);
  const text = await response.text();

  assert(response.ok, `${asset.kind} asset ${asset.url} returned HTTP ${response.status}: ${text.slice(0, 300)}`);
  assert(text.trim().length > 0, `${asset.kind} asset ${asset.url} returned an empty response`);
  assert(!looksLikeHtmlDocument(text), `${asset.kind} asset ${asset.url} returned HTML instead of an asset`);
  return text;
}

async function fetchForSmoke(label, url, init) {
  try {
    return await fetch(url, init);
  } catch (error) {
    throw new Error(`${label} request failed for ${url}: ${describeProbeError(error)}`);
  }
}

function looksLikeHtmlDocument(text) {
  return /^\s*(?:<!doctype\s+html\b|<html\b)/i.test(text);
}

async function expectData(label, url, predicate) {
  const data = await requestJson(label, url);
  assert(predicate(data), `${label} returned unexpected data: ${JSON.stringify(data).slice(0, 500)}`);
  log(`${label} ok`);
}

async function expectWorkspacePrerequisites() {
  const defaultRoot = await requestJson("workspace default root", `${apiBase}/workspace/default-root`);
  assert(
    typeof defaultRoot?.root === "string" && defaultRoot.root.trim().length > 0,
    `workspace default root returned unexpected data: ${JSON.stringify(defaultRoot).slice(0, 500)}`,
  );

  const readiness = await requestJson("workspace readiness repair", `${apiBase}/workspace/readiness`, {
    method: "POST",
  });
  assertWorkspaceReady("workspace readiness repair", readiness);

  const inspected = await requestJson(
    "workspace readiness inspect",
    `${apiBase}/workspace/readiness?workspaceRoot=${encodeURIComponent(readiness.workspaceRoot)}`,
  );
  assertWorkspaceReady("workspace readiness inspect", inspected);

  const skillRoots = ["default", "local"].flatMap((userSegment) => [
    joinSmokeWorkspacePath(readiness.workspaceRoot, "users", userSegment, "skills"),
    joinSmokeWorkspacePath(readiness.workspaceRoot, "users", userSegment, "shared", "skills"),
  ]);

  for (const path of skillRoots) {
    await requestJson("workspace mkdir", `${apiBase}/workspace/mkdir`, postJson({ path }));
    await expectData(
      "workspace exists",
      `${apiBase}/workspace/exists?path=${encodeURIComponent(path)}`,
      (data) => data?.exists === true,
    );
  }

  log(`workspace prerequisites ok (root=${readiness.workspaceRoot}, skill dirs=${skillRoots.length})`);
  return {
    skillRoots,
    workspaceRoot: readiness.workspaceRoot,
  };
}

function assertWorkspaceReady(label, readiness) {
  assert(
    typeof readiness?.workspaceRoot === "string" && readiness.workspaceRoot.trim().length > 0,
    `${label} did not return workspaceRoot: ${JSON.stringify(readiness).slice(0, 500)}`,
  );
  assert(
    readiness.rootExists === true && readiness.agentsExists === true && readiness.sessionsExists === true,
    `${label} returned incomplete readiness: ${JSON.stringify(readiness).slice(0, 500)}`,
  );
  assert(readiness.needsRepair === false, `${label} still needs repair: ${JSON.stringify(readiness).slice(0, 500)}`);
}

async function expectSettingsPrerequisites() {
  const settings = await requestJson("settings config", `${apiBase}/config`);
  assertDesktopSettingsConfig("settings config", settings);

  const categories = await requestJson("settings categories", `${apiBase}/config/categories`);
  assertConfigCategoryList("settings categories", categories);

  const general = await requestJson("settings general category", `${apiBase}/config/categories/general`);
  assertRecord("settings general category", general);

  const llm = await requestJson("settings llm category", `${apiBase}/config/categories/llm`);
  assertRecord("settings llm category", llm);
  assert(
    Array.isArray(llm.providers),
    `settings llm category did not include providers: ${JSON.stringify(llm).slice(0, 500)}`,
  );

  log("settings config ok");
}

export function assertDesktopSettingsConfig(label, settings) {
  assertRecord(label, settings);
  assertRecord(`${label}.general`, settings.general);
  assertRecord(`${label}.llm`, settings.llm);
  assertRecord(`${label}.search`, settings.search);
  assertRecord(`${label}.storage`, settings.storage);
  assert(
    Array.isArray(settings.llm.providers),
    `${label}.llm.providers was not an array: ${JSON.stringify(settings.llm).slice(0, 500)}`,
  );
}

export function assertConfigCategoryList(label, categories) {
  assert(
    Array.isArray(categories?.items),
    `${label} did not return an items array: ${JSON.stringify(categories).slice(0, 500)}`,
  );
  const names = new Set(categories.items.map((item) => item?.name).filter(Boolean));
  const missing = ["general", "llm", "search", "storage"].filter((name) => !names.has(name));
  assert(missing.length === 0, `${label} missing category names: ${missing.join(", ")}`);
}

async function expectSkillsWorkspaceRoundTrip(skillRoot) {
  const filename = `desktop-smoke-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.md`;
  const path = joinSmokeWorkspacePath(skillRoot, filename);
  const content = [
    "---",
    `name: ${filename.replace(/\.md$/, "")}`,
    "description: Desktop smoke skill file round trip",
    "kind: instruction",
    "tags:",
    "  - desktop-smoke",
    "version: 1.0.0",
    "---",
    "",
    "# Desktop Smoke Skill",
    "",
    "This file is created and removed by desktop-smoke.",
    "",
  ].join("\n");

  try {
    await requestJson("skills workspace write", `${apiBase}/workspace/write`, postJson({ content, path }));
    await expectData(
      "skills workspace exists",
      `${apiBase}/workspace/exists?path=${encodeURIComponent(path)}`,
      (data) => data?.exists === true,
    );

    const read = await requestJson(
      "skills workspace read",
      `${apiBase}/workspace/read?path=${encodeURIComponent(path)}`,
    );
    assert(read?.content === content, "skills workspace read returned different content");

    const entries = await requestJson(
      "skills workspace read-dir",
      `${apiBase}/workspace/read-dir?path=${encodeURIComponent(skillRoot)}`,
    );
    assertSkillsDirectoryContains("skills workspace read-dir", entries, filename);
  } finally {
    await fetchForSmoke("skills workspace cleanup", `${apiBase}/workspace/delete?path=${encodeURIComponent(path)}`, {
      method: "DELETE",
    }).catch(() => null);
  }

  await expectData(
    "skills workspace cleanup exists",
    `${apiBase}/workspace/exists?path=${encodeURIComponent(path)}`,
    (data) => data?.exists === false,
  );
  log("skills workspace round trip ok");
}

export function assertSkillsDirectoryContains(label, entries, filename) {
  assert(Array.isArray(entries), `${label} did not return an array: ${JSON.stringify(entries).slice(0, 500)}`);
  assert(
    entries.some((entry) => entry?.name === filename && entry?.isFile === true),
    `${label} did not include ${filename}: ${JSON.stringify(entries).slice(0, 500)}`,
  );
}

export function joinSmokeWorkspacePath(root, ...segments) {
  const base = String(root ?? "").trim();
  assert(base, "workspace root is required");
  const separator = base.includes("\\") && !base.includes("/") ? "\\" : "/";
  const normalizedBase = base.replace(/[\\/]+$/, "");
  const normalizedSegments = segments.map((segment) => String(segment).replace(/^[\\/]+|[\\/]+$/g, "")).filter(Boolean);
  return [normalizedBase, ...normalizedSegments].join(separator);
}

function postJson(body) {
  return {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}

function assertRecord(label, value) {
  assert(
    !!value && typeof value === "object" && !Array.isArray(value),
    `${label} was not an object: ${JSON.stringify(value).slice(0, 500)}`,
  );
}

function describeHtmlFingerprint(html) {
  const title =
    html
      .match(/<title\b[^>]*>(.*?)<\/title>/is)?.[1]
      ?.replace(/\s+/g, " ")
      .trim() || "(none)";
  const ids = [...html.matchAll(/\bid\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s"'>=]+))/gi)]
    .slice(0, 8)
    .map((match) => match[1] ?? match[2] ?? match[3])
    .filter(Boolean);
  const idSummary = ids.length > 0 ? ids.join(", ") : "(none)";
  return `Received title=${JSON.stringify(title)}, ids=${JSON.stringify(idSummary)}. Check PUBLIC_DESKTOP_URL and make sure it points at \`just desktop-local\`, not another local web app.`;
}

export function normalizeGatewayUrl(value) {
  return normalizeUrl(value).replace(/\/api\/v1(?:\/health)?$/i, "");
}

export function normalizeUrl(value) {
  return value.trim().replace(/\/+$/, "");
}

function recordProbeAttempt(attempts, url, detail) {
  attempts.push({ url, detail });
}

export function formatProbeAttempts(attempts) {
  if (attempts.length === 0) return "";

  const shown = attempts.slice(0, 8).map((attempt) => `${attempt.url}: ${attempt.detail}`);
  const suffix = attempts.length > shown.length ? `; ... ${attempts.length - shown.length} more` : "";
  return [
    `Probe attempts: ${shown.join("; ")}${suffix}.`,
    "If the service is already running, check whether this command can access 127.0.0.1 from the current sandbox.",
  ].join(" ");
}

export function describeProbeError(error) {
  const parts = [];
  if (error instanceof Error && error.message) {
    parts.push(error.message);
  } else {
    parts.push(String(error));
  }

  const cause = error && typeof error === "object" && "cause" in error ? error.cause : null;
  if (cause && typeof cause === "object") {
    const causeRecord = cause;
    const details = ["code", "syscall", "address", "port"]
      .map((key) => (key in causeRecord ? `${key}=${String(causeRecord[key])}` : null))
      .filter(Boolean);
    if (details.length > 0) {
      parts.push(`cause(${details.join(", ")})`);
    }
    const code = "code" in causeRecord ? String(causeRecord.code) : "";
    const syscall = "syscall" in causeRecord ? String(causeRecord.syscall) : "";
    const address = "address" in causeRecord ? String(causeRecord.address) : "";
    if (code === "EPERM" && syscall === "connect" && isLoopbackAddress(address)) {
      parts.push(
        "localhost access was denied by the current sandbox; rerun this smoke command with local network permission or from an unrestricted shell",
      );
    }
  }

  if (parts.length === 1 && parts[0] === "fetch failed") {
    parts.push("no low-level cause exposed; verify the service is listening and this sandbox can access 127.0.0.1");
  }

  return parts.join(" ").replace(/\s+/g, " ").trim();
}

function isLoopbackAddress(address) {
  return address === "127.0.0.1" || address === "::1" || address === "localhost";
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function log(message) {
  console.log(`[desktop-smoke] ${message}`);
}

function formatError(error) {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
    .catch((error) => {
      console.error(`[desktop-smoke] failed: ${formatError(error)}`);
      process.exitCode = 1;
    })
    .finally(cleanup);
}
