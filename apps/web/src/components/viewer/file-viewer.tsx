/**
 * FileViewer — lightweight read-only file content display using Shiki for syntax highlighting.
 * No Monaco dependency, no TextModel disposal issues.
 */
import { memo, useEffect, useState, type CSSProperties } from "react";
import { FileText } from "lucide-react";
import { getHighlighter, resolveHighlightLanguage } from "./shiki";

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
	const isDark = false;

	const lines = content.split("\n");
	let lineOffset = 0;
	const lineEntries = lines.map((line) => {
		const entry = { key: `${lineOffset}:${line}`, line };
		lineOffset += line.length + 1;
		return entry;
	});

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
				{lineEntries.map(({ key, line }, lineIndex) => (
					<div
						key={key}
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
									{lineIndex + 1}
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
