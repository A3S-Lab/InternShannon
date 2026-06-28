import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { getCurrentAppVersion } from "@/desktop/lib/app-version";
import {
	type AppUpdateInfo,
	type AppUpdateProgress,
	checkAppUpdate,
	installAppUpdate,
} from "@/desktop/lib/update-api";
import constants from "@/desktop/constants";
import { readStorage, writeStorage } from "@/lib/browser-storage";
import { Download, ExternalLink, Loader2 } from "lucide-react";
import { useEffect } from "react";
import { useReactive } from "ahooks";
import { toast } from "sonner";
import { shouldRunStartupUpdateCheck } from "./app-update-bootstrap-state";

const STARTUP_CHECK_KEY = "internshannon-update-startup-checked";

function formatBytes(value?: number | null) {
	if (!value || value <= 0) return "0 B";
	const units = ["B", "KB", "MB", "GB"];
	let size = value;
	let unitIndex = 0;
	while (size >= 1024 && unitIndex < units.length - 1) {
		size /= 1024;
		unitIndex += 1;
	}
	return `${size.toFixed(size >= 10 || unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

export function AppUpdateBootstrap() {
	const state = useReactive({
		info: null as AppUpdateInfo | null,
		open: false,
		installing: false,
		progress: null as AppUpdateProgress | null,
	});

	useEffect(() => {
		if (typeof window === "undefined") return;
		if (
			!shouldRunStartupUpdateCheck({
				isDev: constants.isDev,
				startupCheckedValue: readStorage(STARTUP_CHECK_KEY, null, "session"),
			})
		) {
			return;
		}
		writeStorage(STARTUP_CHECK_KEY, "true", "session");

		let disposed = false;

		const run = async () => {
			try {
				await getCurrentAppVersion();
				const next = await checkAppUpdate();
				if (disposed || !next.hasUpdate) return;
				state.info = next;
				state.open = true;
			} catch {
				// Silent on startup to avoid blocking app launch on transient network issues.
			}
		};

		run();

		return () => {
			disposed = true;
		};
	}, []);

	const handleInstall = async () => {
		try {
			state.installing = true;
			state.progress = {
				phase: "downloading",
				downloadedBytes: 0,
				totalBytes: null,
			};
			const next = await installAppUpdate((event) => {
				state.progress = event;
			});
			state.info = next;
			state.open = false;
			toast.success("更新已安装，应用即将自动重启");
		} catch (error) {
			toast.error(error instanceof Error ? error.message : "下载更新失败");
		} finally {
			state.installing = false;
			state.progress = null;
		}
	};

	const progressPercent =
		state.progress?.totalBytes && state.progress.totalBytes > 0
			? Math.min(
					100,
					Math.round(
						(state.progress.downloadedBytes / state.progress.totalBytes) * 100,
					),
				)
			: null;

	return (
		<Dialog open={state.open} onOpenChange={(open) => (state.open = open)}>
			<DialogContent className="max-w-xl">
				<DialogHeader>
					<DialogTitle>发现新版本</DialogTitle>
					<DialogDescription>
						{state.info
							? `当前版本 ${state.info.currentVersion}，检测到新版本 ${state.info.latestVersion}。确认后将通过官方 updater 安装更新。`
							: "检测到可用更新。"}
					</DialogDescription>
				</DialogHeader>
				<div className="rounded-lg border bg-muted/20 p-3">
					<div className="flex items-center justify-between gap-3 text-sm">
						<span className="text-muted-foreground">安装包</span>
						<span className="max-w-[65%] truncate font-mono text-xs">
							{state.info?.assetName || "-"}
						</span>
					</div>
					{state.info?.releaseNotes ? (
						<div className="mt-4 rounded-md bg-background/80 p-3">
							<div className="mb-2 text-xs font-semibold">更新说明</div>
							<pre className="max-h-64 overflow-auto whitespace-pre-wrap text-xs leading-6 text-muted-foreground">
								{state.info.releaseNotes}
							</pre>
						</div>
					) : null}
					{state.installing && state.progress ? (
						<div className="mt-4 rounded-md bg-background/80 p-3">
							<div className="mb-2 flex items-center justify-between gap-3 text-xs">
								<span className="font-medium">
									{state.progress.phase === "installing"
										? "正在安装"
										: "正在下载"}
								</span>
								<span className="font-mono text-muted-foreground">
									{formatBytes(state.progress.downloadedBytes)}
									{state.progress.totalBytes
										? ` / ${formatBytes(state.progress.totalBytes)}`
										: ""}
									{progressPercent !== null ? ` (${progressPercent}%)` : ""}
								</span>
							</div>
							<div className="h-2 overflow-hidden rounded-full bg-muted">
								<div
									className="h-full rounded-full bg-primary transition-all"
									style={{
										width:
											state.progress.phase === "installing"
												? "100%"
												: `${progressPercent ?? 8}%`,
									}}
								/>
							</div>
						</div>
					) : null}
				</div>
				<DialogFooter>
					{state.info?.releaseUrl ? (
						<a
							href={state.info.releaseUrl}
							target="_blank"
							rel="noreferrer"
							className="inline-flex h-10 items-center justify-center gap-2 rounded-md border px-4 text-sm font-medium transition-colors hover:bg-muted/50"
						>
							<ExternalLink className="size-4" />
							查看 Release
						</a>
					) : null}
					<button
						type="button"
						className="inline-flex h-10 items-center justify-center rounded-md border px-4 text-sm font-medium transition-colors hover:bg-muted/50"
						onClick={() => (state.open = false)}
						disabled={state.installing}
					>
						稍后
					</button>
					<button
						type="button"
						className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
						onClick={handleInstall}
						disabled={state.installing}
					>
						{state.installing ? (
							<Loader2 className="size-4 animate-spin" />
						) : (
							<Download className="size-4" />
						)}
						下载并更新
					</button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
