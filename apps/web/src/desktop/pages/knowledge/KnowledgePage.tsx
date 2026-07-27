import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  AlertTriangle,
  BookOpenText,
  Download,
  FileArchive,
  History,
  Link2,
  ListChecks,
  Loader2,
  Network,
  RefreshCw,
  Settings2,
  Upload,
} from "lucide-react";
import { toast } from "@/components/ui/sonner";
import { AssetFileManager, type AssetFileManagerStateSnapshot } from "@/components/workspace/asset-file-manager";
import { dispatchFileTreeEditorCommand } from "@/components/workspace/file-tree-editor/events";
import {
  assetsApi,
  type Asset,
  type WikiAuditEntry,
  type WikiConfig,
  type WikiCurationSuggestion,
  type WikiGraph,
  type WikiHealth,
  type WikiIngestJobStatus,
  type WikiPageEntry,
  type WikiSearchHit,
  type WikiSourceEntry,
} from "@/lib/api/assets";
import { buildAssetWorkspaceRoot } from "@/lib/asset-workspace-path";
import { parseKnowledgeAssetCitation } from "@/lib/knowledge-citation";
import { hasTauriCore } from "@/lib/runtime-environment";
import { invokeDesktop } from "@/desktop/lib/tauri-runtime";
import { cn } from "@/lib/utils";
import { CurationPane } from "./components/knowledge-curation-pane";
import { BacklinksPane, ExplorerHeader, OverviewPane } from "./components/knowledge-explorer-pane";
import { GraphPane } from "./components/knowledge-graph-pane";
import { ingestProgress, OperationsPane } from "./components/knowledge-operations-pane";
import { KnowledgeSettingsPane } from "./components/knowledge-settings-pane";
import {
  saveBase64File,
  formatRelativeTime,
  type PendingKnowledgeUpload,
  readFileAsBase64,
  relativeActiveFile,
} from "./knowledge-page-utils";

type LoadState = "loading" | "ready" | "error";

interface SelectedKnowledgeSource {
  name: string;
  size: number;
  contentBase64: string;
  originalPath?: string;
}

export default function KnowledgePage() {
  const [searchParams] = useSearchParams();
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
  const [sidebarPanelRequest, setSidebarPanelRequest] = useState<{
    panel: "custom:operations";
    nonce: number;
  } | null>(null);
  const [auditEntries, setAuditEntries] = useState<WikiAuditEntry[]>([]);
  const [knowledgeConfig, setKnowledgeConfig] = useState<WikiConfig | null>(null);
  const [query, setQuery] = useState("");
  const [searchHits, setSearchHits] = useState<WikiSearchHit[]>([]);
  const [searchState, setSearchState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editorState, setEditorState] = useState<AssetFileManagerStateSnapshot | null>(null);

  const assetRoot = useMemo(() => {
    if (!asset) return null;
    return buildAssetWorkspaceRoot(asset.id, asset.defaultBranch);
  }, [asset]);

  const activeRelativeFile = useMemo(() => relativeActiveFile(editorState?.activeFile), [editorState?.activeFile]);
  const activeIngestJob = useMemo(
    () => ingestJobs.find((job) => job.status === "queued" || job.status === "running") ?? null,
    [ingestJobs],
  );
  const activeIngestProgress = activeIngestJob ? ingestProgress(activeIngestJob) : null;
  const nativeRevealPaths = useMemo(() => {
    if (!assetRoot) return {};
    return Object.fromEntries(
      sources
        .filter((source): source is WikiSourceEntry & { originalPath: string } => Boolean(source.originalPath))
        .map((source) => [`${assetRoot}/${source.path}`, source.originalPath]),
    );
  }, [assetRoot, sources]);

  const citationOpenRequest = useMemo(() => {
    const source = searchParams.get("source");
    const openRequest = searchParams.get("open") || source;
    if (!assetRoot || !asset || !source || !openRequest) return null;
    const citation = parseKnowledgeAssetCitation(source);
    if (!citation) return null;
    const belongsToPersonalKnowledge =
      citation.assetId === asset.id || citation.assetId === "personal-knowledge" || citation.assetId === asset.name;
    if (!belongsToPersonalKnowledge) return null;
    return { path: `${assetRoot}/${citation.relativePath}`, nonce: openRequest };
  }, [asset, assetRoot, searchParams]);

  const loadKnowledge = useCallback(async () => {
    setLoadState("loading");
    setError(null);
    try {
      const nextAsset = await assetsApi.getMyKnowledge();
      setAsset(nextAsset);
      const [nextHealth, nextSources, nextPages, nextGraph, nextCuration, nextJobs, nextAudit, nextConfig] =
        await Promise.all([
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
      setSearchState("idle");
      return;
    }
    setSearchHits([]);
    setSearchState("loading");
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void assetsApi
        .wikiSearch(asset.id, normalized, 24, { suppressErrorToast: true })
        .then((result) => {
          if (!cancelled) {
            setSearchHits(result.hits);
            setSearchState("ready");
          }
        })
        .catch(() => {
          if (!cancelled) {
            setSearchHits([]);
            setSearchState("error");
          }
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
      void assetsApi
        .wikiListIngestJobs(asset.id, 20)
        .then((jobs) => {
          setIngestJobs(jobs);
          if (!jobs.some((job) => job.status === "queued" || job.status === "running")) {
            void refreshMetadata();
          }
        })
        .catch(() => undefined);
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
        toast.success(
          decision === "accept" ? "已接受建链建议" : decision === "revert" ? "已撤销建链建议" : "已拒绝建链建议",
        );
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

  const uploadSelectedSources = useCallback(
    async (selectedFiles: SelectedKnowledgeSource[]) => {
      if (!asset || selectedFiles.length === 0) return;
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
            updateUpload(upload.id, "uploading");
            const uploaded = await assetsApi.wikiUploadSources(asset.id, {
              sources: [{ name: file.name, contentBase64: file.contentBase64, originalPath: file.originalPath }],
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

  const handleUploadFiles = useCallback(
    async (files: FileList | null) => {
      if (!files?.length) return;
      const selectedFiles = await Promise.all(
        Array.from(files).map(async (file) => ({
          name: file.name,
          size: file.size,
          contentBase64: await readFileAsBase64(file),
        })),
      );
      await uploadSelectedSources(selectedFiles);
      if (fileInputRef.current) fileInputRef.current.value = "";
    },
    [uploadSelectedSources],
  );

  const handleChooseSources = useCallback(async () => {
    if (!hasTauriCore()) {
      fileInputRef.current?.click();
      return;
    }
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const selected = await open({ multiple: true, directory: false, title: "选择知识库资料" });
      const paths = typeof selected === "string" ? [selected] : (selected ?? []);
      const files = await Promise.all(
        paths.map((path) => invokeDesktop<SelectedKnowledgeSource>("read_knowledge_source", { path })),
      );
      await uploadSelectedSources(files);
    } catch (selectionError) {
      toast.error(selectionError instanceof Error ? selectionError.message : "读取所选资料失败");
    }
  }, [uploadSelectedSources]);

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

  const handleReingestSource = useCallback(
    async (sourcePath: string) => {
      if (!asset) return;
      setBusy(true);
      setSidebarPanelRequest({ panel: "custom:operations", nonce: Date.now() });
      try {
        const job = await assetsApi.wikiStartIngest(asset.id, [sourcePath]);
        setIngestJobs((current) => [job, ...current.filter((item) => item.jobId !== job.jobId)]);
        toast.success("来源重新抽取已启动", { description: sourcePath.split("/").pop() || sourcePath });
      } catch (reindexError) {
        toast.error(reindexError instanceof Error ? reindexError.message : "重新抽取来源失败");
      } finally {
        setBusy(false);
      }
    },
    [asset],
  );

  const handleCancelIngest = useCallback(
    async (jobId: string) => {
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
    },
    [asset],
  );

  const handleRetryIngest = useCallback(
    async (jobId: string) => {
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
    },
    [asset],
  );

  const handleMigrateStorage = useCallback(async () => {
    if (!asset) return;
    setBusy(true);
    try {
      const result = await assetsApi.wikiMigrateStorage(asset.id);
      toast.success("知识库存储检查完成", {
        description: `${result.migratedPaths.length} 个文件已迁移`,
      });
      await refreshMetadata();
    } catch (migrationError) {
      toast.error(migrationError instanceof Error ? migrationError.message : "知识库存储迁移失败");
    } finally {
      setBusy(false);
    }
  }, [asset, refreshMetadata]);

  const handleSaveKnowledgeConfig = useCallback(
    async (embedding: WikiConfig["embedding"]) => {
      if (!asset) return;
      if (embedding.keywordWeight <= 0 && embedding.vectorWeight <= 0) {
        toast.error("关键词权重和语义权重不能同时为 0");
        return;
      }
      if (!embedding.provider.trim() || !embedding.model.trim()) {
        toast.error("请填写向量服务和向量模型");
        return;
      }
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
    },
    [asset],
  );

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
      const destination = await saveBase64File(result.filename, result.contentBase64, "application/zip");
      if (destination === "cancelled") return;
      const errors = result.validation.diagnostics.filter((item) => item.severity === "error").length;
      toast.success("OKF 知识包已导出", {
        description: errors
          ? `导出完成，当前 bundle 有 ${errors} 条校验错误`
          : `${result.validation.conceptCount} 个 concept${destination === "download" ? "，已保存到浏览器下载目录" : ""}`,
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
            onClick={() => void handleChooseSources()}
            disabled={!asset}
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-background px-3 text-xs font-medium text-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
          >
            {pendingUploads.length > 0 ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Upload className="size-3.5" />
            )}
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
            disabled={busy || !asset || Boolean(activeIngestJob)}
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-background px-3 text-xs font-medium text-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
          >
            <RefreshCw className={cn("size-3.5", busy || activeIngestJob ? "animate-spin" : "")} />
            {activeIngestProgress ? `索引中 ${Math.round(activeIngestProgress.percent)}%` : "刷新索引"}
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
            openFileRequest={citationOpenRequest}
            nativeRevealPaths={nativeRevealPaths}
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
                  searchState={searchState}
                  busy={busy}
                  onQueryChange={setQuery}
                  onReingestSource={(path) => void handleReingestSource(path)}
                  onOpenPath={(path) => {
                    dispatchFileTreeEditorCommand(
                      "open-file-preserve-sidebar",
                      "desktop-knowledge",
                      `${assetRoot}/${path}`,
                    );
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
