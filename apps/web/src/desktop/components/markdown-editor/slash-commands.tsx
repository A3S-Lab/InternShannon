/**
 * Slash-command extension for the markdown editor.
 *
 * Format group  — heading 1-3, lists, code block, blockquote, HR
 * AI group      — 扩写, 续写, 润色, 精简, 翻译成英文, 翻译成中文, 总结
 */
import { createSuggestionRenderer } from "@/components/tiptap-editor/suggestion-renderer";
import type { SuggestionItem } from "@/components/tiptap-editor/mention-list";
import { getPreferredSessionModel, resolveApiKey, resolveBaseUrl } from "@/models/settings.model";
import { Extension, type Editor } from "@tiptap/core";
import { PluginKey } from "@tiptap/pm/state";
import Suggestion from "@tiptap/suggestion";
import {
  AlertTriangle,
  CheckSquare,
  Code2,
  Heading1,
  Heading2,
  Heading3,
  Info,
  Languages,
  Lightbulb,
  List,
  ListOrdered,
  Minus,
  OctagonAlert,
  Quote,
  Table,
  Sparkles,
  Scissors,
  Feather,
  Pen,
  AlignLeft,
  StickyNote,
} from "lucide-react";
import { toast } from "sonner";

// ---------------------------------------------------------------------------
// Command definitions
// ---------------------------------------------------------------------------

const COMMANDS: SuggestionItem[] = [
  // Format group
  {
    id: "h1",
    label: "标题 1",
    description: "大号标题",
    icon: <Heading1 className="size-3.5" />,
    group: "格式",
  },
  {
    id: "h2",
    label: "标题 2",
    description: "中号标题",
    icon: <Heading2 className="size-3.5" />,
    group: "格式",
  },
  {
    id: "h3",
    label: "标题 3",
    description: "小号标题",
    icon: <Heading3 className="size-3.5" />,
    group: "格式",
  },
  {
    id: "bullet",
    label: "无序列表",
    description: "项目符号列表",
    icon: <List className="size-3.5" />,
    group: "格式",
  },
  {
    id: "ordered",
    label: "有序列表",
    description: "编号列表",
    icon: <ListOrdered className="size-3.5" />,
    group: "格式",
  },
  {
    id: "task",
    label: "任务列表",
    description: "带复选框的列表",
    icon: <CheckSquare className="size-3.5" />,
    group: "格式",
  },
  {
    id: "code",
    label: "代码块",
    description: "等宽代码区域",
    icon: <Code2 className="size-3.5" />,
    group: "格式",
  },
  {
    id: "quote",
    label: "引用",
    description: "引用块",
    icon: <Quote className="size-3.5" />,
    group: "格式",
  },
  {
    id: "hr",
    label: "分割线",
    description: "水平分隔线",
    icon: <Minus className="size-3.5" />,
    group: "格式",
  },
  // Callout group — Obsidian-style `> [!TYPE]` admonitions. Render as styled
  // boxes in the markdown viewer (see markdown-viewer remarkCallouts).
  {
    id: "callout-note",
    label: "提示框 · 笔记",
    description: "> [!NOTE] 蓝色信息框",
    icon: <StickyNote className="size-3.5" />,
    group: "提示框",
  },
  {
    id: "callout-tip",
    label: "提示框 · 建议",
    description: "> [!TIP] 绿色建议框",
    icon: <Lightbulb className="size-3.5" />,
    group: "提示框",
  },
  {
    id: "callout-info",
    label: "提示框 · 信息",
    description: "> [!INFO] 信息说明框",
    icon: <Info className="size-3.5" />,
    group: "提示框",
  },
  {
    id: "callout-warning",
    label: "提示框 · 警告",
    description: "> [!WARNING] 橙色警告框",
    icon: <AlertTriangle className="size-3.5" />,
    group: "提示框",
  },
  {
    id: "callout-danger",
    label: "提示框 · 危险",
    description: "> [!DANGER] 红色危险框",
    icon: <OctagonAlert className="size-3.5" />,
    group: "提示框",
  },
  // Insert group
  {
    id: "table",
    label: "表格",
    description: "插入 3×3 表格(可编辑、可调列宽)",
    icon: <Table className="size-3.5" />,
    group: "插入",
  },
  // AI group
  {
    id: "ai-expand",
    label: "AI 扩写",
    description: "扩展当前段落，使内容更加丰富",
    icon: <Sparkles className="size-3.5" />,
    group: "AI 助手",
  },
  {
    id: "ai-continue",
    label: "AI 续写",
    description: "基于当前内容继续写作",
    icon: <Pen className="size-3.5" />,
    group: "AI 助手",
  },
  {
    id: "ai-polish",
    label: "AI 润色",
    description: "改善语言表达，使文字更流畅",
    icon: <Feather className="size-3.5" />,
    group: "AI 助手",
  },
  {
    id: "ai-condense",
    label: "AI 精简",
    description: "保留核心内容，去除冗余",
    icon: <Scissors className="size-3.5" />,
    group: "AI 助手",
  },
  {
    id: "ai-to-en",
    label: "翻译成英文",
    description: "将当前内容翻译为英文",
    icon: <Languages className="size-3.5" />,
    group: "AI 助手",
  },
  {
    id: "ai-to-zh",
    label: "翻译成中文",
    description: "将当前内容翻译为中文",
    icon: <Languages className="size-3.5" />,
    group: "AI 助手",
  },
  {
    id: "ai-summarize",
    label: "AI 总结",
    description: "提炼当前内容的核心要点",
    icon: <AlignLeft className="size-3.5" />,
    group: "AI 助手",
  },
];

function filterCommands(query: string): SuggestionItem[] {
  if (!query) return COMMANDS;
  const q = query.toLowerCase();
  return COMMANDS.filter(
    (c) =>
      c.label.toLowerCase().includes(q) ||
      (c.description ?? "").toLowerCase().includes(q) ||
      c.id.toLowerCase().includes(q),
  );
}

export const AI_COMMANDS = COMMANDS.filter((command) => command.id.startsWith("ai-"));

function getCommandLabel(id: string) {
  return COMMANDS.find((command) => command.id === id)?.label ?? "AI";
}

export function filterAiCommands(query: string): SuggestionItem[] {
  if (!query) return AI_COMMANDS;
  const q = query.toLowerCase();
  return AI_COMMANDS.filter(
    (c) =>
      c.label.toLowerCase().includes(q) ||
      (c.description ?? "").toLowerCase().includes(q) ||
      c.id.toLowerCase().includes(q),
  );
}

// ---------------------------------------------------------------------------
// Format commands
// ---------------------------------------------------------------------------

function applyFormat(editor: Editor, range: { from: number; to: number }, id: string) {
  const chain = editor.chain().focus().deleteRange(range);
  switch (id) {
    case "h1":
      chain.toggleHeading({ level: 1 }).run();
      break;
    case "h2":
      chain.toggleHeading({ level: 2 }).run();
      break;
    case "h3":
      chain.toggleHeading({ level: 3 }).run();
      break;
    case "bullet":
      chain.toggleBulletList().run();
      break;
    case "ordered":
      chain.toggleOrderedList().run();
      break;
    case "task":
      chain.toggleTaskList().run();
      break;
    case "code":
      chain.toggleCodeBlock().run();
      break;
    case "quote":
      chain.toggleBlockquote().run();
      break;
    case "hr":
      chain.setHorizontalRule().run();
      break;
    case "callout-note":
    case "callout-tip":
    case "callout-info":
    case "callout-warning":
    case "callout-danger": {
      const type = id.slice("callout-".length).toUpperCase();
      // Blockquote whose first paragraph starts with the `[!TYPE]` marker; on
      // markdown round-trip it becomes `> [!TYPE]` which the viewer styles.
      chain
        .insertContent({
          type: "blockquote",
          content: [{ type: "paragraph", content: [{ type: "text", text: `[!${type}] ` }] }],
        })
        .run();
      break;
    }
    case "table":
      chain.insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run();
      break;
  }
}

// ---------------------------------------------------------------------------
// AI streaming helpers
// ---------------------------------------------------------------------------

const AI_PROMPTS: Record<string, (ctx: string) => string> = {
  "ai-expand": (ctx) =>
    `请扩写以下文字，使内容更加详细丰富，保持原有风格，直接输出扩写后的内容，不要任何解释：\n\n${ctx}`,
  "ai-continue": (ctx) => `请续写以下文字，保持原有风格和语气，直接输出续写内容（不要重复原文）：\n\n${ctx}`,
  "ai-polish": (ctx) => `请润色以下文字，改善语言表达使其更流畅，直接输出润色后的内容，不要任何解释：\n\n${ctx}`,
  "ai-condense": (ctx) => `请精简以下文字，保留核心信息去除冗余，直接输出精简后的内容，不要任何解释：\n\n${ctx}`,
  "ai-to-en": (ctx) => `Please translate the following content into English. Output only the translation:\n\n${ctx}`,
  "ai-to-zh": (ctx) => `请将以下内容翻译成中文，直接输出译文，不要任何解释：\n\n${ctx}`,
  "ai-summarize": (ctx) => `请总结以下内容的核心要点，用简洁的语言表达，直接输出总结，不要任何解释：\n\n${ctx}`,
};

/** Parse SSE data lines and yield JSON strings. */
async function* readSSE(reader: ReadableStreamDefaultReader<Uint8Array>): AsyncGenerator<string> {
  const decoder = new TextDecoder();
  let buf = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop() ?? "";
    for (const line of lines) {
      if (line.startsWith("data: ")) {
        const data = line.slice(6).trim();
        if (data !== "[DONE]") yield data;
      }
    }
  }
}

function extractChunk(json: string, isAnthropic: boolean): string {
  try {
    const obj = JSON.parse(json);
    if (isAnthropic) {
      if (obj.type === "content_block_delta" && obj.delta?.type === "text_delta") {
        return obj.delta.text ?? "";
      }
      return "";
    }
    return obj.choices?.[0]?.delta?.content ?? "";
  } catch {
    return "";
  }
}

function normalizeBaseUrl(baseUrl: string, isAnthropic: boolean): string {
  const trimmed = baseUrl.replace(/\/+$/, "");
  if (!trimmed) {
    return isAnthropic ? "https://api.anthropic.com" : "https://api.openai.com";
  }
  if (isAnthropic) {
    return trimmed.replace(/\/v1$/i, "");
  }
  return trimmed.replace(/\/v1\/chat\/completions$/i, "").replace(/\/v1$/i, "");
}

type AiCommandMode = "append" | "replace";

const AI_COMMAND_MODES: Record<string, AiCommandMode> = {
  "ai-expand": "append",
  "ai-continue": "append",
  "ai-polish": "replace",
  "ai-condense": "replace",
  "ai-to-en": "replace",
  "ai-to-zh": "replace",
  "ai-summarize": "replace",
};

const AI_STREAM_FLUSH_INTERVAL_MS = 48;
const AI_STREAM_MAX_BUFFER_CHARS = 160;

export interface ExecuteMarkdownCommandOptions {
  signal?: AbortSignal;
  onAiStart?: () => void;
  onAiFinish?: () => void;
  onAiChunk?: () => void;
}

type MarkdownAiLifecycleEvent = {
  editor: Editor;
  phase: "start" | "finish";
};

const activeAiEditors = new WeakMap<Editor, number>();
const aiLifecycleListeners = new Set<(event: MarkdownAiLifecycleEvent) => void>();

export function isMarkdownAiWriting(editor: Editor | null): boolean {
  return editor ? (activeAiEditors.get(editor) ?? 0) > 0 : false;
}

export function subscribeMarkdownAiLifecycle(listener: (event: MarkdownAiLifecycleEvent) => void) {
  aiLifecycleListeners.add(listener);
  return () => {
    aiLifecycleListeners.delete(listener);
  };
}

function emitMarkdownAiLifecycle(event: MarkdownAiLifecycleEvent) {
  for (const listener of aiLifecycleListeners) {
    listener(event);
  }
}

function beginMarkdownAiWriting(editor: Editor, options?: ExecuteMarkdownCommandOptions) {
  const count = activeAiEditors.get(editor) ?? 0;
  activeAiEditors.set(editor, count + 1);
  if (count === 0) {
    emitMarkdownAiLifecycle({ editor, phase: "start" });
  }
  options?.onAiStart?.();

  let finished = false;
  return () => {
    if (finished) return;
    finished = true;

    const nextCount = Math.max(0, (activeAiEditors.get(editor) ?? 1) - 1);
    if (nextCount === 0) {
      activeAiEditors.delete(editor);
      emitMarkdownAiLifecycle({ editor, phase: "finish" });
    } else {
      activeAiEditors.set(editor, nextCount);
    }
    options?.onAiFinish?.();
  };
}

function isAbortError(error: unknown, signal?: AbortSignal) {
  return (
    signal?.aborted ||
    (error instanceof DOMException && error.name === "AbortError") ||
    (error instanceof Error && error.name === "AbortError")
  );
}

function createBufferedInserter(
  editor: Editor,
  initialInsertPos: number,
  options?: Pick<ExecuteMarkdownCommandOptions, "onAiChunk">,
) {
  let insertPos = initialInsertPos;
  let pendingText = "";
  let flushTimer: ReturnType<typeof setTimeout> | null = null;

  const clearFlushTimer = () => {
    if (!flushTimer) return;
    clearTimeout(flushTimer);
    flushTimer = null;
  };

  const flush = () => {
    clearFlushTimer();
    if (!pendingText || editor.isDestroyed) return;
    const text = pendingText;
    pendingText = "";
    editor.commands.insertContentAt(insertPos, text);
    insertPos += text.length;
    options?.onAiChunk?.();
  };

  const scheduleFlush = () => {
    if (flushTimer) return;
    flushTimer = setTimeout(flush, AI_STREAM_FLUSH_INTERVAL_MS);
  };

  return {
    append(text: string) {
      pendingText += text;
      if (pendingText.length >= AI_STREAM_MAX_BUFFER_CHARS) {
        flush();
      } else {
        scheduleFlush();
      }
    },
    flush,
    discard() {
      clearFlushTimer();
      pendingText = "";
    },
  };
}

function adjustAfterDelete(pos: number, range: { from: number; to: number }): number {
  if (pos <= range.from) return pos;
  if (pos >= range.to) return pos - (range.to - range.from);
  return range.from;
}

function currentBlockBounds(editor: Editor) {
  const { state } = editor;
  const { $head } = state.selection;
  return {
    start: $head.start($head.depth),
    end: $head.end($head.depth),
  };
}

function currentSelectionText(editor: Editor, range: { from: number; to: number }): string {
  return editor.state.doc.textBetween(range.from, range.to, "\n").trim();
}

function currentBlockText(editor: Editor, range?: { from: number; to: number }): string {
  const { state } = editor;
  const { start, end } = currentBlockBounds(editor);
  if (!range || range.from >= end || range.to <= start) {
    return state.doc.textBetween(start, end, "\n").trim();
  }
  const before = state.doc.textBetween(start, Math.max(start, range.from), "\n");
  const after = state.doc.textBetween(Math.min(end, range.to), end, "\n");
  return `${before}${after}`.trim();
}

async function runAiCommand(
  editor: Editor,
  range: { from: number; to: number },
  commandId: string,
  options: ExecuteMarkdownCommandOptions = {},
) {
  const mode = AI_COMMAND_MODES[commandId];
  if (!mode) return;

  const { start: blockStart, end: blockEnd } = currentBlockBounds(editor);
  const hasSelectedText = range.to > range.from;
  const selectionText = hasSelectedText ? currentSelectionText(editor, range) : "";
  const context = selectionText || currentBlockText(editor, range);
  if (!context) {
    toast.error("当前段落没有内容，请先写一些文字");
    editor.chain().focus().deleteRange(range).run();
    return;
  }

  const { providerName, modelId } = getPreferredSessionModel();
  const apiKey = resolveApiKey(providerName, modelId);
  const rawBaseUrl = resolveBaseUrl(providerName, modelId);
  const isAnthropic = providerName === "anthropic";

  if (!apiKey && !rawBaseUrl) {
    toast.error("请先在设置中配置 AI 提供商和 API Key");
    editor.chain().focus().deleteRange(range).run();
    return;
  }

  const buildFn = AI_PROMPTS[commandId];
  if (!buildFn) return;
  const userPrompt = buildFn(context);
  const commandLabel = getCommandLabel(commandId);
  const finishAiWriting = beginMarkdownAiWriting(editor, options);

  let insertPos = adjustAfterDelete(blockEnd, range);
  if (!hasSelectedText) {
    editor.chain().focus().deleteRange(range).run();
  }

  if (mode === "replace") {
    const from = hasSelectedText ? range.from : adjustAfterDelete(blockStart, range);
    const to = hasSelectedText ? range.to : adjustAfterDelete(blockEnd, range);
    editor.chain().focus().deleteRange({ from, to }).run();
    insertPos = from;
  } else {
    if (hasSelectedText) {
      insertPos = range.to;
    }
    editor.chain().focus().setTextSelection(insertPos).splitBlock().run();
    insertPos = editor.state.selection.from;
  }

  const loadingToastId = toast.loading(`${commandLabel}处理中...`);
  let hasReceivedContent = false;
  let shouldFlushPendingText = true;
  let bufferedInserter: ReturnType<typeof createBufferedInserter> | null = null;

  try {
    let res: Response;

    if (isAnthropic) {
      const base = normalizeBaseUrl(rawBaseUrl, true);
      res = await fetch(`${base}/v1/messages`, {
        method: "POST",
        signal: options.signal,
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
          "anthropic-dangerous-request-proxy": "true",
        },
        body: JSON.stringify({
          model: modelId,
          max_tokens: 2048,
          stream: true,
          messages: [{ role: "user", content: userPrompt }],
        }),
      });
    } else {
      const base = normalizeBaseUrl(rawBaseUrl, false);
      res = await fetch(`${base}/v1/chat/completions`, {
        method: "POST",
        signal: options.signal,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: modelId,
          max_tokens: 2048,
          stream: true,
          messages: [{ role: "user", content: userPrompt }],
        }),
      });
    }

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new Error(`${res.status}: ${errText}`);
    }

    if (!res.body) throw new Error("No response body");

    const reader = res.body.getReader();
    bufferedInserter = createBufferedInserter(editor, insertPos, options);
    for await (const json of readSSE(reader)) {
      const chunk = extractChunk(json, isAnthropic);
      if (chunk) {
        if (!hasReceivedContent) {
          hasReceivedContent = true;
          toast.loading(`${commandLabel}正在写入...`, { id: loadingToastId });
        }
        bufferedInserter.append(chunk);
      }
    }
    bufferedInserter.flush();
    if (hasReceivedContent) {
      toast.success(`${commandLabel}完成`, { id: loadingToastId });
    } else {
      toast.error(`${commandLabel}没有返回内容`, { id: loadingToastId });
    }
  } catch (e) {
    if (isAbortError(e, options.signal)) {
      shouldFlushPendingText = false;
      bufferedInserter?.discard();
      toast.info(`${commandLabel}已取消`, { id: loadingToastId });
    } else {
      bufferedInserter?.flush();
      toast.error(`AI 请求失败: ${(e as Error).message}`, {
        id: loadingToastId,
      });
    }
  } finally {
    if (shouldFlushPendingText) {
      bufferedInserter?.flush();
    }
    finishAiWriting();
  }
}

export function executeMarkdownCommand(
  editor: Editor,
  range: { from: number; to: number },
  id: string,
  options?: ExecuteMarkdownCommandOptions,
): Promise<void> {
  if (id.startsWith("ai-")) {
    return runAiCommand(editor, range, id, options);
  }
  applyFormat(editor, range, id);
  return Promise.resolve();
}

// ---------------------------------------------------------------------------
// TipTap Extension
// ---------------------------------------------------------------------------

const MdSlashKey = new PluginKey("mdSlashCommand");

export const MdSlashCommand = Extension.create({
  name: "mdSlashCommand",

  addProseMirrorPlugins() {
    const renderer = createSuggestionRenderer((query) => filterCommands(query));

    return [
      Suggestion({
        editor: this.editor,
        pluginKey: MdSlashKey,
        char: "/",
        items: renderer.items,
        render: renderer.render,
        command: ({ editor, range, props }) => {
          void executeMarkdownCommand(editor, range, (props as SuggestionItem).id);
        },
      }),
    ];
  },
});
