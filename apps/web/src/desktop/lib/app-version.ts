import { hasTauriCore } from "@/lib/tauri-runtime";
import packageJson from "../../../package.json";

let versionPromise: Promise<string> | null = null;

export async function getCurrentAppVersion(): Promise<string> {
	if (!versionPromise) {
		versionPromise = (async () => {
			if (!hasTauriCore()) return packageJson.version;
			const { getVersion } = await import("@tauri-apps/api/app");
			return getVersion().catch(() => packageJson.version);
		})();
	}
	return versionPromise;
}
