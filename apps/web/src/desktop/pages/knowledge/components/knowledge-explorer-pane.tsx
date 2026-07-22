import { useMemo } from "react";
import { BookOpenText, FilePlus2, FileText, Hash, Tags } from "lucide-react";
import type { WikiGraph, WikiHealth, WikiPageEntry, WikiSearchHit, WikiSourceEntry } from "@/lib/api/assets";
import { cn } from "@/lib/utils";
import { formatRelativeTime, pageTitle } from "../knowledge-page-utils";

function KnowledgeStat(props: { label: string; value: number | string; tone?: "default" | "warning" }) {
  return (
    <div className="min-w-0 rounded-md border border-border-light bg-white px-2 py-1.5">
      <div className="truncate text-[10px] font-medium uppercase text-muted-foreground">{props.label}</div>
      <div
        className={cn(
          "mt-0.5 truncate text-sm font-semibold",
          props.tone === "warning" ? "text-amber-700" : "text-foreground",
        )}
      >
        {props.value}
      </div>
    </div>
  );
}

export function ExplorerHeader(props: { health: WikiHealth | null; sources: number }) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <div className="flex size-7 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
          <BookOpenText className="size-4" />
        </div>
        <div className="min-w-0">
          <div className="truncate text-xs font-semibold text-foreground">书小安知识库</div>
          <div className="truncate text-[10px] text-muted-foreground">
            {props.health ? formatRelativeTime(props.health.lastIngestedAt) : `${props.sources} 个来源`}
          </div>
        </div>
      </div>
      <div className="grid grid-cols-3 gap-1.5">
        <KnowledgeStat label="页面" value={props.health?.pageCount ?? 0} />
        <KnowledgeStat label="来源" value={props.health?.sourceCount ?? props.sources} />
        <KnowledgeStat
          label="断链"
          value={props.health?.brokenLinks.length ?? 0}
          tone={props.health?.brokenLinks.length ? "warning" : "default"}
        />
      </div>
    </div>
  );
}

export function OverviewPane(props: {
  pages: WikiPageEntry[];
  sources: WikiSourceEntry[];
  health: WikiHealth | null;
  query: string;
  searchHits: WikiSearchHit[];
  onQueryChange: (value: string) => void;
  onOpenPath: (path: string) => void;
}) {
  const filteredPages = useMemo(() => {
    const normalized = props.query.trim().toLowerCase();
    if (normalized) {
      return Array.from(new Map(props.searchHits.map((hit) => [hit.path, hit])).values()).slice(0, 24);
    }
    return props.pages.slice(0, 24);
  }, [props.pages, props.query, props.searchHits]);

  const tags = useMemo(() => {
    const counts = new Map<string, number>();
    for (const page of props.pages) {
      for (const tag of page.tags ?? []) counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "zh-CN"))
      .slice(0, 16);
  }, [props.pages]);

  return (
    <div className="flex h-full min-h-0 flex-col bg-[#f7f7f5]">
      <div className="border-b border-border-light p-2">
        <div className="grid grid-cols-2 gap-1.5">
          <KnowledgeStat label="已索引" value={props.health?.ingestedSourceCount ?? 0} />
          <KnowledgeStat
            label="孤立页"
            value={props.health?.orphanPages.length ?? 0}
            tone={props.health?.orphanPages.length ? "warning" : "default"}
          />
        </div>
        <input
          value={props.query}
          onChange={(event) => props.onQueryChange(event.target.value)}
          placeholder="查找页面或标签"
          className="mt-2 h-8 w-full rounded-md border border-border bg-white px-2 text-xs outline-none transition-colors focus:border-primary/40"
        />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        <section>
          <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold text-muted-foreground">
            <FileText className="size-3" />
            页面
            <span className="ml-auto">{props.pages.length}</span>
          </div>
          <div className="space-y-1">
            {filteredPages.length > 0 ? (
              filteredPages.map((page) => (
                <button
                  key={page.path}
                  type="button"
                  onClick={() => props.onOpenPath(page.path)}
                  className="block w-full rounded-md px-2 py-1.5 text-left text-xs transition-colors hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
                  aria-label={`打开 ${page.title}`}
                >
                  <div className="truncate font-medium text-foreground">{page.title}</div>
                  <div className="mt-0.5 truncate text-[10px] text-muted-foreground">{page.path}</div>
                  {"snippet" in page && page.snippet ? (
                    <div className="mt-1 line-clamp-2 text-[10px] leading-4 text-muted-foreground">{page.snippet}</div>
                  ) : null}
                </button>
              ))
            ) : (
              <div className="rounded-md border border-dashed border-border px-3 py-5 text-center text-xs text-muted-foreground">
                暂无页面
              </div>
            )}
          </div>
        </section>

        <section className="mt-4">
          <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold text-muted-foreground">
            <Tags className="size-3" />
            标签
          </div>
          <div className="flex flex-wrap gap-1.5">
            {tags.length > 0 ? (
              tags.map(([tag, count]) => (
                <span
                  key={tag}
                  className="inline-flex max-w-full items-center gap-1 rounded-md border border-border-light bg-white px-1.5 py-1 text-[10px] text-muted-foreground"
                >
                  <Hash className="size-2.5 shrink-0" />
                  <span className="truncate">{tag}</span>
                  <span className="text-foreground">{count}</span>
                </span>
              ))
            ) : (
              <div className="text-xs text-muted-foreground">暂无标签</div>
            )}
          </div>
        </section>

        <section className="mt-4">
          <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold text-muted-foreground">
            <FilePlus2 className="size-3" />
            来源
            <span className="ml-auto">{props.sources.length}</span>
          </div>
          <div className="space-y-1">
            {props.sources.slice(0, 12).map((source) => (
              <div key={source.path} className="rounded-md px-2 py-1.5 text-xs transition-colors hover:bg-white">
                <div className="flex items-center gap-2">
                  <div className="min-w-0 flex-1 truncate font-medium text-foreground">{source.name}</div>
                  <span
                    className={cn(
                      "shrink-0 text-[10px]",
                      source.status === "error"
                        ? "text-rose-700"
                        : source.status === "waiting_for_ocr"
                          ? "text-amber-700"
                          : "text-muted-foreground",
                    )}
                  >
                    {source.status === "waiting_for_ocr"
                      ? "等待 OCR"
                      : source.status === "indexed"
                        ? "已索引"
                        : source.status || "待处理"}
                  </span>
                </div>
                <div className="mt-0.5 truncate text-[10px] text-muted-foreground" title={source.error || source.path}>
                  {source.error || source.path}
                </div>
              </div>
            ))}
            {props.sources.length === 0 ? (
              <div className="rounded-md border border-dashed border-border px-3 py-5 text-center text-xs text-muted-foreground">
                暂无来源
              </div>
            ) : null}
          </div>
        </section>
      </div>
    </div>
  );
}

export function BacklinksPane(props: { graph: WikiGraph | null; activeFile: string | null }) {
  const incoming = useMemo(() => {
    if (!props.graph || !props.activeFile) return [];
    return props.graph.edges.filter((edge) => edge.target === props.activeFile);
  }, [props.activeFile, props.graph]);

  return (
    <div className="h-full overflow-y-auto bg-[#f7f7f5] p-2">
      <div className="mb-2 text-[11px] font-semibold text-muted-foreground">
        {props.activeFile ? pageTitle(props.activeFile) : "未选择页面"}
      </div>
      <div className="space-y-1">
        {incoming.map((edge) => (
          <div key={`${edge.source}-${edge.target}`} className="rounded-md bg-white px-2 py-1.5 text-xs">
            <div className="truncate font-medium text-foreground">{pageTitle(edge.source)}</div>
            <div className="mt-0.5 truncate text-[10px] text-muted-foreground">{edge.source}</div>
          </div>
        ))}
        {incoming.length === 0 ? (
          <div className="rounded-md border border-dashed border-border px-3 py-6 text-center text-xs text-muted-foreground">
            暂无反向链接
          </div>
        ) : null}
      </div>
    </div>
  );
}
