import { configApi, type PlatformSettings, type SystemInfo } from "@/lib/api/config";
import constants from "@/lib/constants";
import { proxy } from "valtio";

const fallbackName =
  (typeof document !== "undefined" ? document.title.trim() : "") || constants.name?.trim() || "InternShannon";
const fallbackLogoUrl = "/logo.png";
const BRAND_CACHE_KEY = "platform-brand:v1";

export interface PlatformBrandState {
  appName: string;
  logoUrl: string;
  version: string;
  hydrated: boolean;
  loading: boolean;
  error: string | null;
}

const cachedBrand = readCachedBrand();

const state = proxy<PlatformBrandState>({
  appName: cachedBrand.appName || fallbackName,
  logoUrl: cachedBrand.logoUrl || "",
  version: "",
  hydrated: false,
  loading: false,
  error: null,
});

function normalizeText(value?: string | null) {
  return value?.trim() || "";
}

function normalizeLogoUrl(value?: string | null) {
  const logoUrl = normalizeText(value);
  if (!logoUrl) return "";
  if (/^https?:\/\//i.test(logoUrl)) return logoUrl;
  if (/^(?:\/(?!\/)|\.{1,2}\/)/.test(logoUrl)) return logoUrl;
  if (/^data:image\/(?:png|jpe?g|gif|webp|svg\+xml);base64,[a-z0-9+/=]+$/i.test(logoUrl)) return logoUrl;
  return "";
}

function readCachedBrand(): Pick<SystemInfo, "appName" | "logoUrl"> {
  if (typeof window === "undefined") return { appName: "", logoUrl: "" };
  try {
    const raw = window.localStorage.getItem(BRAND_CACHE_KEY);
    if (!raw) return { appName: "", logoUrl: "" };
    const parsed = JSON.parse(raw) as Partial<SystemInfo>;
    return {
      appName: normalizeText(parsed.appName),
      logoUrl: normalizeLogoUrl(parsed.logoUrl),
    };
  } catch {
    return { appName: "", logoUrl: "" };
  }
}

function writeCachedBrand(input: Pick<SystemInfo, "appName" | "logoUrl">) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(BRAND_CACHE_KEY, JSON.stringify(input));
  } catch {
    // Ignore storage quota/privacy failures; backend hydration is still authoritative.
  }
}

function applyBrand(input: Pick<SystemInfo, "appName" | "logoUrl"> & Partial<Pick<SystemInfo, "version">>) {
  const appName = normalizeText(input.appName);
  const logoUrl = normalizeLogoUrl(input.logoUrl);

  state.appName = appName || fallbackName;
  state.logoUrl = logoUrl;
  state.version = normalizeText(input.version);
  state.hydrated = true;
  state.error = null;
  writeCachedBrand({ appName: state.appName, logoUrl: state.logoUrl });
}

function applyPlatformSettings(platform: PlatformSettings) {
  applyBrand({
    appName: platform.appName,
    logoUrl: platform.logoUrl,
    version: state.version,
  });
}

async function seedFromBackend(): Promise<boolean> {
  if (state.loading) return false;
  state.loading = true;
  try {
    applyBrand(await configApi.systemInfo());
    return true;
  } catch (error) {
    state.hydrated = true;
    state.error = error instanceof Error ? error.message : "加载平台品牌失败";
    return false;
  } finally {
    state.loading = false;
  }
}

function effectiveName(fallback = fallbackName) {
  return normalizeText(state.appName) || fallback;
}

function effectiveLogoUrl(fallback = fallbackLogoUrl) {
  return normalizeLogoUrl(state.logoUrl) || fallback;
}

export default {
  state,
  fallbackName,
  fallbackLogoUrl,
  applyBrand,
  applyPlatformSettings,
  seedFromBackend,
  effectiveName,
  effectiveLogoUrl,
};
