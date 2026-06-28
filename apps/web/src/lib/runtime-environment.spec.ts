import * as assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { setAgentRuntime } from "../runtime/singleton.ts";
import {
  allowsLocalWorkspacePaths,
  getRuntimeCapabilities,
  hasTauriCore,
  isDesktopRuntime,
} from "./runtime-environment.ts";

function runtime(isDesktop: boolean): Parameters<typeof setAgentRuntime>[0] {
  return {
    fetch,
    gatewayUrl: "",
    storagePrefix: "test",
    isDesktop,
    invoke: async () => null,
  };
}

function setWindow(value: unknown): void {
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value,
  });
}

afterEach(() => {
  setAgentRuntime(runtime(false));
  delete (globalThis as { window?: unknown }).window;
});

test("desktop runtime allows local workspace paths without the Tauri bridge", () => {
  setAgentRuntime(runtime(true));
  delete (globalThis as { window?: unknown }).window;

  assert.equal(hasTauriCore(), false);
  assert.equal(isDesktopRuntime(), true);
  assert.equal(allowsLocalWorkspacePaths(), true);
});

test("web runtime does not allow local workspace paths without the Tauri bridge", () => {
  setAgentRuntime(runtime(false));
  delete (globalThis as { window?: unknown }).window;

  assert.equal(hasTauriCore(), false);
  assert.equal(isDesktopRuntime(), false);
  assert.equal(allowsLocalWorkspacePaths(), false);
});

test("native Tauri bridge still enables native runtime capabilities", () => {
  setAgentRuntime(runtime(false));
  setWindow({
    __TAURI__: {
      core: {
        invoke: () => undefined,
      },
    },
  });

  assert.equal(hasTauriCore(), true);
  assert.equal(isDesktopRuntime(), true);
  assert.equal(allowsLocalWorkspacePaths(), true);
  assert.deepEqual(getRuntimeCapabilities(), {
    nativeDialog: true,
    nativeFileSystem: true,
    nativeShell: true,
    nativeUpdater: true,
    loopbackProxy: true,
  });
});
