/**
 * Monaco environment setup — must be first to ensure local workers are used
 * instead of CDN loading. Import before any Monaco component is rendered.
 */
import "@/desktop/lib/monaco-env";

import { AppUpdateBootstrap } from "./components/app-update-bootstrap";
import { BackendStartupGuard } from "./components/backend-startup-guard";
import { ErrorBoundary } from "@/components/custom/error-boundary";
import { KeyboardDispatcherProvider } from "@/contexts/keyboard-dispatcher-provider";
import { ModalProvider } from "./components/modal-provider";
import { ThemeProvider } from "@/components/custom/theme-provider";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import constants from "@/desktop/constants";
import { readStorage, removeStorage, writeStorage } from "@/lib/browser-storage";
import { notifyClientError } from "@/lib/client-error";
import { initHitlAuth, startAutoCleanup } from "@/lib/hitl-auth";
import { allowsLocalWorkspacePaths } from "@/lib/runtime-environment";
import { ensureWorkspaceReadiness } from "@/lib/workspace-utils";
import settingsModel from "@/models/settings.model";
import { AgentationOverlay } from "@/components/dev/agentation-overlay";
import { PlatformBrandEffect } from "@/components/platform/platform-brand-effect";
import assistantIdentityModel from "@/models/assistant-identity.model";
import platformBrandModel from "@/models/platform-brand.model";
import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime";
import type { ErrorInfo, ReactNode } from "react";
import ReactDOM from "react-dom/client";
import { RouterProvider } from "react-router-dom";
import { Suspense } from "react";
import { subscribe } from "valtio";
import router from "./router";

import "dayjs/locale/zh-cn";
import "./index.css";

import { AgentRuntimeProvider, setAgentRuntime } from "@/runtime";
import { desktopRuntime } from "./runtime";
setAgentRuntime(desktopRuntime);

dayjs.locale("zh-cn");
dayjs.extend(relativeTime);

type InternShannonBootOverlay = {
	setStage?: (stage: string, message?: string) => void;
	markRootMounted?: () => void;
	fail?: (stage: string, reason: unknown) => void;
	ready?: () => void;
};

const CHUNK_RELOAD_KEY = "internshannon-chunk-reload-once";

function bootOverlay(): InternShannonBootOverlay | null {
	if (typeof window === "undefined") return null;
	return (
		(
			window as typeof window & {
				__internshannonBoot?: InternShannonBootOverlay;
			}
		).__internshannonBoot ?? null
	);
}

function maybeRecoverFromChunkLoadError(reason: unknown) {
	if (typeof window === "undefined") return false;
	const message =
		reason instanceof Error
			? reason.message
			: typeof reason === "string"
				? reason
				: typeof reason === "object" && reason && "message" in reason
					? String((reason as { message?: unknown }).message ?? "")
					: "";

	if (
		!/Loading chunk|ChunkLoadError|failed to fetch dynamically imported module/i.test(
			message,
		)
	) {
		return false;
	}

	try {
		if (readStorage(CHUNK_RELOAD_KEY, null, "session") === "1") {
			removeStorage(CHUNK_RELOAD_KEY, "session");
			return false;
		}
		writeStorage(CHUNK_RELOAD_KEY, "1", "session");
		window.location.reload();
		return true;
	} catch {
		return false;
	}
}

function formatStartupReason(reason: unknown) {
	if (reason instanceof Error) {
		return `${reason.name}: ${reason.message}`;
	}
	if (typeof reason === "string") return reason;
	if (typeof reason === "object" && reason && "message" in reason) {
		return String((reason as { message?: unknown }).message ?? "Unknown error");
	}
	return "Unknown error";
}

function BootstrapScreen(props: {
	title: string;
	message: string;
	details?: string;
	busy?: boolean;
	actions?: ReactNode;
}) {
	return (
		<div className="fixed inset-0 flex items-center justify-center bg-[radial-gradient(circle_at_top,#f8fafc,#e2e8f0)] p-4 text-slate-950">
			<div className="w-full max-w-2xl rounded-[10px] border border-slate-200 bg-white p-5 shadow-[0_12px_16px_-4px_rgba(36,36,36,0.08)]">
				<div className="flex items-start gap-3">
					<div
						className={`mt-1 size-3 shrink-0 rounded-full ${
							props.busy ? "animate-pulse bg-amber-500" : "bg-rose-600"
						}`}
					/>
					<div className="min-w-0">
						<h1 className="text-lg font-semibold">{props.title}</h1>
						<p className="mt-1.5 text-sm leading-6 text-slate-600">
							{props.message}
						</p>
						{props.details ? (
							<pre className="mt-5 overflow-auto rounded-[8px] border border-slate-200 bg-slate-950/95 p-4 text-xs leading-6 text-slate-100">
								{props.details}
							</pre>
						) : null}
						{props.actions ? (
							<div className="mt-5 flex flex-wrap gap-2">{props.actions}</div>
						) : null}
					</div>
				</div>
			</div>
		</div>
	);
}

function RuntimeErrorScreen({
	error,
	errorInfo,
	reset,
}: {
	error: Error | null;
	errorInfo?: ErrorInfo;
	reset: () => void;
}) {
	return (
		<BootstrapScreen
			title="InternShannon 界面出错"
			message="界面运行时发生异常，当前页面已被保护起来。你可以先重试；如果仍然失败，请刷新页面。"
			details={[
				formatStartupReason(error),
				errorInfo?.componentStack?.trim() || null,
			]
				.filter(Boolean)
				.join("\n\n")}
			actions={
				<>
					<button
						type="button"
						onClick={reset}
						className="inline-flex h-9 items-center rounded-[8px] border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
					>
						重试
					</button>
					<button
						type="button"
						onClick={() => window.location.reload()}
						className="inline-flex h-9 items-center rounded-[8px] bg-slate-950 px-4 text-sm font-medium text-white transition-colors hover:bg-slate-800"
					>
						刷新页面
					</button>
				</>
			}
		/>
	);
}

function renderStartupFatal(root: ReactDOM.Root, reason: unknown) {
	bootOverlay()?.fail?.("react-bootstrap", reason);
	root.render(
		<BootstrapScreen
			title="InternShannon 启动失败"
			message="界面在初始化阶段发生异常，当前会话无法继续。请重新打开页面或重启应用；如果问题持续出现，请收集下面的错误信息。"
			details={formatStartupReason(reason)}
		/>,
	);
}

async function syncWorkspaceLogging() {
	try {
		if (!allowsLocalWorkspacePaths()) {
			return;
		}
		await ensureWorkspaceReadiness(
			settingsModel.state.agentDefaults.workspaceRoot,
		);
	} catch (error) {
		console.warn("Failed to initialize workspace logging:", error);
	}
}

// Seed settings from backend config on startup.
// The embedded gateway may not be ready immediately, so retry briefly.
bootOverlay()?.setStage?.(
	"settings-seed",
	"前端脚本已开始执行，正在同步本地设置与后端运行时。",
);
void syncWorkspaceLogging();
settingsModel.waitForSeed().then(() => {
	void syncWorkspaceLogging();
});
void platformBrandModel.seedFromBackend().catch((error) => {
	console.warn("Failed to seed desktop platform brand:", error);
});
// 默认智能助手展示身份;模型内部对失败静默回退到内置默认。
void assistantIdentityModel.seedFromBackend();

// Initialize HITL authorization system
initHitlAuth();
startAutoCleanup();

let lastWorkspaceRoot = settingsModel.state.agentDefaults.workspaceRoot.trim();
subscribe(settingsModel.state, () => {
	const nextWorkspaceRoot =
		settingsModel.state.agentDefaults.workspaceRoot.trim();
	if (nextWorkspaceRoot === lastWorkspaceRoot) return;
	lastWorkspaceRoot = nextWorkspaceRoot;
	void syncWorkspaceLogging();
});

// Enable stream debug logs by default in development.
if (constants.isDev) {
	writeStorage("internshannon-stream-debug", "true");
}

// Track if we're still in startup phase (before React tree is mounted)
let isStartupPhase = true;

const rootEl = document.getElementById("root");
if (rootEl) {
	const root = ReactDOM.createRoot(rootEl);
	bootOverlay()?.setStage?.("react-render", "React 正在渲染主界面。");

	window.addEventListener("unhandledrejection", (event) => {
		if (maybeRecoverFromChunkLoadError(event.reason)) {
			event.preventDefault();
			return;
		}
		if (!isStartupPhase) {
			event.preventDefault();
			notifyClientError(event.reason, {
				title: "后台操作失败",
				source: "window.unhandledrejection",
			});
			return;
		}
		console.error("Unhandled startup rejection:", event.reason);
		event.preventDefault();
		renderStartupFatal(root, event.reason);
	});

	window.addEventListener("error", (event) => {
		const reason = event.error ?? event.message;
		if (maybeRecoverFromChunkLoadError(reason)) {
			event.preventDefault();
			return;
		}
		if (!isStartupPhase) {
			event.preventDefault();
			notifyClientError(reason, {
				title: "界面运行错误",
				source: "window.error",
			});
			return;
		}
		console.error("Unhandled startup error:", reason);
		event.preventDefault();
		renderStartupFatal(root, reason);
	});

	root.render(
		<>
			<ErrorBoundary
				verbose
				fallback={({ error, errorInfo, reset }) => (
					<RuntimeErrorScreen
						error={error}
						errorInfo={errorInfo}
						reset={reset}
					/>
				)}
			>
				<AgentRuntimeProvider runtime={desktopRuntime}>
					<ThemeProvider>
						<ModalProvider>
							<TooltipProvider>
								<BackendStartupGuard>
									<KeyboardDispatcherProvider>
										<Suspense
											fallback={
												<BootstrapScreen
													title="InternShannon 正在启动"
													message="界面资源与本地运行时正在加载。首次启动、杀毒软件实时扫描或磁盘较慢时，这个阶段可能会持续几十秒。"
													busy
												/>
											}
										>
											<PlatformBrandEffect fallbackLogoUrl="/logo.png" />
											<RouterProvider router={router} />
											<AgentationOverlay />
										</Suspense>
									</KeyboardDispatcherProvider>
								</BackendStartupGuard>
								<AppUpdateBootstrap />
							</TooltipProvider>
						</ModalProvider>
					</ThemeProvider>
				</AgentRuntimeProvider>
			</ErrorBoundary>
			<Toaster position="top-right" duration={3000} />
		</>,
	);
	// Mark startup as complete - after this, global errors won't show fatal screen
	bootOverlay()?.markRootMounted?.();
	const finishStartup = () => {
		isStartupPhase = false;
		bootOverlay()?.ready?.();
	};
	window.setTimeout(finishStartup, 0);
	window.requestAnimationFrame(finishStartup);
}
