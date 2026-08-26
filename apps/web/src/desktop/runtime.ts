import { resolveDesktopGatewayUrl } from "@/lib/desktop-gateway-url";
import { sidecarFetch } from "@/lib/sidecar-http";
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

async function tauriInvoke<T>(
	command: string,
	args?: Record<string, unknown>,
): Promise<T | null> {
	if (!hasTauriCore()) return null;
	try {
		const { invoke } = await import("@tauri-apps/api/core");
		return await invoke<T>(command, args);
	} catch {
		return null;
	}
}

const desktopGatewayEnv = {
	PUBLIC_DESKTOP_GATEWAY_URL: import.meta.env?.PUBLIC_DESKTOP_GATEWAY_URL,
};
const processEnv = typeof process !== "undefined" ? process.env : {};
const gatewayUrl = resolveDesktopGatewayUrl(desktopGatewayEnv, processEnv);

const storagePrefix =
	import.meta.env?.PUBLIC_DESKTOP_STORAGE_PREFIX ||
	processEnv.PUBLIC_DESKTOP_STORAGE_PREFIX ||
	"internshannon";

export const desktopRuntime: AgentRuntime = {
	fetch: sidecarFetch,
	gatewayUrl,
	storagePrefix,
	isDesktop: true,

	invoke: tauriInvoke,

	async pickDirectory(defaultPath?: string) {
		if (!hasTauriCore()) return null;
		const { open } = await import("@tauri-apps/plugin-dialog");
		const result = await open({
			directory: true,
			multiple: false,
			defaultPath,
		});
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

/** Resolve the native-selected port before React creates HTTP or WebSocket clients. */
export async function initializeDesktopRuntimeGateway(): Promise<string> {
	const nativeGatewayUrl = await tauriInvoke<string>("get_gateway_url");
	const resolvedGatewayUrl = String(nativeGatewayUrl || "")
		.trim()
		.replace(/\/+$/, "");
	if (resolvedGatewayUrl) {
		desktopRuntime.gatewayUrl = resolvedGatewayUrl;
	}
	return desktopRuntime.gatewayUrl;
}
