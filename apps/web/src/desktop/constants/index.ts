import { resolveDesktopGatewayUrl } from "@/lib/desktop-gateway-url";

const processEnv = typeof process !== "undefined" ? process.env : {};
const desktopGatewayEnv = {
  PUBLIC_DESKTOP_GATEWAY_URL: import.meta.env?.PUBLIC_DESKTOP_GATEWAY_URL,
};
const isDev = (import.meta.env?.MODE || processEnv.NODE_ENV) === "development";
const gatewayUrl = resolveDesktopGatewayUrl(desktopGatewayEnv, processEnv);
const appName = import.meta.env?.PUBLIC_DESKTOP_APP_NAME || processEnv.PUBLIC_DESKTOP_APP_NAME || "InternShannon";
const runtimeMode = import.meta.env?.PUBLIC_DESKTOP_RUNTIME || processEnv.PUBLIC_DESKTOP_RUNTIME || "web";
const localStorageKeyPrefix =
  import.meta.env?.PUBLIC_DESKTOP_STORAGE_PREFIX || processEnv.PUBLIC_DESKTOP_STORAGE_PREFIX || "internshannon";
const assetBasePath =
  import.meta.env?.PUBLIC_DESKTOP_ASSET_BASE_URL ||
  import.meta.env?.PUBLIC_DESKTOP_BASE_URL ||
  processEnv.PUBLIC_DESKTOP_ASSET_BASE_URL ||
  processEnv.PUBLIC_DESKTOP_BASE_URL ||
  "/";
const normalisedAssetBasePath = assetBasePath.endsWith("/") ? assetBasePath.slice(0, -1) : assetBasePath;

export const COPY_FEEDBACK_MS = 2000;
const normalisedAssetBase = normalisedAssetBasePath === "/" ? "" : normalisedAssetBasePath;

export function workspaceAssetPath(assetPath: string): string {
  const cleanPath = assetPath.replace(/^\/+/, "");
  if (!cleanPath) return normalisedAssetBase || ".";
  return normalisedAssetBase ? `${normalisedAssetBase}/${cleanPath}` : `./${cleanPath}`;
}

export default {
  isDev,
  name: appName,
  description: "认知驱动的个人智能助手",
  gatewayUrl,
  runtimeMode,
  localStorageKeyPrefix,
  assetBasePath: normalisedAssetBasePath,
  workspaceAssetPath: workspaceAssetPath,
};
