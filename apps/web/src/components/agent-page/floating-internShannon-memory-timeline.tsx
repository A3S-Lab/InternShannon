import {
  ArrowLeft,
  BookOpenText,
  Boxes,
  Check,
  Clock3,
  Database,
  Library,
  Loader2,
  MessageSquareText,
  Save,
  Search,
  Sparkles,
  Trash2,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";
import { agentApi, type KnowledgeBaseScope, type KnowledgeSearchHit } from "@/lib/agent-api";
import { cn } from "@/lib/utils";
import { mapServerMemoryToTimelineItem, mergeInternShannonMemoryTimeline } from "@/lib/internShannon-memory-server";
import {
  resolveInternShannonMemorySyncFailureStatus,
  type InternShannonMemorySyncStatus as MemorySyncStatus,
} from "@/lib/internShannon-memory-sync";
import {
  deleteInternShannonMemoryTimelineItem,
  readInternShannonMemoryTimeline,
  subscribeInternShannonMemoryTimeline,
  updateInternShannonMemoryTimelineItem,
  INTERNSHANNON_MEMORY_LAYER_DEFINITIONS,
  type InternShannonMemoryConversationRef,
  type InternShannonMemoryAction,
  type InternShannonMemoryLayer,
  type InternShannonMemoryTimelineItem,
} from "@/lib/internShannon-memory-timeline";

type MemoryFilter = "all" | InternShannonMemoryLayer;

interface FloatingInternShannonMemoryTimelineProps {
  onOpenConversation: (conversation: InternShannonMemoryConversationRef) => void;
}

const layerOrder: InternShannonMemoryLayer[] = ["resource", "artifact", "insight"];

function layerIcon(layer: InternShannonMemoryLayer) {
  if (layer === "resource") return <Database className="size-3.5" />;
  if (layer === "artifact") return <Boxes className="size-3.5" />;
  return <Sparkles className="size-3.5" />;
}

function layerToneClass(layer: InternShannonMemoryLayer) {
  if (layer === "resource") return "border-sky-200 bg-sky-50 text-sky-700";
  if (layer === "artifact") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  return "border-violet-200 bg-violet-50 text-violet-700";
}

function layerDotClass(layer: InternShannonMemoryLayer) {
  if (layer === "resource") return "bg-sky-500 ring-sky-50";
  if (layer === "artifact") return "bg-emerald-500 ring-emerald-50";
  return "bg-violet-500 ring-violet-50";
}

function actionLabel(action: InternShannonMemoryAction) {
  if (action === "stored") return "写入";
  if (action === "recalled") return "召回";
  return "清理";
}

function actionToneClass(action: InternShannonMemoryAction) {
  if (action === "stored") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (action === "recalled") return "border-blue-200 bg-blue-50 text-blue-700";
  return "border-zinc-200 bg-zinc-50 text-zinc-600";
}

function formatTimestamp(timestamp: number) {
  const date = new Date(timestamp);
  if (!Number.isFinite(date.getTime())) return "未知时间";
  const now = Date.now();
  const diff = Math.max(0, now - timestamp);
  if (diff < 60_000) return "刚刚";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`;
  return date.toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function roleLabel(role?: InternShannonMemoryConversationRef["role"]) {
  if (role === "user") return "用户";
  if (role === "assistant") return "书小安";
  if (role === "system") return "系统";
  return "对话";
}

/**
 * Live local entries (instant feedback, editable) merged with the durable, user-scoped local
 * memory base (prior sessions, read-only). Local entries stay reactive via the
 * localStorage subscription; the server is hydrated once on mount and re-mergeable on demand.
 */
function useInternShannonMemoryTimeline() {
  const [localItems, setLocalItems] = useState(() => readInternShannonMemoryTimeline());
  const [serverItems, setServerItems] = useState<InternShannonMemoryTimelineItem[]>([]);
  const [syncStatus, setSyncStatus] = useState<MemorySyncStatus>("idle");
  const [serverTotal, setServerTotal] = useState(0);

  useEffect(() => {
    const refresh = () => setLocalItems(readInternShannonMemoryTimeline());
    const unsubscribe = subscribeInternShannonMemoryTimeline(refresh);
    refresh();
    return unsubscribe;
  }, []);

  const hydrateFromServer = useCallback(async () => {
    setSyncStatus("loading");
    try {
      // One page of the most-recent durable memories is plenty for the timeline; live local
      // events still surface the in-flight run instantly via the localStorage subscription.
      const page = await agentApi.listMemories({ page: 1, limit: 100 });
      setServerItems(page.items.map(mapServerMemoryToTimelineItem));
      setServerTotal(page.total);
      setSyncStatus("synced");
    } catch (error) {
      // Durable hydration is best-effort: local entries keep working when the server is unreachable.
      setServerItems([]);
      setServerTotal(0);
      setSyncStatus(resolveInternShannonMemorySyncFailureStatus(error));
    }
  }, []);

  useEffect(() => {
    void hydrateFromServer();
  }, [hydrateFromServer]);

  const items = useMemo(() => mergeInternShannonMemoryTimeline(localItems, serverItems), [localItems, serverItems]);

  return { items, syncStatus, serverTotal, refresh: hydrateFromServer };
}

/**
 * Shows that the timeline draws from Desktop's durable local memory store, not only browser state.
 */
function DurableMemoryIndicator({ status, serverTotal }: { status: MemorySyncStatus; serverTotal: number }) {
  if (status === "idle" || status === "local-only") return null;
  if (status === "loading") {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-border-light bg-white px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
        <Loader2 className="size-3 animate-spin" />
        正在读取本地记忆…
      </span>
    );
  }
  if (status === "error") {
    return (
      <span
        className="inline-flex items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700"
        title="本地持久记忆库暂时无法读取，仅展示当前窗口的实时记忆。"
      >
        <Database className="size-3" />
        本地记忆暂不可用
      </span>
    );
  }
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full border border-sky-200 bg-sky-50 px-2 py-0.5 text-[11px] font-medium text-sky-700"
      title="记忆已写入本地持久记忆库，跨会话长期保留。"
    >
      <Database className="size-3" />
      本地已保存{status === "synced" && serverTotal > 0 ? ` · ${serverTotal} 条` : ""}
    </span>
  );
}

const KNOWLEDGE_SCOPES: ReadonlyArray<{ scope: KnowledgeBaseScope; label: string; hint: string }> = [
  { scope: "personal", label: "我的知识库", hint: "你沉淀的专属知识" },
  { scope: "docs", label: "书小安文档库", hint: "本地文档" },
];

/**
 * Makes InternShannon's knowledge grounding discoverable: a subtle header chip stating it can draw on
 * 「我的知识库」+「InternShannon 文档库」when answering, plus a minimal inline "搜索我的知识库" quick
 * action so the user can preview hits without leaving the panel. Read-only preview — actually
 * grounding an answer happens inside a chat turn.
 */
function KnowledgeGroundingAffordance() {
  const [scope, setScope] = useState<KnowledgeBaseScope>("personal");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [hits, setHits] = useState<KnowledgeSearchHit[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const requestSeq = useRef(0);

  const runSearch = useCallback(async () => {
    const q = query.trim();
    if (!q) {
      setHits(null);
      setError(null);
      return;
    }
    const seq = ++requestSeq.current;
    setLoading(true);
    setError(null);
    try {
      const result = await agentApi.searchKnowledge(scope, q, 8);
      if (seq !== requestSeq.current) return;
      setHits(result.hits);
    } catch {
      if (seq !== requestSeq.current) return;
      setHits(null);
      setError("检索失败，请稍后重试。");
    } finally {
      if (seq === requestSeq.current) setLoading(false);
    }
  }, [query, scope]);

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          title="书小安作答时可结合「我的知识库」与「书小安文档库」"
          className="inline-flex items-center gap-1.5 rounded-full border border-violet-200 bg-violet-50 px-2 py-0.5 text-[11px] font-medium text-violet-700 transition-colors hover:border-violet-300 hover:bg-violet-100"
        >
          <Library className="size-3" />
          知识库支撑
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[320px] rounded-[8px] p-3">
        <div className="flex items-center gap-1.5 text-xs font-medium text-foreground">
          <Library className="size-3.5 text-violet-600" />
          书小安的知识支撑
        </div>
        <p className="mt-1 text-[11px] leading-4 text-muted-foreground">
          作答时书小安可结合下列知识库并标注来源。在这里也能直接预检索命中。
        </p>

        <div className="mt-2 grid grid-cols-2 gap-1.5">
          {KNOWLEDGE_SCOPES.map((option) => (
            <button
              key={option.scope}
              type="button"
              onClick={() => {
                setScope(option.scope);
                setHits(null);
                setError(null);
              }}
              className={cn(
                "rounded-[6px] border px-2 py-1.5 text-left transition-colors",
                scope === option.scope
                  ? "border-primary/30 bg-primary/[0.05]"
                  : "border-border-light bg-white hover:border-primary/20",
              )}
            >
              <div className="text-[11px] font-medium text-foreground">{option.label}</div>
              <div className="mt-0.5 text-[10px] leading-3 text-muted-foreground">{option.hint}</div>
            </button>
          ))}
        </div>

        <form
          className="mt-2 flex items-center gap-1.5"
          onSubmit={(event) => {
            event.preventDefault();
            void runSearch();
          }}
        >
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={scope === "docs" ? "搜索官方文档…" : "搜索我的知识库…"}
            className="h-8 rounded-[6px] border-border-light text-xs"
          />
          <button
            type="submit"
            disabled={loading || !query.trim()}
            className="inline-flex h-8 shrink-0 items-center gap-1 rounded-[6px] bg-primary px-2.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loading ? <Loader2 className="size-3.5 animate-spin" /> : <Search className="size-3.5" />}
          </button>
        </form>

        <div className="mt-2 max-h-[220px] overflow-y-auto">
          {error ? (
            <p className="px-1 py-2 text-[11px] text-amber-700">{error}</p>
          ) : hits === null ? (
            <p className="px-1 py-2 text-[11px] text-muted-foreground">
              输入关键词检索{scope === "docs" ? "官方文档" : "你的专属知识库"}。
            </p>
          ) : hits.length === 0 ? (
            <p className="px-1 py-2 text-[11px] text-muted-foreground">没有命中相关内容。</p>
          ) : (
            <ul className="space-y-1.5">
              {hits.map((hit) => (
                <li
                  key={`${hit.path}-${hit.title}`}
                  className="rounded-[6px] border border-border-light bg-white px-2 py-1.5"
                >
                  <div className="flex items-center gap-1.5">
                    <BookOpenText className="size-3 shrink-0 text-violet-500" />
                    <span className="min-w-0 truncate text-[11px] font-medium text-foreground">{hit.title}</span>
                  </div>
                  {hit.snippet ? (
                    <p className="mt-0.5 line-clamp-2 text-[10px] leading-4 text-muted-foreground">{hit.snippet}</p>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

export function FloatingInternShannonMemoryTimeline({ onOpenConversation }: FloatingInternShannonMemoryTimelineProps) {
  const { items: mergedItems, syncStatus, serverTotal } = useInternShannonMemoryTimeline();
  // The merge already drops soft-deleted local entries; keep the guard for any stragglers.
  const items = useMemo(() => mergedItems.filter((item) => !item.deletedAt), [mergedItems]);
  const [filter, setFilter] = useState<MemoryFilter>("all");
  const [selectedItem, setSelectedItem] = useState<InternShannonMemoryTimelineItem | null>(null);
  const [draftContent, setDraftContent] = useState("");

  const selectedFreshItem = useMemo(
    () => (selectedItem ? (items.find((item) => item.id === selectedItem.id) ?? selectedItem) : null),
    [items, selectedItem],
  );
  // Server entries are read-only: no edit/delete endpoint exists for the durable memory base.
  const selectedReadOnly = selectedFreshItem?.origin === "server";

  useEffect(() => {
    if (!selectedFreshItem) return;
    setDraftContent(selectedFreshItem.content);
  }, [selectedFreshItem]);

  const counts = useMemo(() => {
    return Object.fromEntries(
      layerOrder.map((layer) => [layer, items.filter((item) => item.layer === layer).length]),
    ) as Record<InternShannonMemoryLayer, number>;
  }, [items]);

  const filteredItems = useMemo(() => {
    if (filter === "all") return items;
    return items.filter((item) => item.layer === filter);
  }, [filter, items]);

  const handleSave = () => {
    if (!selectedFreshItem || selectedReadOnly) return;
    const nextContent = draftContent.trim();
    if (!nextContent) return;
    updateInternShannonMemoryTimelineItem(selectedFreshItem.id, { content: nextContent });
    toast.success("记忆要点已修正");
    setSelectedItem(null);
  };

  const handleDelete = () => {
    if (!selectedFreshItem || selectedReadOnly) return;
    deleteInternShannonMemoryTimelineItem(selectedFreshItem.id);
    toast.success("记忆要点已删除");
    setSelectedItem(null);
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-[#f7f9fc]">
      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <DurableMemoryIndicator status={syncStatus} serverTotal={serverTotal} />
          <div className="ml-auto">
            <KnowledgeGroundingAffordance />
          </div>
        </div>
        <div className="grid gap-2 md:grid-cols-3">
          {layerOrder.map((layer) => {
            const definition = INTERNSHANNON_MEMORY_LAYER_DEFINITIONS[layer];
            return (
              <button
                key={layer}
                type="button"
                onClick={() => setFilter(filter === layer ? "all" : layer)}
                className={cn(
                  "min-w-0 rounded-[8px] border bg-white p-3 text-left shadow-[0_1px_2px_rgba(15,23,42,0.04)] transition-colors hover:border-primary/25 hover:bg-primary/[0.03]",
                  filter === layer ? "border-primary/30 ring-1 ring-primary/10" : "border-border-light",
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <span
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium",
                      layerToneClass(layer),
                    )}
                  >
                    {layerIcon(layer)}
                    {definition.label}
                  </span>
                  <span className="text-lg font-semibold tabular-nums text-foreground">{counts[layer]}</span>
                </div>
                <p className="mt-2 line-clamp-2 text-[11px] leading-4 text-muted-foreground">
                  {definition.description}
                </p>
              </button>
            );
          })}
        </div>

        <div className="mt-3 flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2 text-xs font-medium text-foreground">
            <Clock3 className="size-3.5 text-muted-foreground" />
            <span>{filter === "all" ? "全部记忆事件" : `${INTERNSHANNON_MEMORY_LAYER_DEFINITIONS[filter].label}事件`}</span>
            <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
              {filteredItems.length}
            </span>
          </div>
          {filter !== "all" ? (
            <button
              type="button"
              onClick={() => setFilter("all")}
              className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-[11px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <ArrowLeft className="size-3" />
              全部
            </button>
          ) : null}
        </div>

        {filteredItems.length === 0 ? (
          <div className="mt-3 flex min-h-[220px] items-center justify-center rounded-[8px] border border-dashed border-[#d8dee8] bg-white px-5 text-center">
            <div>
              <BookOpenText className="mx-auto size-8 text-muted-foreground/55" />
              <p className="mt-3 text-sm font-medium text-foreground">暂无记忆事件</p>
              <p className="mt-1 max-w-[360px] text-xs leading-5 text-muted-foreground">
                书小安写入、召回或清理记忆后，会在这里沉淀为当前用户自己的时间轴。
              </p>
            </div>
          </div>
        ) : (
          <ol className="relative mt-3 space-y-2 border-l border-slate-200 pl-4">
            {filteredItems.map((item) => {
              const edited = item.updatedAt && item.content !== item.originalContent;
              return (
                <li key={item.id} className="relative">
                  <span
                    className={cn("absolute -left-[21px] top-3 size-2 rounded-full ring-4", layerDotClass(item.layer))}
                  />
                  <button
                    type="button"
                    onClick={() => setSelectedItem(item)}
                    className="group w-full rounded-[8px] border border-border-light bg-white px-3 py-2 text-left shadow-[0_1px_2px_rgba(15,23,42,0.04)] transition-colors hover:border-primary/25 hover:bg-primary/[0.03] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/30"
                  >
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span
                        className={cn(
                          "inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-medium",
                          layerToneClass(item.layer),
                        )}
                      >
                        {layerIcon(item.layer)}
                        {INTERNSHANNON_MEMORY_LAYER_DEFINITIONS[item.layer].shortLabel}
                      </span>
                      <span
                        className={cn(
                          "inline-flex rounded-full border px-1.5 py-0.5 text-[10px] font-medium",
                          actionToneClass(item.action),
                        )}
                      >
                        {actionLabel(item.action)}
                      </span>
                      {edited ? (
                        <span className="inline-flex items-center gap-1 rounded-full border border-primary/15 bg-primary/[0.06] px-1.5 py-0.5 text-[10px] font-medium text-primary">
                          <Check className="size-2.5" />
                          已修正
                        </span>
                      ) : null}
                      {item.origin === "server" ? (
                        <span
                          className="inline-flex items-center gap-1 rounded-full border border-sky-200 bg-sky-50 px-1.5 py-0.5 text-[10px] font-medium text-sky-700"
                          title="来自本地持久记忆库（历史会话），只读"
                        >
                          <Database className="size-2.5" />
                          本地
                        </span>
                      ) : null}
                      <span className="ml-auto text-[10px] text-muted-foreground">
                        {formatTimestamp(item.createdAt)}
                      </span>
                    </div>
                    <p className="mt-2 line-clamp-2 text-[13px] leading-5 text-foreground">{item.content}</p>
                    {item.conversation.sessionId ? (
                      <div className="mt-2 flex min-w-0 items-center gap-1.5 rounded-[6px] bg-muted/45 px-2 py-1 text-[11px] text-muted-foreground">
                        <MessageSquareText className="size-3 shrink-0" />
                        <span className="shrink-0">{roleLabel(item.conversation.role)}</span>
                        <span className="shrink-0">·</span>
                        <span className="min-w-0 truncate">
                          {item.conversation.preview ?? item.conversation.sessionName ?? item.sessionId}
                        </span>
                      </div>
                    ) : null}
                  </button>
                </li>
              );
            })}
          </ol>
        )}
      </div>

      <Dialog
        open={Boolean(selectedFreshItem)}
        onOpenChange={(open) => {
          if (!open) setSelectedItem(null);
        }}
      >
        <DialogContent className="max-w-[560px] gap-0 overflow-hidden rounded-[8px] border-border-light p-0 shadow-[0_24px_70px_rgba(15,23,42,0.22)]">
          {selectedFreshItem ? (
            <>
              <DialogHeader className="border-b border-border-light px-4 py-3 text-left">
                <DialogTitle className="flex items-center gap-2 text-sm">
                  <span
                    className={cn(
                      "inline-flex size-7 items-center justify-center rounded-[6px] border",
                      layerToneClass(selectedFreshItem.layer),
                    )}
                  >
                    {layerIcon(selectedFreshItem.layer)}
                  </span>
                  {selectedReadOnly ? "记忆要点" : "修正记忆要点"}
                  {selectedReadOnly ? (
                    <span className="inline-flex items-center gap-1 rounded-full border border-sky-200 bg-sky-50 px-1.5 py-0.5 text-[10px] font-medium text-sky-700">
                      <Database className="size-2.5" />
                      本地记忆库
                    </span>
                  ) : null}
                </DialogTitle>
                <DialogDescription className="text-xs">
                  {INTERNSHANNON_MEMORY_LAYER_DEFINITIONS[selectedFreshItem.layer].label} ·{" "}
                  {actionLabel(selectedFreshItem.action)} · {formatTimestamp(selectedFreshItem.createdAt)}
                  {selectedReadOnly ? " · 只读" : ""}
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-3 px-4 py-3">
                <div>
                  <label htmlFor="internShannon-memory-content" className="text-xs font-medium text-foreground">
                    记忆要点
                  </label>
                  <Textarea
                    id="internShannon-memory-content"
                    value={draftContent}
                    onChange={(event) => setDraftContent(event.target.value)}
                    readOnly={selectedReadOnly}
                    className={cn(
                      "mt-1 min-h-[120px] resize-none rounded-[6px] border-border-light bg-white text-sm leading-6 focus-visible:ring-primary/20",
                      selectedReadOnly ? "cursor-default bg-muted/30 text-muted-foreground" : "",
                    )}
                  />
                  {selectedReadOnly ? (
                    <p className="mt-1.5 text-[11px] leading-4 text-muted-foreground">
                      该记忆来自本地持久记忆库（历史会话沉淀），为只读，暂不支持在此修正或删除。
                    </p>
                  ) : null}
                </div>

                {selectedFreshItem.conversation.sessionId ? (
                  <div className="rounded-[8px] border border-border-light bg-muted/35 p-3">
                    <div className="mb-2 flex items-center gap-1.5 text-xs font-medium text-foreground">
                      <MessageSquareText className="size-3.5 text-muted-foreground" />
                      关联对话记录
                    </div>
                    <p className="line-clamp-3 text-xs leading-5 text-muted-foreground">
                      {selectedFreshItem.conversation.preview ?? "这条记忆事件没有捕获到可展示的对话正文。"}
                    </p>
                    <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                      <span>{selectedFreshItem.conversation.sessionName ?? selectedFreshItem.sessionId}</span>
                      {selectedFreshItem.conversation.timestamp ? (
                        <>
                          <span>·</span>
                          <span>{formatTimestamp(selectedFreshItem.conversation.timestamp)}</span>
                        </>
                      ) : null}
                    </div>
                  </div>
                ) : null}
              </div>

              <DialogFooter className="flex-row justify-between border-t border-border-light bg-white px-4 py-3 sm:justify-between">
                {selectedReadOnly ? (
                  <span className="inline-flex h-8 items-center gap-1.5 text-[11px] text-muted-foreground">
                    <Database className="size-3.5" />
                    本地记忆库 · 只读
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={handleDelete}
                    className="inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium text-red-600 transition-colors hover:bg-red-50 hover:text-red-700"
                  >
                    <Trash2 className="size-3.5" />
                    删除
                  </button>
                )}
                <div className="flex items-center gap-2">
                  {selectedFreshItem.conversation.sessionId ? (
                    <button
                      type="button"
                      onClick={() => {
                        onOpenConversation(selectedFreshItem.conversation);
                        setSelectedItem(null);
                      }}
                      className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border-light bg-white px-2.5 text-xs font-medium text-foreground transition-colors hover:border-primary/25 hover:bg-primary/5 hover:text-primary"
                    >
                      <MessageSquareText className="size-3.5" />
                      打开对话
                    </button>
                  ) : null}
                  {selectedReadOnly ? (
                    <button
                      type="button"
                      onClick={() => setSelectedItem(null)}
                      className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border-light bg-white px-2.5 text-xs font-medium text-foreground transition-colors hover:border-primary/25 hover:bg-primary/5 hover:text-primary"
                    >
                      关闭
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={handleSave}
                      disabled={!draftContent.trim()}
                      className="inline-flex h-8 items-center gap-1.5 rounded-md bg-primary px-2.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <Save className="size-3.5" />
                      保存
                    </button>
                  )}
                </div>
              </DialogFooter>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
