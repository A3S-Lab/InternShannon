import { pathToFileURL } from "node:url";

const DEFAULT_TIMEOUT_MS = 90_000;
const DEFAULT_INTERVAL_MS = 500;
const STATUS_LOG_INTERVAL_MS = 5_000;

export async function probeDesktopLocalReady({ webUrl, gatewayUrl, fetchImpl = fetch }) {
  const normalizedWebUrl = normalizeUrl(webUrl);
  const normalizedGatewayUrl = normalizeUrl(gatewayUrl);
  const [web, api] = await Promise.all([
    probeWebShell(normalizedWebUrl, fetchImpl),
    probeApiHealth(`${normalizedGatewayUrl}/api/v1/health`, fetchImpl),
  ]);

  return {
    api,
    gatewayUrl: normalizedGatewayUrl,
    ready: web.ready && api.ready,
    web,
    webUrl: normalizedWebUrl,
  };
}

export function formatDesktopLocalReadyMessage({ webUrl, gatewayUrl, dataDir }) {
  const normalizedWebUrl = normalizeUrl(webUrl);
  const normalizedGatewayUrl = normalizeUrl(gatewayUrl);
  const apiUrl = `${normalizedGatewayUrl}/api/v1`;

  return [
    "",
    "desktop-local: Web/API 已就绪，可以开始使用",
    `  Web      ${normalizedWebUrl}`,
    `  API      ${apiUrl}`,
    `  Health   ${apiUrl}/health`,
    `  Data     ${String(dataDir ?? "").trim() || "(default)"}`,
    `  Smoke    PUBLIC_DESKTOP_URL=${normalizedWebUrl} PUBLIC_DESKTOP_GATEWAY_URL=${normalizedGatewayUrl} just desktop-smoke`,
    "",
  ].join("\n");
}

export function formatDesktopLocalWaitStatus(result) {
  return `desktop-local: 等待 Web/API ready... Web=${result.web.status}; API=${result.api.status}`;
}

async function probeWebShell(webUrl, fetchImpl) {
  try {
    const response = await fetchImpl(webUrl);
    const html = await response.text();
    if (!response.ok) {
      return {
        ready: false,
        status: `HTTP ${response.status}`,
      };
    }

    const missing = [
      html.includes("<title>InternShannon</title>") ? null : "title",
      html.includes('id="internshannon-bootstrap"') ? null : "bootstrap",
      html.includes('id="root"') ? null : "root",
    ].filter(Boolean);

    if (missing.length > 0) {
      return {
        ready: false,
        status: `shell missing ${missing.join("/")}`,
      };
    }

    return { ready: true, status: "ready" };
  } catch (error) {
    return {
      ready: false,
      status: formatProbeError(error),
    };
  }
}

async function probeApiHealth(healthUrl, fetchImpl) {
  try {
    const response = await fetchImpl(healthUrl);
    const text = await response.text();
    if (!response.ok) {
      return {
        ready: false,
        status: `HTTP ${response.status}`,
      };
    }

    const data = text ? JSON.parse(text) : null;
    if (data?.data?.status === "ok" || data?.status === "ok") {
      return { ready: true, status: "ready" };
    }

    return {
      ready: false,
      status: `health not ok (${JSON.stringify(data).slice(0, 120)})`,
    };
  } catch (error) {
    return {
      ready: false,
      status: formatProbeError(error),
    };
  }
}

async function waitForDesktopLocalReady({ webUrl, gatewayUrl, dataDir, timeoutMs, intervalMs }) {
  const startedAt = Date.now();
  let lastStatusLogAt = 0;
  let lastResult = null;

  while (Date.now() - startedAt <= timeoutMs) {
    lastResult = await probeDesktopLocalReady({ webUrl, gatewayUrl });
    if (lastResult.ready) {
      process.stdout.write(formatDesktopLocalReadyMessage({ webUrl, gatewayUrl, dataDir }));
      return;
    }

    if (Date.now() - lastStatusLogAt >= STATUS_LOG_INTERVAL_MS) {
      console.log(formatDesktopLocalWaitStatus(lastResult));
      lastStatusLogAt = Date.now();
    }

    await sleep(intervalMs);
  }

  const summary = lastResult ? formatDesktopLocalWaitStatus(lastResult) : "desktop-local: readiness probe did not run";
  throw new Error(`desktop-local: Web/API did not become ready within ${timeoutMs}ms. ${summary}`);
}

function parsePositiveInteger(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function normalizeUrl(value) {
  return String(value ?? "")
    .trim()
    .replace(/\/+$/, "");
}

function formatProbeError(error) {
  if (error instanceof Error && error.message) return error.message.replace(/\s+/g, " ").trim();
  return String(error).replace(/\s+/g, " ").trim();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main(argv) {
  const [webUrl, gatewayUrl, dataDir] = argv;
  if (!String(webUrl ?? "").trim() || !String(gatewayUrl ?? "").trim()) {
    throw new Error("Usage: desktop-local-ready.mjs <web-url> <gateway-url> [data-dir]");
  }

  await waitForDesktopLocalReady({
    dataDir,
    gatewayUrl,
    intervalMs: parsePositiveInteger(process.env.DESKTOP_LOCAL_READY_INTERVAL_MS, DEFAULT_INTERVAL_MS),
    timeoutMs: parsePositiveInteger(process.env.DESKTOP_LOCAL_READY_TIMEOUT_MS, DEFAULT_TIMEOUT_MS),
    webUrl,
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
