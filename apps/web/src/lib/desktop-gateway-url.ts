export const DEFAULT_DESKTOP_GATEWAY_URL = "http://127.0.0.1:29653";

export type DesktopGatewayEnv = {
  PUBLIC_DESKTOP_GATEWAY_URL?: string | null;
  VITE_API_URL?: string | null;
  PUBLIC_API_BASE_URL?: string | null;
};

export function normalizeGatewayUrl(value?: string | null): string {
  return (value || "").trim().replace(/\/+$/, "");
}

export function resolveBrowserGatewayUrl(env: DesktopGatewayEnv = {}): string {
  return (
    normalizeGatewayUrl(env.PUBLIC_DESKTOP_GATEWAY_URL) ||
    normalizeGatewayUrl(env.VITE_API_URL) ||
    normalizeGatewayUrl(env.PUBLIC_API_BASE_URL)
  );
}

export function resolveDesktopGatewayUrl(env: DesktopGatewayEnv = {}, processEnv: DesktopGatewayEnv = {}): string {
  return (
    normalizeGatewayUrl(env.PUBLIC_DESKTOP_GATEWAY_URL) ||
    normalizeGatewayUrl(processEnv.PUBLIC_DESKTOP_GATEWAY_URL) ||
    DEFAULT_DESKTOP_GATEWAY_URL
  );
}
