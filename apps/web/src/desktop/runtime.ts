import { resolveDesktopGatewayUrl } from "@/lib/desktop-gateway-url";
import type { AgentRuntime } from "@/runtime";

type TauriWindow = Window & {
  __TAURI__?: {
    core?: {
      invoke?: unknown;
    };
  };
};

function hasTauriCore(): boolean {
  if (typeof window === "undefined") return false;
  return typeof (window as TauriWindow).__TAURI__?.core?.invoke === "function";
}

function isLoopbackUrl(url: string): boolean {
  try {
    const parsed = new URL(url, window.location.origin);
    const hostname = parsed.hostname.replace(/^\[|\]$/g, "");
    return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
  } catch {
    return url.includes("localhost") || url.includes("127.0.0.1") || url.includes("::1");
  }
}

async function tauriInvoke<T>(command: string, args?: Record<string, unknown>): Promise<T | null> {
  if (!hasTauriCore()) return null;
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return await invoke<T>(command, args);
  } catch {
    return null;
  }
}

async function desktopFetch(url: string, init?: RequestInit): Promise<Response> {
  if (hasTauriCore()) {
    if (isLoopbackUrl(url)) {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        const result = await invoke<{ status: number; headers: Record<string, string>; body: string }>(
          "loopback_http_request",
          {
            method: init?.method || "GET",
            url,
            headers: init?.headers ? Object.fromEntries(new Headers(init.headers).entries()) : {},
            body: init?.body ? String(init.body) : null,
          },
        );
        return new Response(result.body, { status: result.status, headers: result.headers });
      } catch {
        // Fallback below keeps desktop dev usable when the command is unavailable.
      }
    }
    try {
      const { fetch: tauriFetch } = await import("@tauri-apps/plugin-http");
      return await tauriFetch(url, init);
    } catch {
      // Fallback to standard fetch.
    }
  }
  return fetch(url, init);
}

const desktopGatewayEnv = {
  PUBLIC_DESKTOP_GATEWAY_URL: import.meta.env?.PUBLIC_DESKTOP_GATEWAY_URL,
};
const processEnv = typeof process !== "undefined" ? process.env : {};
const gatewayUrl = resolveDesktopGatewayUrl(desktopGatewayEnv, processEnv);

const storagePrefix =
  import.meta.env?.PUBLIC_DESKTOP_STORAGE_PREFIX || processEnv.PUBLIC_DESKTOP_STORAGE_PREFIX || "internshannon";

export const desktopRuntime: AgentRuntime = {
  fetch: desktopFetch,
  gatewayUrl,
  storagePrefix,
  isDesktop: true,

  invoke: tauriInvoke,

  async pickDirectory(defaultPath?: string) {
    if (!hasTauriCore()) return null;
    const { open } = await import("@tauri-apps/plugin-dialog");
    const result = await open({ directory: true, multiple: false, defaultPath });
    return typeof result === "string" ? result : null;
  },

  async writeFile(path: string, content: string) {
    if (!hasTauriCore()) return;
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke<void>("workspace_write_file", { path, content });
  },

  async speak(text: string) {
    if (!hasTauriCore()) return;
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("voice_tts_speak", { text });
  },

  async openUrl(url: string) {
    if (!hasTauriCore()) {
      window.open(url, "_blank");
      return;
    }
    try {
      const { open } = await import("@tauri-apps/plugin-shell");
      await open(url);
    } catch {
      window.open(url, "_blank");
    }
  },

  async openFolder(path: string) {
    if (!hasTauriCore()) return;
    await tauriInvoke("open_folder", { path });
  },
};
