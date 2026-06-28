import { getAgentRuntimeOptional } from "../runtime/singleton.ts";

export type SpaRuntimeKind = "tauri" | "web";

type TauriWindow = Window & {
  __TAURI__?: {
    core?: {
      invoke?: unknown;
    };
  };
};

export interface RuntimeCapabilities {
  nativeDialog: boolean;
  nativeFileSystem: boolean;
  nativeShell: boolean;
  nativeUpdater: boolean;
  loopbackProxy: boolean;
}

export function hasTauriCore(): boolean {
  if (typeof window === "undefined") return false;
  return typeof (window as TauriWindow).__TAURI__?.core?.invoke === "function";
}

export function isDesktopRuntime(): boolean {
  return Boolean(getAgentRuntimeOptional()?.isDesktop) || hasTauriCore();
}

export function allowsLocalWorkspacePaths(): boolean {
  return isDesktopRuntime();
}

export function getSpaRuntimeKind(): SpaRuntimeKind {
  return hasTauriCore() ? "tauri" : "web";
}

export function isWebRuntime(): boolean {
  return getSpaRuntimeKind() === "web";
}

export function isApplePlatform(): boolean {
  if (typeof navigator === "undefined") return false;
  const nav = navigator as Navigator & {
    userAgentData?: { platform?: string };
  };
  const platform = nav.userAgentData?.platform || nav.platform || "";
  if (/mac|iphone|ipad|ipod/i.test(platform)) return true;
  return /Mac OS X|iPhone|iPad|iPod/i.test(nav.userAgent || "");
}

export function createCompatId(prefix = "id"): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function cloneJsonCompat<T>(value: T): T {
  if (typeof structuredClone === "function") {
    return structuredClone(value);
  }
  return JSON.parse(JSON.stringify(value)) as T;
}

export function getRuntimeCapabilities(): RuntimeCapabilities {
  const native = hasTauriCore();
  return {
    nativeDialog: native,
    nativeFileSystem: native,
    nativeShell: native,
    nativeUpdater: native,
    loopbackProxy: native,
  };
}
