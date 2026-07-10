import { pathToFileURL } from "node:url";
import { io } from "socket.io-client";

const webUrl = normalizeUrl(process.env.PUBLIC_DESKTOP_URL || "http://127.0.0.1:5000");
const apiBase = `${webUrl}/api/v1`;
const fixtureId = `pr7-skill-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const fixtureDescription = "PR 7 real websocket skill loading smoke";

let createdSessionId = null;
let fixtureDir = null;

async function main() {
  await expectOk("web root", webUrl, { method: "HEAD" });

  const defaultRoot = await requestJson("workspace default root", `${apiBase}/workspace/default-root`);
  assert(typeof defaultRoot?.root === "string" && defaultRoot.root.trim(), "workspace default root is missing");

  const userRoot = joinWorkspacePath(defaultRoot.root, "users", "local");
  const agentSkillsDir = joinWorkspacePath(userRoot, "agents", "default", "skills");
  const userSkillsDir = joinWorkspacePath(userRoot, "skills");
  const sharedSkillsDir = joinWorkspacePath(userRoot, "shared", "skills");
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

  const skillDirs = [agentSkillsDir, userSkillsDir, sharedSkillsDir];
  const created = await requestJson("create skill smoke session through web proxy", `${apiBase}/kernel/sessions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      title: `PR 7 skill smoke ${new Date().toISOString()}`,
      agentId: "default",
      skillDirs,
    }),
  });
  createdSessionId = created?.session?.sessionId;
  assert(createdSessionId, "create session did not return session.sessionId");

  const evidence = await expectSkillOverWebSocket(createdSessionId, {
    name: fixtureId,
    description: fixtureDescription,
    kind: "instruction",
  });
  console.log(
    `[skill-loading-smoke] passed ${JSON.stringify({ webUrl, sessionId: createdSessionId, skillDirs, ...evidence })}`,
  );
}

async function expectSkillOverWebSocket(sessionId, expectedSkill) {
  const socket = io(`${webUrl}/ws/kernel`, {
    transports: ["websocket"],
    forceNew: true,
    reconnection: false,
    timeout: 10_000,
  });

  try {
    await waitForSocketEvent(socket, "connect", 10_000);
    const transport = socket.io.engine.transport.name;
    assert(transport === "websocket", `expected websocket transport, received ${transport}`);

    socket.emit("subscribe", { sessionId });
    const subscribed = await waitForSocketEvent(socket, "subscribed", 10_000);
    if (subscribed && typeof subscribed === "object" && "sessionId" in subscribed) {
      assert(subscribed.sessionId === sessionId, "subscription acknowledged a different session");
    }

    socket.emit("message", { sessionId, type: "session_status" });
    const status = await waitForSocketMessage(socket, (message) => message?.type === "session_status", 15_000);
    assertSkillStatus(status, expectedSkill);

    return {
      transport,
      subscribed: true,
      skill: status.data.skills.find((skill) => skill?.name === expectedSkill.name),
    };
  } finally {
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
    await fetch(`${apiBase}/kernel/sessions/${encodeURIComponent(createdSessionId)}`, { method: "DELETE" }).catch(
      () => null,
    );
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
