import {
  ChevronDown,
  ChevronRight,
  FileText,
  Replace,
  Search,
  X,
} from "lucide-react";
import { useCallback, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { type SearchResult, workspaceApi } from "@/lib/workspace-api";
import {
  getWorkspaceRelativePath,
  joinWorkspacePath,
  normalizeWorkspacePath,
} from "@/lib/workspace-path";

interface GlobalSearchProps {
  className?: string;
  onClose?: () => void;
  onFileClick?: (path: string, line?: number) => void;
  rootPath?: string;
  variant?: "default" | "vscode";
}

type ReplaceScope = {
  filePaths?: string[];
  label: string;
};

function getSearchPathParts(path: string, rootPath?: string) {
  const relativePath = getWorkspaceRelativePath(rootPath, path);
  const lastSlash = relativePath.lastIndexOf("/");

  if (lastSlash === -1) {
    return { fileName: relativePath, folderPath: "" };
  }

  return {
    fileName: relativePath.slice(lastSlash + 1),
    folderPath: relativePath.slice(0, lastSlash),
  };
}

function getSearchOpenPath(path: string, rootPath?: string) {
  const normalizedPath = normalizeWorkspacePath(path);
  const normalizedRoot = normalizeWorkspacePath(rootPath);
  if (
    !normalizedRoot ||
    normalizedPath === normalizedRoot ||
    normalizedPath.startsWith(`${normalizedRoot}/`)
  ) {
    return normalizedPath;
  }
  return joinWorkspacePath(normalizedRoot, normalizedPath);
}

function buildSearchKey({
  rootPath,
  searchQuery,
  caseSensitive,
  matchWholeWord,
  useRegex,
  includePattern,
  excludePattern,
}: {
  rootPath?: string;
  searchQuery: string;
  caseSensitive: boolean;
  matchWholeWord: boolean;
  useRegex: boolean;
  includePattern: string;
  excludePattern: string;
}) {
  return JSON.stringify({
    rootPath: normalizeWorkspacePath(rootPath),
    searchQuery: searchQuery.trim(),
    caseSensitive,
    matchWholeWord,
    useRegex,
    includePattern: includePattern.trim(),
    excludePattern: excludePattern.trim(),
  });
}

export function GlobalSearch({
  className,
  onClose,
  onFileClick,
  rootPath,
  variant = "default",
}: GlobalSearchProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [replaceQuery, setReplaceQuery] = useState("");
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [matchWholeWord, setMatchWholeWord] = useState(false);
  const [useRegex, setUseRegex] = useState(false);
  const [includePattern, setIncludePattern] = useState("");
  const [excludePattern, setExcludePattern] = useState("");
  const [showReplace, setShowReplace] = useState(false);
  const [searching, setSearching] = useState(false);
  const [replacing, setReplacing] = useState(false);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [expandedFiles, setExpandedFiles] = useState<Set<string>>(new Set());
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set());
  const [searchedKey, setSearchedKey] = useState<string | null>(null);
  const [pendingReplace, setPendingReplace] = useState<ReplaceScope | null>(
    null
  );
  const searchRequestIdRef = useRef(0);
  const isVsCode = variant === "vscode";
  const totalMatches = useMemo(
    () => results.reduce((total, result) => total + result.matches.length, 0),
    [results]
  );
  const currentSearchKey = useMemo(
    () =>
      buildSearchKey({
        rootPath,
        searchQuery,
        caseSensitive,
        matchWholeWord,
        useRegex,
        includePattern,
        excludePattern,
      }),
    [
      rootPath,
      searchQuery,
      caseSensitive,
      matchWholeWord,
      useRegex,
      includePattern,
      excludePattern,
    ]
  );
  const searchIsStale = results.length > 0 && searchedKey !== currentSearchKey;
  const resultByPath = useMemo(
    () => new Map(results.map((result) => [result.path, result])),
    [results]
  );
  const replacePreview = useMemo(() => {
    if (!pendingReplace) return null;
    const files = pendingReplace.filePaths?.length
      ? pendingReplace.filePaths
          .map((path) => resultByPath.get(path))
          .filter((result): result is SearchResult => !!result)
      : results;
    const matchCount = files.reduce(
      (total, result) => total + result.matches.length,
      0
    );
    return { files, fileCount: files.length, matchCount };
  }, [pendingReplace, resultByPath, results]);
  const selectedMatchCount = useMemo(() => {
    if (selectedFiles.size === 0) return 0;
    return Array.from(selectedFiles).reduce(
      (total, path) => total + (resultByPath.get(path)?.matches.length ?? 0),
      0
    );
  }, [resultByPath, selectedFiles]);
  const replaceUnavailable =
    !rootPath ||
    searching ||
    replacing ||
    results.length === 0 ||
    searchIsStale;

  const handleSearch = useCallback(async () => {
    if (!searchQuery.trim() || !rootPath) return;

    const requestId = searchRequestIdRef.current + 1;
    searchRequestIdRef.current = requestId;
    setSearching(true);
    try {
      const searchResults = await workspaceApi.searchInFiles(
        rootPath,
        searchQuery,
        {
          caseSensitive,
          matchWholeWord,
          useRegex,
          includePattern: includePattern.trim() || undefined,
          excludePattern: excludePattern.trim() || undefined,
          maxResults: 1000,
        }
      );
      if (requestId !== searchRequestIdRef.current) return;
      setResults(searchResults);
      setExpandedFiles(new Set(searchResults.map((result) => result.path)));
      setSelectedFiles(new Set());
      setSearchedKey(currentSearchKey);
    } catch (error) {
      if (requestId !== searchRequestIdRef.current) return;
      console.error("Search failed:", error);
      setResults([]);
      setSearchedKey(null);
      toast.error(
        `搜索失败: ${error instanceof Error ? error.message : "未知错误"}`
      );
    } finally {
      if (requestId === searchRequestIdRef.current) {
        setSearching(false);
      }
    }
  }, [
    searchQuery,
    rootPath,
    caseSensitive,
    matchWholeWord,
    useRegex,
    includePattern,
    excludePattern,
    currentSearchKey,
  ]);

  const handleReplace = useCallback(
    async (scope: ReplaceScope) => {
      if (!searchQuery.trim() || !rootPath) return;
      if (searchIsStale) {
        toast.error("搜索条件已变更，请先重新搜索再替换");
        return;
      }

      setReplacing(true);
      try {
        const result = await workspaceApi.replaceInFiles(
          rootPath,
          searchQuery,
          replaceQuery,
          {
            caseSensitive,
            matchWholeWord,
            useRegex,
            includePattern: includePattern.trim() || undefined,
            excludePattern: excludePattern.trim() || undefined,
            filePaths: scope.filePaths,
          }
        );
        setPendingReplace(null);
        toast.success(
          `替换完成: ${result.filesModified} 个文件，共 ${result.totalReplacements} 处替换`
        );
        await handleSearch();
      } catch (error) {
        console.error("Replace failed:", error);
        toast.error(
          `替换失败: ${error instanceof Error ? error.message : "未知错误"}`
        );
      } finally {
        setReplacing(false);
      }
    },
    [
      searchQuery,
      replaceQuery,
      rootPath,
      caseSensitive,
      matchWholeWord,
      useRegex,
      includePattern,
      excludePattern,
      handleSearch,
      searchIsStale,
    ]
  );

  const requestReplace = useCallback(
    (scope: ReplaceScope) => {
      if (!searchQuery.trim() || !rootPath) return;
      if (searching) {
        toast.info("搜索仍在进行，请稍后再替换");
        return;
      }
      if (searchIsStale) {
        toast.error("搜索条件已变更，请先重新搜索再替换");
        return;
      }
      if (results.length === 0) {
        toast.error("没有可替换的搜索结果");
        return;
      }
      if (scope.filePaths && scope.filePaths.length === 0) {
        toast.error("请先选择要替换的文件");
        return;
      }
      setPendingReplace(scope);
    },
    [rootPath, searchIsStale, searchQuery, searching, results.length]
  );

  const handleReplaceInFile = useCallback(
    (filePath: string) => {
      const { fileName } = getSearchPathParts(filePath, rootPath);
      requestReplace({ filePaths: [filePath], label: `替换 ${fileName}` });
    },
    [requestReplace, rootPath]
  );

  const handleReplaceAll = useCallback(() => {
    requestReplace({ label: "全部替换" });
  }, [requestReplace]);

  const handleReplaceSelected = useCallback(() => {
    if (selectedFiles.size === 0) {
      toast.error("请先选择要替换的文件");
      return;
    }
    requestReplace({
      filePaths: Array.from(selectedFiles),
      label: "替换选中的文件",
    });
  }, [selectedFiles, requestReplace]);

  const toggleAllSelected = useCallback(
    (checked: boolean) => {
      setSelectedFiles(
        checked ? new Set(results.map((result) => result.path)) : new Set()
      );
    },
    [results]
  );

  const replaceConfirmDialog = (
    <Dialog
      open={!!pendingReplace}
      onOpenChange={(open) => !open && !replacing && setPendingReplace(null)}
    >
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>确认批量替换</DialogTitle>
          <DialogDescription>
            此操作会直接写入工作区文件。请确认搜索结果仍然符合预期。
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          <div className="rounded-[6px] border border-border bg-muted/20 p-3">
            <div className="grid grid-cols-[4.5rem_1fr] gap-x-3 gap-y-1.5">
              <span className="text-muted-foreground">搜索</span>
              <span className="min-w-0 break-words font-mono text-xs">
                {searchQuery || "-"}
              </span>
              <span className="text-muted-foreground">替换为</span>
              <span className="min-w-0 break-words font-mono text-xs">
                {replaceQuery || "(空字符串)"}
              </span>
              <span className="text-muted-foreground">范围</span>
              <span>{pendingReplace?.label ?? "-"}</span>
            </div>
          </div>
          <div className="rounded-[6px] border border-amber-200 bg-amber-50 p-3 text-amber-800">
            将修改 {replacePreview?.fileCount ?? 0} 个文件中的{" "}
            {replacePreview?.matchCount ?? 0} 处匹配。
          </div>
          {searchIsStale && (
            <div className="rounded-[6px] border border-destructive/25 bg-destructive/10 p-3 text-destructive">
              搜索条件已变更，请重新搜索后再执行替换。
            </div>
          )}
          {!!replacePreview?.files.length && (
            <div className="max-h-40 overflow-y-auto rounded-[6px] border border-border">
              {replacePreview.files.slice(0, 20).map((result) => (
                <div
                  key={result.path}
                  className="flex items-center gap-2 border-b border-border/60 px-3 py-2 last:border-b-0"
                >
                  <FileText className="size-3.5 shrink-0 text-muted-foreground" />
                  <span
                    className="min-w-0 flex-1 truncate text-xs"
                    title={getWorkspaceRelativePath(rootPath, result.path)}
                  >
                    {getWorkspaceRelativePath(rootPath, result.path)}
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {result.matches.length} 处
                  </span>
                </div>
              ))}
              {replacePreview.files.length > 20 && (
                <div className="px-3 py-2 text-xs text-muted-foreground">
                  还有 {replacePreview.files.length - 20} 个文件未显示
                </div>
              )}
            </div>
          )}
        </div>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => setPendingReplace(null)}
            disabled={replacing}
          >
            取消
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={() => pendingReplace && void handleReplace(pendingReplace)}
            disabled={
              replacing ||
              searching ||
              searchIsStale ||
              !replacePreview ||
              replacePreview.matchCount === 0
            }
          >
            {replacing ? "替换中…" : "确认替换"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );

  const toggleFileExpanded = useCallback((path: string) => {
    setExpandedFiles((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  }, []);

  const handleResultClick = useCallback(
    (path: string, line?: number) => {
      onFileClick?.(getSearchOpenPath(path, rootPath), line);
    },
    [onFileClick, rootPath]
  );

  if (isVsCode) {
    return (
      <>
        <div
          className={cn(
            "file-tree-vscode-search flex h-full flex-col",
            className
          )}
        >
          <div className="file-tree-vscode-search-controls">
            <div className="file-tree-vscode-search-row">
              <button
                type="button"
                className="file-tree-vscode-search-toggle"
                aria-label={showReplace ? "隐藏替换" : "显示替换"}
                aria-expanded={showReplace}
                onClick={() => setShowReplace((value) => !value)}
              >
                <ChevronRight
                  className={cn("size-3.5", showReplace && "rotate-90")}
                />
              </button>
              <div className="file-tree-vscode-search-inputbox">
                <input
                  type="text"
                  aria-label="搜索内容"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      void handleSearch();
                    }
                  }}
                  placeholder={rootPath ? "搜索" : "未选择工作区"}
                  className="file-tree-vscode-search-input"
                />
                <div className="file-tree-vscode-search-input-actions">
                  <button
                    type="button"
                    className={cn(
                      "file-tree-vscode-search-option",
                      caseSensitive && "is-active"
                    )}
                    aria-pressed={caseSensitive}
                    title="区分大小写"
                    onClick={() => setCaseSensitive((value) => !value)}
                  >
                    Aa
                  </button>
                  <button
                    type="button"
                    className={cn(
                      "file-tree-vscode-search-option",
                      matchWholeWord && "is-active"
                    )}
                    aria-pressed={matchWholeWord}
                    title="全字匹配"
                    onClick={() => setMatchWholeWord((value) => !value)}
                  >
                    ab
                  </button>
                  <button
                    type="button"
                    className={cn(
                      "file-tree-vscode-search-option",
                      useRegex && "is-active"
                    )}
                    aria-pressed={useRegex}
                    title="使用正则表达式"
                    onClick={() => setUseRegex((value) => !value)}
                  >
                    .*
                  </button>
                </div>
              </div>
              <button
                type="button"
                className="file-tree-vscode-search-command"
                aria-label="搜索"
                disabled={!rootPath || !searchQuery.trim() || searching}
                onClick={handleSearch}
              >
                <Search className="size-3.5" />
              </button>
              {onClose && (
                <button
                  type="button"
                  className="file-tree-vscode-search-command"
                  aria-label="关闭搜索"
                  onClick={onClose}
                >
                  <X className="size-3.5" />
                </button>
              )}
            </div>
            {showReplace && (
              <div className="file-tree-vscode-search-row">
                <span className="file-tree-vscode-search-toggle-spacer" />
                <div className="file-tree-vscode-search-inputbox">
                  <input
                    type="text"
                    aria-label="替换为"
                    value={replaceQuery}
                    onChange={(e) => setReplaceQuery(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                        handleReplaceAll();
                      }
                    }}
                    placeholder={rootPath ? "替换" : "未选择工作区"}
                    className="file-tree-vscode-search-input is-replace-input"
                  />
                </div>
                <button
                  type="button"
                  className="file-tree-vscode-search-command"
                  aria-label="全部替换"
                  title={
                    searchIsStale ? "搜索条件已变更，请先重新搜索" : "全部替换"
                  }
                  disabled={replaceUnavailable}
                  onClick={handleReplaceAll}
                >
                  <Replace className="size-3.5" />
                </button>
              </div>
            )}
            {searchIsStale && (
              <div className="file-tree-vscode-search-state py-1 text-left">
                搜索条件已变更，请重新搜索后替换。
              </div>
            )}
            <div className="file-tree-vscode-search-row file-tree-vscode-search-pattern-row">
              <span className="file-tree-vscode-search-toggle-spacer" />
              <input
                type="text"
                value={includePattern}
                onChange={(event) => setIncludePattern(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    void handleSearch();
                  }
                }}
                placeholder={rootPath ? "要包含的文件" : "未选择工作区"}
                aria-label="要包含的文件"
                className="file-tree-vscode-search-input is-pattern-input"
              />
            </div>
            <div className="file-tree-vscode-search-row file-tree-vscode-search-pattern-row">
              <span className="file-tree-vscode-search-toggle-spacer" />
              <input
                type="text"
                value={excludePattern}
                onChange={(event) => setExcludePattern(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    void handleSearch();
                  }
                }}
                placeholder={rootPath ? "要排除的文件" : "未选择工作区"}
                aria-label="要排除的文件"
                className="file-tree-vscode-search-input is-pattern-input"
              />
            </div>
          </div>

          <div className="file-tree-vscode-search-results">
            {searching && (
              <div className="file-tree-vscode-search-state">搜索中...</div>
            )}

            {!searching && !rootPath && (
              <div className="file-tree-vscode-search-state">未选择工作区</div>
            )}

            {!searching && rootPath && results.length === 0 && searchQuery && (
              <div className="file-tree-vscode-search-state">未找到结果</div>
            )}

            {!searching && rootPath && results.length === 0 && !searchQuery && (
              <div className="file-tree-vscode-search-state">在文件中搜索</div>
            )}

            {!searching && results.length > 0 && (
              <>
                <div className="file-tree-vscode-search-summary">
                  {results.length} 个文件中有 {totalMatches} 个结果
                </div>
                {results.map((result) => {
                  const isExpanded = expandedFiles.has(result.path);
                  const { fileName, folderPath } = getSearchPathParts(
                    result.path,
                    rootPath
                  );

                  return (
                    <div
                      key={result.path}
                      className="file-tree-vscode-search-result-file"
                    >
                      <div className="file-tree-vscode-search-file-row">
                        <button
                          type="button"
                          onClick={() => toggleFileExpanded(result.path)}
                          className="file-tree-vscode-search-file-main"
                          aria-expanded={isExpanded}
                        >
                          {isExpanded ? (
                            <ChevronDown className="size-3.5 shrink-0" />
                          ) : (
                            <ChevronRight className="size-3.5 shrink-0" />
                          )}
                          <FileText className="size-3.5 shrink-0" />
                          <span className="file-tree-vscode-search-file-name">
                            {fileName}
                          </span>
                          {folderPath && (
                            <span className="file-tree-vscode-search-file-path">
                              {folderPath}
                            </span>
                          )}
                          <span className="file-tree-vscode-search-file-count">
                            {result.matches.length}
                          </span>
                        </button>
                        {showReplace && (
                          <button
                            type="button"
                            className="file-tree-vscode-search-replace-file"
                            aria-label={`替换 ${fileName}`}
                            title={
                              searchIsStale
                                ? "搜索条件已变更，请先重新搜索"
                                : "替换此文件"
                            }
                            disabled={replaceUnavailable}
                            onClick={() => handleReplaceInFile(result.path)}
                          >
                            <Replace className="size-3" />
                          </button>
                        )}
                      </div>

                      {isExpanded && (
                        <div className="file-tree-vscode-search-matches">
                          {result.matches.map((match) => (
                            <button
                              key={`${result.path}:${match.line}:${match.matchStart}:${match.matchEnd}:${match.text}`}
                              type="button"
                              onClick={() =>
                                handleResultClick(result.path, match.line)
                              }
                              className="file-tree-vscode-search-match-row"
                            >
                              <span className="file-tree-vscode-search-match-line">
                                {match.line}
                              </span>
                              <span className="file-tree-vscode-search-match-text">
                                {match.text.substring(0, match.matchStart)}
                                <span className="file-tree-vscode-search-match-hit">
                                  {match.text.substring(
                                    match.matchStart,
                                    match.matchEnd
                                  )}
                                </span>
                                {match.text.substring(match.matchEnd)}
                              </span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </>
            )}
          </div>
        </div>
        {replaceConfirmDialog}
      </>
    );
  }

  return (
    <>
      <div className={cn("flex h-full flex-col bg-background", className)}>
        {/* Search header */}
        <div className="flex flex-col gap-2 border-b border-border/50 p-3">
          <div className="flex items-center gap-2">
            <div className="flex-1">
              <Input
                placeholder={rootPath ? "搜索内容..." : "未选择工作区"}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    void handleSearch();
                  }
                }}
                className="h-8"
              />
            </div>
            <Button
              size="sm"
              onClick={handleSearch}
              disabled={!rootPath || !searchQuery.trim() || searching}
              className="h-8"
            >
              <Search className="size-3.5" />
            </Button>
            {onClose && (
              <Button
                size="sm"
                variant="ghost"
                onClick={onClose}
                className="h-8"
              >
                <X className="size-3.5" />
              </Button>
            )}
          </div>

          {showReplace && (
            <div className="flex items-center gap-2">
              <div className="flex-1">
                <Input
                  placeholder={rootPath ? "替换为..." : "未选择工作区"}
                  value={replaceQuery}
                  onChange={(e) => setReplaceQuery(e.target.value)}
                  className="h-8"
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && e.ctrlKey) {
                      handleReplaceAll();
                    }
                  }}
                />
              </div>
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-8"
                      onClick={handleReplaceSelected}
                      disabled={replaceUnavailable || selectedFiles.size === 0}
                    >
                      <Replace className="size-3.5" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>替换选中的文件</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      size="sm"
                      variant="default"
                      className="h-8"
                      onClick={handleReplaceAll}
                      disabled={replaceUnavailable}
                    >
                      全部替换
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>替换所有文件 (Ctrl+Enter)</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>
          )}

          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <Checkbox
                id="case-sensitive"
                checked={caseSensitive}
                onCheckedChange={(checked) => setCaseSensitive(!!checked)}
              />
              <Label
                htmlFor="case-sensitive"
                className="text-xs cursor-pointer"
              >
                区分大小写
              </Label>
            </div>
            <div className="flex items-center gap-2">
              <Checkbox
                id="match-whole-word"
                checked={matchWholeWord}
                onCheckedChange={(checked) => setMatchWholeWord(!!checked)}
              />
              <Label
                htmlFor="match-whole-word"
                className="text-xs cursor-pointer"
              >
                整词匹配
              </Label>
            </div>
            <div className="flex items-center gap-2">
              <Checkbox
                id="use-regex"
                checked={useRegex}
                onCheckedChange={(checked) => setUseRegex(!!checked)}
              />
              <Label htmlFor="use-regex" className="text-xs cursor-pointer">
                正则表达式
              </Label>
            </div>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setShowReplace(!showReplace)}
              className="h-6 text-xs"
            >
              {showReplace ? "隐藏替换" : "显示替换"}
            </Button>
          </div>
        </div>
        {searchIsStale && (
          <div className="border-b border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            搜索条件已变更，请重新搜索后替换。
          </div>
        )}
        {showReplace && results.length > 0 && (
          <div className="flex min-h-9 items-center gap-2 border-b border-border/50 bg-muted/20 px-3 text-xs text-muted-foreground">
            <Checkbox
              aria-label="选择全部搜索结果文件"
              checked={
                selectedFiles.size === results.length
                  ? true
                  : selectedFiles.size > 0
                  ? "indeterminate"
                  : false
              }
              onCheckedChange={(checked) => toggleAllSelected(checked === true)}
            />
            <span className="min-w-0 flex-1 truncate">
              已选 {selectedFiles.size} 个文件，{selectedMatchCount} 处匹配
            </span>
            {selectedFiles.size > 0 && (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-7 px-2 text-xs"
                onClick={() => toggleAllSelected(false)}
              >
                清空
              </Button>
            )}
          </div>
        )}

        {/* Search results */}
        <div className="flex-1 overflow-y-auto">
          {searching && (
            <div className="flex items-center justify-center p-5 text-muted-foreground">
              <span>搜索中...</span>
            </div>
          )}

          {!searching && !rootPath && (
            <div className="flex items-center justify-center p-5 text-muted-foreground">
              <span>未选择工作区</span>
            </div>
          )}

          {!searching && rootPath && results.length === 0 && searchQuery && (
            <div className="flex items-center justify-center p-5 text-muted-foreground">
              <span>未找到结果</span>
            </div>
          )}

          {!searching && rootPath && results.length === 0 && !searchQuery && (
            <div className="flex items-center justify-center p-5 text-muted-foreground">
              <span>输入搜索内容开始搜索</span>
            </div>
          )}

          {!searching && results.length > 0 && (
            <div className="divide-y divide-border/50">
              {results.map((result) => {
                const isExpanded = expandedFiles.has(result.path);
                const isSelected = selectedFiles.has(result.path);
                const relativePath = getWorkspaceRelativePath(
                  rootPath,
                  result.path
                );
                return (
                  <div key={result.path} className="border-b border-border/30">
                    <div className="flex items-center gap-2 px-3 py-2 hover:bg-muted/50 transition-colors">
                      {showReplace && (
                        <Checkbox
                          checked={isSelected}
                          onCheckedChange={(checked) => {
                            setSelectedFiles((prev) => {
                              const next = new Set(prev);
                              if (checked) {
                                next.add(result.path);
                              } else {
                                next.delete(result.path);
                              }
                              return next;
                            });
                          }}
                        />
                      )}
                      <button
                        type="button"
                        onClick={() => toggleFileExpanded(result.path)}
                        className="flex flex-1 items-center gap-2 text-left"
                      >
                        {isExpanded ? (
                          <ChevronDown className="size-3.5 shrink-0" />
                        ) : (
                          <ChevronRight className="size-3.5 shrink-0" />
                        )}
                        <FileText className="size-3.5 shrink-0 text-muted-foreground" />
                        <span
                          className="flex-1 truncate text-sm"
                          title={relativePath}
                        >
                          {relativePath}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {result.matches.length} 个匹配
                        </span>
                      </button>
                      {showReplace && (
                        <TooltipProvider>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-6 px-2"
                                onClick={() => handleReplaceInFile(result.path)}
                                disabled={replaceUnavailable}
                              >
                                <Replace className="size-3 mr-1" />
                                <span className="text-xs">替换</span>
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>
                              <p>替换此文件中的所有匹配</p>
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      )}
                    </div>

                    {isExpanded && (
                      <div className="bg-muted/20">
                        {result.matches.map((match) => (
                          <button
                            key={`${result.path}:${match.line}:${match.matchStart}:${match.matchEnd}:${match.text}`}
                            type="button"
                            onClick={() =>
                              handleResultClick(result.path, match.line)
                            }
                            className="flex w-full items-start gap-2 px-5 py-1.5 text-left transition-colors hover:bg-muted/50"
                          >
                            <span className="text-xs text-muted-foreground w-12 shrink-0 text-right">
                              {match.line}
                            </span>
                            <span className="flex-1 text-xs font-mono">
                              {match.text.substring(0, match.matchStart)}
                              <span className="bg-yellow-500/30 text-foreground">
                                {match.text.substring(
                                  match.matchStart,
                                  match.matchEnd
                                )}
                              </span>
                              {match.text.substring(match.matchEnd)}
                            </span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
      {replaceConfirmDialog}
    </>
  );
}
