import { isDesktopRuntime } from "./runtime-environment";
import { probeSidecarHealth } from "./sidecar-http";

let backendReady = false;
let waiters: Array<() => void> = [];
let lastProbe = "";

const PROBE_INTERVAL_MS = 700;
const PROBE_TIMEOUT_MS = 2500;

export function isBackendReady(): boolean {
	return backendReady;
}

export function getLastBackendReadyProbe(): string {
	return lastProbe;
}

export function markBackendReady(): void {
	if (backendReady) return;
	backendReady = true;
	const pending = waiters;
	waiters = [];
	for (const resolve of pending) {
		resolve();
	}
}

async function probeBackendReady(): Promise<boolean> {
	const result = await probeSidecarHealth({ timeoutMs: PROBE_TIMEOUT_MS });
	lastProbe = result.attempts.at(-1) || result.error || "";
	if (result.ok) {
		markBackendReady();
		return true;
	}
	return false;
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function waitForBackendReady(options?: {
	timeoutMs?: number;
}): Promise<void> {
	if (backendReady) return;

	// Web/cloud: the API is an always-on separate service — there is no local sidecar to
	// wait for booting. Probing /api/v1/health here only floods it when the API is briefly
	// unreachable: http.ts gates every request on this, so each request/retry (e.g. under a
	// no-permission / api-down state) re-spawns a 700ms health poll-storm → endless requests.
	// The sidecar startup-readiness gate is only meaningful in desktop (Tauri sidecar); in web
	// a down API surfaces as a normal request error and is handled there.
	if (!isDesktopRuntime()) {
		markBackendReady();
		return;
	}

	const timeoutMs = options?.timeoutMs ?? 15000;
	const deadline = Date.now() + timeoutMs;

	if (await probeBackendReady()) return;

	await new Promise<void>((resolve, reject) => {
		let finished = false;
		let timeoutId: ReturnType<typeof setTimeout> | null = null;

		const complete = () => {
			if (finished) return;
			finished = true;
			if (timeoutId) clearTimeout(timeoutId);
			resolve();
		};

		waiters.push(complete);

		if (timeoutMs > 0) {
			timeoutId = setTimeout(() => {
				if (finished) return;
				finished = true;
				waiters = waiters.filter((waiter) => waiter !== complete);
				reject(
					new Error(
						`Local backend is not ready after waiting ${timeoutMs}ms. Last probe: ${lastProbe || "none"}`,
					),
				);
			}, timeoutMs);
		}

		void (async () => {
			while (!finished && !backendReady && Date.now() < deadline) {
				if (await probeBackendReady()) {
					complete();
					return;
				}
				await sleep(PROBE_INTERVAL_MS);
			}
		})();
	});
}
