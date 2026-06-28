import {
	type AppUpdateInfo,
	type AppUpdateProgress,
	checkAppUpdate,
	installAppUpdate,
} from "@/desktop/lib/update-api";
import { notifyClientError } from "@/lib/client-error";
import { SettingsSection, SettingsCard } from "./shared";
import {
	CheckCircle2,
	Download,
	ExternalLink,
	Loader2,
	RefreshCw,
} from "lucide-react";
import { useCallback, useEffect } from "react";
import { useReactive } from "ahooks";
import { toast } from "sonner";

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

function UpdateInfoRows({ info }: { info: AppUpdateInfo | null }) {
	if (!info) return null;
	return (
		<div className="rounded-lg bg-slate-50 divide-y divide-slate-200">
			<div className="flex justify-between items-center px-4 py-2.5">
				<span className="text-xs text-slate-500">当前版本</span>
				<span className="text-xs font-medium font-mono text-slate-800">
					{info.currentVersion}
				</span>
			</div>
			<div className="flex justify-between items-center px-4 py-2.5">
				<span className="text-xs text-slate-500">最新版本</span>
				<span className="text-xs font-medium font-mono text-slate-800">
					{info.latestVersion}
				</span>
			</div>
			<div className="flex justify-between items-center px-4 py-2.5">
				<span className="text-xs text-slate-500">安装包</span>
				<span className="text-xs font-medium font-mono text-slate-800 max-w-[60%] truncate">
					{info.assetName || "-"}
				</span>
			</div>
		</div>
	);
}

export function UpdateSection() {
	const state = useReactive({
		info: null as AppUpdateInfo | null,
		loading: true,
		installing: false,
		progress: null as AppUpdateProgress | null,
		checkError: null as string | null,
	});

	const load = useCallback(async (silent = false) => {
		try {
			if (!silent) state.loading = true;
			state.checkError = null;
			const next = await checkAppUpdate();
			state.info = next;
		} catch (error) {
			const msg =
				typeof error === "string"
					? error
					: error instanceof Error
						? error.message
						: "检查更新失败，请稍后重试";
			state.checkError = msg;
		} finally {
			state.loading = false;
		}
	}, []);

	useEffect(() => {
		load();
	}, [load]);

	const handleInstall = async () => {
		try {
			state.installing = true;
			state.progress = {
				phase: "downloading",
				downloadedBytes: 0,
				totalBytes: null,
			};
			const result = await installAppUpdate((next) => {
				state.progress = next;
			});
			state.info = result;
			toast.success("更新已安装，应用即将自动重启");
		} catch (error) {
			notifyClientError(error, {
				title: "下载更新失败",
				source: "settings.update.install",
			});
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
		<SettingsSection
			title="版本更新"
			description="检查并安装最新版本"
			icon={RefreshCw}
			accentColor="emerald"
		>
			<SettingsCard
				title="版本更新"
				description="通过官方 updater 检查、下载并安装签名更新"
				icon={RefreshCw}
				accentColor="emerald"
			>
				<div className="space-y-4">
					<UpdateInfoRows info={state.info} />

					{state.checkError ? (
						<div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
							<div className="text-xs font-medium text-amber-800">
								暂时无法检查更新
							</div>
							<div className="mt-1 text-xs text-amber-700 break-all">
								{state.checkError}
							</div>
							<a
								href="https://github.com/A3S-Lab/InternShannon/releases"
								target="_blank"
								rel="noreferrer"
								className="mt-2 inline-flex items-center gap-1.5 text-xs font-medium text-amber-800 underline-offset-2 hover:underline"
							>
								<ExternalLink className="size-3" />
								前往 GitHub Releases 手动下载
							</a>
						</div>
					) : (
						<div className="flex flex-wrap items-center gap-3">
							<button
								type="button"
								className="inline-flex h-10 items-center gap-2 rounded-lg border border-slate-200 px-4 text-sm font-medium transition-colors hover:bg-slate-50 disabled:opacity-50"
								onClick={() => load()}
								disabled={state.loading || state.installing}
							>
								{state.loading ? (
									<Loader2 className="size-4 animate-spin" />
								) : (
									<RefreshCw className="size-4" />
								)}
								检查更新
							</button>
							{state.info?.hasUpdate ? (
								<button
									type="button"
									className="inline-flex h-10 items-center gap-2 rounded-lg bg-emerald-600 px-4 text-sm font-medium text-white transition-colors hover:bg-emerald-600/90 disabled:opacity-50"
									onClick={handleInstall}
									disabled={state.installing || state.loading}
								>
									{state.installing ? (
										<Loader2 className="size-4 animate-spin" />
									) : (
										<Download className="size-4" />
									)}
									下载并更新
								</button>
							) : (
								<div className="inline-flex h-10 items-center gap-2 rounded-lg bg-emerald-500/10 px-4 text-sm font-medium text-emerald-600">
									<CheckCircle2 className="size-4" />
									{state.loading ? "检查中..." : "当前已是最新版本"}
								</div>
							)}
							{state.info?.releaseUrl && (
								<a
									href={state.info.releaseUrl}
									target="_blank"
									rel="noreferrer"
									className="inline-flex h-10 items-center gap-2 rounded-lg border border-slate-200 px-4 text-sm font-medium transition-colors hover:bg-slate-50"
								>
									<ExternalLink className="size-4" />
									查看 Release
								</a>
							)}
						</div>
					)}

					{state.installing && state.progress ? (
						<div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
							<div className="mb-2 flex items-center justify-between gap-3 text-xs">
								<span className="font-medium text-slate-700">
									{state.progress.phase === "installing"
										? "正在安装更新"
										: "正在下载更新"}
								</span>
								<span className="font-mono text-slate-500">
									{formatBytes(state.progress.downloadedBytes)}
									{state.progress.totalBytes
										? ` / ${formatBytes(state.progress.totalBytes)}`
										: ""}
									{progressPercent !== null ? ` (${progressPercent}%)` : ""}
								</span>
							</div>
							<div className="h-2 overflow-hidden rounded-full bg-slate-200">
								<div
									className="h-full rounded-full bg-emerald-500 transition-all"
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

					{state.info?.releaseNotes && (
						<div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
							<div className="mb-2 text-xs font-semibold text-slate-700">
								更新说明
							</div>
							<pre className="max-h-80 overflow-auto whitespace-pre-wrap text-xs leading-6 text-slate-600">
								{state.info.releaseNotes}
							</pre>
						</div>
					)}
				</div>
			</SettingsCard>
		</SettingsSection>
	);
}
