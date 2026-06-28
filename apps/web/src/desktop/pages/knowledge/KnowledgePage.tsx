import {
  AssetFileManager,
  type AssetFileManagerStateSnapshot,
} from "@/components/workspace/asset-file-manager";
import {
  assetsApi,
  type Asset,
  type WikiGraph,
  type WikiHealth,
  type WikiPageEntry,
  type WikiSourceEntry,
} from "@/lib/api/assets";
import { buildAssetWorkspaceRoot, parseAssetWorkspacePath } from "@/lib/asset-workspace-path";
import { cn } from "@/lib/utils";
import {
  AlertTriangle,
  BookOpenText,
  FilePlus2,
  FileText,
  Hash,
  Link2,
  Loader2,
  Network,
  RefreshCw,
  Tags,
  Upload,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

type LoadState = "loading" | "ready" | "error";

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

function relativeActiveFile(path: string | null | undefined) {
  return parseAssetWorkspacePath(path)?.relativePath ?? null;
}

function pageTitle(path: string) {
  const name = path.split("/").pop() || path;
  return name.replace(/\.[^.]+$/, "") || name;
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
          <div className="truncate text-xs font-semibold text-foreground">InternShannon Vault</div>
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
  onQueryChange: (value: string) => void;
}) {
  const filteredPages = useMemo(() => {
    const normalized = props.query.trim().toLowerCase();
    return (normalized ? props.pages.filter((page) => normalizeSearchTarget(page).includes(normalized)) : props.pages).slice(0, 24);
  }, [props.pages, props.query]);

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
                <div key={page.path} className="rounded-md px-2 py-1.5 text-xs transition-colors hover:bg-white">
                  <div className="truncate font-medium text-foreground">{page.title}</div>
                  <div className="mt-0.5 truncate text-[10px] text-muted-foreground">{page.path}</div>
                </div>
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
                <div className="truncate font-medium text-foreground">{source.name}</div>
                <div className="mt-0.5 truncate text-[10px] text-muted-foreground">{source.path}</div>
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
  const topNodes = nodes.slice().sort((a, b) => b.degree - a.degree || a.title.localeCompare(b.title, "zh-CN")).slice(0, 18);

  return (
    <div className="flex h-full min-h-0 flex-col bg-[#f7f7f5]">
      <div className="flex shrink-0 items-center gap-3 border-b border-border-light px-4 py-3">
        <div className="flex size-8 items-center justify-center rounded-md bg-primary/10 text-primary">
          <Network className="size-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold text-foreground">关系图</div>
          <div className="truncate text-[11px] text-muted-foreground">{nodes.length} 节点 / {edges.length} 连接</div>
        </div>
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_280px]">
        <div className="relative min-h-0 overflow-hidden p-6">
          <div className="grid h-full min-h-[360px] place-items-center rounded-md border border-border-light bg-white">
            <div className="relative size-[min(58vw,520px)] max-h-[520px] max-w-[520px]">
              {topNodes.map((node, index) => {
                const angle = (Math.PI * 2 * index) / Math.max(1, topNodes.length);
                const radius = 42;
                return (
                  <div
                    key={node.path}
                    className="absolute flex max-w-[130px] -translate-x-1/2 -translate-y-1/2 items-center gap-1.5 rounded-full border border-border-light bg-[#fbfaf7] px-2 py-1 text-[11px] shadow-sm"
                    style={{
                      left: `${50 + Math.cos(angle) * radius}%`,
                      top: `${50 + Math.sin(angle) * radius}%`,
                    }}
                    title={node.path}
                  >
                    <span className="size-1.5 shrink-0 rounded-full bg-primary" />
                    <span className="truncate">{node.title}</span>
                  </div>
                );
              })}
              <div className="absolute left-1/2 top-1/2 flex size-24 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-primary/20 bg-primary/10 text-xs font-semibold text-primary">
                Vault
              </div>
            </div>
          </div>
        </div>
        <aside className="min-h-0 overflow-y-auto border-l border-border-light bg-white p-3">
          <div className="mb-2 text-[11px] font-semibold text-muted-foreground">连接</div>
          <div className="space-y-1">
            {edges.slice(0, 32).map((edge) => (
              <div key={`${edge.source}-${edge.target}`} className="rounded-md border border-border-light px-2 py-1.5 text-xs">
                <div className="truncate text-foreground">{pageTitle(edge.source)}</div>
                <div className="flex items-center gap-1 truncate text-[10px] text-muted-foreground">
                  <Link2 className="size-3 shrink-0" />
                  {pageTitle(edge.target)}
                </div>
              </div>
            ))}
            {edges.length === 0 ? (
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

export default function KnowledgePage() {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [asset, setAsset] = useState<Asset | null>(null);
  const [health, setHealth] = useState<WikiHealth | null>(null);
  const [sources, setSources] = useState<WikiSourceEntry[]>([]);
  const [pages, setPages] = useState<WikiPageEntry[]>([]);
  const [graph, setGraph] = useState<WikiGraph | null>(null);
  const [query, setQuery] = useState("");
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
      const [nextHealth, nextSources, nextPages, nextGraph] = await Promise.all([
        assetsApi.wikiHealth(nextAsset.id, { suppressErrorToast: true }).catch(() => null),
        assetsApi.wikiListSources(nextAsset.id).catch(() => []),
        assetsApi.wikiListPages(nextAsset.id, { suppressErrorToast: true }).catch(() => []),
        assetsApi.wikiGraph(nextAsset.id).catch(() => null),
      ]);
      setHealth(nextHealth);
      setSources(nextSources);
      setPages(nextPages);
      setGraph(nextGraph);
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

  const refreshMetadata = useCallback(async () => {
    if (!asset) return;
    const [nextHealth, nextSources, nextPages, nextGraph] = await Promise.all([
      assetsApi.wikiHealth(asset.id, { suppressErrorToast: true }).catch(() => null),
      assetsApi.wikiListSources(asset.id).catch(() => []),
      assetsApi.wikiListPages(asset.id, { suppressErrorToast: true }).catch(() => []),
      assetsApi.wikiGraph(asset.id).catch(() => null),
    ]);
    setHealth(nextHealth);
    setSources(nextSources);
    setPages(nextPages);
    setGraph(nextGraph);
  }, [asset]);

  const handleUploadFiles = useCallback(
    async (files: FileList | null) => {
      if (!asset || !files?.length) return;
      setBusy(true);
      try {
        const sourcesToUpload = await Promise.all(
          Array.from(files).map(async (file) => ({
            name: file.name,
            contentBase64: await readFileAsBase64(file),
          })),
        );
        await assetsApi.wikiUploadSources(asset.id, {
          sources: sourcesToUpload,
          ingest: true,
        });
        toast.success("已导入知识库", {
          description: `${sourcesToUpload.length} 个文件`,
        });
        await refreshMetadata();
      } catch (uploadError) {
        toast.error(uploadError instanceof Error ? uploadError.message : "导入知识库失败");
      } finally {
        setBusy(false);
        if (fileInputRef.current) fileInputRef.current.value = "";
      }
    },
    [asset, refreshMetadata],
  );

  const handleReindex = useCallback(async () => {
    if (!asset) return;
    setBusy(true);
    try {
      await assetsApi.wikiReindex(asset.id);
      toast.success("知识库索引已刷新");
      await refreshMetadata();
    } catch (reindexError) {
      toast.error(reindexError instanceof Error ? reindexError.message : "刷新索引失败");
    } finally {
      setBusy(false);
    }
  }, [asset, refreshMetadata]);

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
                : "InternShannon Vault"}
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
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={busy || !asset}
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-background px-3 text-xs font-medium text-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Upload className="size-3.5" />}
            导入
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
            commandScope="desktop-knowledge"
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
                  onQueryChange={setQuery}
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
            ]}
            onStateChange={setEditorState}
            onAfterSave={() => void refreshMetadata()}
          />
        ) : null}
      </div>
    </div>
  );
}
