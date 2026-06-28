import { Button } from "@/components/ui/button";
import constants, { workspaceAssetPath } from "@/desktop/constants";
import { getCurrentAppVersion } from "@/desktop/lib/app-version";
import globalModel from "@/models/global.model";
import { RotateCcw, ExternalLink } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

export function AboutSection() {
	const [version, setVersion] = useState("0.1.1");

	useEffect(() => {
		let disposed = false;
		getCurrentAppVersion().then((next) => {
			if (!disposed) setVersion(next);
		});
		return () => {
			disposed = true;
		};
	}, []);

	const handleReopenStartup = () => {
		globalModel.reopenOnboarding();
		toast.success("首次配置弹窗已重新打开");
	};

	return (
		<div className="space-y-4">
			{/* Hero Section */}
			<div className="flex flex-col items-center py-6 text-center">
				{/* Logo */}
				<img
					src={workspaceAssetPath("logo.png")}
					alt="书小安"
					className="mb-3 size-16 rounded-[10px] object-contain shadow-[0_12px_16px_-4px_rgba(36,36,36,0.08)]"
				/>

				{/* App Name */}
				<h1 className="text-xl font-bold text-slate-800">书小安</h1>

				{/* Version */}
				<div className="inline-flex items-center gap-1.5 mt-2 px-3 py-1 rounded-full bg-slate-100 text-slate-600">
					<span className="text-xs">版本</span>
					<span className="text-xs font-mono font-medium">{version}</span>
				</div>

				{/* Slogan */}
				<p className="text-sm text-slate-500 mt-3">认知驱动的个人智能助手</p>
			</div>

			{/* Links Card */}
			<div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
				<a
					href="https://github.com/A3S-Lab/InternShannon"
					target="_blank"
					rel="noreferrer"
					className="flex items-center justify-between border-b border-slate-100 px-4 py-3 transition-colors hover:bg-slate-50"
				>
					<div className="flex items-center gap-3">
						<ExternalLink className="size-5 text-slate-400" />
						<span className="text-sm text-slate-700">GitHub 仓库</span>
					</div>
					<ExternalLink className="size-4 text-slate-300" />
				</a>
				<a
					href="https://github.com/A3S-Lab/InternShannon/releases"
					target="_blank"
					rel="noreferrer"
					className="flex items-center justify-between px-4 py-3 transition-colors hover:bg-slate-50"
				>
					<div className="flex items-center gap-3">
						<ExternalLink className="size-5 text-slate-400" />
						<span className="text-sm text-slate-700">更新日志</span>
					</div>
					<ExternalLink className="size-4 text-slate-300" />
				</a>
			</div>

			{/* Dev Only */}
			{constants.isDev ? (
				<div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
					<div className="border-b border-slate-100 px-4 py-3">
						<span className="text-sm font-medium text-slate-700">
							开发者选项
						</span>
					</div>
					<div className="flex items-center justify-between px-4 py-3">
						<div>
							<div className="text-sm text-slate-700">重新打开首次配置</div>
							<div className="text-xs text-slate-500 mt-0.5">
								重新显示首次启动时的配置向导
							</div>
						</div>
						<Button
							type="button"
							variant="outline"
							size="sm"
							onClick={handleReopenStartup}
						>
							<RotateCcw className="mr-1.5 size-3.5" />
							打开
						</Button>
					</div>
				</div>
			) : null}
		</div>
	);
}
