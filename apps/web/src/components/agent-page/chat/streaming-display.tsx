import { normalizeMarkdownContent } from "@/components/memoized-markdown/MemoizedMarkdown";
import { StreamdownRenderer } from "@/components/memoized-markdown/streamdown-renderer";
import { cn } from "@/lib/utils";
import agentModel, {
	type CompletedToolCall,
	type StreamingSegment,
	type ToolProgress,
} from "@/models/agent.model";
import agentRegistryModel from "@/models/agent-registry.model";
import { Loader2 } from "lucide-react";
import { useEffect, useMemo, useRef } from "react";
import { useInterval, useReactive } from "ahooks";
import { subscribe } from "valtio";
import { AgentAvatar } from "../agent-avatar";
import { stripLeakedInternalReasoning } from "./chat-utils";
import {
	getVisibleStreamingSegments,
	hasProducedVisibleStreamingContent,
	orderStreamingSegments,
} from "./streaming-display-utils";
import { ToolCallDisplay } from "./tool-call-display";

function StreamingTextContent({
	content,
	sessionId,
	seq,
	streaming,
}: {
	content: string;
	sessionId: string;
	seq: number;
	streaming: boolean;
}) {
	return (
		<StreamdownRenderer
			id={`streaming-${sessionId}-${seq}-${streaming ? "live" : "done"}`}
			content={content}
			streaming={streaming}
		/>
	);
}

function CompletedToolSegment({ t }: { t: CompletedToolCall }) {
	return (
		<ToolCallDisplay
			compact
			data={{
				toolName: t.toolName,
				input: t.input,
				output: t.output,
				isError: t.is_error,
				before: t.before,
				after: t.after,
				filePath: t.filePath,
				durationMs: t.durationMs,
			}}
		/>
	);
}

function ActiveToolSegment({
	p,
	active,
}: {
	p: ToolProgress;
	active: boolean;
}) {
	return (
		<ToolCallDisplay
			compact
			data={{
				toolName: p.toolName,
				input: p.input,
				output: p.output,
				elapsedTimeSeconds: p.elapsedTimeSeconds,
				active,
			}}
		/>
	);
}

/**
 * StreamingDisplay — renders streaming content in arrival order.
 *
 * Uses `streamingSegments` (an ordered array of text/tool blocks) instead of
 * the old separate `completedTools` + `streaming` buckets, which caused all
 * tool calls to render before all text regardless of actual arrival order.
 */
export function StreamingDisplay({
	sessionId,
	layout = "default",
	transformText,
	onContentResize,
}: {
	sessionId: string;
	layout?: "default" | "compact-left";
	transformText?: (content: string) => string;
	onContentResize?: () => void;
}) {
	const state = useReactive({
		segments: [] as StreamingSegment[],
		status: null as string | null,
		streamStartedAt: null as number | null,
		messages: agentModel.state.messages[sessionId] || [],
		nowMs: Date.now(),
	});
	const containerRef = useRef<HTMLDivElement | null>(null);

	// Direct subscription to agentModel.state — fires on every mutation
	useEffect(() => {
		const readState = () => {
			const s = agentModel.state;
			// Clone array to force React updates for in-place proxy mutations.
			state.segments = [...(s.streamingSegments[sessionId] || [])];
			state.status = s.sessionStatus[sessionId] ?? null;
			state.streamStartedAt = s.streamingStartedAt[sessionId] ?? null;
			state.messages = [...(s.messages[sessionId] || [])];
		};
		readState();

		const unsub = subscribe(agentModel.state, readState);
		return unsub;
	}, [sessionId]);

	const isRunning = state.status === "running";
	const isCompacting = state.status === "compacting";
	const streamActive = isRunning || isCompacting;
	const agent = agentRegistryModel.getSessionAgent(sessionId);
	const latestCommittedAssistant = useMemo(
		() =>
			[...state.messages]
				.reverse()
				.find(
					(msg) =>
						msg.role === "assistant" &&
						((msg.contentBlocks?.length || 0) > 0 ||
							msg.content.trim().length > 0),
				) ?? null,
		[state.messages],
	);
	const latestAssistantToolIds = useMemo(() => {
		const lastAssistant = latestCommittedAssistant;
		if (!lastAssistant?.contentBlocks?.length) return new Set<string>();
		return new Set(
			lastAssistant.contentBlocks
				.filter((block) => block.type === "tool_use")
				.map((block) => block.id),
		);
	}, [latestCommittedAssistant]);
	const orderedSegments = useMemo(
		() => orderStreamingSegments(state.segments),
		[state.segments],
	);
	const visibleSegments = useMemo(
		() =>
			getVisibleStreamingSegments(state.segments, {
				streamActive,
				latestAssistantToolIds,
			}),
		[latestAssistantToolIds, state.segments, streamActive],
	);
	// True once any user-visible content has ever been produced.
	const hasProducedContent =
		hasProducedVisibleStreamingContent(orderedSegments);

	const waitingSec = state.streamStartedAt
		? Math.max(0, Math.floor((state.nowMs - state.streamStartedAt) / 1000))
		: 0;
	const showSlowHint =
		isRunning && orderedSegments.length === 0 && waitingSec >= 8;
	const committedAssistantTakesOver =
		!!latestCommittedAssistant &&
		!isRunning &&
		!isCompacting &&
		state.streamStartedAt != null &&
		latestCommittedAssistant.timestamp >= state.streamStartedAt;
	const shouldRender =
		!committedAssistantTakesOver &&
		(isRunning ||
			isCompacting ||
			visibleSegments.length > 0 ||
			(state.streamStartedAt != null && waitingSec < 120));

	useEffect(() => {
		if (!isRunning || !state.streamStartedAt) return;
	}, [isRunning, state.streamStartedAt]);

	useInterval(
		() => (state.nowMs = Date.now()),
		isRunning && state.streamStartedAt ? 400 : undefined,
	);

	useEffect(() => {
		const el = containerRef.current;
		if (!el || !onContentResize) return;

		const notify = () => onContentResize();
		notify();

		if (typeof ResizeObserver === "undefined") {
			window.addEventListener("resize", notify);
			return () => window.removeEventListener("resize", notify);
		}

		const resizeObserver = new ResizeObserver(() => {
			notify();
		});
		resizeObserver.observe(el);

		return () => {
			resizeObserver.disconnect();
		};
	}, [onContentResize]);
	if (!shouldRender) return null;
	const isCompactLeft = layout === "compact-left";

	return (
		<div
			ref={containerRef}
			className={cn(
				"group relative w-full min-w-0 shrink-0",
				isCompactLeft ? "px-3 py-0.5" : "px-3 pb-1.5 pt-1 sm:px-4",
			)}
		>
			<div className={cn("flex items-start", isCompactLeft ? "gap-2" : "gap-2")}>
				{isCompactLeft ? (
					<span
						className="mt-6 inline-flex size-2 shrink-0 rounded-full bg-emerald-500 shadow-[0_0_0_3px_rgba(16,185,129,0.12)]"
						aria-hidden="true"
					/>
				) : (
					<AgentAvatar
						agent={agent}
						className="mt-4 size-7 shrink-0 rounded-[12px] ring-1 ring-[#f2f3f5] shadow-[rgba(0,0,0,0.06)_0px_3px_5px]"
					/>
				)}
				<div className={cn("min-w-0", isCompactLeft ? "max-w-[min(96%,72rem)]" : "max-w-[min(84%,52rem)]")}>
					<div className={cn("flex", isCompactLeft ? "mb-0.5 justify-start pl-0.5" : "mb-0.5 justify-center")}>
						<span
							className={cn(
								"text-[9px] leading-none text-muted-foreground [font-variant-numeric:tabular-nums]",
								!isCompactLeft &&
									"rounded-full border border-border-light bg-white/80 px-1.5 py-0.5 shadow-[rgba(0,0,0,0.05)_0px_2px_4px]",
							)}
						>
							{state.streamStartedAt
								? new Date(state.streamStartedAt).toLocaleTimeString("zh-CN", {
										hour: "2-digit",
										minute: "2-digit",
										hour12: false,
									})
								: ""}
						</span>
					</div>
					<div
						className={cn(
							"relative z-[1] min-w-0 overflow-visible font-sans backdrop-blur-[2px]",
							isCompactLeft
								? "rounded-[8px] border border-border-light bg-white px-2.5 py-1.5 text-foreground shadow-[0_2px_6px_rgba(36,36,36,0.05)]"
								: "rounded-[14px] rounded-tl-[6px] border border-border-light bg-white px-3 py-2 text-foreground shadow-[rgba(36,36,36,0.06)_0px_6px_12px_-4px]",
						)}
					>
						<div className="relative z-[1]">
							<div className="mb-1.5 flex flex-wrap items-center gap-1.5 pr-8">
								<span className="text-[11px] font-medium text-foreground/80">
									{agent?.name || "书小安"}
								</span>
								<span
									className={cn(
										"inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[9px] font-semibold tracking-[0.12em] uppercase",
										streamActive
											? "border-primary/30 bg-primary/10 text-primary"
											: "border-emerald-500/15 bg-[#e8ffea] text-emerald-700",
									)}
								>
									<span
										className={cn(
											"size-1.5 rounded-full",
											streamActive
												? "animate-pulse bg-primary"
												: "bg-emerald-500",
										)}
									/>
									{streamActive ? "生成中" : "已完成"}
								</span>
								{streamActive && (
									<Loader2 className="size-3 animate-spin text-primary" />
								)}
								{isCompacting && (
									<span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-700">
										正在整理对话...
									</span>
								)}
							</div>

							<div className="space-y-1">
								{showSlowHint && (
									<div className="flex items-center gap-2 rounded-[10px] border border-primary/30 bg-primary/5 px-2.5 py-2 text-xs shadow-[rgba(0,0,0,0.05)_0px_2px_6px]">
										<Loader2 className="size-3.5 shrink-0 animate-spin text-primary" />
										<div className="text-primary">
											<div>还在处理，已等待 {waitingSec}s</div>
										</div>
									</div>
								)}

								{/* Ordered segments — text and tool calls interleaved as they arrived */}
								{visibleSegments.map((seg) => {
									if (seg.type === "text") {
										const transformedText = transformText
											? (transformText(seg.content) ?? seg.content)
											: seg.content;
										const visibleText =
											stripLeakedInternalReasoning(transformedText);
										const renderedText = normalizeMarkdownContent(
											visibleText.trim().length > 0 ? visibleText : seg.content,
											{ streaming: streamActive },
										);
										if (renderedText.length === 0) return null;
										return (
											<div
												key={`text-${seg.seq}`}
												className={cn(
													"prose-chat-density-compact text-[13px] leading-6 text-foreground",
												)}
											>
												<StreamingTextContent
													content={renderedText}
													sessionId={sessionId}
													seq={seg.seq}
													streaming={streamActive}
												/>
											</div>
										);
									}
									if (seg.type === "tool_progress") {
										return (
											<ActiveToolSegment
												key={`tool-progress-${seg.progress.toolUseId}-${seg.seq}`}
												p={seg.progress}
												active={streamActive}
											/>
										);
									}
									// seg.type === "tool"
									return (
										<CompletedToolSegment
											key={`${seg.call.toolUseId}-${seg.seq}`}
											t={seg.call}
										/>
									);
								})}

								{!hasProducedContent && streamActive && (
									<div className="flex items-center gap-2 rounded-[10px] border border-border-light bg-[linear-gradient(135deg,#ffffff_0%,#f8fbff_100%)] px-2.5 py-2 text-xs text-foreground/80 shadow-[rgba(0,0,0,0.05)_0px_2px_6px]">
										<span className="font-medium text-foreground">思考中</span>
										<span className="flex gap-1">
											<span
												className="size-1 rounded-full bg-primary/45 animate-bounce"
												style={{ animationDelay: "0ms" }}
											/>
											<span
												className="size-1 rounded-full bg-primary/45 animate-bounce"
												style={{ animationDelay: "150ms" }}
											/>
											<span
												className="size-1 rounded-full bg-primary/45 animate-bounce"
												style={{ animationDelay: "300ms" }}
											/>
										</span>
									</div>
								)}
							</div>
						</div>
					</div>
				</div>
			</div>
		</div>
	);
}
