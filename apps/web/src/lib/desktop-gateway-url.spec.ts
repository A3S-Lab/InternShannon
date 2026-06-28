import * as assert from "node:assert/strict";
import { test } from "node:test";
import {
  DEFAULT_DESKTOP_GATEWAY_URL,
  normalizeGatewayUrl,
  resolveBrowserGatewayUrl,
  resolveDesktopGatewayUrl,
} from "./desktop-gateway-url.ts";

test("normalizes gateway URLs before they reach runtime state", () => {
  assert.equal(normalizeGatewayUrl(" http://127.0.0.1:29680/// "), "http://127.0.0.1:29680");
  assert.equal(normalizeGatewayUrl(""), "");
  assert.equal(normalizeGatewayUrl(null), "");
});

test("browser gateway resolution prefers the desktop gateway injected by rsbuild", () => {
  assert.equal(
    resolveBrowserGatewayUrl({
      PUBLIC_DESKTOP_GATEWAY_URL: "http://127.0.0.1:29680/",
      VITE_API_URL: "http://127.0.0.1:29653",
      PUBLIC_API_BASE_URL: "http://127.0.0.1:29655",
    }),
    "http://127.0.0.1:29680",
  );
});

test("browser gateway resolution keeps admin builds on their existing API env fallback", () => {
  assert.equal(
    resolveBrowserGatewayUrl({
      VITE_API_URL: "http://localhost:3000/api",
      PUBLIC_API_BASE_URL: "http://localhost:4000/api",
    }),
    "http://localhost:3000/api",
  );
  assert.equal(resolveBrowserGatewayUrl({}), "");
});

test("desktop runtime gateway resolution falls back to the fixed sidecar port", () => {
  assert.equal(
    resolveDesktopGatewayUrl(
      { PUBLIC_DESKTOP_GATEWAY_URL: "http://127.0.0.1:29680" },
      { PUBLIC_DESKTOP_GATEWAY_URL: "http://127.0.0.1:29653" },
    ),
    "http://127.0.0.1:29680",
  );
  assert.equal(resolveDesktopGatewayUrl({}, {}), DEFAULT_DESKTOP_GATEWAY_URL);
});
