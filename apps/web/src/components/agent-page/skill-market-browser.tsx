/**
 * Shared SkillMarketBrowser component for browsing and installing skills from the backend marketplace.
 */

import { useReactive } from "ahooks";
import { Download, Loader2, RefreshCw, Search, Star, Wrench, Zap } from "lucide-react";
import { memo, useCallback, useEffect, useMemo, useRef } from "react";
import { Virtuoso } from "react-virtuoso";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { createTimeoutSignal } from "@/lib/abort-signal";
import { apiRawFetch, getApiBaseUrl } from "@/lib/api/client";
import { type MarketplacePackage, marketplaceApi, type SearchMarketplaceParams } from "@/lib/api/marketplace";
import { installSkillPackage, normalizeSkillInstallName } from "@/lib/skill-package-import";
import { cn } from "@/lib/utils";
import { workspaceApi } from "@/lib/workspace-api";
import { joinWorkspacePath } from "@/lib/workspace-path";
import { getSharedSkillsPath } from "@/lib/workspace-utils";
import {
  formatSkillMarketErrorMessage,
  INITIAL_SKILL_MARKET_SEARCH_STATE,
  resolveSkillMarketEmptyState,
} from "./skill-market-browser-state";

const MARKET_PAGE_SIZE = 24;
const SEARCH_DEBOUNCE_MS = 400;

export interface CommunitySkill {
  id: string;
  name: string;
  description: string;
  tags?: string[];
  author?: string;
  packageId: string;
  rawUrl?: string;
  slug?: string;
  version?: string;
  downloads?: number;
  installs?: number;
  category?: string;
  rating?: number;
}

interface CommunitySkillSearchResult {
  skills: CommunitySkill[];
  total: number;
}

const SORT_MAP = {
  downloads: "downloads",
  stars: "stars",
  rating: "rating",
  recent: "recent",
} satisfies Record<string, NonNullable<SearchMarketplaceParams["sort"]>>;

function backendSort(sort: string): NonNullable<SearchMarketplaceParams["sort"]> {
  return Object.hasOwn(SORT_MAP, sort) ? SORT_MAP[sort as keyof typeof SORT_MAP] : "downloads";
}

function installSlugFromPackageId(packageId: string) {
  const lastSegment = packageId.split("/").filter(Boolean).pop() || packageId;
  return lastSegment
    .replace(/[:?#\\]/g, "-")
    .replace(/\.zip$/i, "")
    .trim();
}

function installNameForSkill(skill: CommunitySkill) {
  return normalizeSkillInstallName(skill.slug || skill.name || skill.packageId);
}

function toCommunitySkill(pkg: MarketplacePackage): CommunitySkill {
  const profile = pkg.catalogProfile;
  const downloads = profile?.downloadCount ?? pkg.downloadCount;
  return {
    id: pkg.id,
    packageId: pkg.id,
    name: profile?.displayName || pkg.name || pkg.id,
    description: profile?.summary || pkg.description || "",
    tags: profile?.tags ?? [],
    author: profile?.ownerDisplayName || pkg.publisher,
    slug: installSlugFromPackageId(pkg.id),
    version: pkg.version,
    downloads,
    installs: profile?.usageCount,
    category: profile?.scenario || profile?.level || profile?.skill?.runtime,
    rating: profile?.rating,
    rawUrl: pkg.downloadUrl,
  };
}

export async function fetchCommunitySkills(
  query: string,
  page = 1,
  pageSize = 24,
  sort = "downloads",
): Promise<CommunitySkillSearchResult> {
  const result = await marketplaceApi.searchPage({
    page,
    limit: pageSize,
    keyword: query.trim() || undefined,
    type: "skill",
    sort: backendSort(sort),
  });
  return {
    total: result.total,
    skills: result.items.map(toCommunitySkill),
  };
}

async function fetchSkillPackageContent(skill: CommunitySkill): Promise<string | ArrayBuffer> {
  const downloadUrl = (await marketplaceApi.download(skill.packageId)).downloadUrl || skill.rawUrl;
  if (!downloadUrl) {
    throw new Error("后端未返回可下载的技能制品地址");
  }
  if (/^zip:\/\//i.test(downloadUrl)) {
    throw new Error("后端返回的是制品引用而不是下载地址，请确认技能 ZIP 制品已上传并可下载");
  }

  const res = await apiRawFetch(downloadUrl, {
    signal: createTimeoutSignal(15000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  const contentType = res.headers.get("content-type") || "";
  if (contentType.includes("text/") || contentType.includes("markdown") || contentType.includes("json")) {
    return res.text();
  }
  return res.arrayBuffer();
}

async function loadInstalledSkillNames(skillsPath?: string | null): Promise<Set<string>> {
  const targetPath = skillsPath || (await getSharedSkillsPath());
  const names = new Set<string>();
  try {
    const entries = await workspaceApi.readDir(targetPath);
    for (const entry of entries) {
      const entryName = entry.name?.trim();
      if (!entryName) continue;
      names.add(entryName.replace(/\.md$/i, ""));
    }
  } catch {
    return names;
  }
  return names;
}

export interface SkillMarketBrowserProps {
  /** Called when a skill is successfully installed */
  onInstalled?: () => void;
  /** Target directory. Defaults to the system shared skill directory for standalone marketplace pages. */
  installPath?: string | null;
  /** Human-readable target label used by messages. */
  installLabel?: string;
  /** Custom class for the container */
  className?: string;
}

type SkillMarketBrowserChrome = "default" | "admin";

const SKILL_MARKET_CHROME = {
  default: {
    root: "flex flex-col h-full",
    header: "px-4 pt-3 pb-0 shrink-0",
    title: "text-sm font-bold",
    description: "text-[11px] text-muted-foreground mt-0.5",
    toolbar: "px-4 py-2.5 flex items-center gap-3 shrink-0",
    tabs: "flex-1",
    tabsList: "h-9",
    search: "relative w-64",
    searchInput: "pl-9 h-9",
    list: "flex min-h-0 flex-1 flex-col px-4 pb-4",
    listMeta: "flex items-center justify-between text-xs text-muted-foreground mb-3",
    card: "mb-2.5 flex items-start gap-3 rounded-lg border bg-white p-3 transition-colors hover:border-primary/40 hover:shadow-[var(--shadow-standard)]",
    icon: "flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10",
    emptyIcon: "mb-3 flex size-12 items-center justify-center rounded-[10px] bg-muted/40",
  },
  admin: {
    root: "flex h-full flex-col bg-white",
    header: "shrink-0 border-b border-border-light px-4 py-3",
    title: "text-sm font-semibold text-foreground",
    description: "mt-0.5 text-[11px] text-muted-foreground",
    toolbar:
      "flex shrink-0 flex-col gap-3 border-b border-border-light bg-[#fafafa] px-4 py-3 lg:flex-row lg:items-center",
    tabs: "flex-1",
    tabsList: "h-8 rounded-[4px] border border-border bg-white",
    search: "relative w-full lg:w-64",
    searchInput: "h-8 rounded-[4px] border-border bg-white pl-9 text-xs",
    list: "flex min-h-0 flex-1 flex-col px-4 py-4",
    listMeta: "mb-3 flex items-center justify-between text-xs text-muted-foreground",
    card: "mb-3 flex items-start gap-3 rounded-[4px] border border-border-light bg-white p-4 transition-colors hover:bg-[#fafafa]",
    icon: "flex size-9 shrink-0 items-center justify-center rounded-[4px] bg-primary/10",
    emptyIcon: "mb-4 flex size-14 items-center justify-center rounded-[4px] border border-border-light bg-[#fafafa]",
  },
} satisfies Record<SkillMarketBrowserChrome, Record<string, string>>;

type SkillMarketChromeStyles = (typeof SKILL_MARKET_CHROME)[SkillMarketBrowserChrome];

interface SkillMarketCardProps {
  skill: CommunitySkill;
  styles: SkillMarketChromeStyles;
  alreadyInstalled: boolean;
  installing: boolean;
  onInstall: (skill: CommunitySkill) => void;
}

const SkillMarketCard = memo(function SkillMarketCard({
  skill,
  styles,
  alreadyInstalled,
  installing,
  onInstall,
}: SkillMarketCardProps) {
  const handleInstallClick = useCallback(() => {
    onInstall(skill);
  }, [onInstall, skill]);

  return (
    <div className={styles.card}>
      <div className={styles.icon}>
        <Wrench className="size-4 text-primary" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="mb-1 flex flex-wrap items-center gap-1.5">
          <div className="text-sm font-medium">{skill.name}</div>
          {skill.category && (
            <Badge variant="secondary" className="text-[10px]">
              {skill.category}
            </Badge>
          )}
          {skill.version && (
            <Badge variant="outline" className="text-[10px]">
              v{skill.version}
            </Badge>
          )}
          {alreadyInstalled && (
            <Badge className="bg-emerald-600 text-[10px] text-white hover:bg-emerald-600">已安装</Badge>
          )}
        </div>
        <div className="mb-1 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
          {skill.author && <span>作者 {skill.author}</span>}
          {typeof skill.downloads === "number" && <span>下载 {skill.downloads}</span>}
          {typeof skill.installs === "number" && <span>安装 {skill.installs}</span>}
          {typeof skill.rating === "number" && (
            <span className="inline-flex items-center gap-1">
              <Star className="size-3 fill-amber-400 text-amber-400" />
              {skill.rating}
            </span>
          )}
        </div>
        <p className="line-clamp-2 text-xs text-muted-foreground">{skill.description}</p>
        {skill.tags?.length ? (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {skill.tags.slice(0, 4).map((tag) => (
              <Badge key={`${skill.id}-${tag}`} variant="outline" className="text-[10px]">
                {tag}
              </Badge>
            ))}
          </div>
        ) : null}
      </div>
      <div className="flex shrink-0 flex-col gap-2">
        <Button
          size="sm"
          variant={alreadyInstalled ? "secondary" : "outline"}
          disabled={alreadyInstalled || installing}
          onClick={handleInstallClick}
        >
          {installing ? <Loader2 className="mr-1.5 size-3.5 animate-spin" /> : <Download className="mr-1.5 size-3.5" />}
          {alreadyInstalled ? "已安装" : "安装"}
        </Button>
      </div>
    </div>
  );
});

function SkillMarketListFooter({ loadingMore, hasItems }: { loadingMore: boolean; hasItems: boolean }) {
  if (loadingMore) {
    return (
      <div className="flex items-center justify-center py-4 text-xs text-muted-foreground">
        <Loader2 className="mr-2 size-4 animate-spin" />
        正在加载更多技能...
      </div>
    );
  }
  return hasItems ? <div className="py-4 text-center text-xs text-muted-foreground">已加载全部技能</div> : null;
}

function SkillMarketEmptyState({
  styles,
  apiAvailable,
  hasQuery,
  onRetry,
  retrying,
  errorMessage,
}: {
  styles: SkillMarketChromeStyles;
  apiAvailable: boolean | null;
  hasQuery: boolean;
  onRetry: () => void;
  retrying: boolean;
  errorMessage?: string | null;
}) {
  const content = resolveSkillMarketEmptyState(apiAvailable, hasQuery, errorMessage);

  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-4 py-20 text-center">
      <div className={styles.emptyIcon}>
        <Zap className="size-7 opacity-25" />
      </div>
      <p className="mb-1 text-sm font-medium">{content.title}</p>
      <p className="max-w-md text-xs leading-5 text-muted-foreground">{content.description}</p>
      {content.retryLabel ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="mt-4"
          onClick={onRetry}
          disabled={retrying}
          aria-label={content.retryAriaLabel}
        >
          {retrying ? <Loader2 className="mr-1.5 size-3.5 animate-spin" /> : <RefreshCw className="mr-1.5 size-3.5" />}
          {content.retryLabel}
        </Button>
      ) : null}
    </div>
  );
}

function SkillMarketBrowserBase({
  onInstalled,
  installPath,
  installLabel = "共享技能",
  className,
  chrome,
}: SkillMarketBrowserProps & { chrome: SkillMarketBrowserChrome }) {
  const styles = SKILL_MARKET_CHROME[chrome];
  const state = useReactive({
    query: "",
    skills: [] as CommunitySkill[],
    totalSkills: 0,
    page: 1,
    loading: INITIAL_SKILL_MARKET_SEARCH_STATE.loading,
    loadingMore: false,
    installingSkillId: null as string | null,
    installedSkillNames: new Set<string>(),
    apiAvailable: INITIAL_SKILL_MARKET_SEARCH_STATE.apiAvailable,
    searchError: INITIAL_SKILL_MARKET_SEARCH_STATE.searchError,
    sortBy: "downloads",
  });
  const installTargetLabel = installLabel || "技能目录";
  const searchRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchRequestSeqRef = useRef(0);

  const refreshInstalledSkills = useCallback(async () => {
    state.installedSkillNames = await loadInstalledSkillNames(installPath);
  }, [installPath, state]);

  const doSearch = useCallback(
    async (q: string, nextPage = 1, append = false, sort = state.sortBy) => {
      const requestSeq = searchRequestSeqRef.current + 1;
      searchRequestSeqRef.current = requestSeq;
      if (append) {
        state.loadingMore = true;
      } else {
        state.loading = true;
        state.loadingMore = false;
      }
      console.info("[skill-market] search", { baseUrl: getApiBaseUrl(), query: q, page: nextPage, sort });
      try {
        const result = await fetchCommunitySkills(q, nextPage, MARKET_PAGE_SIZE, sort);
        if (searchRequestSeqRef.current !== requestSeq) return;
        state.apiAvailable = true;
        state.searchError = null;
        if (!append) {
          state.skills = result.skills;
        } else {
          const existingIds = new Set(state.skills.map((skill) => skill.id));
          state.skills = [...state.skills, ...result.skills.filter((skill) => !existingIds.has(skill.id))];
        }
        state.totalSkills = result.total;
        state.page = nextPage;
      } catch (error) {
        if (searchRequestSeqRef.current !== requestSeq) return;
        state.apiAvailable = false;
        state.searchError = formatSkillMarketErrorMessage(error);
        if (!append) {
          state.skills = [];
          state.totalSkills = 0;
        }
        console.error("[skill-market] search failed", { baseUrl: getApiBaseUrl(), query: q, error });
      } finally {
        if (searchRequestSeqRef.current === requestSeq) {
          state.loading = false;
          state.loadingMore = false;
        }
      }
    },
    [state],
  );

  useEffect(() => {
    void doSearch("");
  }, [doSearch]);

  useEffect(() => {
    void refreshInstalledSkills();
  }, [refreshInstalledSkills]);

  useEffect(() => {
    return () => {
      if (searchRef.current) clearTimeout(searchRef.current);
    };
  }, []);

  const handleQueryChange = (value: string) => {
    state.query = value;
    if (searchRef.current) clearTimeout(searchRef.current);
    searchRef.current = setTimeout(() => void doSearch(value, 1, false), SEARCH_DEBOUNCE_MS);
  };

  const totalPages = Math.max(1, Math.ceil(state.totalSkills / MARKET_PAGE_SIZE));

  // Refs to avoid scroll handler recreation on every skill append
  const loadingRef = useRef(state.loading);
  const loadingMoreRef = useRef(state.loadingMore);
  const hasMoreRef = useRef(state.page < totalPages);
  const pageRef = useRef(state.page);
  const queryRef = useRef(state.query);

  // Keep refs in sync with state (reads latest on every render)
  loadingRef.current = state.loading;
  loadingMoreRef.current = state.loadingMore;
  pageRef.current = state.page;
  queryRef.current = state.query;
  hasMoreRef.current = state.page < totalPages;

  const handleInstall = useCallback(
    async (skill: CommunitySkill) => {
      const installName = installNameForSkill(skill);
      if (!installName) {
        toast.error("技能名称无效");
        return;
      }
      if (state.installedSkillNames.has(installName)) {
        toast.error(`技能 "${skill.name}" 已安装到${installTargetLabel}`);
        return;
      }

      state.installingSkillId = skill.id;
      try {
        const skillsPath = (installPath || (await getSharedSkillsPath())).trim();
        if (!skillsPath) {
          throw new Error(`${installTargetLabel}路径不可用`);
        }
        await workspaceApi.mkdir(skillsPath);

        const mdPath = joinWorkspacePath(skillsPath, `${installName}.md`);
        const dirPath = joinWorkspacePath(skillsPath, installName);
        const [mdExists, dirExists] = await Promise.all([
          workspaceApi.fileExists(mdPath),
          workspaceApi.fileExists(dirPath),
        ]);
        if (mdExists || dirExists) {
          toast.error(`技能 "${skill.name}" 已安装到${installTargetLabel}`);
          await refreshInstalledSkills();
          return;
        }

        const content = await fetchSkillPackageContent(skill);
        const installed = await installSkillPackage(skillsPath, installName, content);
        if (!(await workspaceApi.fileExists(installed.targetPath).catch(() => false))) {
          throw new Error(`安装结果不存在：${installed.targetPath}`);
        }
        toast.success(`技能 "${skill.name}" 已安装到${installTargetLabel}`);
        await refreshInstalledSkills();
        onInstalled?.();
      } catch (error) {
        toast.error(`安装失败: ${error instanceof Error ? error.message : "未知错误"}`);
      } finally {
        state.installingSkillId = null;
      }
    },
    [installPath, installTargetLabel, state, refreshInstalledSkills, onInstalled],
  );

  const handleSortChange = useCallback(
    (value: string) => {
      if (searchRef.current) clearTimeout(searchRef.current);
      state.sortBy = value;
      void doSearch(state.query, 1, false, value);
    },
    [doSearch, state],
  );

  const handleEndReached = useCallback(() => {
    if (!loadingRef.current && !loadingMoreRef.current && hasMoreRef.current) {
      void doSearch(queryRef.current, pageRef.current + 1, true);
    }
  }, [doSearch]);

  const handleRetry = useCallback(() => {
    if (searchRef.current) clearTimeout(searchRef.current);
    void doSearch(state.query, 1, false, state.sortBy);
  }, [doSearch, state]);

  const hasMarketQuery = state.query.trim().length > 0;
  const renderSkillItem = useCallback(
    (index: number) => {
      const skill = state.skills[index];
      const installName = installNameForSkill(skill);
      return (
        <SkillMarketCard
          skill={skill}
          styles={styles}
          alreadyInstalled={state.installedSkillNames.has(installName)}
          installing={state.installingSkillId === skill.id}
          onInstall={handleInstall}
        />
      );
    },
    [handleInstall, state.installedSkillNames, state.installingSkillId, state.skills, styles],
  );

  const virtuosoComponents = useMemo(
    () => ({
      Footer: () => <SkillMarketListFooter loadingMore={state.loadingMore} hasItems={state.skills.length > 0} />,
    }),
    [state.loadingMore, state.skills.length],
  );

  const sortOptions = useMemo(
    () => [
      { value: "downloads", label: "最多下载" },
      { value: "stars", label: "最多收藏" },
      { value: "rating", label: "最高评分" },
      { value: "recent", label: "最新上架" },
    ],
    [],
  );

  return (
    <div className={cn(styles.root, className)}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>技能市场</h1>
          <p className={styles.description}>发现技能并安装到{installTargetLabel}</p>
        </div>
      </div>

      <div className={styles.toolbar}>
        <Select value={state.sortBy} onValueChange={handleSortChange}>
          <SelectTrigger className="h-9 w-full text-xs sm:w-44" aria-label="技能排序">
            <span className="mr-1 text-muted-foreground">排序:</span>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {sortOptions.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <div className={styles.search}>
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="搜索..."
            value={state.query}
            onChange={(e) => handleQueryChange(e.target.value)}
            className={styles.searchInput}
          />
        </div>
      </div>

      {/* Scrollable list container */}
      <div className={styles.list}>
        {state.loading ? (
          <div className="flex min-h-0 flex-1 items-center justify-center py-16">
            <Loader2 className="size-5 animate-spin text-muted-foreground" />
          </div>
        ) : state.skills.length > 0 ? (
          <>
            <div className={styles.listMeta}>
              <span>共 {state.totalSkills} 个技能</span>
              <span>已加载 {state.skills.length} 个</span>
            </div>
            <div className="min-h-0 flex-1">
              <Virtuoso
                style={{ height: "100%" }}
                totalCount={state.skills.length}
                itemContent={renderSkillItem}
                endReached={handleEndReached}
                components={virtuosoComponents}
              />
            </div>
          </>
        ) : (
          <SkillMarketEmptyState
            styles={styles}
            apiAvailable={state.apiAvailable}
            hasQuery={hasMarketQuery}
            onRetry={handleRetry}
            retrying={state.loading}
            errorMessage={state.searchError}
          />
        )}
      </div>
    </div>
  );
}

export function SkillMarketBrowser(props: SkillMarketBrowserProps) {
  return <SkillMarketBrowserBase {...props} chrome="default" />;
}

export function AdminSkillMarketBrowser(props: SkillMarketBrowserProps) {
  return <SkillMarketBrowserBase {...props} chrome="admin" />;
}
