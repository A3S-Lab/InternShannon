import { useTheme } from "@/components/custom/theme-provider";
import { SettingsSection, SettingsCard } from "./shared";
import { Monitor, Moon, Palette, Sun } from "lucide-react";

type ThemeOption = "system" | "light" | "dark";

const THEME_OPTIONS: Array<{
	value: ThemeOption;
	label: string;
	description: string;
	icon: typeof Monitor;
}> = [
	{
		value: "system",
		label: "跟随系统",
		description: "根据操作系统当前主题自动切换界面配色。",
		icon: Monitor,
	},
	{
		value: "light",
		label: "浅色",
		description: "使用浅色主题，适合明亮环境和长时间阅读。",
		icon: Sun,
	},
	{
		value: "dark",
		label: "深色",
		description: "使用深色主题，适合夜间环境并减少眩光。",
		icon: Moon,
	},
];

function ThemeCard({
	active,
	onClick,
	icon: Icon,
	label,
	description,
}: {
	active: boolean;
	onClick: () => void;
	icon: typeof Monitor;
	label: string;
	description: string;
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			className={`rounded-lg border p-3 text-left transition-all ${
				active
					? "border-primary bg-primary/10 ring-1 ring-primary/30"
					: "border-slate-200 bg-white hover:border-primary/40 hover:bg-slate-50"
			}`}
		>
			<div className="flex items-start gap-3">
				<div
					className={`mt-0.5 flex size-8 items-center justify-center rounded-lg ${
						active ? "bg-primary/15" : "bg-slate-100"
					}`}
				>
					<Icon
						className={`size-4 ${active ? "text-primary" : "text-slate-500"}`}
					/>
				</div>
				<div className="min-w-0 flex-1">
					<div className="flex items-center gap-2">
						<div className="text-sm font-semibold text-slate-800">{label}</div>
						{active ? (
							<span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
								当前
							</span>
						) : null}
					</div>
					<div className="mt-1 text-xs leading-relaxed text-slate-500">
						{description}
					</div>
				</div>
			</div>
		</button>
	);
}

export function AppearanceSection() {
	const { theme, setTheme } = useTheme();

	return (
		<SettingsSection
			title="外观"
			description="配置书小安的系统主题色和界面明暗模式"
			icon={Palette}
			accentColor="violet"
		>
			<SettingsCard
				title="主题模式"
				description="选择界面显示模式"
				icon={Palette}
				accentColor="violet"
			>
				<div className="grid gap-3 xl:grid-cols-3">
					{THEME_OPTIONS.map((option) => (
						<ThemeCard
							key={option.value}
							active={theme === option.value}
							onClick={() => setTheme(option.value)}
							icon={option.icon}
							label={option.label}
							description={option.description}
						/>
					))}
				</div>
				<div className="mt-4 text-xs text-slate-500">
					选择"跟随系统"后，书小安会在系统浅色和深色主题之间自动切换。
				</div>
			</SettingsCard>
		</SettingsSection>
	);
}
