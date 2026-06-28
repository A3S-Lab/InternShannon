/**
 * FileViewer — lightweight read-only file content display using Shiki for syntax highlighting.
 * No Monaco dependency, no TextModel disposal issues.
 */
import { memo, useEffect } from "react";
import { useReactive } from "ahooks";
import { useTheme } from "@/components/custom/theme-provider";
import { FileText } from "lucide-react";
import { getHighlighter } from "./shiki";

// =============================================================================
// Highlighted line component
// =============================================================================

interface HighlightedLineProps {
	content: string;
	lang: string;
	isDark: boolean;
	className?: string;
}

const HighlightedLine = memo(function HighlightedLine({
	content,
	lang,
	isDark,
	className = "",
}: HighlightedLineProps) {
	const state = useReactive({
		html: "",
	});

	useEffect(() => {
		let cancelled = false;
		const highlight = async () => {
			const h = await getHighlighter();
			if (cancelled) return;

			const escaped = content
				.replace(/&/g, "&amp;")
				.replace(/</g, "&lt;")
				.replace(/>/g, "&gt;");

			const highlighted = h.codeToHtml(escaped, {
				lang: lang || "text",
				theme: isDark ? "github-dark" : "github-light",
			});
			state.html = highlighted;
		};
		highlight();
		return () => {
			cancelled = true;
		};
	}, [content, lang, isDark]);

	if (!state.html) {
		return <span className={className}>{content}</span>;
	}

	return (
		<span
			dangerouslySetInnerHTML={{ __html: state.html }}
			className={`${className} [&_pre]:!bg-transparent [&_pre]:!p-0 [&_code]:!bg-transparent [&_code]:!text-inherit`}
		/>
	);
});

// =============================================================================
// Main FileViewer component
// =============================================================================

export interface FileViewerProps {
	content: string;
	language?: string;
	filepath?: string;
	/** Show line numbers (default: true) */
	showLineNumbers?: boolean;
	/** Max height for scroll container */
	maxHeight?: number | string;
}

export function FileViewer({
	content,
	language = "text",
	filepath,
	showLineNumbers = true,
	maxHeight,
}: FileViewerProps) {
	const { theme } = useTheme();
	const isDark =
		theme === "dark" ||
		(theme === "system" && document.documentElement.classList.contains("dark"));

	const lines = content.split("\n");

	return (
		<div
			className={`overflow-hidden ${isDark ? "bg-[#1e1e1e]" : "bg-white"}`}
		>
			{/* Header */}
			{filepath && (
				<div
					className={`flex items-center gap-2 px-4 py-2 border-b ${isDark ? "bg-[#252526] border-[#3c3c3c] text-[#cccccc]" : "bg-muted/50 border-border text-[#24292e]"}`}
				>
					<FileText className="size-4 opacity-60" />
					<span className="text-xs font-mono truncate">{filepath}</span>
					<span
						className={`text-[10px] px-1.5 py-0.5 rounded ${isDark ? "bg-[#3c3c3c] text-[#858585]" : "bg-muted text-muted-foreground"}`}
					>
						{lines.length} 行
					</span>
				</div>
			)}

			{/* Content */}
			<div
				className={`font-mono text-[13px] leading-5 overflow-auto ${isDark ? "[&::-webkit-scrollbar]:bg-[#1e1e1e] [&::-webkit-scrollbar]:w-2" : "[&::-webkit-scrollbar]:bg-white [&::-webkit-scrollbar]:w-2"}`}
				style={maxHeight ? { maxHeight } : undefined}
			>
				{lines.map((line, i) => (
					<div
						key={i}
						className={`flex items-stretch ${isDark ? "hover:bg-[#2a2d2e]" : "hover:bg-[#f6f8fa]"}`}
					>
						{showLineNumbers && (
							<div
								className="select-none text-right w-12 flex-shrink-0 px-2 text-[11px] leading-5 border-r flex items-center justify-end"
								style={{
									backgroundColor: isDark ? "#1e1e1e" : "#ffffff",
									borderColor: isDark ? "#3c3c3c" : "#e5e7eb",
								}}
							>
								<span
									className={`text-[10px] ${isDark ? "text-[#858585]" : "text-[#959da5]"}`}
								>
									{i + 1}
								</span>
							</div>
						)}

						<div className="flex-1 px-3 leading-5 overflow-x-auto">
							{line.length > 0 ? (
								<HighlightedLine
									content={line}
									lang={language}
									isDark={isDark}
									className={isDark ? "text-[#d4d4d4]" : "text-[#24292e]"}
								/>
							) : (
								<span className="text-[#d4d4d4]"> </span>
							)}
						</div>
					</div>
				))}

				{lines.length === 0 && (
					<div
						className={`px-4 py-5 text-center text-sm ${isDark ? "text-[#858585]" : "text-muted-foreground"}`}
					>
						文件为空
					</div>
				)}
			</div>
		</div>
	);
}
