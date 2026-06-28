import {
	hasTauriCore,
	invokeDesktop,
	desktopOnlyMessage,
} from "@/lib/tauri-runtime";

export interface AppUpdateInfo {
	currentVersion: string;
	latestVersion: string;
	hasUpdate: boolean;
	releaseNotes?: string | null;
	releaseUrl?: string | null;
	assetName?: string | null;
	downloadedPath?: string | null;
}

export interface AppUpdateProgress {
	phase: "downloading" | "progress" | "installing" | "finished";
	downloadedBytes: number;
	totalBytes?: number | null;
}

export async function checkAppUpdate(): Promise<AppUpdateInfo> {
	if (!hasTauriCore()) {
		return {
			currentVersion: "",
			latestVersion: "",
			hasUpdate: false,
		};
	}
	return invokeDesktop<AppUpdateInfo>("check_app_update");
}

export async function installAppUpdate(
	onProgress?: (progress: AppUpdateProgress) => void,
): Promise<AppUpdateInfo> {
	if (!hasTauriCore()) {
		throw new Error(desktopOnlyMessage("自动更新"));
	}
	const { listen } = await import("@tauri-apps/api/event");
	const unlisten = await listen<AppUpdateProgress>(
		"internshannon://updater-progress",
		(event) => {
			onProgress?.(event.payload);
		},
	);
	try {
		return await invokeDesktop<AppUpdateInfo>("install_app_update");
	} finally {
		unlisten();
	}
}
