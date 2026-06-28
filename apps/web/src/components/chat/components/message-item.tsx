import { cn } from "../../ui";
import { writeClipboardText } from "@/lib/clipboard";
import { Check, Copy, RefreshCw, ThumbsDown, ThumbsUp } from "lucide-react";
import React, { useCallback, useMemo, useState } from "react";
import { useReactive } from "ahooks";
import dayjs from "dayjs";
import type { RichMessage, TextBlock, ToolCallBlock } from "../types/message";
import type { ToolCallDisplayRenderProps } from "./tool-call-display";
import { ToolCallDisplay } from "./tool-call-display";

// =============================================================================
// Date separator
// =============================================================================

export function DateSeparator({ timestamp }: { timestamp: number }) {
	const label = dayjs(timestamp).format("YYYY-MM-DD");
	const isToday = dayjs(timestamp).isSame(dayjs(), "day");
	const isYesterday = dayjs(timestamp).isSame(dayjs().subtract(1, "day"), "day");
	const display = isToday ? "今天" : isYesterday ? "昨天" : label;

	return (
		<div
			className="flex select-none items-center gap-3 px-4 py-2"
			aria-label={`日期: ${display}`}
		>
			<div className="flex-1 h-px bg-gradient-to-r from-transparent via-border to-transparent" />
			<span className="text-[10px] text-muted-foreground/50 font-medium tracking-wider uppercase">
				{display}
			</span>
			<div className="flex-1 h-px bg-gradient-to-r from-transparent via-border to-transparent" />
		</div>
	);
}

// =============================================================================
// Hover action bar
// =============================================================================

function MessageActions({
	msg,
	onCopy,
	onRetry,
	isUser,
}: {
	msg: RichMessage;
	onCopy: () => void;
	onRetry?: () => void;
	isUser: boolean;
}) {
	const state = useReactive({
		copied: false,
		feedback: null as "up" | "down" | null,
	});

	const handleCopy = useCallback(() => {
		onCopy();
		state.copied = true;
		setTimeout(() => (state.copied = false), 1500);
	}, [onCopy]);

	const handleFeedback = useCallback((type: "up" | "down") => {
		state.feedback = state.feedback === type ? null : type;
	}, []);

	return (
		<div
			className={cn(
				"absolute top-0 z-10 hidden -translate-y-[calc(100%+6px)] items-center gap-0.5 rounded-[8px] border border-black/5 bg-background/98 px-1.5 py-1 shadow-[0_4px_8px_rgba(0,0,0,0.1)] backdrop-blur-md group-hover:flex group-focus-within:flex transition-opacity duration-200",
				isUser ? "right-0" : "left-0",
			)}
		>
			<button
				type="button"
				className="flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground transition-colors"
				onClick={handleCopy}
				aria-label="复制消息"
				title="复制"
			>
				{state.copied ? (
					<Check className="size-3 text-emerald-500" />
				) : (
					<Copy className="size-3" />
				)}
			</button>
			{msg.role === "assistant" && onRetry && (
				<button
					type="button"
					className="flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground transition-colors"
					onClick={onRetry}
					aria-label="重新生成"
					title="重新生成"
				>
					<RefreshCw className="size-3" />
				</button>
			)}
			{msg.role === "assistant" && (
				<button
					type="button"
					className={cn(
						"flex size-7 items-center justify-center rounded-md transition-colors",
						state.feedback === "up"
							? "text-emerald-500 hover:bg-emerald-500/10"
							: "text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground",
					)}
					onClick={() => handleFeedback("up")}
					aria-label="好评"
					title="好评"
				>
					<ThumbsUp className="size-3" />
				</button>
			)}
			{msg.role === "assistant" && (
				<button
					type="button"
					className={cn(
						"flex size-7 items-center justify-center rounded-md transition-colors",
						state.feedback === "down"
							? "text-red-500 hover:bg-red-500/10"
							: "text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground",
					)}
					onClick={() => handleFeedback("down")}
					aria-label="差评"
					title="差评"
				>
					<ThumbsDown className="size-3" />
				</button>
			)}
		</div>
	);
}

// =============================================================================
// Inline images
// =============================================================================

function InlineImages({
	images,
}: { images?: { mediaType: string; data: string }[] }) {
	if (!images || images.length === 0) return null;
	return (
		<div className="flex flex-wrap gap-2 mt-2">
			{images.map((img, i) => (
				<a
					key={`inline-img-${i}`}
					href={`data:${img.mediaType};base64,${img.data}`}
					target="_blank"
					rel="noopener noreferrer"
					className="block"
				>
					<img
						src={`data:${img.mediaType};base64,${img.data}`}
						alt={`图片 ${i + 1}`}
						className="max-h-48 max-w-xs rounded-md border object-contain hover:opacity-90 transition-opacity cursor-zoom-in"
					/>
				</a>
			))}
		</div>
	);
}

// =============================================================================
// File mention card
// =============================================================================

function splitFileMentions(
	text: string,
): Array<{ type: "text" | "file"; value: string }> {
	if (!text) return [];
	const segments: Array<{ type: "text" | "file"; value: string }> = [];
	const re = /@(\/[^\s@]+)/g;
	let last = 0;
	let m: RegExpExecArray | null;
	while ((m = re.exec(text)) !== null) {
		if (m.index > last)
			segments.push({ type: "text", value: text.slice(last, m.index) });
		segments.push({ type: "file", value: m[1] });
		last = m.index + m[0].length;
	}
	if (last < text.length)
		segments.push({ type: "text", value: text.slice(last) });
	return segments;
}

function FileTypeIcon({ ext, size = 22 }: { ext?: string; size?: number }) {
	const s = size;
	const iconColor =
		ext === "pdf"
			? "#cf4444"
			: ["doc", "docx"].includes(ext || "")
				? "#2563eb"
				: ["xls", "xlsx", "csv"].includes(ext || "")
					? "#13803d"
					: ["ppt", "pptx"].includes(ext || "")
						? "#d97706"
						: ["ts", "tsx"].includes(ext || "")
							? "#3178c6"
							: ["js", "jsx"].includes(ext || "")
								? "#f7df1e"
								: ["rs"].includes(ext || "")
									? "#ce422b"
									: ["py"].includes(ext || "")
										? "#3776ab"
										: ["go"].includes(ext || "")
											? "#00add8"
											: ["png", "jpg", "jpeg", "gif", "svg", "webp"].includes(
														ext || "",
													)
												? "#10b981"
												: ["json", "toml", "yaml", "yml"].includes(ext || "")
													? "#f59e0b"
													: "#64748b";

	if (
		[
			"ts", "tsx", "js", "jsx", "rs", "py", "go", "java",
			"c", "cpp", "h", "hpp", "cs", "rb", "php", "swift",
			"kt", "scala", "vue", "svelte",
		].includes(ext || "")
	) {
		return (
			<svg width={s} height={s} viewBox="0 0 24 24" fill="none">
				<path
					d="M8 3L3 8l5 5M8 3l5 5M8 3l5 5M16 21l5-5-5-5M16 21l-5-5 5-5"
					stroke={iconColor}
					strokeWidth="1.8"
					strokeLinecap="round"
					strokeLinejoin="round"
				/>
			</svg>
		);
	}
	if (
		["png", "jpg", "jpeg", "gif", "svg", "webp", "ico", "bmp"].includes(ext || "")
	) {
		return (
			<svg width={s} height={s} viewBox="0 0 24 24" fill="none">
				<rect x="3" y="3" width="18" height="18" rx="2" stroke={iconColor} strokeWidth="1.8" />
				<circle cx="8.5" cy="8.5" r="1.5" fill={iconColor} />
				<path d="M21 15l-5-5L5 21" stroke={iconColor} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
			</svg>
		);
	}
	if (ext === "pdf") {
		return (
			<svg width={s} height={s} viewBox="0 0 24 24" fill="none">
				<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6Z" stroke={iconColor} strokeWidth="1.8" strokeLinejoin="round" />
				<path d="M14 2v6h6M9 13h6M9 17h4" stroke={iconColor} strokeWidth="1.8" strokeLinecap="round" />
			</svg>
		);
	}
	if (["doc", "docx", "odt"].includes(ext || "")) {
		return (
			<svg width={s} height={s} viewBox="0 0 24 24" fill="none">
				<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6Z" stroke={iconColor} strokeWidth="1.8" strokeLinejoin="round" />
				<path d="M14 2v6h6M9 12h6M9 16h4" stroke={iconColor} strokeWidth="1.8" strokeLinecap="round" />
			</svg>
		);
	}
	if (["xls", "xlsx", "csv", "ods"].includes(ext || "")) {
		return (
			<svg width={s} height={s} viewBox="0 0 24 24" fill="none">
				<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6Z" stroke={iconColor} strokeWidth="1.8" strokeLinejoin="round" />
				<path d="M14 2v6h6M8 13h8M8 17h5" stroke={iconColor} strokeWidth="1.8" strokeLinecap="round" />
			</svg>
		);
	}
	if (["ppt", "pptx", "odp"].includes(ext || "")) {
		return (
			<svg width={s} height={s} viewBox="0 0 24 24" fill="none">
				<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6Z" stroke={iconColor} strokeWidth="1.8" strokeLinejoin="round" />
				<path d="M14 2v6h6M9 11l2 2 4-4" stroke={iconColor} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
			</svg>
		);
	}
	if (["md", "txt", "text"].includes(ext || "")) {
		return (
			<svg width={s} height={s} viewBox="0 0 24 24" fill="none">
				<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6Z" stroke={iconColor} strokeWidth="1.8" strokeLinejoin="round" />
				<path d="M14 2v6h6M8 13h8M8 17h8M8 9h2" stroke={iconColor} strokeWidth="1.8" strokeLinecap="round" />
			</svg>
		);
	}
	if (["json", "toml", "yaml", "yml", "xml", "ini", "env"].includes(ext || "")) {
		return (
			<svg width={s} height={s} viewBox="0 0 24 24" fill="none">
				<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6Z" stroke={iconColor} strokeWidth="1.8" strokeLinejoin="round" />
				<path d="M9 9l-2 3h4l-2 3M15 9l2 3h-4l2 3" stroke={iconColor} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
			</svg>
		);
	}
	return (
		<svg width={s} height={s} viewBox="0 0 24 24" fill="none">
			<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6Z" stroke={iconColor} strokeWidth="1.8" strokeLinejoin="round" />
			<path d="M14 2v6h6" stroke={iconColor} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
		</svg>
	);
}

function FileMentionCard({
	path,
	isUser = false,
	onOpenFilePath,
}: {
	path: string;
	isUser?: boolean;
	onOpenFilePath?: (path: string) => void;
}) {
	const [isOpening, setIsOpening] = useState(false);
	const parts = path.split("/");
	const name = parts[parts.length - 1] || path;
	const dir = parts.slice(0, -1).join("/") || "/";
	const ext = name.includes(".") ? name.split(".").pop()?.toLowerCase() : undefined;

	const tagColor =
		ext === "pdf"
			? "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300"
			: ["doc", "docx"].includes(ext || "")
				? "bg-primary/10 text-primary dark:bg-primary/20 dark:text-primary"
				: ["xls", "xlsx", "csv"].includes(ext || "")
					? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300"
					: ["ppt", "pptx"].includes(ext || "")
						? "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300"
						: ["ts", "tsx"].includes(ext || "")
							? "bg-primary/10 text-primary dark:bg-primary/20 dark:text-primary"
							: ["js", "jsx"].includes(ext || "")
								? "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-300"
								: ["rs"].includes(ext || "")
									? "bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300"
									: ["py"].includes(ext || "")
										? "bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300"
										: ["png", "jpg", "jpeg", "gif", "svg", "webp"].includes(ext || "")
											? "bg-pink-100 text-pink-700 dark:bg-pink-900/40 dark:text-pink-300"
											: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300";

	const tagText = ext
		? ["ts", "tsx"].includes(ext)
			? "TypeScript"
			: ["js", "jsx"].includes(ext)
				? "JavaScript"
				: ["rs"].includes(ext)
					? "Rust"
					: ["py"].includes(ext)
						? "Python"
						: ["go"].includes(ext)
							? "Go"
							: ["png", "jpg", "jpeg", "gif", "svg", "webp"].includes(ext)
								? "Image"
								: ext.toUpperCase()
		: "FILE";

	const handleOpen = async () => {
		if (isOpening) return;
		setIsOpening(true);
		try {
			if (onOpenFilePath) {
				onOpenFilePath(path);
			} else {
				await writeClipboardText(path);
			}
		} finally {
			setIsOpening(false);
		}
	};

	const handleCopyPath = async (e: React.MouseEvent) => {
		e.stopPropagation();
		await writeClipboardText(path);
	};

	return (
		<div
			title={`${path}\n点击打开 · 右键复制路径`}
			onClick={handleOpen}
			className={cn(
				"my-1 inline-flex max-w-[19rem] cursor-pointer items-center gap-2.5 rounded-lg border px-3 py-2 shadow-sm backdrop-blur-sm transition-all hover:shadow-md active:scale-[0.98]",
				isUser
					? "border-primary/25 bg-white/95 hover:border-primary/40"
					: "border-slate-200/60 bg-white/90 dark:border-slate-700/60 dark:bg-slate-900/90 dark:hover:border-slate-600",
			)}
		>
			<div
				className={cn(
					"flex size-9 shrink-0 items-center justify-center rounded-lg",
					isUser ? "bg-primary/10" : "bg-slate-50 dark:bg-slate-800",
				)}
			>
				<FileTypeIcon ext={ext} size={18} />
			</div>
			<div className="min-w-0 flex-1">
				<p className="truncate text-[13px] font-semibold leading-tight text-slate-800 dark:text-slate-100">
					{name}
				</p>
				<div className="mt-1 flex items-center gap-1.5">
					<span
						className={cn(
							"inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide",
							tagColor,
						)}
					>
						{tagText}
					</span>
					<span className="truncate text-[10px] text-slate-400 dark:text-slate-500">
						{dir || "/"}
					</span>
				</div>
			</div>
			<div className="shrink-0 text-slate-300 dark:text-slate-600">
				{isOpening ? (
					<svg width="16" height="16" viewBox="0 0 24 24" fill="none" className="animate-spin">
						<path d="M21 12a9 9 0 1 1-6.219-8.56" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
					</svg>
				) : (
					<button
						type="button"
						onClick={handleCopyPath}
						title="复制路径"
						className="flex items-center justify-center rounded p-0.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"
					>
						<svg width="14" height="14" viewBox="0 0 24 24" fill="none">
							<rect x="9" y="9" width="13" height="13" rx="2" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
							<path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
						</svg>
					</button>
				)}
			</div>
		</div>
	);
}

function TextWithFileMentions({
	content,
	isUser = false,
	onOpenFilePath,
	renderMarkdown,
}: {
	content: string;
	isUser?: boolean;
	onOpenFilePath?: (path: string) => void;
	renderMarkdown?: (content: string, id: string) => React.ReactNode;
}) {
	const safeContent = content ?? "";
	const segments = useMemo(() => splitFileMentions(safeContent), [safeContent]);
	const hasFileMentions = segments.some((s) => s.type === "file");

	if (!hasFileMentions) {
		return renderMarkdown ? (
			<>{renderMarkdown(safeContent, safeContent.slice(0, 32))}</>
		) : (
			<div className="whitespace-pre-wrap">{safeContent}</div>
		);
	}

	return (
		<div className="space-y-1">
			{segments.map((seg, i) =>
				seg.type === "file" ? (
					<FileMentionCard
						key={i}
						path={seg.value}
						isUser={isUser}
						onOpenFilePath={onOpenFilePath}
					/>
				) : seg.value.trim() ? (
					renderMarkdown ? (
						<React.Fragment key={i}>
							{renderMarkdown(seg.value, `seg-${i}`)}
						</React.Fragment>
					) : (
						<div key={i} className="whitespace-pre-wrap">
							{seg.value}
						</div>
					)
				) : null,
			)}
		</div>
	);
}

// =============================================================================
// MessageItem
// =============================================================================

export interface MessageItemProps extends ToolCallDisplayRenderProps {
	msg: RichMessage;
	renderMarkdown?: (content: string, id: string) => React.ReactNode;
	agentAvatar?: React.ReactNode;
	userAvatarSrc?: string;
	onRetry?: () => void;
	onOpenFilePath?: (path: string) => void;
	layout?: "default" | "compact-left";
}

const MessageItem = React.memo(function MessageItem({
	msg,
	renderMarkdown,
	agentAvatar,
	userAvatarSrc,
	onRetry,
	onOpenFilePath,
	layout = "default",
	renderDiff,
	renderFile,
}: MessageItemProps) {
	const isUser = msg.role === "user";
	const isCompactLeft = layout === "compact-left";

	const getPlainText = useCallback(() => {
		return msg.blocks
			.map((block) => {
				if (block.type === "text") return block.content;
				if (block.type === "tool_call")
					return `[${block.tool}] ${block.input}${block.output ? `\n→ ${block.output}` : ""}`;
				return "";
			})
			.filter(Boolean)
			.join("\n\n");
	}, [msg.blocks]);

	const handleCopy = useCallback(async () => {
		const text = getPlainText();
		await writeClipboardText(text);
	}, [getPlainText]);

	const shellClassName = cn(
		"relative overflow-visible px-3.5 py-2.5 backdrop-blur-[2px]",
		isUser
			? "rounded-[14px] rounded-tr-[5px] bg-[#9fe870] text-slate-900 shadow-[0_10px_18px_-16px_rgba(22,101,52,0.22)] dark:bg-[#86d962]"
			: "rounded-[14px] rounded-tl-[5px] bg-[rgba(255,255,255,0.98)] text-slate-900 shadow-[0_10px_20px_-18px_rgba(15,23,42,0.16)] dark:bg-[rgba(43,43,45,0.96)] dark:text-slate-100",
	);

	if (msg.role === "system") {
		return (
			<div className="flex justify-center px-4 py-2">
				<div className="rounded-full bg-muted/60 backdrop-blur-sm px-4 py-1.5 text-[11px] text-muted-foreground/70 max-w-md text-center shadow-sm border border-border/30">
					{msg.blocks[0]?.type === "text"
						? (msg.blocks[0] as TextBlock).content
						: ""}
				</div>
			</div>
		);
	}

	return (
		<div
			className={cn(
				"group relative pb-1.5 pt-1 transition-all duration-200",
				isCompactLeft ? "px-2" : "px-4 sm:px-5",
			)}
		>
			<div
				className={cn(
					"relative flex min-w-0 items-start gap-2.5",
					isCompactLeft ? "justify-start" : isUser && "justify-end",
				)}
			>
				{isCompactLeft ? (
					<span
						className={cn(
							"mt-1 inline-flex size-2.5 shrink-0 rounded-full animate-pulse",
							isUser
								? "bg-primary shadow-[0_0_0_3px_hsl(var(--primary)_/_0.12)]"
								: "bg-emerald-500 shadow-[0_0_0_3px_rgba(16,185,129,0.12)]",
						)}
						aria-label={isUser ? "user message" : "assistant activity"}
					/>
				) : !isUser ? (
					agentAvatar ? (
						<div className="mt-6 shrink-0">{agentAvatar}</div>
					) : (
						<div className="mt-6 size-9 shrink-0 rounded-[12px] ring-1 ring-black/5 shadow-sm bg-muted flex items-center justify-center">
							<svg className="size-4 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
								<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
							</svg>
						</div>
					)
				) : null}

				<div
					className={cn(
						"min-w-0",
						isCompactLeft
							? "max-w-[min(92%,52rem)]"
							: isUser
								? "order-[-1] max-w-[min(78%,44rem)]"
								: "flex-1",
					)}
				>
					<div
						className={cn(
							"mb-1 flex",
							isCompactLeft ? "justify-start pl-1" : "justify-center",
						)}
					>
						<time className="rounded-full border border-black/[0.04] bg-white/52 px-2 py-0.5 text-[9px] leading-none tabular-nums text-muted-foreground/55 shadow-[0_4px_10px_-8px_rgba(15,23,42,0.2)] dark:border-white/8 dark:bg-white/[0.04]">
							{dayjs(msg.timestamp).format("HH:mm")}
						</time>
					</div>
					<div className="relative">
						<span
							aria-hidden="true"
							className={cn(
								"pointer-events-none absolute top-3.5 size-3 rotate-45 z-0",
								isUser
									? "right-[-6px] border-r border-b border-emerald-600/10 bg-[#9fe870] dark:bg-[#7fd45c]"
									: "left-[-6px] bg-[rgba(255,255,255,0.98)] dark:bg-[#2b2b2d]",
							)}
						/>
						<span
							aria-hidden="true"
							className={cn(
								"pointer-events-none absolute top-[15px] size-2 rotate-45 z-0",
								isUser
									? "right-[-2px] bg-[#9fe870] dark:bg-[#7fd45c]"
									: "left-[-2px] bg-[rgba(255,255,255,0.96)] dark:bg-[#2b2b2d]",
							)}
						/>
						<div className={cn(shellClassName, "z-[1]")}>
							<MessageActions
								msg={msg}
								onCopy={handleCopy}
								onRetry={msg.role === "assistant" ? onRetry : undefined}
								isUser={isUser}
							/>

							<div className="relative z-[1] min-w-0">
								<div className="space-y-1">
									{msg.blocks.map((block, i) => {
										if (block.type === "tool_call") {
											const b = block as ToolCallBlock;
											return (
												<div key={i}>
													<ToolCallDisplay
														compact
														renderDiff={renderDiff}
														renderFile={renderFile}
														data={{
															toolName: b.tool,
															input: b.input,
															output: b.output,
															isError: b.isError,
															before: b.before,
															after: b.after,
															filePath: b.filePath,
															durationMs: b.durationMs,
														}}
													/>
												</div>
											);
										}
										if (block.type === "text") {
											return (
												<div
													key={i}
													className={cn(
														"overflow-x-auto text-[14px] leading-6.5",
														isUser
															? "text-slate-900 dark:text-slate-900"
															: "text-foreground/92",
													)}
												>
													<TextWithFileMentions
														content={block.content}
														isUser={isUser}
														onOpenFilePath={onOpenFilePath}
														renderMarkdown={renderMarkdown}
													/>
												</div>
											);
										}
										return null;
									})}
									{isUser && <InlineImages images={msg.images} />}
								</div>
							</div>
						</div>
					</div>

					{msg.stopReason === "max_tokens" && (
						<div className="mt-2 flex items-center gap-1.5 pl-1 text-[10px] text-amber-600 dark:text-amber-400">
							<span className="size-1 rounded-full bg-amber-500" />
							输出被截断 (max_tokens)
						</div>
					)}
				</div>

				{isUser && !isCompactLeft ? (
					<div className="mt-6 size-9 shrink-0 overflow-hidden rounded-[12px] ring-1 ring-black/5 shadow-sm shadow-black/5">
						{userAvatarSrc ? (
							<img
								src={userAvatarSrc}
								alt="用户"
								className="size-full object-cover"
							/>
						) : (
							<div className="size-full bg-primary flex items-center justify-center">
								<svg className="size-4 text-primary-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
									<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
								</svg>
							</div>
						)}
					</div>
				) : null}
			</div>
		</div>
	);
});

export default MessageItem;
