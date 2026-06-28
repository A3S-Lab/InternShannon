export {
	getRuntimeCapabilities,
	getSpaRuntimeKind,
	hasTauriCore,
	isWebRuntime,
	type RuntimeCapabilities,
	type SpaRuntimeKind,
} from "@/lib/runtime-environment";

import { hasTauriCore } from "@/lib/runtime-environment";

export function desktopOnlyMessage(action = "该操作"): string {
	return `${action}仅在桌面版可用，网页版请手动输入路径或改用桌面应用。`;
}

export async function invokeDesktop<T>(
	command: string,
	args?: Record<string, unknown>,
): Promise<T> {
	if (!hasTauriCore()) {
		throw new Error(desktopOnlyMessage());
	}
	const { invoke: tauriInvoke } = await import("@tauri-apps/api/core");
	return tauriInvoke<T>(command, args);
}

export async function invokeDesktopOptional<T>(
	command: string,
	args?: Record<string, unknown>,
): Promise<T | null> {
	if (!hasTauriCore()) return null;
	return invokeDesktop<T>(command, args);
}

export async function openNativeDialog(
	options: Record<string, unknown>,
): Promise<string | string[] | null> {
	// 检查是否在 Tauri 环境中
	const inTauri = hasTauriCore();

	if (inTauri) {
		try {
			const { open } = await import("@tauri-apps/plugin-dialog");
			return await open(options as never);
		} catch (e) {
			// Tauri 环境但对话框不可用时，回退到手动输入
			console.warn("[tauri-runtime] Tauri dialog failed, falling back:", e);
		}
	}

	// 非 Tauri 环境或 Tauri 对话框失败时，使用浏览器 prompt 让用户手动输入路径
	const title =
		typeof options.title === "string" ? options.title : "输入路径";
	const value = window.prompt(
		`${title}\n\n浏览器环境无法打开系统文件夹选择器。\n请手动输入文件夹的完整路径，\n或者使用桌面版应用来选择文件夹。`,
	);
	return value?.trim() || null;
}

export async function openNativeDirectoryDialog(): Promise<string | null> {
	const selected = await openNativeDialog({
		directory: true,
		multiple: false,
	});
	return typeof selected === "string" ? selected : null;
}

export async function openExternalUrl(url: string): Promise<void> {
	if (hasTauriCore()) {
		try {
			const { open } = await import("@tauri-apps/plugin-shell");
			await open(url);
			return;
		} catch {
			await invokeDesktop("open_url_in_browser", { url });
			return;
		}
	}
	window.open(url, "_blank", "noopener,noreferrer");
}

export async function openLocalPath(path: string): Promise<boolean> {
	if (!path.trim()) return false;
	if (!hasTauriCore()) {
		return false;
	}
	await invokeDesktop("open_folder", { path });
	return true;
}
