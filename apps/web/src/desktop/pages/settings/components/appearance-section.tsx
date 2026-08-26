import { SettingsSection, SettingsCard } from "./shared";
import { Palette, Sun } from "lucide-react";

export function AppearanceSection() {
	return (
		<SettingsSection
			title="外观"
			description="书小安统一使用浅色主题"
			icon={Palette}
			accentColor="violet"
		>
			<SettingsCard
				title="主题模式"
				description="当前版本固定为浅色，不跟随系统切换"
				icon={Palette}
				accentColor="violet"
			>
				<div className="rounded-lg border border-primary bg-primary/5 p-3">
					<div className="flex items-center gap-3">
						<div className="flex size-8 items-center justify-center rounded-lg bg-primary/10">
							<Sun className="size-4 text-primary" />
						</div>
						<div>
							<div className="text-sm font-semibold text-slate-800">浅色主题</div>
							<div className="mt-1 text-xs text-slate-500">应用、编辑器、预览和终端使用统一的浅色视觉。</div>
						</div>
					</div>
				</div>
			</SettingsCard>
		</SettingsSection>
	);
}
