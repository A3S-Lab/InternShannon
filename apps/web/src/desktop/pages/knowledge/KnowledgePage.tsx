import { AssetFileManager } from "@/components/workspace/asset-file-manager";
import {
  assetsApi,
  type Asset,
  type WikiHealth,
  type WikiPageEntry,
  type WikiSourceEntry,
} from "@/lib/api/assets";
import { buildAssetWorkspaceRoot } from "@/lib/asset-workspace-path";
import { cn } from "@/lib/utils";
import {
  AlertTriangle,
  BookOpenText,
  FilePlus2,
  Loader2,
  RefreshCw,
  Search,
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

export default function KnowledgePage() {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [asset, setAsset] = useState<Asset | null>(null);
  const [health, setHealth] = useState<WikiHealth | null>(null);
  const [sources, setSources] = useState<WikiSourceEntry[]>([]);
  const [pages, setPages] = useState<WikiPageEntry[]>([]);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const assetRoot = useMemo(() => {
    if (!asset) return null;
    return buildAssetWorkspaceRoot(asset.id, asset.defaultBranch);
  }, [asset]);

  const filteredPages = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return pages.slice(0, 8);
    return pages
      .filter((page) => `${page.title} ${page.path} ${(page.tags ?? []).join(" ")}`.toLowerCase().includes(normalized))
      .slice(0, 12);
  }, [pages, query]);

  const loadKnowledge = useCallback(async () => {
    setLoadState("loading");
    setError(null);
    try {
      const nextAsset = await assetsApi.getMyKnowledge();
      setAsset(nextAsset);
      const [nextHealth, nextSources, nextPages] = await Promise.all([
        assetsApi.wikiHealth(nextAsset.id, { suppressErrorToast: true }).catch(() => null),
        assetsApi.wikiListSources(nextAsset.id).catch(() => []),
        assetsApi.wikiListPages(nextAsset.id, { suppressErrorToast: true }).catch(() => []),
      ]);
      setHealth(nextHealth);
      setSources(nextSources);
      setPages(nextPages);
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
    const [nextHealth, nextSources, nextPages] = await Promise.all([
      assetsApi.wikiHealth(asset.id, { suppressErrorToast: true }).catch(() => null),
      assetsApi.wikiListSources(asset.id).catch(() => []),
      assetsApi.wikiListPages(asset.id, { suppressErrorToast: true }).catch(() => []),
    ]);
    setHealth(nextHealth);
    setSources(nextSources);
    setPages(nextPages);
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
    <div className="flex h-full min-h-0 w-full flex-col bg-background">
      <div className="flex shrink-0 flex-wrap items-center gap-3 border-b px-4 py-2.5">
        <div className="flex min-w-0 flex-1 items-center gap-2.5">
          <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <BookOpenText className="size-4" />
          </div>
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold text-foreground">知识库</div>
            <div className="truncate text-[11px] text-muted-foreground">
              {health
                ? `${health.pageCount} 个页面 / ${health.sourceCount} 个来源 / ${formatRelativeTime(
                    health.lastIngestedAt,
                  )}`
                : "本地知识库"}
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

      <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_260px]">
        <div className="min-h-0 min-w-0">
          {assetRoot ? (
            <AssetFileManager
              rootPath={assetRoot}
              assetId={asset?.id}
              treeDepth={8}
              autoExpandDepth={2}
              defaultSidebarPanel="explorer"
              commandScope="desktop-knowledge"
              className="h-full"
            />
          ) : null}
        </div>

        <aside className="hidden min-h-0 border-l bg-[#fafafa] lg:flex lg:flex-col">
          <div className="border-b px-3 py-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="搜索页面"
                className="h-8 w-full rounded-md border border-border bg-white pl-7 pr-2 text-xs outline-none transition-colors focus:border-primary/40"
              />
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
            <div className="mb-2 flex items-center justify-between text-[11px] font-medium text-muted-foreground">
              <span>页面</span>
              <span>{pages.length}</span>
            </div>
            <div className="space-y-1.5">
              {filteredPages.length > 0 ? (
                filteredPages.map((page) => (
                  <div key={page.path} className="rounded-md border border-border-light bg-white px-2 py-1.5">
                    <div className="flex items-center gap-1.5 text-xs font-medium text-foreground">
                      <BookOpenText className="size-3 shrink-0 text-primary" />
                      <span className="truncate">{page.title}</span>
                    </div>
                    <div className="mt-0.5 truncate text-[10px] text-muted-foreground">{page.path}</div>
                  </div>
                ))
              ) : (
                <div className="rounded-md border border-dashed border-border px-3 py-6 text-center text-xs text-muted-foreground">
                  暂无页面
                </div>
              )}
            </div>

            <div className="mt-5 mb-2 flex items-center justify-between text-[11px] font-medium text-muted-foreground">
              <span>来源</span>
              <span>{sources.length}</span>
            </div>
            <div className="space-y-1.5">
              {sources.slice(0, 10).map((source) => (
                <div key={source.path} className="rounded-md border border-border-light bg-white px-2 py-1.5">
                  <div className="flex items-center gap-1.5 text-xs font-medium text-foreground">
                    <FilePlus2 className="size-3 shrink-0 text-emerald-600" />
                    <span className="truncate">{source.name}</span>
                  </div>
                  <div className="mt-0.5 truncate text-[10px] text-muted-foreground">{source.path}</div>
                </div>
              ))}
              {sources.length === 0 ? (
                <div className="rounded-md border border-dashed border-border px-3 py-6 text-center text-xs text-muted-foreground">
                  暂无来源
                </div>
              ) : null}
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
