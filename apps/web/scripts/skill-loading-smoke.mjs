import { existsSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";
import { io } from "socket.io-client";

const webUrl = normalizeUrl(process.env.PUBLIC_DESKTOP_URL || "http://127.0.0.1:5000");
const apiBase = `${webUrl}/api/v1`;
const fixtureId = `pr7-skill-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const fixtureDescription = "PR 7 real websocket skill loading smoke";

let createdSessionId = null;
let createdSessionApiBase = null;
let fixtureDir = null;

async function main() {
  await expectOk("web root", webUrl, { method: "HEAD" });

  const defaultRoot = await requestJson("workspace default root", `${apiBase}/workspace/default-root`);
  assert(typeof defaultRoot?.root === "string" && defaultRoot.root.trim(), "workspace default root is missing");
  const settings = await requestJson("desktop settings", `${apiBase}/config`);
  const workspaceRoot = settings?.general?.workspacePath?.trim() || defaultRoot.root;

  const userSkillsDir = joinWorkspacePath(workspaceRoot, "users", "local", "skills");
  fixtureDir = joinWorkspacePath(userSkillsDir, fixtureId);
  const fixturePath = joinWorkspacePath(fixtureDir, "SKILL.md");
  const fixtureContent = [
    "---",
    `name: ${fixtureId}`,
    `description: ${fixtureDescription}`,
    "kind: instruction",
    "---",
    "",
    "# WebSocket skill smoke",
    "",
  ].join("\n");

  await requestJson(
    "create personal skill fixture directory",
    `${apiBase}/workspace/mkdir`,
    postJson({ path: fixtureDir }),
  );
  await requestJson(
    "write personal SKILL.md fixture",
    `${apiBase}/workspace/write`,
    postJson({ path: fixturePath, content: fixtureContent }),
  );
  const saved = await requestJson(
    "read personal SKILL.md fixture",
    `${apiBase}/workspace/read?path=${encodeURIComponent(fixturePath)}`,
  );
  assert(saved?.content === fixtureContent, "SKILL.md frontmatter changed during workspace write/read");

  // This must remain the same path a user exercises. Do not replace the UI
  // click with a test-only REST request that injects skillDirs.
  const { created, requestBody, gatewayUrl } = await createSessionThroughProductUi(workspaceRoot);
  createdSessionId = created?.session?.sessionId;
  createdSessionApiBase = `${gatewayUrl}/api/v1`;
  assert(createdSessionId, "create session did not return session.sessionId");
  const requestedUserSkillsDir = findPersonalSkillDir(requestBody.skillDirs);
  assert(
    requestedUserSkillsDir === userSkillsDir,
    `product create request did not resolve a personal skill directory: ${JSON.stringify(requestBody.skillDirs)}`,
  );
  assert(
    Array.isArray(requestBody.skills) && requestBody.skills.includes(fixtureId),
    `product create request did not activate the personal skill: ${JSON.stringify(requestBody.skills)}`,
  );

  const evidence = await expectSkillOverWebSocket(gatewayUrl, createdSessionId, {
    name: fixtureId,
    description: fixtureDescription,
    kind: "instruction",
  });
  console.log(
    `[skill-loading-smoke] passed ${JSON.stringify({ webUrl, gatewayUrl, sessionId: createdSessionId, creationPath: "ui:new-session", skillDirs: requestBody.skillDirs, ...evidence })}`,
  );
}

export function findPersonalSkillDir(skillDirs) {
  if (!Array.isArray(skillDirs)) return null;
  return (
    skillDirs.find((value) =>
      typeof value === "string" ? value.replace(/\\/g, "/").replace(/\/+$/, "").endsWith("/users/local/skills") : false,
    ) ?? null
  );
}

async function createSessionThroughProductUi(workspaceRoot) {
  const browser = await chromium.launch(resolveBrowserLaunchOptions());
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 960 } });
    const page = await context.newPage();
    await page.goto(`${webUrl}/#/`, { waitUntil: "domcontentloaded", timeout: 30_000 });

    const onboardingDialog = page.getByRole("dialog").filter({ hasText: "完成首次默认配置" });
    await onboardingDialog.waitFor({ state: "visible", timeout: 30_000 });
    await onboardingDialog.locator("#startup-nickname").fill("PR 7 WebSocket Smoke");
    const workspaceInput = onboardingDialog.locator('input[placeholder="/path/to/workspace"]');
    if (!(await workspaceInput.inputValue()).trim()) {
      await workspaceInput.fill(workspaceRoot);
    }
    const finishOnboarding = onboardingDialog.getByRole("button", { name: "开始使用书小安" });
    await finishOnboarding.waitFor({ state: "visible", timeout: 30_000 });
    assert(
      await finishOnboarding.isEnabled(),
      "product onboarding has no default model; configure the isolated sidecar before running the UI smoke",
    );
    await finishOnboarding.click();
    await onboardingDialog.waitFor({ state: "hidden", timeout: 30_000 });

    const createButton = page.locator('button[aria-label="新会话"]:visible').first();
    await createButton.waitFor({ state: "visible", timeout: 30_000 });
    const responsePromise = page.waitForResponse(
      (response) => {
        const url = new URL(response.url());
        return response.request().method() === "POST" && url.pathname.endsWith("/api/v1/kernel/sessions");
      },
      { timeout: 30_000 },
    );
    await createButton.click();
    const response = await responsePromise;
    const responseText = await response.text();
    assert(response.ok(), `UI create session returned HTTP ${response.status()}: ${responseText.slice(0, 500)}`);
    const payload = responseText ? JSON.parse(responseText) : null;
    const requestBody = response.request().postDataJSON();
    await page.getByText("会话创建成功", { exact: true }).waitFor({ state: "visible", timeout: 30_000 });
    return {
      created: payload && typeof payload === "object" && "data" in payload ? payload.data : payload,
      requestBody,
      gatewayUrl: new URL(response.url()).origin,
    };
  } finally {
    await browser.close();
  }
}

function resolveBrowserLaunchOptions() {
  const explicitPath = process.env.PLAYWRIGHT_EXECUTABLE_PATH?.trim();
  if (explicitPath) return { headless: true, executablePath: explicitPath };

  const installedBrowsers = [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
  ];
  const executablePath = installedBrowsers.find((candidate) => existsSync(candidate));
  return executablePath ? { headless: true, executablePath } : { headless: true };
}

async function expectSkillOverWebSocket(gatewayUrl, sessionId, expectedSkill) {
  const socket = io(`${gatewayUrl}/ws/kernel`, {
    transports: ["websocket"],
    forceNew: true,
    reconnection: false,
    timeout: 10_000,
  });
  const observedMessages = [];
  const observeMessage = (message) => {
    observedMessages.push({
      type: message?.type ?? typeof message,
      message: typeof message?.message === "string" ? message.message : undefined,
      status: typeof message?.status === "string" || message?.status === null ? message.status : undefined,
    });
  };
  socket.on("message", observeMessage);

  try {
    await waitForSocketEvent(socket, "connect", 10_000);
    const transport = socket.io.engine.transport.name;
    assert(transport === "websocket", `expected websocket transport, received ${transport}`);

    const subscribedPromise = waitForSocketEvent(socket, "subscribed", 10_000);
    socket.emit("subscribe", { sessionId });
    const subscribed = await subscribedPromise;
    if (subscribed && typeof subscribed === "object" && "sessionId" in subscribed) {
      assert(subscribed.sessionId === sessionId, "subscription acknowledged a different session");
    }

    const statusPromise = waitForSocketMessage(socket, (message) => message?.type === "session_status", 15_000);
    socket.emit("message", { sessionId, type: "session_status" });
    const status = await statusPromise.catch((error) => {
      throw new Error(
        `${error instanceof Error ? error.message : String(error)}; observed messages=${JSON.stringify(observedMessages)}`,
      );
    });
    assertSkillStatus(status, expectedSkill);

    return {
      transport,
      subscribed: true,
      skill: status.data.skills.find((skill) => skill?.name === expectedSkill.name),
    };
  } finally {
    socket.off("message", observeMessage);
    socket.close();
  }
}

export function assertSkillStatus(status, expectedSkill) {
  assert(status && typeof status === "object", "session_status message is missing");
  assert(Array.isArray(status.data?.skills), `session_status.data.skills is not an array: ${JSON.stringify(status)}`);
  const actual = status.data.skills.find((skill) => skill?.name === expectedSkill.name);
  assert(actual, `session_status did not include ${expectedSkill.name}: ${JSON.stringify(status.data.skills)}`);
  assert(actual.description === expectedSkill.description, `unexpected skill description: ${JSON.stringify(actual)}`);
  assert(actual.kind === expectedSkill.kind, `unexpected skill kind: ${JSON.stringify(actual)}`);
}

function waitForSocketEvent(socket, eventName, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`timed out waiting for Socket.IO event ${eventName}`));
    }, timeoutMs);
    const onEvent = (value) => {
      cleanup();
      resolve(value);
    };
    const onError = (error) => {
      cleanup();
      reject(error instanceof Error ? error : new Error(String(error)));
    };
    const cleanup = () => {
      clearTimeout(timer);
      socket.off(eventName, onEvent);
      socket.off("connect_error", onError);
    };
    socket.once(eventName, onEvent);
    socket.once("connect_error", onError);
  });
}

function waitForSocketMessage(socket, predicate, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("timed out waiting for matching Socket.IO message"));
    }, timeoutMs);
    const onMessage = (message) => {
      if (!predicate(message)) return;
      cleanup();
      resolve(message);
    };
    const cleanup = () => {
      clearTimeout(timer);
      socket.off("message", onMessage);
    };
    socket.on("message", onMessage);
  });
}

async function cleanup() {
  if (createdSessionId) {
    const sessionApiBase = createdSessionApiBase || apiBase;
    await fetch(`${sessionApiBase}/kernel/sessions/${encodeURIComponent(createdSessionId)}`, {
      method: "DELETE",
    }).catch(() => null);
  }
  if (fixtureDir) {
    await fetch(`${apiBase}/workspace/delete?path=${encodeURIComponent(fixtureDir)}`, { method: "DELETE" }).catch(
      () => null,
    );
  }
}

async function requestJson(label, url, init) {
  const response = await fetch(url, init);
  const text = await response.text();
  assert(response.ok, `${label} returned HTTP ${response.status}: ${text.slice(0, 500)}`);
  const parsed = text ? JSON.parse(text) : null;
  return parsed && typeof parsed === "object" && "data" in parsed ? parsed.data : parsed;
}

async function expectOk(label, url, init) {
  const response = await fetch(url, init);
  assert(response.ok, `${label} returned HTTP ${response.status}`);
}

function postJson(body) {
  return {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}

export function joinWorkspacePath(root, ...segments) {
  const base = String(root ?? "").trim();
  assert(base, "workspace root is required");
  const separator = base.includes("\\") && !base.includes("/") ? "\\" : "/";
  return [
    base.replace(/[\\/]+$/, ""),
    ...segments.map((segment) => String(segment).replace(/^[\\/]+|[\\/]+$/g, "")).filter(Boolean),
  ].join(separator);
}

function normalizeUrl(value) {
  return value.trim().replace(/\/+$/, "");
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
    .catch((error) => {
      console.error(`[skill-loading-smoke] failed: ${error instanceof Error ? error.message : String(error)}`);
      process.exitCode = 1;
    })
    .finally(cleanup);
}
