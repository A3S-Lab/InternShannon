import { createContext, useContext, type ReactNode } from "react";

/**
 * Runtime provider interface — abstracts environment-specific capabilities.
 * Desktop injects Tauri-based implementations, Admin injects browser-based ones.
 */
export interface AgentRuntime {
  /**
   * HTTP fetch function for API calls.
   * Desktop: sidecarFetch (Tauri loopback or plugin-http)
   * Admin: standard fetch
   */
  fetch: (url: string, init?: RequestInit) => Promise<Response>;

  /**
   * Base URL for the kernel gateway API.
   * Desktop: http://127.0.0.1:29653
   * Admin: window.location.origin or configured API URL
   */
  gatewayUrl: string;

  /**
   * localStorage key prefix for state persistence.
   */
  storagePrefix: string;

  /**
   * Whether this runtime supports native desktop features.
   */
  isDesktop: boolean;

  /**
   * Invoke a native desktop command (Tauri invoke).
   * Returns null in non-desktop environments.
   */
  invoke: <T>(command: string, args?: Record<string, unknown>) => Promise<T | null>;

  /**
   * Open a native directory picker dialog.
   * Returns null if not supported.
   */
  pickDirectory?: (defaultPath?: string) => Promise<string | null>;

  /**
   * Write a file to the local filesystem (native only).
   */
  writeFile?: (path: string, content: string) => Promise<void>;

  /**
   * Speak text using native TTS.
   */
  speak?: (text: string) => Promise<void>;

  /**
   * Open a URL in the default browser.
   */
  openUrl?: (url: string) => Promise<void>;

  /**
   * Open a folder in the file explorer.
   */
  openFolder?: (path: string) => Promise<void>;
}

const AgentRuntimeContext = createContext<AgentRuntime | null>(null);

export function AgentRuntimeProvider({ runtime, children }: { runtime: AgentRuntime; children: ReactNode }) {
  return <AgentRuntimeContext.Provider value={runtime}>{children}</AgentRuntimeContext.Provider>;
}

export function useAgentRuntime(): AgentRuntime {
  const runtime = useContext(AgentRuntimeContext);
  if (!runtime) {
    throw new Error("useAgentRuntime must be used within AgentRuntimeProvider");
  }
  return runtime;
}

export function useAgentRuntimeOptional(): AgentRuntime | null {
  return useContext(AgentRuntimeContext);
}
