import * as assert from "node:assert/strict";
import { test } from "node:test";
import {
  formatDesktopLocalReadyMessage,
  formatDesktopLocalWaitStatus,
  probeDesktopLocalReady,
} from "./desktop-local-ready.mjs";

test("detects ready desktop-local web and API endpoints", async () => {
  const result = await probeDesktopLocalReady({
    fetchImpl: async (url) => {
      if (String(url).endsWith("/api/v1/health")) {
        return jsonResponse({ data: { status: "ok" } });
      }
      return textResponse(
        '<html><head><title>InternShannon</title></head><body id="internshannon-bootstrap"><div id="root"></div></body></html>',
      );
    },
    gatewayUrl: " http://127.0.0.1:29653/ ",
    webUrl: " http://127.0.0.1:5001/ ",
  });

  assert.equal(result.ready, true);
  assert.equal(result.webUrl, "http://127.0.0.1:5001");
  assert.equal(result.gatewayUrl, "http://127.0.0.1:29653");
  assert.equal(result.web.status, "ready");
  assert.equal(result.api.status, "ready");
});

test("reports shell fingerprints that are not ready yet", async () => {
  const result = await probeDesktopLocalReady({
    fetchImpl: async (url) => {
      if (String(url).endsWith("/api/v1/health")) {
        return jsonResponse({ status: "ok" });
      }
      return textResponse("<html><head><title>Other</title></head><body></body></html>");
    },
    gatewayUrl: "http://127.0.0.1:29653",
    webUrl: "http://127.0.0.1:5001",
  });

  assert.equal(result.ready, false);
  assert.match(result.web.status, /shell missing title\/bootstrap\/root/);
  assert.equal(result.api.status, "ready");
});

test("formats waiting and ready messages for copy-paste recovery", () => {
  assert.equal(
    formatDesktopLocalWaitStatus({
      api: { status: "fetch failed" },
      web: { status: "HTTP 503" },
    }),
    "desktop-local: 等待 Web/API ready... Web=HTTP 503; API=fetch failed",
  );

  assert.equal(
    formatDesktopLocalReadyMessage({
      dataDir: "/tmp/internshannon",
      gatewayUrl: "http://127.0.0.1:29653/",
      webUrl: "http://127.0.0.1:5001/",
    }),
    [
      "",
      "desktop-local: Web/API 已就绪，可以开始使用",
      "  Web      http://127.0.0.1:5001",
      "  API      http://127.0.0.1:29653/api/v1",
      "  Health   http://127.0.0.1:29653/api/v1/health",
      "  Data     /tmp/internshannon",
      "  Smoke    PUBLIC_DESKTOP_URL=http://127.0.0.1:5001 PUBLIC_DESKTOP_GATEWAY_URL=http://127.0.0.1:29653 just desktop-smoke",
      "",
    ].join("\n"),
  );
});

function jsonResponse(value, init) {
  return new Response(JSON.stringify(value), {
    headers: { "Content-Type": "application/json" },
    status: 200,
    ...init,
  });
}

function textResponse(value, init) {
  return new Response(value, {
    headers: { "Content-Type": "text/html" },
    status: 200,
    ...init,
  });
}
