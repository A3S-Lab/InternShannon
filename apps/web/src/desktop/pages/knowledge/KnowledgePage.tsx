import {
  AssetFileManager,
  type AssetFileManagerStateSnapshot,
} from "@/components/workspace/asset-file-manager";
import {
  assetsApi,
  type Asset,
  type WikiCurationSuggestion,
  type WikiAuditEntry,
  type WikiConfig,
  type WikiGraph,
  type WikiHealth,
  type WikiIngestJobStatus,
  type WikiPageEntry,
  type WikiSearchHit,
  type WikiSourceEntry,
} from "@/lib/api/assets";
import { dispatchFileTreeEditorCommand } from "@/components/workspace/file-tree-editor/events";
import { buildAssetWorkspaceRoot, parseAssetWorkspacePath } from "@/lib/asset-workspace-path";
import { cn } from "@/lib/utils";
import {
  AlertTriangle,
  BookOpenText,
  Check,
  Download,
  Database,
  FileArchive,
  FilePlus2,
  FileText,
  Hash,
  History,
  Link2,
  ListChecks,
  Loader2,
  Network,
  RefreshCw,
  RotateCcw,
  Save,
  Settings2,
  Square,
  Tags,
  Upload,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

type LoadState = "loading" | "ready" | "error";

interface PendingKnowledgeUpload {
  id: string;
  name: string;
  size: number;
  stage: "reading" | "uploading" | "starting";
}

const DEFAULT_KNOWLEDGE_EMBEDDING: WikiConfig["embedding"] = {
  provider: "local",
  model: "local-hash-v1",
  dimensions: 192,
  keywordWeight: 1,
  vectorWeight: 6,
  mmrLambda: 0.78,
};

function formatRelativeTime(value: string | null | undefined) {
  if (!value) return "尚未索引";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "时间未知";
  return date.toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("读取文件失败"));
    reader.onload = () => {
      const result = typeof reader.result === "string" ? reader.result : "";
      resolve(result.includes(",") ? result.split(",").pop() || "" : result);
    };
    reader.readAsDataURL(file);
  });
}

function downloadBase64File(filename: string, contentBase64: string, mime: string) {
  const binary = globalThis.atob(contentBase64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function relativeActiveFile(path: string | null | undefined) {
  return parseAssetWorkspacePath(path)?.relativePath ?? null;
}

function pageTitle(path: string) {
  const name = path.split("/").pop() || path;
  return name.replace(/\.[^.]+$/, "") || name;
}

function graphNodeColor(type: string | null) {
  const colors = ["#2563eb", "#059669", "#d97706", "#dc2626", "#7c3aed", "#0891b2", "#4d7c0f"];
  const value = type || "note";
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) hash = (hash * 31 + value.charCodeAt(index)) | 0;
  return colors[Math.abs(hash) % colors.length];
}

function forceGraphLayout(nodes: WikiGraph["nodes"], edges: WikiGraph["edges"]) {
  const positions = new Map<string, { x: number; y: number }>();
  nodes.forEach((node, index) => {
    const angle = (Math.PI * 2 * index) / Math.max(1, nodes.length);
    positions.set(node.path, { x: 50 + Math.cos(angle) * 32, y: 50 + Math.sin(angle) * 32 });
  });
  for (let iteration = 0; iteration < 90; iteration += 1) {
    const forces = new Map(nodes.map((node) => [node.path, { x: 0, y: 0 }]));
    for (let leftIndex = 0; leftIndex < nodes.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < nodes.length; rightIndex += 1) {
        const left = positions.get(nodes[leftIndex].path);
        const right = positions.get(nodes[rightIndex].path);
        if (!left || !right) continue;
        const dx = left.x - right.x || 0.01;
        const dy = left.y - right.y || 0.01;
        const distanceSquared = Math.max(8, dx * dx + dy * dy);
        const repulsion = 48 / distanceSquared;
        const leftForce = forces.get(nodes[leftIndex].path);
        const rightForce = forces.get(nodes[rightIndex].path);
        if (leftForce) {
          leftForce.x += dx * repulsion;
          leftForce.y += dy * repulsion;
        }
        if (rightForce) {
          rightForce.x -= dx * repulsion;
          rightForce.y -= dy * repulsion;
        }
      }
    }
    for (const edge of edges) {
      const source = positions.get(edge.source);
      const target = positions.get(edge.target);
      if (!source || !target) continue;
      const pull = 0.006 * Math.max(1, edge.weight);
      const dx = target.x - source.x;
      const dy = target.y - source.y;
      const sourceForce = forces.get(edge.source);
      const targetForce = forces.get(edge.target);
      if (sourceForce) {
        sourceForce.x += dx * pull;
        sourceForce.y += dy * pull;
      }
      if (targetForce) {
        targetForce.x -= dx * pull;
        targetForce.y -= dy * pull;
      }
    }
    const cooling = 1 - iteration / 110;
    for (const node of nodes) {
      const position = positions.get(node.path);
      const force = forces.get(node.path);
      if (!position || !force) continue;
      position.x = Math.max(8, Math.min(92, position.x + (force.x + (50 - position.x) * 0.002) * cooling));
      position.y = Math.max(8, Math.min(92, position.y + (force.y + (50 - position.y) * 0.002) * cooling));
    }
  }
  return positions;
}

function normalizeSearchTarget(page: WikiPageEntry) {
  return `${page.title} ${page.path} ${(page.tags ?? []).join(" ")}`.toLowerCase();
}

function KnowledgeStat(props: { label: string; value: number | string; tone?: "default" | "warning" }) {
  return (
    <div className="min-w-0 rounded-md border border-border-light bg-white px-2 py-1.5">
      <div className="truncate text-[10px] font-medium uppercase text-muted-foreground">{props.label}</div>
      <div className={cn("mt-0.5 truncate text-sm font-semibold", props.tone === "warning" ? "text-amber-700" : "text-foreground")}>
        {props.value}
      </div>
    </div>
  );
}

function ExplorerHeader(props: { health: WikiHealth | null; sources: number }) {
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
        <KnowledgeStat label="断链" value={props.health?.brokenLinks.length ?? 0} tone={props.health?.brokenLinks.length ? "warning" : "default"} />
      </div>
    </div>
  );
}

function OverviewPane(props: {
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
    if (normalized) return props.searchHits.slice(0, 24);
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
          <KnowledgeStat label="孤立页" value={props.health?.orphanPages.length ?? 0} tone={props.health?.orphanPages.length ? "warning" : "default"} />
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
                      source.status === "error" ? "text-rose-700" : source.status === "waiting_for_ocr" ? "text-amber-700" : "text-muted-foreground",
                    )}
                  >
                    {source.status === "waiting_for_ocr" ? "等待 OCR" : source.status === "indexed" ? "已索引" : source.status || "待处理"}
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

function GraphPane(props: { graph: WikiGraph | null }) {
  const nodes = props.graph?.nodes ?? [];
  const edges = props.graph?.edges ?? [];
  const [query, setQuery] = useState("");
  const [type, setType] = useState("");
  const [tag, setTag] = useState("");
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [selectedEdgeKey, setSelectedEdgeKey] = useState<string | null>(null);
  const matchingNodes = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return nodes.filter((node) => {
      if (normalized && !`${node.title} ${node.path}`.toLowerCase().includes(normalized)) return false;
      if (type && node.type !== type) return false;
      if (tag && !(node.tags ?? []).includes(tag)) return false;
      return true;
    });
  }, [nodes, query, tag, type]);
  const filteredNodes = useMemo(() => {
    const hasFilter = Boolean(query.trim() || type || tag);
    if (!hasFilter) return matchingNodes;
    const matchedPaths = new Set(matchingNodes.map((node) => node.path));
    const contextPaths = new Set(matchedPaths);
    for (const edge of edges) {
      if (matchedPaths.has(edge.source) || matchedPaths.has(edge.target)) {
        contextPaths.add(edge.source);
        contextPaths.add(edge.target);
      }
    }
    return nodes.filter((node) => contextPaths.has(node.path));
  }, [edges, matchingNodes, nodes, query, tag, type]);
  const matchingPaths = useMemo(() => new Set(matchingNodes.map((node) => node.path)), [matchingNodes]);
  const topNodes = useMemo(
    () => filteredNodes.slice().sort((a, b) => b.degree - a.degree || a.title.localeCompare(b.title, "zh-CN")).slice(0, 120),
    [filteredNodes],
  );
  const visiblePaths = useMemo(() => new Set(topNodes.map((node) => node.path)), [topNodes]);
  const visibleEdges = useMemo(
    () => edges.filter((edge) => visiblePaths.has(edge.source) && visiblePaths.has(edge.target)),
    [edges, visiblePaths],
  );
  const positions = useMemo(() => forceGraphLayout(topNodes, visibleEdges), [topNodes, visibleEdges]);
  const selectedNode = nodes.find((node) => node.path === selectedPath) ?? null;
  const selectedEdges = selectedPath ? visibleEdges.filter((edge) => edge.source === selectedPath || edge.target === selectedPath) : visibleEdges;
  const edgeKey = (edge: WikiGraph["edges"][number]) => `${edge.source}\u0000${edge.target}\u0000${edge.kind ?? "concept-link"}`;
  const selectedEdge = visibleEdges.find((edge) => edgeKey(edge) === selectedEdgeKey) ?? null;

  return (
    <div className="flex h-full min-h-0 flex-col bg-[#f7f7f5]">
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border-light px-3 py-2">
        <div className="flex size-8 items-center justify-center rounded-md bg-primary/10 text-primary">
          <Network className="size-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold text-foreground">关系图</div>
          <div className="truncate text-[11px] text-muted-foreground">{nodes.length} 节点 / {edges.length} 连接</div>
        </div>
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索节点" className="h-8 w-36 rounded-md border border-border bg-white px-2 text-xs" />
        <select value={type} onChange={(event) => setType(event.target.value)} className="h-8 max-w-40 rounded-md border border-border bg-white px-2 text-xs">
          <option value="">全部类型</option>
          {(props.graph?.filters?.types ?? []).map((item) => <option key={item} value={item}>{item}</option>)}
        </select>
        <select value={tag} onChange={(event) => setTag(event.target.value)} className="h-8 max-w-40 rounded-md border border-border bg-white px-2 text-xs">
          <option value="">全部标签</option>
          {(props.graph?.filters?.tags ?? []).map((item) => <option key={item} value={item}>{item}</option>)}
        </select>
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_280px]">
        <div className="relative min-h-[360px] overflow-hidden bg-white">
          <svg className="absolute inset-0 size-full" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
            <defs>
              <marker id="knowledge-graph-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse" markerUnits="strokeWidth">
                <path d="M 0 0 L 10 5 L 0 10 z" fill="context-stroke" />
              </marker>
            </defs>
            {visibleEdges.map((edge) => {
              const source = positions.get(edge.source);
              const target = positions.get(edge.target);
              if (!source || !target) return null;
              const isSelected = edgeKey(edge) === selectedEdgeKey;
              return (
                <line
                  key={edgeKey(edge)}
                  x1={source.x}
                  y1={source.y}
                  x2={target.x}
                  y2={target.y}
                  stroke={isSelected ? "#2563eb" : "#94a3b8"}
                  strokeWidth={isSelected ? 1.5 : Math.min(0.9, 0.25 + edge.weight * 0.12)}
                  vectorEffect="non-scaling-stroke"
                  markerEnd="url(#knowledge-graph-arrow)"
                />
              );
            })}
          </svg>
          {topNodes.map((node) => {
            const position = positions.get(node.path);
            if (!position) return null;
            const color = graphNodeColor(node.type);
            return (
              <button
                type="button"
                key={node.path}
                onClick={() => {
                  setSelectedPath(node.path);
                  setSelectedEdgeKey(null);
                }}
                className={cn(
                  "absolute z-10 flex max-w-[150px] -translate-x-1/2 -translate-y-1/2 items-center gap-1.5 rounded-md border bg-white px-2 py-1 text-[11px] shadow-sm",
                  selectedPath === node.path || selectedEdge?.source === node.path || selectedEdge?.target === node.path
                    ? "border-primary ring-1 ring-primary/20"
                    : matchingPaths.has(node.path)
                      ? "border-border-light"
                      : "border-border-light opacity-55",
                )}
                style={{
                  left: `${position.x}%`,
                  top: `${position.y}%`,
                }}
                title={node.path}
              >
                <span
                  className="shrink-0 rounded-full"
                  style={{
                    backgroundColor: color,
                    width: 7 + Math.min(9, node.degree * 1.5),
                    height: 7 + Math.min(9, node.degree * 1.5),
                  }}
                />
                <span className="truncate">{node.title}</span>
              </button>
            );
          })}
        </div>
        <aside className="min-h-0 overflow-y-auto border-l border-border-light bg-white p-3">
          <div className="mb-2 text-[11px] font-semibold text-muted-foreground">
            {selectedNode ? `${selectedNode.title} · 社区 ${selectedNode.community ?? 0}` : "可见连接"}
          </div>
          <div className="space-y-1">
            {selectedEdges.slice(0, 64).map((edge) => (
              <button
                type="button"
                key={edgeKey(edge)}
                onClick={() => {
                  setSelectedEdgeKey(edgeKey(edge));
                  setSelectedPath(null);
                }}
                className={cn(
                  "block w-full rounded-md border px-2 py-1.5 text-left text-xs",
                  selectedEdgeKey === edgeKey(edge) ? "border-primary bg-primary/5" : "border-border-light",
                )}
                aria-label={`高亮关系：${pageTitle(edge.source)} 到 ${pageTitle(edge.target)}`}
              >
                <div className="truncate text-foreground">{pageTitle(edge.source)}</div>
                <div className="flex items-center gap-1 truncate text-[10px] text-muted-foreground">
                  <Link2 className="size-3 shrink-0" />
                  {pageTitle(edge.target)}
                </div>
                <div className="mt-0.5 truncate text-[10px] text-muted-foreground">{edge.kind || "concept-link"} · weight {edge.weight}</div>
              </button>
            ))}
            {selectedEdges.length === 0 ? (
              <div className="rounded-md border border-dashed border-border px-3 py-8 text-center text-xs text-muted-foreground">
                暂无连接
              </div>
            ) : null}
          </div>
        </aside>
      </div>
    </div>
  );
}

function BacklinksPane(props: { graph: WikiGraph | null; activeFile: string | null }) {
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

function CurationPane(props: {
  suggestions: WikiCurationSuggestion[];
  busy: boolean;
  onRefresh: () => void;
  onReview: (suggestionId: string, decision: "accept" | "reject" | "revert") => void;
}) {
  const suggestions = props.suggestions
    .slice()
    .sort((left, right) => {
      if (left.status !== right.status) return left.status === "pending" ? -1 : right.status === "pending" ? 1 : 0;
      if (left.status === "pending") return right.similarity - left.similarity;
      return new Date(right.reviewedAt ?? right.createdAt).getTime() - new Date(left.reviewedAt ?? left.createdAt).getTime();
    });
  return (
    <div className="flex h-full min-h-0 flex-col bg-[#f7f7f5]">
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border-light bg-white px-2">
        <div className="min-w-0 flex-1 truncate text-xs font-semibold text-foreground">
          待审阅 {suggestions.filter((item) => item.status === "pending").length}
        </div>
        <button
          type="button"
          onClick={props.onRefresh}
          disabled={props.busy}
          className="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
          aria-label="刷新策展建议"
          title="刷新策展建议"
        >
          <RefreshCw className={cn("size-3.5", props.busy && "animate-spin")} />
        </button>
      </div>
      <div className="min-h-0 flex-1 space-y-1 overflow-y-auto p-2">
        {suggestions.map((suggestion) => (
          <div key={suggestion.id} className="rounded-md border border-border-light bg-white px-2 py-2">
            <div className="flex items-start gap-2">
              {suggestion.kind === "link" ? <Link2 className="mt-0.5 size-3.5 shrink-0 text-primary" /> : <FileText className="mt-0.5 size-3.5 shrink-0 text-primary" />}
              <div className="min-w-0 flex-1">
                <div className="truncate text-xs font-medium text-foreground">
                  {suggestion.kind === "link" ? "建链" : suggestion.kind === "summary" ? "摘要" : suggestion.kind === "merge" ? "合并草稿" : "页面草稿"} · {pageTitle(suggestion.sourcePath)}
                </div>
                <div className="mt-0.5 flex items-center gap-1 truncate text-[10px] text-muted-foreground">
                  <span className="truncate">{suggestion.targetTitle}</span>
                  <span className="shrink-0">{Math.round(suggestion.similarity * 100)}%</span>
                </div>
                {suggestion.proposedContent ? <div className="mt-1 line-clamp-2 text-[10px] leading-4 text-muted-foreground">{suggestion.proposedContent}</div> : null}
              </div>
              {suggestion.status === "pending" ? (
                <div className="flex shrink-0 items-center gap-0.5">
                  <button
                    type="button"
                    onClick={() => props.onReview(suggestion.id, "accept")}
                    disabled={props.busy}
                    className="inline-flex size-7 items-center justify-center rounded-md text-emerald-700 transition-colors hover:bg-emerald-50 disabled:opacity-50"
                    aria-label="接受建链建议"
                    title="接受建链建议"
                  >
                    <Check className="size-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => props.onReview(suggestion.id, "reject")}
                    disabled={props.busy}
                    className="inline-flex size-7 items-center justify-center rounded-md text-rose-700 transition-colors hover:bg-rose-50 disabled:opacity-50"
                    aria-label="拒绝建链建议"
                    title="拒绝建链建议"
                  >
                    <X className="size-3.5" />
                  </button>
                </div>
              ) : suggestion.status === "accepted" ? (
                <button
                  type="button"
                  onClick={() => props.onReview(suggestion.id, "revert")}
                  disabled={props.busy}
                  className="inline-flex size-7 shrink-0 items-center justify-center rounded-md text-amber-700 transition-colors hover:bg-amber-50 disabled:opacity-50"
                  aria-label="撤销已接受的建议"
                  title="撤销已接受的建议"
                >
                  <RotateCcw className="size-3.5" />
                </button>
              ) : (
                <span className="shrink-0 text-[10px] text-muted-foreground">
                  {suggestion.status === "reverted" ? "已撤销" : "已拒绝"}
                </span>
              )}
            </div>
          </div>
        ))}
        {suggestions.length === 0 ? (
          <div className="rounded-md border border-dashed border-border px-3 py-6 text-center text-xs text-muted-foreground">
            暂无策展建议
          </div>
        ) : null}
      </div>
    </div>
  );
}

function ingestProgress(job: WikiIngestJobStatus) {
  if (job.progress && typeof job.progress === "object" && "percent" in job.progress) {
    const progress = job.progress as { percent?: unknown; stage?: unknown; message?: unknown };
    return {
      percent: typeof progress.percent === "number" ? progress.percent : 0,
      stage: typeof progress.stage === "string" ? progress.stage : job.status,
      message: typeof progress.message === "string" ? progress.message : job.status,
    };
  }
  return { percent: typeof job.progress === "number" ? job.progress : 0, stage: job.status, message: job.status };
}

function OperationsPane(props: {
  uploads: PendingKnowledgeUpload[];
  jobs: WikiIngestJobStatus[];
  audit: WikiAuditEntry[];
  busy: boolean;
  onCancel: (jobId: string) => void;
  onRetry: (jobId: string) => void;
  onMigrate: () => void;
}) {
  return (
    <div className="h-full overflow-y-auto bg-[#f7f7f5] p-2">
      <div className="mb-2 flex items-center gap-2 text-[11px] font-semibold text-muted-foreground">
        <span className="min-w-0 flex-1">摄取任务</span>
        <button
          type="button"
          onClick={props.onMigrate}
          disabled={props.busy}
          className="inline-flex size-7 items-center justify-center rounded-md hover:bg-muted disabled:opacity-50"
          aria-label="迁移知识库存储"
          title="迁移知识库存储"
        >
          <Database className="size-3.5" />
        </button>
      </div>
      <div className="space-y-1">
        {props.uploads.map((upload) => (
          <div key={upload.id} className="rounded-md border border-border-light bg-white px-2 py-2">
            <div className="truncate text-xs font-medium text-foreground">
              {upload.stage === "reading" ? "正在读取" : upload.stage === "uploading" ? "正在上传" : "正在创建摄取任务"}
            </div>
            <div className="mt-0.5 truncate text-[10px] text-muted-foreground">
              {upload.name} · {(upload.size / 1024 / 1024).toFixed(1)} MiB · uploading
            </div>
            <div className="mt-2 h-1 overflow-hidden rounded bg-muted">
              <div className="h-full w-1/3 animate-pulse bg-primary" />
            </div>
          </div>
        ))}
        {props.jobs.slice(0, 12).map((job) => {
          const progress = ingestProgress(job);
          return (
            <div key={job.jobId} className="rounded-md border border-border-light bg-white px-2 py-2">
              <div className="flex items-center gap-2">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-xs font-medium text-foreground">{progress.message}</div>
                  <div className="mt-0.5 truncate text-[10px] text-muted-foreground">
                    {job.sourcePaths?.length === 1
                      ? pageTitle(job.sourcePaths[0])
                      : job.sourcePaths?.length
                        ? `${job.sourcePaths.length} 个来源`
                        : "全部来源"} · {job.status}
                  </div>
                </div>
                {(job.status === "running" || job.status === "queued") && progress.stage !== "cancelling" ? (
                  <button
                    type="button"
                    onClick={() => props.onCancel(job.jobId)}
                    disabled={props.busy}
                    className="inline-flex size-7 items-center justify-center rounded-md text-rose-700 hover:bg-rose-50 disabled:opacity-50"
                    aria-label="取消摄取任务"
                    title="取消摄取任务"
                  >
                    <Square className="size-3" />
                  </button>
                ) : progress.stage === "cancelling" ? (
                  <Loader2 className="size-3.5 shrink-0 animate-spin text-muted-foreground" aria-label="正在取消摄取任务" />
                ) : job.status === "failed" || job.status === "cancelled" ? (
                  <button
                    type="button"
                    onClick={() => props.onRetry(job.jobId)}
                    disabled={props.busy}
                    className="inline-flex size-7 items-center justify-center rounded-md text-amber-700 hover:bg-amber-50 disabled:opacity-50"
                    aria-label="重试摄取任务"
                    title="重试摄取任务"
                  >
                    <RotateCcw className="size-3.5" />
                  </button>
                ) : null}
              </div>
              <div className="mt-2 h-1 overflow-hidden rounded bg-muted">
                <div className="h-full bg-primary transition-[width]" style={{ width: `${Math.max(0, Math.min(100, progress.percent))}%` }} />
              </div>
            </div>
          );
        })}
        {props.uploads.length === 0 && props.jobs.length === 0 ? <div className="py-4 text-center text-xs text-muted-foreground">暂无摄取任务</div> : null}
      </div>

      <div className="mb-2 mt-4 text-[11px] font-semibold text-muted-foreground">最近审计</div>
      <div className="space-y-1">
        {props.audit.slice(0, 20).map((entry) => (
          <div key={entry.id} className="rounded-md border border-border-light bg-white px-2 py-1.5">
            <div className="truncate text-xs font-medium text-foreground">{entry.action}</div>
            <div className="mt-0.5 truncate text-[10px] text-muted-foreground">
              {entry.target || "知识库"} · {formatRelativeTime(entry.at)}
            </div>
          </div>
        ))}
        {props.audit.length === 0 ? <div className="py-4 text-center text-xs text-muted-foreground">暂无审计记录</div> : null}
      </div>
    </div>
  );
}

function KnowledgeSettingsPane(props: {
  config: WikiConfig | null;
  busy: boolean;
  onSave: (embedding: WikiConfig["embedding"]) => void;
}) {
  const [draft, setDraft] = useState<WikiConfig["embedding"] | null>(props.config?.embedding ?? null);
  useEffect(() => setDraft(props.config?.embedding ?? null), [props.config]);
  if (!draft) return <div className="p-4 text-xs text-muted-foreground">配置不可用</div>;
  const update = (patch: Partial<WikiConfig["embedding"]>) => setDraft((current) => current ? { ...current, ...patch } : current);
  return (
    <div className="h-full overflow-y-auto bg-[#f7f7f5] p-3">
      <div className="space-y-3">
        <label className="block text-[11px] font-medium text-muted-foreground">
          Provider
          <input value={draft.provider} onChange={(event) => update({ provider: event.target.value })} className="mt-1 h-8 w-full rounded-md border border-border bg-white px-2 text-xs text-foreground" />
        </label>
        <label className="block text-[11px] font-medium text-muted-foreground">
          Model
          <input value={draft.model} onChange={(event) => update({ model: event.target.value })} className="mt-1 h-8 w-full rounded-md border border-border bg-white px-2 text-xs text-foreground" />
        </label>
        <label className="block text-[11px] font-medium text-muted-foreground">
          Dimensions
          <input type="number" min={1} value={draft.dimensions} onChange={(event) => update({ dimensions: Math.max(1, Number(event.target.value) || 1) })} className="mt-1 h-8 w-full rounded-md border border-border bg-white px-2 text-xs text-foreground" />
        </label>
        <label className="block text-[11px] font-medium text-muted-foreground">
          Keyword weight {draft.keywordWeight.toFixed(1)}
          <input type="range" min={0} max={10} step={0.1} value={draft.keywordWeight} onChange={(event) => update({ keywordWeight: Number(event.target.value) })} className="mt-1 w-full" />
        </label>
        <label className="block text-[11px] font-medium text-muted-foreground">
          Vector weight {draft.vectorWeight.toFixed(1)}
          <input type="range" min={0} max={10} step={0.1} value={draft.vectorWeight} onChange={(event) => update({ vectorWeight: Number(event.target.value) })} className="mt-1 w-full" />
        </label>
        <label className="block text-[11px] font-medium text-muted-foreground">
          MMR lambda {draft.mmrLambda.toFixed(2)}
          <input type="range" min={0} max={1} step={0.01} value={draft.mmrLambda} onChange={(event) => update({ mmrLambda: Number(event.target.value) })} className="mt-1 w-full" />
        </label>
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => props.onSave(draft)} disabled={props.busy} className="inline-flex h-8 items-center gap-1.5 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground disabled:opacity-50">
            <Save className="size-3.5" />
            保存
          </button>
          <button
            type="button"
            onClick={() => {
              const defaults = { ...DEFAULT_KNOWLEDGE_EMBEDDING };
              setDraft(defaults);
              props.onSave(defaults);
            }}
            disabled={props.busy}
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-white px-3 text-xs font-medium text-foreground hover:bg-muted disabled:opacity-50"
          >
            <RotateCcw className="size-3.5" />
            恢复默认
          </button>
        </div>
      </div>
    </div>
  );
}

export default function KnowledgePage() {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const okfInputRef = useRef<HTMLInputElement | null>(null);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [asset, setAsset] = useState<Asset | null>(null);
  const [health, setHealth] = useState<WikiHealth | null>(null);
  const [sources, setSources] = useState<WikiSourceEntry[]>([]);
  const [pages, setPages] = useState<WikiPageEntry[]>([]);
  const [graph, setGraph] = useState<WikiGraph | null>(null);
  const [curationSuggestions, setCurationSuggestions] = useState<WikiCurationSuggestion[]>([]);
  const [ingestJobs, setIngestJobs] = useState<WikiIngestJobStatus[]>([]);
  const [pendingUploads, setPendingUploads] = useState<PendingKnowledgeUpload[]>([]);
  const [sidebarPanelRequest, setSidebarPanelRequest] = useState<{ panel: "custom:operations"; nonce: number } | null>(null);
  const [auditEntries, setAuditEntries] = useState<WikiAuditEntry[]>([]);
  const [knowledgeConfig, setKnowledgeConfig] = useState<WikiConfig | null>(null);
  const [query, setQuery] = useState("");
  const [searchHits, setSearchHits] = useState<WikiSearchHit[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editorState, setEditorState] = useState<AssetFileManagerStateSnapshot | null>(null);

  const assetRoot = useMemo(() => {
    if (!asset) return null;
    return buildAssetWorkspaceRoot(asset.id, asset.defaultBranch);
  }, [asset]);

  const activeRelativeFile = useMemo(() => relativeActiveFile(editorState?.activeFile), [editorState?.activeFile]);

  const loadKnowledge = useCallback(async () => {
    setLoadState("loading");
    setError(null);
    try {
      const nextAsset = await assetsApi.getMyKnowledge();
      setAsset(nextAsset);
      const [nextHealth, nextSources, nextPages, nextGraph, nextCuration, nextJobs, nextAudit, nextConfig] = await Promise.all([
        assetsApi.wikiHealth(nextAsset.id, { suppressErrorToast: true }).catch(() => null),
        assetsApi.wikiListSources(nextAsset.id).catch(() => []),
        assetsApi.wikiListPages(nextAsset.id, { suppressErrorToast: true }).catch(() => []),
        assetsApi.wikiGraph(nextAsset.id).catch(() => null),
        assetsApi
          .wikiListCurationSuggestions(nextAsset.id, { suppressErrorToast: true })
          .catch(() => ({ assetId: nextAsset.id, suggestions: [] })),
        assetsApi.wikiListIngestJobs(nextAsset.id, 20).catch(() => []),
        assetsApi.wikiAuditLog(nextAsset.id, 50).catch(() => []),
        assetsApi.wikiGetConfig(nextAsset.id).catch(() => null),
      ]);
      setHealth(nextHealth);
      setSources(nextSources);
      setPages(nextPages);
      setGraph(nextGraph);
      setCurationSuggestions(nextCuration.suggestions);
      setIngestJobs(nextJobs);
      setAuditEntries(nextAudit);
      setKnowledgeConfig(nextConfig);
      setLoadState("ready");
    } catch (loadError) {
      const message = loadError instanceof Error ? loadError.message : "知识库加载失败";
      setError(message);
      setLoadState("error");
    }
  }, []);

  useEffect(() => {
    void loadKnowledge();
  }, [loadKnowledge]);

  useEffect(() => {
    const normalized = query.trim();
    if (!asset || !normalized) {
      setSearchHits([]);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void assetsApi
        .wikiSearch(asset.id, normalized, 24, { suppressErrorToast: true })
        .then((result) => {
          if (!cancelled) setSearchHits(result.hits);
        })
        .catch(() => {
          if (!cancelled) setSearchHits([]);
        });
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [asset, query]);

  const refreshMetadata = useCallback(async () => {
    if (!asset) return;
    const [nextHealth, nextSources, nextPages, nextGraph, nextCuration, nextJobs, nextAudit] = await Promise.all([
      assetsApi.wikiHealth(asset.id, { suppressErrorToast: true }).catch(() => null),
      assetsApi.wikiListSources(asset.id).catch(() => []),
      assetsApi.wikiListPages(asset.id, { suppressErrorToast: true }).catch(() => []),
      assetsApi.wikiGraph(asset.id).catch(() => null),
      assetsApi
        .wikiListCurationSuggestions(asset.id, { suppressErrorToast: true })
        .catch(() => ({ assetId: asset.id, suggestions: [] })),
      assetsApi.wikiListIngestJobs(asset.id, 20).catch(() => []),
      assetsApi.wikiAuditLog(asset.id, 50).catch(() => []),
    ]);
    setHealth(nextHealth);
    setSources(nextSources);
    setPages(nextPages);
    setGraph(nextGraph);
    setCurationSuggestions(nextCuration.suggestions);
    setIngestJobs(nextJobs);
    setAuditEntries(nextAudit);
  }, [asset]);

  useEffect(() => {
    if (!asset || !ingestJobs.some((job) => job.status === "queued" || job.status === "running")) return;
    const timer = window.setInterval(() => {
      void assetsApi.wikiListIngestJobs(asset.id, 20).then((jobs) => {
        setIngestJobs(jobs);
        if (!jobs.some((job) => job.status === "queued" || job.status === "running")) void refreshMetadata();
      }).catch(() => undefined);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [asset, ingestJobs, refreshMetadata]);

  const handleRefreshCuration = useCallback(async () => {
    if (!asset) return;
    setBusy(true);
    try {
      const result = await assetsApi.wikiRefreshCurationSuggestions(asset.id);
      setCurationSuggestions(result.suggestions);
    } catch (curationError) {
      toast.error(curationError instanceof Error ? curationError.message : "刷新策展建议失败");
    } finally {
      setBusy(false);
    }
  }, [asset]);

  const handleReviewCuration = useCallback(
    async (suggestionId: string, decision: "accept" | "reject" | "revert") => {
      if (!asset) return;
      const suggestion = curationSuggestions.find((item) => item.id === suggestionId);
      const affectedPath = suggestion
        ? suggestion.kind === "page" || suggestion.kind === "merge"
          ? suggestion.targetPath
          : suggestion.sourcePath
        : null;
      if (
        affectedPath &&
        activeRelativeFile === affectedPath &&
        editorState?.activeSaveStatus &&
        editorState.activeSaveStatus !== "saved"
      ) {
        toast.warning("请先保存当前文件，再处理会修改该文件的策展建议");
        return;
      }
      setBusy(true);
      try {
        await assetsApi.wikiReviewCurationSuggestion(asset.id, suggestionId, decision);
        toast.success(decision === "accept" ? "已接受建链建议" : decision === "revert" ? "已撤销建链建议" : "已拒绝建链建议");
        await refreshMetadata();
        dispatchFileTreeEditorCommand("refresh", "desktop-knowledge");
        if (affectedPath && assetRoot) {
          dispatchFileTreeEditorCommand("reload-file", "desktop-knowledge", `${assetRoot}/${affectedPath}`);
        }
      } catch (reviewError) {
        toast.error(reviewError instanceof Error ? reviewError.message : "策展审阅失败");
      } finally {
        setBusy(false);
      }
    },
    [activeRelativeFile, asset, assetRoot, curationSuggestions, editorState?.activeSaveStatus, refreshMetadata],
  );

  const handleUploadFiles = useCallback(
    async (files: FileList | null) => {
      if (!asset || !files?.length) return;
      const selectedFiles = Array.from(files);
      const uploads = selectedFiles.map((file, index) => ({
        id: `${Date.now()}-${index}-${file.name}`,
        name: file.name,
        size: file.size,
        stage: "reading" as const,
      }));
      setPendingUploads((current) => [...uploads, ...current]);
      setSidebarPanelRequest({ panel: "custom:operations", nonce: Date.now() });
      if (fileInputRef.current) fileInputRef.current.value = "";

      const updateUpload = (id: string, stage: PendingKnowledgeUpload["stage"]) => {
        setPendingUploads((current) => current.map((item) => (item.id === id ? { ...item, stage } : item)));
      };
      const results = await Promise.all(
        selectedFiles.map(async (file, index) => {
          const upload = uploads[index];
          try {
            const contentBase64 = await readFileAsBase64(file);
            updateUpload(upload.id, "uploading");
            const uploaded = await assetsApi.wikiUploadSources(asset.id, {
              sources: [{ name: file.name, contentBase64 }],
              ingest: true,
            });
            updateUpload(upload.id, "starting");
            const job = uploaded.job;
            if (!job) throw new Error("摄取任务未创建");
            setIngestJobs((current) => [job, ...current.filter((item) => item.jobId !== job.jobId)]);
            return true;
          } catch (uploadError) {
            toast.error(uploadError instanceof Error ? uploadError.message : `导入 ${file.name} 失败`);
            return false;
          } finally {
            setPendingUploads((current) => current.filter((item) => item.id !== upload.id));
          }
        }),
      );
      const succeeded = results.filter(Boolean).length;
      if (succeeded > 0) {
        toast.success("资料已加入知识库", { description: `${succeeded} 个文件正在后台摄取` });
      }
      await refreshMetadata();
    },
    [asset, refreshMetadata],
  );

  const handleReindex = useCallback(async () => {
    if (!asset) return;
    setBusy(true);
    try {
      const job = await assetsApi.wikiStartIngest(asset.id, []);
      setIngestJobs((current) => [job, ...current.filter((item) => item.jobId !== job.jobId)]);
      toast.success("索引任务已启动");
      await refreshMetadata();
    } catch (reindexError) {
      toast.error(reindexError instanceof Error ? reindexError.message : "刷新索引失败");
    } finally {
      setBusy(false);
    }
  }, [asset, refreshMetadata]);

  const handleCancelIngest = useCallback(async (jobId: string) => {
    if (!asset) return;
    setBusy(true);
    try {
      const job = await assetsApi.wikiCancelIngest(asset.id, jobId);
      setIngestJobs((current) => current.map((item) => (item.jobId === job.jobId ? job : item)));
    } catch (cancelError) {
      toast.error(cancelError instanceof Error ? cancelError.message : "取消摄取失败");
    } finally {
      setBusy(false);
    }
  }, [asset]);

  const handleRetryIngest = useCallback(async (jobId: string) => {
    if (!asset) return;
    setBusy(true);
    try {
      const job = await assetsApi.wikiRetryIngest(asset.id, jobId);
      setIngestJobs((current) => [job, ...current]);
    } catch (retryError) {
      toast.error(retryError instanceof Error ? retryError.message : "重试摄取失败");
    } finally {
      setBusy(false);
    }
  }, [asset]);

  const handleMigrateStorage = useCallback(async () => {
    if (!asset) return;
    setBusy(true);
    try {
      const result = await assetsApi.wikiMigrateStorage(asset.id);
      toast.success("知识库存储检查完成", { description: `${result.migratedPaths.length} 个文件已迁移` });
      await refreshMetadata();
    } catch (migrationError) {
      toast.error(migrationError instanceof Error ? migrationError.message : "知识库存储迁移失败");
    } finally {
      setBusy(false);
    }
  }, [asset, refreshMetadata]);

  const handleSaveKnowledgeConfig = useCallback(async (embedding: WikiConfig["embedding"]) => {
    if (!asset) return;
    setBusy(true);
    try {
      const config = await assetsApi.wikiUpdateConfig(asset.id, { embedding });
      setKnowledgeConfig(config);
      toast.success("知识库检索配置已保存");
    } catch (configError) {
      toast.error(configError instanceof Error ? configError.message : "知识库配置保存失败");
    } finally {
      setBusy(false);
    }
  }, [asset]);

  const handleImportOkf = useCallback(
    async (files: FileList | null) => {
      const file = files?.[0];
      if (!asset || !file) return;
      setBusy(true);
      try {
        const result = await assetsApi.wikiImportOkf(asset.id, await readFileAsBase64(file));
        const warnings = result.validation.diagnostics.filter((item) => item.severity === "warning").length;
        toast.success("OKF 知识包已导入", {
          description: `${result.validation.conceptCount} 个 concept${warnings ? `，${warnings} 条兼容提示` : ""}`,
        });
        await refreshMetadata();
      } catch (importError) {
        toast.error(importError instanceof Error ? importError.message : "OKF 导入失败");
      } finally {
        setBusy(false);
        if (okfInputRef.current) okfInputRef.current.value = "";
      }
    },
    [asset, refreshMetadata],
  );

  const handleExportOkf = useCallback(async () => {
    if (!asset) return;
    setBusy(true);
    try {
      const result = await assetsApi.wikiExportOkf(asset.id);
      downloadBase64File(result.filename, result.contentBase64, "application/zip");
      const errors = result.validation.diagnostics.filter((item) => item.severity === "error").length;
      toast.success("OKF 知识包已导出", {
        description: errors ? `导出完成，当前 bundle 有 ${errors} 条校验错误` : `${result.validation.conceptCount} 个 concept`,
      });
    } catch (exportError) {
      toast.error(exportError instanceof Error ? exportError.message : "OKF 导出失败");
    } finally {
      setBusy(false);
    }
  }, [asset]);

  const newFileTemplate = useCallback((stem: string) => {
    const title = stem.trim() || "未命名页面";
    return `---\ntitle: ${title}\ntype: concept\ntags: []\n---\n\n# ${title}\n\n`;
  }, []);

  if (loadState === "loading") {
    return (
      <div className="flex h-full items-center justify-center bg-background text-sm text-muted-foreground">
        <Loader2 className="mr-2 size-4 animate-spin text-primary" />
        正在加载知识库
      </div>
    );
  }

  if (loadState === "error") {
    return (
      <div className="flex h-full items-center justify-center bg-background px-6">
        <div className="max-w-md text-center">
          <div className="mx-auto flex size-10 items-center justify-center rounded-lg bg-destructive/10 text-destructive">
            <AlertTriangle className="size-5" />
          </div>
          <h2 className="mt-3 text-sm font-semibold text-foreground">知识库不可用</h2>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">{error}</p>
          <button
            type="button"
            onClick={() => void loadKnowledge()}
            className="mt-4 inline-flex h-8 items-center gap-1.5 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            <RefreshCw className="size-3.5" />
            重试
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 w-full flex-col bg-[#f7f7f5]">
      <div className="flex h-12 shrink-0 items-center gap-3 border-b border-border-light bg-white px-3">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <div className="flex size-7 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
            <BookOpenText className="size-4" />
          </div>
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold text-foreground">知识库</div>
            <div className="truncate text-[11px] text-muted-foreground">
              {health
                ? `${health.pageCount} 页面 / ${health.sourceCount} 来源 / ${formatRelativeTime(health.lastIngestedAt)}`
                : "书小安知识库"}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={(event) => void handleUploadFiles(event.target.files)}
          />
          <input
            ref={okfInputRef}
            type="file"
            accept=".zip,application/zip"
            className="hidden"
            onChange={(event) => void handleImportOkf(event.target.files)}
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={!asset}
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-background px-3 text-xs font-medium text-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
          >
            {pendingUploads.length > 0 ? <Loader2 className="size-3.5 animate-spin" /> : <Upload className="size-3.5" />}
            导入资料
          </button>
          <button
            type="button"
            onClick={() => okfInputRef.current?.click()}
            disabled={busy || !asset}
            className="inline-flex size-8 shrink-0 items-center justify-center rounded-md border border-border bg-background text-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
            aria-label="导入 OKF 知识包"
            title="导入 OKF 知识包"
          >
            <FileArchive className="size-3.5" />
          </button>
          <button
            type="button"
            onClick={() => void handleExportOkf()}
            disabled={busy || !asset}
            className="inline-flex size-8 shrink-0 items-center justify-center rounded-md border border-border bg-background text-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
            aria-label="导出 OKF 知识包"
            title="导出 OKF 知识包"
          >
            <Download className="size-3.5" />
          </button>
          <button
            type="button"
            onClick={() => void handleReindex()}
            disabled={busy || !asset}
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-background px-3 text-xs font-medium text-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
          >
            <RefreshCw className={cn("size-3.5", busy ? "animate-spin" : "")} />
            刷新索引
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1">
        {assetRoot ? (
          <AssetFileManager
            rootPath={assetRoot}
            assetId={asset?.id}
            treeDepth={8}
            autoExpandDepth={3}
            defaultSidebarPanel="explorer"
            sidebarPanelRequest={sidebarPanelRequest ?? undefined}
            commandScope="desktop-knowledge"
            enableRichMarkdown={false}
            className="h-full"
            newFileTemplate={newFileTemplate}
            headerSlot={<ExplorerHeader health={health} sources={sources.length} />}
            overviewSidebarPane={{
              id: "assetOverview",
              label: "库概览",
              icon: BookOpenText,
              content: (
                <OverviewPane
                  pages={pages}
                  sources={sources}
                  health={health}
                  query={query}
                  searchHits={searchHits}
                  onQueryChange={setQuery}
                  onOpenPath={(path) => {
                    if (!assetRoot) return;
                    dispatchFileTreeEditorCommand("open-file-preserve-sidebar", "desktop-knowledge", `${assetRoot}/${path}`);
                  }}
                />
              ),
            }}
            customSidebarPanes={[
              {
                id: "graph",
                label: "关系图",
                icon: Network,
                fullWidth: true,
                bodyClassName: "bg-[#f7f7f5]",
                content: <GraphPane graph={graph} />,
              },
              {
                id: "backlinks",
                label: "反向链接",
                icon: Link2,
                content: <BacklinksPane graph={graph} activeFile={activeRelativeFile} />,
              },
              {
                id: "curation",
                label: "策展建议",
                icon: ListChecks,
                content: (
                  <CurationPane
                    suggestions={curationSuggestions}
                    busy={busy}
                    onRefresh={() => void handleRefreshCuration()}
                    onReview={(suggestionId, decision) => void handleReviewCuration(suggestionId, decision)}
                  />
                ),
              },
              {
                id: "operations",
                label: "任务与审计",
                icon: History,
                content: (
                  <OperationsPane
                    uploads={pendingUploads}
                    jobs={ingestJobs}
                    audit={auditEntries}
                    busy={busy}
                    onCancel={(jobId) => void handleCancelIngest(jobId)}
                    onRetry={(jobId) => void handleRetryIngest(jobId)}
                    onMigrate={() => void handleMigrateStorage()}
                  />
                ),
              },
              {
                id: "knowledgeSettings",
                label: "检索配置",
                icon: Settings2,
                content: (
                  <KnowledgeSettingsPane
                    config={knowledgeConfig}
                    busy={busy}
                    onSave={(embedding) => void handleSaveKnowledgeConfig(embedding)}
                  />
                ),
              },
            ]}
            onStateChange={setEditorState}
            onAfterSave={() => void refreshMetadata()}
          />
        ) : null}
      </div>
    </div>
  );
}
