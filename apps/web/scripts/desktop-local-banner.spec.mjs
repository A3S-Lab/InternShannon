import * as assert from "node:assert/strict";
import { test } from "node:test";
import { formatDesktopLocalBanner } from "./desktop-local-banner.mjs";

test("formats desktop-local endpoints and smoke command", () => {
  assert.equal(
    formatDesktopLocalBanner({
      webPort: " 5001 ",
      apiPort: 29653,
      dataDir: " /tmp/internshannon ",
    }),
    [
      "",
      "desktop-local: 启动桌面本地闭环",
      "  Web      http://127.0.0.1:5001",
      "  API      http://127.0.0.1:29653/api/v1",
      "  Health   http://127.0.0.1:29653/api/v1/health",
      "  Data     /tmp/internshannon",
      "  Smoke    PUBLIC_DESKTOP_URL=http://127.0.0.1:5001 PUBLIC_DESKTOP_GATEWAY_URL=http://127.0.0.1:29653 just desktop-web-smoke",
      "",
    ].join("\n"),
  );
});

test("requires the endpoint inputs", () => {
  assert.throws(() => formatDesktopLocalBanner({ webPort: "", apiPort: 29653, dataDir: "/tmp/data" }), /webPort/);
  assert.throws(() => formatDesktopLocalBanner({ webPort: 5001, apiPort: "", dataDir: "/tmp/data" }), /apiPort/);
  assert.throws(() => formatDesktopLocalBanner({ webPort: 5001, apiPort: 29653, dataDir: "" }), /dataDir/);
});
