/**
 * ShikiDiffViewer — lightweight read-only diff display using Shiki for syntax highlighting.
 * No Monaco dependency, no TextModel disposal issues.
 */
import { memo, useEffect, useState, type CSSProperties } from "react";
import { getHighlighter, resolveHighlightLanguage } from "./shiki";
import { cn } from "@/lib/utils";
import { computeLineDiff } from "@/runtime/wasm/diff-wasm";

// =============================================================================
// Highlighted line component
// =============================================================================

interface HighlightedLineProps {
	content: string;
	lang: string;
	isDark: boolean;
	className?: string;
}

interface HighlightedToken {
	content: string;
	offset: number;
	color?: string;
	bgColor?: string;
	fontStyle?: number;
}

function highlightedTokenStyle(token: HighlightedToken): CSSProperties {
	const fontStyle = token.fontStyle ?? 0;
	return {
		color: token.color,
		backgroundColor: token.bgColor,
		fontStyle: fontStyle & 1 ? "italic" : undefined,
		fontWeight: fontStyle & 2 ? 700 : undefined,
		textDecoration: fontStyle & 4 ? "underline" : undefined,
	};
}

const HighlightedLine = memo(function HighlightedLine({
	content,
	lang,
	isDark,
	className = "",
}: HighlightedLineProps) {
	const [tokens, setTokens] = useState<HighlightedToken[]>([]);

	useEffect(() => {
		let cancelled = false;
		const highlight = async () => {
			const h = await getHighlighter();
			if (cancelled) return;

			const highlighted = h.codeToTokens(content, {
				lang: resolveHighlightLanguage(h, lang),
				theme: isDark ? "github-dark" : "github-light",
			});
			setTokens(highlighted.tokens[0] ?? []);
		};
		highlight();
		return () => {
			cancelled = true;
		};
	}, [content, lang, isDark]);

	if (tokens.length === 0) {
		return <span className={className}>{content}</span>;
	}

	return (
		<span className={className}>
			{tokens.map((token) => (
				<span
					key={`${token.offset}:${token.content}`}
					style={highlightedTokenStyle(token)}
				>
					{token.content}
				</span>
			))}
		</span>
	);
});

// =============================================================================
// Main DiffViewer component
// =============================================================================

export interface DiffViewerProps {
	original: string;
	modified: string;
	language?: string;
	/** Show +X -Y stats header (default: true) */
	showStats?: boolean;
}

export function DiffViewer({
	original,
	modified,
	language = "text",
	showStats = true,
}: DiffViewerProps) {
	const isDark = false;

	const diff = computeLineDiff(original.split("\n"), modified.split("\n"));

	const added = diff.filter((l) => l.type === "added").length;
	const removed = diff.filter((l) => l.type === "removed").length;

	return (
		<div
			className={`overflow-hidden ${isDark ? "bg-[#1e1e1e]" : "bg-white"}`}
		>
			{showStats && (added > 0 || removed > 0) && (
				<div
					className={cn(
						"flex items-center gap-3 px-4 py-1.5 border-b text-[11px] font-mono",
						isDark
							? "bg-[#252526] border-[#3c3c3c] text-[#d4d4d4]"
							: "bg-muted/50 border-border text-[#24292e]",
					)}
				>
					<span className="text-emerald-600 dark:text-emerald-400 font-semibold">
						+{added}
					</span>
					<span className="text-red-600 dark:text-red-400 font-semibold">
						-{removed}
					</span>
					<span className="text-muted-foreground/50">行变更</span>
				</div>
			)}
			<div
				className={`font-mono text-[13px] leading-5 overflow-auto ${isDark ? "[&::-webkit-scrollbar]:bg-[#1e1e1e] [&::-webkit-scrollbar]:w-2" : "[&::-webkit-scrollbar]:bg-white [&::-webkit-scrollbar]:w-2"}`}
			>
				{diff.map((line) => {
					const lineNum =
						line.type === "removed"
							? line.origLineNum
							: line.type === "added"
								? line.modLineNum
								: line.origLineNum;

					let bgClass = "";
					let indicatorColor = "";
					let textClass = "";
					let gutterBg = isDark ? "#1e1e1e" : "#ffffff";

					if (line.type === "added") {
						bgClass = isDark ? "bg-[#2d4a2d]" : "bg-[#e6ffec]";
						indicatorColor = isDark ? "#89d185" : "#22863a";
						textClass = isDark ? "text-[#89d185]" : "text-[#22863a]";
						gutterBg = isDark ? "#2d4a2d" : "#e6ffec";
					} else if (line.type === "removed") {
						bgClass = isDark ? "bg-[#4a2d2d]" : "bg-[#ffebe9]";
						indicatorColor = isDark ? "#f14c4c" : "#cb2431";
						textClass = isDark ? "text-[#f14c4c]" : "text-[#cb2431]";
						gutterBg = isDark ? "#4a2d2d" : "#ffebe9";
					} else {
						textClass = isDark ? "text-[#d4d4d4]" : "text-[#24292e]";
					}

					return (
						<div
							key={`${line.type}:${line.origLineNum ?? "none"}:${line.modLineNum ?? "none"}:${line.content}`}
							className={`flex items-stretch ${bgClass}`}
						>
							<div
								className="select-none text-right w-12 flex-shrink-0 px-2 text-[11px] leading-5 border-r flex items-center justify-end gap-1"
								style={{
									backgroundColor: gutterBg,
									borderColor: isDark ? "#3c3c3c" : "#e5e7eb",
								}}
							>
								{lineNum !== undefined && (
									<span
										className={`text-[10px] ${isDark ? "text-[#858585]" : "text-[#959da5]"}`}
									>
										{lineNum + 1}
									</span>
								)}
							</div>

							<div
								className="w-5 flex-shrink-0 flex items-center justify-center text-[12px] leading-5 border-r"
								style={{ borderColor: isDark ? "#3c3c3c" : "#e5e7eb" }}
							>
								{line.type === "added" ? (
									<span className="font-bold" style={{ color: indicatorColor }}>
										+
									</span>
								) : line.type === "removed" ? (
									<span className="font-bold" style={{ color: indicatorColor }}>
										−
									</span>
								) : null}
							</div>

							<div className="flex-1 px-3 leading-5 overflow-x-auto">
								{line.type === "unchanged" ? (
									<HighlightedLine
										content={line.content}
										lang={language}
										isDark={isDark}
										className={textClass}
									/>
								) : (
									<span className={textClass}>{line.content || " "}</span>
								)}
							</div>
						</div>
					);
				})}

				{diff.length === 0 && (
					<div
						className={`px-4 py-5 text-center text-sm ${isDark ? "text-[#858585]" : "text-muted-foreground"}`}
					>
						没有检测到变化
					</div>
				)}
			</div>
		</div>
	);
}
