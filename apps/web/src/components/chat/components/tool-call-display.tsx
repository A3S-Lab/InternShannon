import {
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
	cn,
} from "../../ui";
import {
	ChevronDown,
	ChevronRight,
	Code2,
	FileCode,
	FileText,
	FolderOpen,
	Globe,
	Loader2,
	Maximize2,
	Search,
	ShieldAlert,
	Terminal,
	Wrench,
	XCircle,
} from "lucide-react";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import {
	ansiToHtml,
	detectBashBoxEndpointMismatch,
	langFromPath,
} from "../utils/chat-utils";
import {
	extractToolPath,
	getToolInvocationParts,
	getTerminalVerb,
	getToolKind,
	shouldShowToolPreviewByDefault,
	summarizeToolResult,
	type ToolDisplayMeta,
	type ToolKind,
} from "../utils/tool-call-display-utils";

export interface ToolCallDisplayData {
	toolName: string;
	input?: string;
	output?: string;
	isError?: boolean;
	before?: string;
	after?: string;
	filePath?: string;
	durationMs?: number;
	elapsedTimeSeconds?: number;
	active?: boolean;
}

export interface ToolCallDisplayRenderProps {
	renderDiff?: (
		original: string,
		modified: string,
		language: string,
	) => ReactNode;
	renderFile?: (
		content: string,
		language: string,
		filepath?: string,
	) => ReactNode;
}

const TOOL_DISPLAY: Record<ToolKind, ToolDisplayMeta> = {
	read: {
		label: "读取文件",
		icon: <FileText className="size-3.5" />,
		iconTone: "text-sky-600 dark:text-sky-300",
		textTone: "text-sky-700 dark:text-sky-300",
		lineTone: "border-sky-500/22",
		outputTone: "border-sky-500/18 bg-sky-500/[0.035]",
	},
	write: {
		label: "写入文件",
		icon: <FileCode className="size-3.5" />,
		iconTone: "text-emerald-600 dark:text-emerald-300",
		textTone: "text-emerald-700 dark:text-emerald-300",
		lineTone: "border-emerald-500/22",
		outputTone: "border-emerald-500/18 bg-emerald-500/[0.035]",
	},
	edit: {
		label: "修改文件",
		icon: <Code2 className="size-3.5" />,
		iconTone: "text-amber-600 dark:text-amber-300",
		textTone: "text-amber-700 dark:text-amber-300",
		lineTone: "border-amber-500/24",
		outputTone: "border-amber-500/20 bg-amber-500/[0.04]",
	},
	command: {
		label: "执行命令",
		icon: <Terminal className="size-3.5" />,
		iconTone: "text-violet-600 dark:text-violet-300",
		textTone: "text-violet-700 dark:text-violet-300",
		lineTone: "border-violet-500/22",
		outputTone: "border-violet-500/18 bg-violet-500/[0.035]",
	},
	search: {
		label: "搜索内容",
		icon: <Search className="size-3.5" />,
		iconTone: "text-cyan-600 dark:text-cyan-300",
		textTone: "text-cyan-700 dark:text-cyan-300",
		lineTone: "border-cyan-500/22",
		outputTone: "border-cyan-500/18 bg-cyan-500/[0.035]",
	},
	list: {
		label: "浏览目录",
		icon: <FolderOpen className="size-3.5" />,
		iconTone: "text-teal-600 dark:text-teal-300",
		textTone: "text-teal-700 dark:text-teal-300",
		lineTone: "border-teal-500/22",
		outputTone: "border-teal-500/18 bg-teal-500/[0.035]",
	},
	web: {
		label: "访问网页",
		icon: <Globe className="size-3.5" />,
		iconTone: "text-indigo-600 dark:text-indigo-300",
		textTone: "text-indigo-700 dark:text-indigo-300",
		lineTone: "border-indigo-500/22",
		outputTone: "border-indigo-500/18 bg-indigo-500/[0.035]",
	},
	other: {
		label: "使用能力",
		icon: <Wrench className="size-3.5" />,
		iconTone: "text-primary",
		textTone: "text-primary",
		lineTone: "border-primary/22",
		outputTone: "border-primary/16 bg-primary/[0.03]",
	},
};

function TerminalOutput({ text }: { text: string }) {
	if (!text.includes("\x1b[")) return <>{text}</>;
	return <span dangerouslySetInnerHTML={{ __html: ansiToHtml(text) }} />;
}

export function ToolCallDisplay({
	data,
	compact = false,
	renderDiff,
	renderFile,
}: {
	data: ToolCallDisplayData;
	compact?: boolean;
} & ToolCallDisplayRenderProps) {
	const [open, setOpen] = useState<boolean | null>(null);
	const [modalOpen, setModalOpen] = useState(false);
	const kind = getToolKind(data.toolName);
	const meta = TOOL_DISPLAY[kind];
	const invocation = getToolInvocationParts(
		data.toolName,
		data.input,
		data.filePath,
	);
	const path = extractToolPath(data.input, data.filePath);
	const isActive = !!data.active && !data.isError;
	const isRunning = isActive && !data.output;
	const hasLiveOutput = isActive && !!data.output;
	const terminalVerb = getTerminalVerb(
		kind,
		isRunning || hasLiveOutput,
		data.isError,
	);
	const elapsedText =
		typeof data.durationMs === "number"
			? `${(data.durationMs / 1000).toFixed(1)}s`
			: typeof data.elapsedTimeSeconds === "number" &&
					data.elapsedTimeSeconds > 0
				? `${Math.round(data.elapsedTimeSeconds)}s`
				: "";
	const hasDiff = !!data.before && !!data.after && !data.isError;
	const hasVisualOutput = !!data.output || hasDiff;
	const defaultPreview = shouldShowToolPreviewByDefault(
		kind,
		hasVisualOutput,
		data.isError,
	);
	const expanded = open ?? defaultPreview;
	const shouldExpand = hasVisualOutput && expanded;
	const outputLines = data.output?.split("\n") ?? [];
	const previewLines = compact ? 5 : 8;
	const previewOutput = outputLines.slice(0, previewLines).join("\n");
	const isLongOutput = outputLines.length > previewLines;
	const boxEndpointMismatch =
		kind === "command"
			? detectBashBoxEndpointMismatch(data.input ?? "", data.output)
			: null;
	const canToggle = hasVisualOutput;
	const resultSummary = summarizeToolResult(
		kind,
		data.output,
		data.isError,
		data.active,
	);

	useEffect(() => {
		if (!data.active && open && !data.output && !hasDiff) {
			setOpen(null);
		}
	}, [data.active, data.output, hasDiff, open]);

	const language = langFromPath(path ?? "");

	return (
		<div
			className={cn(
				"my-1.5 font-mono text-[12px] leading-5",
				data.isError ? "text-destructive/82" : "text-foreground/80",
			)}
		>
			<button
				type="button"
				className={cn(
					"group flex w-full items-start gap-2 rounded-[6px] px-1.5 py-1 text-left transition-all duration-200",
					canToggle && "hover:bg-muted/40 active:scale-[0.99]",
					!canToggle && "cursor-default",
				)}
				onClick={() =>
					canToggle && setOpen((value) => !(value ?? defaultPreview))
				}
			>
				<span
					className={cn(
						"mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-[5px] bg-background/90 ring-1 ring-border/40 transition-all duration-200",
						data.isError ? "text-destructive ring-destructive/30" : meta.iconTone,
						canToggle &&
							"group-hover:ring-border/60 group-hover:scale-105",
					)}
				>
					{isRunning || hasLiveOutput ? (
						<Loader2 className="size-3.5 animate-spin" />
					) : data.isError ? (
						<XCircle className="size-3.5" />
					) : (
						meta.icon
					)}
				</span>
				<span className="min-w-0 flex-1">
					<span
						className={cn(
							"flex min-w-0 items-center gap-1.5",
							data.isError ? "text-destructive/90" : "text-foreground/80",
						)}
					>
						<span className="min-w-0 truncate text-[12.5px] font-semibold">
							<span
								className={cn(
									data.isError ? "text-destructive/90" : meta.textTone,
								)}
							>
								{invocation.name}
							</span>
							{invocation.args ? (
								<>
									<span className="text-muted-foreground/42">(</span>
									<span className="font-medium text-foreground/78">
										{invocation.args}
									</span>
									<span className="text-muted-foreground/42">)</span>
								</>
							) : null}
						</span>
						{elapsedText ? (
							<span className="ml-auto shrink-0 text-[10px] tabular-nums text-muted-foreground/45">
								{elapsedText}
							</span>
						) : null}
						{canToggle ? (
							expanded ? (
								<ChevronDown className="size-3 shrink-0 text-muted-foreground/45" />
							) : (
								<ChevronRight className="size-3 shrink-0 text-muted-foreground/45" />
							)
						) : null}
					</span>
				</span>
			</button>

			<div
				className={cn(
					"ml-7 flex items-start gap-2 border-l pl-2.5 text-[11.5px] font-medium",
					data.isError
						? "border-destructive/24 text-destructive/74"
						: `${meta.lineTone} text-muted-foreground/72`,
				)}
			>
				<span className="shrink-0 select-none text-muted-foreground/45">⎿</span>
				<span className="min-w-0 truncate">{resultSummary}</span>
			</div>

			{shouldExpand ? (
				<div
					className={cn(
						"ml-7 border-l pl-4 pt-1",
						data.isError ? "border-destructive/24" : meta.lineTone,
					)}
				>
					{boxEndpointMismatch ? (
						<div className="mb-2 rounded-[6px] border border-amber-500/20 bg-amber-500/10 px-2.5 py-2 text-[11px] leading-5 text-amber-800 dark:text-amber-200">
							<div className="mb-0.5 flex items-center gap-1.5 font-medium">
								<ShieldAlert className="size-3.5" />
								<span>输出需要确认</span>
							</div>
							{boxEndpointMismatch}
						</div>
					) : null}

					{hasDiff ? (
						<div
							className={cn(
								"max-h-[320px] overflow-auto rounded-[6px] border bg-background shadow-sm shadow-black/[0.03]",
								data.isError ? "border-destructive/16" : meta.outputTone,
							)}
						>
							{renderDiff ? (
								renderDiff(data.before!, data.after!, language)
							) : (
								<pre
									className={cn(
										"whitespace-pre-wrap break-words px-3 py-2.5 font-mono text-[11px] leading-5",
										data.isError
											? "text-destructive/82"
											: "text-foreground/80",
									)}
								>
									{data.after}
								</pre>
							)}
						</div>
					) : kind === "read" && data.output ? (
						<div>
							<div
								className={cn(
									"max-h-[260px] overflow-auto rounded-[6px] border bg-background shadow-sm shadow-black/[0.03]",
									data.isError ? "border-destructive/16" : meta.outputTone,
								)}
							>
								{renderFile ? (
									renderFile(
										isLongOutput ? previewOutput : data.output,
										language,
										path ?? undefined,
									)
								) : (
									<pre
										className={cn(
											"whitespace-pre-wrap break-words px-3 py-2.5 font-mono text-[11px] leading-5",
											data.isError
												? "text-destructive/82"
												: "text-foreground/80",
										)}
									>
										<TerminalOutput
											text={isLongOutput ? previewOutput : data.output}
										/>
									</pre>
								)}
							</div>
							{isLongOutput ? (
								<button
									type="button"
									onClick={() => setModalOpen(true)}
									className="mt-1.5 inline-flex items-center gap-1 text-[11px] text-muted-foreground/62 transition-colors hover:text-foreground/75"
								>
									<Maximize2 className="size-3" />
									查看全部 {outputLines.length} 行
								</button>
							) : null}
						</div>
					) : data.output ? (
						<div>
							<pre
								className={cn(
									"max-h-[220px] overflow-auto whitespace-pre-wrap break-words rounded-[6px] border px-3 py-2.5 font-mono text-[11px] leading-5 shadow-sm shadow-black/[0.025]",
									data.isError
										? "border-destructive/18 bg-destructive/[0.04] text-destructive/82"
										: `${meta.outputTone} text-foreground/80`,
								)}
							>
								<TerminalOutput
									text={isLongOutput ? previewOutput : data.output}
								/>
								{isLongOutput ? (
									<span className="text-muted-foreground/45">
										{"\n... "}
										还有 {outputLines.length - previewLines} 行
									</span>
								) : null}
							</pre>
							{isLongOutput ? (
								<button
									type="button"
									onClick={() => setModalOpen(true)}
									className="mt-1.5 inline-flex items-center gap-1 text-[11px] text-muted-foreground/62 transition-colors hover:text-foreground/75"
								>
									<Maximize2 className="size-3" />
									查看完整输出
								</button>
							) : null}
						</div>
					) : null}
				</div>
			) : null}

			<Dialog open={modalOpen} onOpenChange={setModalOpen}>
				<DialogContent className="flex max-h-[80vh] max-w-3xl flex-col">
					<DialogHeader>
						<DialogTitle className="flex items-center gap-2 text-sm">
							<span
								className={cn(
									"flex size-6 items-center justify-center rounded-[6px]",
									meta.iconTone,
								)}
							>
								{meta.icon}
							</span>
							{terminalVerb}
							{path ? (
								<span className="min-w-0 truncate text-xs font-normal text-muted-foreground">
									{path}
								</span>
							) : null}
						</DialogTitle>
					</DialogHeader>
					<div className="min-h-0 flex-1 overflow-auto">
						{kind === "read" && data.output ? (
							renderFile ? (
								renderFile(data.output, language, path ?? undefined)
							) : (
								<pre className="whitespace-pre-wrap rounded-[6px] border border-border/35 bg-muted/20 p-3 font-mono text-[11px] leading-5 text-foreground/82">
									<TerminalOutput text={data.output} />
								</pre>
							)
						) : data.output ? (
							<pre className="whitespace-pre-wrap rounded-[6px] border border-border/35 bg-muted/20 p-3 font-mono text-[11px] leading-5 text-foreground/82">
								<TerminalOutput text={data.output} />
							</pre>
						) : null}
					</div>
				</DialogContent>
			</Dialog>
		</div>
	);
}
