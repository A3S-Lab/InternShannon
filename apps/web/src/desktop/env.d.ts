/// <reference types="@rsbuild/core/types" />

// Tauri v2 window augmentation
declare global {
	interface Window {
		__TAURI__?: {
			core: {
				invoke: <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;
			};
		};
		__TAURI_INTERNALS__?: unknown;
	}
}

export {};
