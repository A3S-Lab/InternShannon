/**
 * Settings shared components — re-exports from shared layout + settings-specific helpers.
 */
export {
	SectionHeader,
	SettingRow,
	PROVIDER_COLORS,
	pColor,
} from "@/desktop/layouts/sidebar-layout";

// ============================================================================
// SettingsCard — Card with icon header (matches session-options-panel style)
// ============================================================================

import type { LucideIcon } from "lucide-react";

export function SettingsCard({
	title,
	description,
	icon: Icon,
	accentColor = "blue",
	children,
}: {
	title: string;
	description?: string;
	icon: LucideIcon;
	accentColor?: "blue" | "emerald" | "violet" | "orange" | "slate";
	children: React.ReactNode;
}) {
	const colorClasses = {
		blue: "bg-primary/10 text-primary",
		emerald: "bg-emerald-600/10 text-emerald-600",
		violet: "bg-violet-600/10 text-violet-600",
		orange: "bg-orange-600/10 text-orange-600",
		slate: "bg-slate-600/10 text-slate-600",
	};

	return (
		<div className="overflow-hidden rounded-lg border border-slate-200/80 bg-white shadow-sm dark:border-slate-800/80">
			{title ? (
				/* Header */
				<div className="border-b border-slate-100 bg-gradient-to-r from-slate-50 to-white px-4 py-3 dark:from-slate-950/40">
					<div className="flex items-center gap-2.5">
						<div
							className={`flex size-8 items-center justify-center rounded-md ${colorClasses[accentColor]}`}
						>
							<Icon className="size-4" />
						</div>
						<div>
							<h3
								className="text-[14px] font-semibold text-slate-800 dark:text-slate-200"
								style={{ fontFamily: "Outfit, DM Sans, sans-serif" }}
							>
								{title}
							</h3>
							{description && (
								<p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
									{description}
								</p>
							)}
						</div>
					</div>
				</div>
			) : null}
			{/* Content */}
			<div className={title ? "p-4" : "p-0"}>{children}</div>
		</div>
	);
}

// ============================================================================
// SettingsSection — Full section wrapper with title and cards
// ============================================================================

export function SettingsSection({
	title,
	description,
	icon: Icon,
	accentColor,
	children,
}: {
	title: string;
	description?: string;
	icon: LucideIcon;
	accentColor?: "blue" | "emerald" | "violet" | "orange" | "slate";
	children?: React.ReactNode;
}) {
	return (
		<div className="space-y-4">
			{/* Section Title */}
			<div className="mb-4 flex items-center gap-2.5">
				<div
					className={`flex size-8 items-center justify-center rounded-lg ${
						accentColor === "emerald"
							? "bg-emerald-600/10"
							: accentColor === "violet"
								? "bg-violet-600/10"
								: accentColor === "orange"
									? "bg-orange-600/10"
									: accentColor === "slate"
										? "bg-slate-600/10"
										: "bg-primary/10"
					}`}
				>
					<Icon
						className={`size-4 ${
							accentColor === "emerald"
								? "text-emerald-600"
								: accentColor === "violet"
									? "text-violet-600"
									: accentColor === "orange"
										? "text-orange-600"
										: accentColor === "slate"
											? "text-slate-600"
											: "text-primary"
						}`}
					/>
				</div>
				<div>
					<h2
						className="text-[15px] font-semibold text-slate-800 dark:text-slate-200"
						style={{ fontFamily: "Outfit, DM Sans, sans-serif" }}
					>
						{title}
					</h2>
					{description && (
						<p className="text-[12px] text-slate-500 dark:text-slate-400 mt-0.5">{description}</p>
					)}
				</div>
			</div>
			{/* Cards */}
			{children}
		</div>
	);
}

// ============================================================================
// CollapsibleSettingsSection — Collapsible section for advanced options
// ============================================================================

import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";

export function CollapsibleSettingsSection({
	title,
	description: _description,
	icon: Icon,
	children,
	defaultExpanded = false,
}: {
	title: string;
	description?: string;
	icon?: LucideIcon;
	children: React.ReactNode;
	defaultExpanded?: boolean;
}) {
	const [expanded, setExpanded] = useState(defaultExpanded);

	return (
		<div className="overflow-hidden rounded-lg border border-slate-200/80 bg-white dark:border-slate-800/80">
			<button
				type="button"
				onClick={() => setExpanded(!expanded)}
				className="flex w-full items-center justify-between px-4 py-3 transition-colors hover:bg-slate-50/50 dark:hover:bg-slate-950/50"
			>
				<div className="flex items-center gap-2">
					{Icon && <Icon className="size-4 text-slate-500 dark:text-slate-400" />}
					<span
						className="text-[13px] font-semibold text-slate-700 dark:text-slate-300"
						style={{ fontFamily: "Outfit, DM Sans, sans-serif" }}
					>
						{title}
					</span>
				</div>
				{expanded ? (
					<ChevronDown className="size-4 text-slate-400" />
				) : (
					<ChevronRight className="size-4 text-slate-400" />
				)}
			</button>
			{expanded && <div className="space-y-3 px-4 pb-4">{children}</div>}
		</div>
	);
}
