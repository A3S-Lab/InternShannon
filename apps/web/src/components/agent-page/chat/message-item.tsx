import { useReactive } from "ahooks";
import dayjs from "dayjs";
import { Check, Copy, RefreshCw, ThumbsDown, ThumbsUp } from "lucide-react";
import React, { useCallback, useMemo } from "react";
import { toast } from "sonner";
import { useSnapshot } from "valtio";
import { MemoizedMarkdown } from "@/components/memoized-markdown/MemoizedMarkdown";
import { writeClipboardText } from "@/lib/clipboard";
import { workspaceAssetPath } from "@/lib/constants";
import { hasTauriCore } from "@/lib/runtime-environment";
import { cn } from "@/lib/utils";
import agentRegistryModel from "@/models/agent-registry.model";
import globalModel from "@/models/global.model";
import { AgentAvatar } from "../agent-avatar";
import { createInlineImageItems } from "./message-item-image-state";
import { ToolCallBlockViewCompact as ToolCallBlockView } from "./message-blocks";
import type { RichBlock, RichMessage, TextBlock } from "./types";

// =============================================================================
// Date separator — shown between messages on different days
// =============================================================================

export function DateSeparator({ timestamp }: { timestamp: number }) {
  const label = dayjs(timestamp).format("YYYY-MM-DD");
  const isToday = dayjs(timestamp).isSame(dayjs(), "day");
  const isYesterday = dayjs(timestamp).isSame(dayjs().subtract(1, "day"), "day");
  const display = isToday ? "今天" : isYesterday ? "昨天" : label;

  return (
    <div className="flex items-center gap-3 px-4 py-2 select-none">
      <div className="flex-1 h-px bg-gradient-to-r from-transparent via-border to-transparent" />
      <span className="text-[10px] text-muted-foreground/50 font-medium tracking-wider uppercase">{display}</span>
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
  className,
}: {
  msg: RichMessage;
  onCopy: () => void;
  onRetry?: () => void;
  isUser: boolean;
  className?: string;
}) {
  const state = useReactive({
    copied: false,
    feedback: null as "up" | "down" | null,
  });

  const handleCopy = () => {
    onCopy();
    state.copied = true;
    setTimeout(() => {
      state.copied = false;
    }, 1500);
  };

  const handleFeedback = (type: "up" | "down") => {
    state.feedback = state.feedback === type ? null : type;
  };

  return (
    <div
      className={cn(
        "pointer-events-none inline-flex h-5 items-center gap-0.5 rounded-full border border-border-light bg-white/95 px-0.5 opacity-0 shadow-[0_3px_8px_rgba(15,23,42,0.08)] backdrop-blur-md transition-opacity duration-150 group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100",
        isUser ? "origin-top-right" : "origin-top-left",
        className,
      )}
    >
      <button
        type="button"
        className="flex size-5 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/40"
        onClick={handleCopy}
        aria-label="复制消息"
        title="复制"
      >
        {state.copied ? <Check className="size-3 text-emerald-500" /> : <Copy className="size-3" />}
      </button>
      {msg.role === "assistant" && onRetry && (
        <button
          type="button"
          className="flex size-5 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/40"
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
            "flex size-5 items-center justify-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/40",
            state.feedback === "up"
              ? "text-emerald-500 hover:bg-emerald-500/10"
              : "text-muted-foreground hover:bg-muted hover:text-foreground",
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
            "flex size-5 items-center justify-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/40",
            state.feedback === "down"
              ? "text-red-500 hover:bg-red-500/10"
              : "text-muted-foreground hover:bg-muted hover:text-foreground",
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
// Inline image display for user messages
// =============================================================================

function InlineImages({ images }: { images?: { mediaType: string; data: string }[] }) {
  const items = createInlineImageItems(images);
  if (items.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-2 mt-2">
      {items.map((img) => (
        <a
          key={img.key}
          href={img.href}
          target="_blank"
          rel="noopener noreferrer"
          className="block"
        >
          <img
            src={img.src}
            alt={img.alt}
            className="max-h-48 max-w-xs rounded-md border object-contain hover:opacity-90 transition-opacity cursor-zoom-in"
          />
        </a>
      ))}
    </div>
  );
}

// =============================================================================
// File mention card for @/path/to/file mentions
// =============================================================================

/** Split text content into alternating plain-text and file-path segments */
function splitFileMentions(text: string): Array<{ type: "text" | "file"; value: string; key: string }> {
  if (!text) return [];
  const segments: Array<{ type: "text" | "file"; value: string; key: string }> = [];
  // Match @/absolute/path (no whitespace)
  const re = /@(\/[^\s@]+)/g;
  let last = 0;
  let match = re.exec(text);
  while (match !== null) {
    if (match.index > last) {
      segments.push({
        type: "text",
        value: text.slice(last, match.index),
        key: `text:${last}:${match.index}`,
      });
    }
    segments.push({ type: "file", value: match[1], key: `file:${match.index}:${match[1]}` });
    last = match.index + match[0].length;
    match = re.exec(text);
  }
  if (last < text.length) {
    segments.push({ type: "text", value: text.slice(last), key: `text:${last}:${text.length}` });
  }
  return segments;
}

function stableHash(value: string): string {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) | 0;
  }
  return Math.abs(hash).toString(36);
}

function richBlockKey(block: RichBlock): string {
  if (block.type === "tool_call") {
    return stableHash(["tool", block.tool, block.filePath ?? "", block.input, block.output ?? ""].join("\u0000"));
  }
  return stableHash(`text:${block.content}`);
}

/** Inline SVG file-type icon component */
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
                      : ["png", "jpg", "jpeg", "gif", "svg", "webp"].includes(ext || "")
                        ? "#10b981"
                        : ["json", "toml", "yaml", "yml"].includes(ext || "")
                          ? "#f59e0b"
                          : "#64748b";

  // Code file
  if (
    [
      "ts",
      "tsx",
      "js",
      "jsx",
      "rs",
      "py",
      "go",
      "java",
      "c",
      "cpp",
      "h",
      "hpp",
      "cs",
      "rb",
      "php",
      "swift",
      "kt",
      "scala",
      "vue",
      "svelte",
    ].includes(ext || "")
  ) {
    return (
      <svg aria-hidden="true" focusable="false" width={s} height={s} viewBox="0 0 24 24" fill="none">
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
  // Image file
  if (["png", "jpg", "jpeg", "gif", "svg", "webp", "ico", "bmp"].includes(ext || "")) {
    return (
      <svg aria-hidden="true" focusable="false" width={s} height={s} viewBox="0 0 24 24" fill="none">
        <rect x="3" y="3" width="18" height="18" rx="2" stroke={iconColor} strokeWidth="1.8" />
        <circle cx="8.5" cy="8.5" r="1.5" fill={iconColor} />
        <path d="M21 15l-5-5L5 21" stroke={iconColor} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  // PDF
  if (ext === "pdf") {
    return (
      <svg aria-hidden="true" focusable="false" width={s} height={s} viewBox="0 0 24 24" fill="none">
        <path
          d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6Z"
          stroke={iconColor}
          strokeWidth="1.8"
          strokeLinejoin="round"
        />
        <path d="M14 2v6h6M9 13h6M9 17h4" stroke={iconColor} strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    );
  }
  // Office (doc/xls/ppt)
  if (["doc", "docx", "odt"].includes(ext || "")) {
    return (
      <svg aria-hidden="true" focusable="false" width={s} height={s} viewBox="0 0 24 24" fill="none">
        <path
          d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6Z"
          stroke={iconColor}
          strokeWidth="1.8"
          strokeLinejoin="round"
        />
        <path d="M14 2v6h6M9 12h6M9 16h4" stroke={iconColor} strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    );
  }
  if (["xls", "xlsx", "csv", "ods"].includes(ext || "")) {
    return (
      <svg aria-hidden="true" focusable="false" width={s} height={s} viewBox="0 0 24 24" fill="none">
        <path
          d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6Z"
          stroke={iconColor}
          strokeWidth="1.8"
          strokeLinejoin="round"
        />
        <path d="M14 2v6h6M8 13h8M8 17h5" stroke={iconColor} strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    );
  }
  if (["ppt", "pptx", "odp"].includes(ext || "")) {
    return (
      <svg aria-hidden="true" focusable="false" width={s} height={s} viewBox="0 0 24 24" fill="none">
        <path
          d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6Z"
          stroke={iconColor}
          strokeWidth="1.8"
          strokeLinejoin="round"
        />
        <path
          d="M14 2v6h6M9 11l2 2 4-4"
          stroke={iconColor}
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  }
  // Markdown / text
  if (["md", "txt", "text"].includes(ext || "")) {
    return (
      <svg aria-hidden="true" focusable="false" width={s} height={s} viewBox="0 0 24 24" fill="none">
        <path
          d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6Z"
          stroke={iconColor}
          strokeWidth="1.8"
          strokeLinejoin="round"
        />
        <path d="M14 2v6h6M8 13h8M8 17h8M8 9h2" stroke={iconColor} strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    );
  }
  // Config / data
  if (["json", "toml", "yaml", "yml", "xml", "ini", "env"].includes(ext || "")) {
    return (
      <svg aria-hidden="true" focusable="false" width={s} height={s} viewBox="0 0 24 24" fill="none">
        <path
          d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6Z"
          stroke={iconColor}
          strokeWidth="1.8"
          strokeLinejoin="round"
        />
        <path
          d="M9 9l-2 3h4l-2 3M15 9l2 3h-4l2 3"
          stroke={iconColor}
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  }
  // Default generic file
  return (
    <svg aria-hidden="true" focusable="false" width={s} height={s} viewBox="0 0 24 24" fill="none">
      <path
        d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6Z"
        stroke={iconColor}
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <path d="M14 2v6h6" stroke={iconColor} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function FileMentionCard({ path, isUser = false }: { path: string; isUser?: boolean }) {
  const state = useReactive({
    isOpening: false,
  });
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

  const handleOpenFile = async () => {
    if (state.isOpening) return;
    state.isOpening = true;
    try {
      if (!hasTauriCore()) {
        await writeClipboardText(path);
        toast.info("当前浏览器不能打开系统文件，已复制路径");
        return;
      }
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("plugin:shell|open", { path });
    } catch {
      // Fallback: try opening the containing folder
      try {
        if (!hasTauriCore()) throw new Error("No native shell");
        const { invoke } = await import("@tauri-apps/api/core");
        const folder = dir.startsWith("/") ? dir : `/${dir}`;
        await invoke("open_folder", { path: folder });
      } catch {
        // Last resort: copy path
        await writeClipboardText(path).catch(() => undefined);
      }
    } finally {
      state.isOpening = false;
    }
  };

  const handleCopyPath = async () => {
    await writeClipboardText(path);
  };

  const handleContextMenu = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    void handleCopyPath();
  };

  return (
    <button
      type="button"
      title={`${path}\n点击打开 · 右键复制路径`}
      onClick={handleOpenFile}
      onContextMenu={handleContextMenu}
      className={cn(
        "my-1 inline-flex max-w-[19rem] cursor-pointer items-center gap-2.5 rounded-lg border px-3 py-2 text-left shadow-sm backdrop-blur-sm transition-all hover:shadow-md active:scale-[0.98]",
        isUser
          ? "border-primary/25 bg-white/95 hover:border-primary/40"
          : "border-slate-200/60 bg-white/90 dark:border-slate-700/60 dark:bg-slate-900/90 dark:hover:border-slate-600",
      )}
    >
      {/* Icon */}
      <div
        className={cn(
          "flex size-9 shrink-0 items-center justify-center rounded-lg",
          isUser ? "bg-primary/10" : "bg-slate-50 dark:bg-slate-800",
        )}
      >
        <FileTypeIcon ext={ext} size={18} />
      </div>

      {/* File info */}
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] font-semibold leading-tight text-slate-800 dark:text-slate-100">{name}</p>
        <div className="mt-1 flex items-center gap-1.5">
          <span
            className={cn(
              "inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide",
              tagColor,
            )}
          >
            {tagText}
          </span>
          <span className="truncate text-[10px] text-slate-400 dark:text-slate-500">{dir || "/"}</span>
        </div>
      </div>

      {/* Arrow / copy icon */}
      <div className="shrink-0 text-slate-300 dark:text-slate-600">
        {state.isOpening ? (
          <svg
            aria-hidden="true"
            focusable="false"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            className="animate-spin"
          >
            <path d="M21 12a9 9 0 1 1-6.219-8.56" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        ) : (
          <span
            aria-hidden="true"
            title="复制路径"
            className="flex items-center justify-center rounded p-0.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"
          >
            <svg aria-hidden="true" focusable="false" width="14" height="14" viewBox="0 0 24 24" fill="none">
              <rect
                x="9"
                y="9"
                width="13"
                height="13"
                rx="2"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinejoin="round"
              />
              <path
                d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </span>
        )}
      </div>
    </button>
  );
}

/** Render text that may contain @/path file mentions as inline cards */
function TextWithFileMentions({ content, isUser = false }: { content: string; isUser?: boolean }) {
  const safeContent = content ?? "";
  const segments = useMemo(() => splitFileMentions(safeContent), [safeContent]);
  const hasFileMentions = segments.some((s) => s.type === "file");

  if (!hasFileMentions) {
    return <MemoizedMarkdown id={safeContent.slice(0, 32)} content={safeContent} />;
  }

  return (
    <div className="space-y-1">
      {segments.map((seg) =>
        seg.type === "file" ? (
          <FileMentionCard key={seg.key} path={seg.value} isUser={isUser} />
        ) : seg.value.trim() ? (
          <MemoizedMarkdown key={seg.key} id={seg.key} content={seg.value} />
        ) : null,
      )}
    </div>
  );
}

// =============================================================================
// MessageItem
// =============================================================================

const MessageItem = React.memo(function MessageItem({
  msg,
  sessionId,
  onRetry,
  layout = "default",
}: {
  msg: RichMessage;
  sessionId: string;
  onRetry?: () => void;
  layout?: "default" | "compact-left";
}) {
  const isUser = msg.role === "user";
  const isCompactLeft = layout === "compact-left";
  const { user } = useSnapshot(globalModel.state);
  const agent = agentRegistryModel.getSessionAgent(sessionId);

  // Extract plain text for copy
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
    "relative overflow-visible font-sans backdrop-blur-[2px]",
    isCompactLeft
      ? cn(
          "rounded-[8px] border px-2.5 py-1.5 shadow-[0_2px_6px_rgba(36,36,36,0.05)]",
          isUser ? "border-primary/30 bg-primary/5 text-foreground" : "border-border-light bg-white text-foreground",
        )
      : cn(
          "px-3 py-2",
          isUser
            ? "rounded-[14px] rounded-tr-[6px] border border-primary/30 bg-[linear-gradient(135deg,#f8fbff_0%,#eaf3ff_100%)] text-foreground shadow-[rgba(44,30,116,0.08)_3px_2px_12px]"
            : "rounded-[14px] rounded-tl-[6px] border border-border-light bg-white text-foreground shadow-[rgba(36,36,36,0.06)_0px_6px_12px_-4px]",
        ),
  );

  if (msg.role === "system") {
    return (
      <div className="flex justify-center px-4 py-2">
        <div className="max-w-md rounded-full border border-border-light bg-white px-4 py-1.5 text-center text-[11px] text-muted-foreground shadow-[rgba(0,0,0,0.08)_0px_4px_6px]">
          {msg.blocks[0]?.type === "text" ? (msg.blocks[0] as TextBlock).content : ""}
        </div>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "group relative w-full min-w-0 transition-[opacity,transform] duration-200",
        isCompactLeft ? "px-3 py-0.5" : "px-3 pb-1.5 pt-1 sm:px-4",
      )}
    >
      <div
        className={cn(
          "relative flex min-w-0 items-start",
          isCompactLeft ? "gap-2" : "gap-2",
          isCompactLeft ? "justify-start" : isUser && "justify-end",
        )}
      >
        {isCompactLeft ? (
          <span
            className={cn(
              "mt-6 inline-flex size-2 shrink-0 rounded-full",
              isUser
                ? "bg-primary shadow-[0_0_0_3px_hsl(var(--primary)_/_0.12)]"
                : "bg-emerald-500 shadow-[0_0_0_3px_rgba(16,185,129,0.12)]",
            )}
            aria-hidden="true"
          />
        ) : !isUser ? (
          <AgentAvatar
            agent={agent}
            className="mt-4 size-7 shrink-0 rounded-[12px] ring-1 ring-border-light shadow-[rgba(0,0,0,0.06)_0px_3px_5px]"
          />
        ) : null}

        <div
          className={cn(
            "min-w-0",
            isCompactLeft
              ? "max-w-[min(96%,72rem)]"
              : isUser
                ? "order-[-1] max-w-[min(78%,44rem)]"
                : "max-w-[min(84%,52rem)]",
          )}
        >
          <div className={cn("relative h-5", isCompactLeft ? "mb-0.5 pl-0.5" : "mb-0.5")}>
            <time
              className={cn(
                "absolute top-1/2 -translate-y-1/2 text-[9px] leading-none text-muted-foreground opacity-100 transition-opacity duration-150 [font-variant-numeric:tabular-nums] group-hover:opacity-0 group-focus-within:opacity-0",
                isUser ? "right-0" : "left-0",
                !isCompactLeft &&
                  "rounded-full border border-border-light bg-white/80 px-1.5 py-0.5 shadow-[rgba(0,0,0,0.05)_0px_2px_4px]",
              )}
            >
              {dayjs(msg.timestamp).format("HH:mm")}
            </time>
            <MessageActions
              msg={msg}
              onCopy={handleCopy}
              onRetry={msg.role === "assistant" ? onRetry : undefined}
              isUser={isUser}
              className={cn("absolute top-0", isUser ? "right-0" : "left-0")}
            />
          </div>
          <div className="relative">
            <span
              aria-hidden="true"
              className={cn("pointer-events-none absolute top-3.5 hidden size-3 rotate-45", "z-0")}
            />
            <span
              aria-hidden="true"
              className={cn("pointer-events-none absolute top-[15px] hidden size-2 rotate-45", "z-0")}
            />
            <div className={cn(shellClassName, "z-[1]")}>
              <div className="relative z-[1] min-w-0">
                <div className="space-y-1">
                  {msg.blocks.map((block) => {
                    const key = richBlockKey(block);
                    switch (block.type) {
                      case "tool_call":
                        return <ToolCallBlockView key={key} block={block} />;
                      case "text":
                        return (
                          <div
                            key={key}
                            className={cn(
                              "overflow-x-auto", // Allow horizontal scroll for wide content (tables, long lines)
                              "prose-chat-density-compact text-[13px] leading-6",
                              isUser ? "text-foreground" : "text-foreground",
                            )}
                          >
                            <TextWithFileMentions content={block.content} isUser={isUser} />
                          </div>
                        );
                      default:
                        return null;
                    }
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
          <div className="mt-4 size-7 shrink-0 overflow-hidden rounded-[12px] ring-1 ring-border-light shadow-[rgba(0,0,0,0.06)_0px_3px_5px]">
            <img
              src={user.avatar || workspaceAssetPath("logo.png")}
              alt={user.nickname || "用户"}
              className="size-full object-cover"
            />
          </div>
        ) : null}
      </div>
    </div>
  );
});

export default MessageItem;
