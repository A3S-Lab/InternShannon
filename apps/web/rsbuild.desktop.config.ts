import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, logger as rsbuildLogger } from "@rsbuild/core";
import { pluginLess } from "@rsbuild/plugin-less";
import { pluginReact } from "@rsbuild/plugin-react";
import { pluginSass } from "@rsbuild/plugin-sass";
import { ignoreKnownEditorWorkerWarnings } from "./rsbuild.shared";
import { isAgentationEnabled } from "./src/lib/agentation-flag";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const browserTargets = ["Chrome >= 91", "Edge >= 91", "Firefox >= 90", "Safari >= 14", "iOS >= 14", "not dead"];
const publicDesktopUrl = process.env.PUBLIC_DESKTOP_URL || "http://127.0.0.1:5000";
const runtimeMode =
  process.env.TAURI_ENV_PLATFORM || process.env.npm_lifecycle_event === "dev:tauri"
    ? "tauri"
    : process.env.PUBLIC_DESKTOP_RUNTIME || "web";
const gatewayUrl = process.env.PUBLIC_DESKTOP_GATEWAY_URL || "http://127.0.0.1:29653";
const appName = process.env.PUBLIC_DESKTOP_APP_NAME || "InternShannon";
const storagePrefix = process.env.PUBLIC_DESKTOP_STORAGE_PREFIX || "internshannon";
const suppressedProxyErrorMarkers = ["[HPM] Error occurred while proxying request", "[ECONNREFUSED]"];

const proxyLogProvider = () => ({
  log: rsbuildLogger.log,
  debug: rsbuildLogger.debug,
  info: rsbuildLogger.info,
  warn: rsbuildLogger.warn,
  error: (message?: unknown, ...args: unknown[]) => {
    const text = [message, ...args].map((value) => String(value)).join(" ");

    if (suppressedProxyErrorMarkers.every((marker) => text.includes(marker))) {
      return;
    }

    rsbuildLogger.error(message, ...args);
  },
});

const sidecarProxy = (target: string, options: { ws?: boolean } = {}) => ({
  target,
  changeOrigin: true,
  logLevel: "warn" as const,
  logProvider: proxyLogProvider,
  ...options,
});

const workspacePort = Number(process.env.PUBLIC_DESKTOP_DEV_PORT || 5000);
const assetBaseUrl = process.env.PUBLIC_DESKTOP_ASSET_BASE_URL || "/workspace";
const gatewayUrlForProxy = gatewayUrl;

export default defineConfig(() => {
  const agentationEnabled = isAgentationEnabled(process.env.PUBLIC_ENABLE_AGENTATION);

  return {
    html: {
      favicon: path.join(__dirname, "public", "workspace", "logo.png"),
      template: path.join(__dirname, "src", "desktop", "index.html"),
    },
    source: {
      assetsInclude: [/\.md$/],
      entry: {
        index: "./src/desktop/DesktopApp.tsx",
      },
      define: {
        "process.env.PUBLIC_DESKTOP_APP_NAME": JSON.stringify(appName),
        "process.env.PUBLIC_DESKTOP_GATEWAY_URL": JSON.stringify(gatewayUrl),
        "process.env.PUBLIC_DESKTOP_RUNTIME": JSON.stringify(runtimeMode),
        "process.env.PUBLIC_DESKTOP_STORAGE_PREFIX": JSON.stringify(storagePrefix),
        "process.env.PUBLIC_DESKTOP_URL": JSON.stringify(publicDesktopUrl),
        "process.env.PUBLIC_DESKTOP_ASSET_BASE_URL": JSON.stringify(assetBaseUrl),
        "import.meta.env.PUBLIC_DESKTOP_APP_NAME": JSON.stringify(appName),
        "import.meta.env.PUBLIC_DESKTOP_GATEWAY_URL": JSON.stringify(gatewayUrl),
        "import.meta.env.PUBLIC_DESKTOP_RUNTIME": JSON.stringify(runtimeMode),
        "import.meta.env.PUBLIC_DESKTOP_STORAGE_PREFIX": JSON.stringify(storagePrefix),
        "import.meta.env.PUBLIC_DESKTOP_URL": JSON.stringify(publicDesktopUrl),
        "import.meta.env.PUBLIC_DESKTOP_ASSET_BASE_URL": JSON.stringify(assetBaseUrl),
        "import.meta.env.PUBLIC_ENABLE_AGENTATION": JSON.stringify(agentationEnabled ? "true" : "false"),
      },
      decorators: {
        version: "legacy",
      },
    },
    resolve: {
      alias: {
        ...(!agentationEnabled
          ? {
              "@/components/dev/agentation-overlay$": path.join(
                __dirname,
                "src/components/dev/agentation-overlay.noop.tsx",
              ),
            }
          : {}),
        "@": path.join(__dirname, "src"),
        "@a3s-lab/ocr/defaults": path.join(__dirname, "../../packages/ocr/src/defaults.ts"),
        lodash$: "lodash-es",
      },
    },
    output: {
      distPath: {
        root: "dist/workspace",
      },
      filename: {
        js: "static/js/[name].[contenthash].js",
        css: "static/css/[name].[contenthash].css",
      },
      publicPath: "./",
      // Enable minification and optimization
      minify: {
        js: true,
        css: true,
      },
      // Keep packaged workspace small; enable only when debugging a desktop build.
      sourceMap: {
        js: process.env.PUBLIC_DESKTOP_SOURCEMAP === "true" ? "source-map" : false,
      },
      overrideBrowserslist: browserTargets,
    },
    server: {
      host: "127.0.0.1",
      port: workspacePort,
      strictPort: true,
      proxy: {
        "/api/v1": sidecarProxy(gatewayUrl),
        "/openapi.json": sidecarProxy(gatewayUrl),
        "/open/openapi.json": sidecarProxy(gatewayUrl),
        "/git": sidecarProxy(gatewayUrl),
        "/v2": sidecarProxy(gatewayUrl),
        "/socket.io": sidecarProxy(gatewayUrlForProxy, { ws: true }),
      },
    },
    plugins: [pluginReact(), pluginLess(), pluginSass()],
    tools: {
      rspack(config) {
        config.ignoreWarnings = [...(config.ignoreWarnings ?? []), ignoreKnownEditorWorkerWarnings];
      },
    },
  };
});
