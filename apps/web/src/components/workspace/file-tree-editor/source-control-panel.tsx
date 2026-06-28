import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Copy,
  FileWarning,
  GitBranch,
  GitCommit,
  Loader2,
  Plus,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import { toast } from "sonner";

import { assetsApi, type Branch } from "@/lib/api/assets";
import {
  buildAssetWorkspaceRoot,
  parseAssetWorkspacePath,
} from "@/lib/asset-workspace-path";
import { writeClipboardText } from "@/lib/clipboard";
import { cn } from "@/lib/utils";
import type { GitStatusResult } from "@/lib/workspace-api";
import {
  getWorkspaceRelativePath,
  joinWorkspacePath,
} from "@/lib/workspace-path";

type SourceControlChange = {
  id: string;
  path: string;
  displayPath: string;
  status: string;
  staged: boolean;
  dirty: boolean;
};

export interface SourceControlPanelProps {
  rootPath: string | null;
  gitStatus: GitStatusResult | null;
  gitStatusLoading: boolean;
  gitStatusError: string | null;
  dirtyPaths: Set<string>;
  readOnly: boolean;
  onRefresh: () => void;
  onOpenFile: (path: string) => void;
}

const STATUS_LABELS: Record<string, string> = {
  A: "新增",
  AD: "新增",
  AM: "新增",
  C: "复制",
  D: "删除",
  M: "修改",
  MD: "修改",
  MM: "修改",
  R: "重命名",
  T: "类型",
  U: "冲突",
  "??": "未跟踪",
};

function formatGitStatus(status: string) {
  const normalized = status.trim() || "M";
  return STATUS_LABELS[normalized] ?? normalized;
}

function formatBranchTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString(undefined, {
    month: "2-digit",
    day: "2-digit",
  });
}

function shortSha(value: string) {
  return value ? value.slice(0, 7) : "";
}

function resolveStatusPath(rootPath: string | null, path: string) {
  if (!rootPath) return path;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(path) || path.startsWith("/")) {
    return path;
  }
  return joinWorkspacePath(rootPath, path);
}

function getComparableRelativePath(rootPath: string | null, path: string) {
  return getWorkspaceRelativePath(rootPath, path).replace(/^\.\//, "");
}

function buildChangeItems(
  rootPath: string | null,
  gitStatus: GitStatusResult | null,
  dirtyPaths: Set<string>
): SourceControlChange[] {
  const changes = new Map<string, SourceControlChange>();

  for (const file of gitStatus?.files ?? []) {
    const fullPath = resolveStatusPath(rootPath, file.path);
    const displayPath = getComparableRelativePath(rootPath, fullPath);
    changes.set(displayPath, {
      id: `git:${displayPath}`,
      path: fullPath,
      displayPath,
      status: formatGitStatus(file.status),
      staged: file.staged,
      dirty: false,
    });
  }

  for (const dirtyPath of dirtyPaths) {
    const displayPath = getComparableRelativePath(rootPath, dirtyPath);
    const existing = changes.get(displayPath);
    if (existing) {
      changes.set(displayPath, {
        ...existing,
        dirty: true,
        status:
          existing.status === "未保存"
            ? existing.status
            : `${existing.status} · 未保存`,
      });
      continue;
    }
    changes.set(displayPath, {
      id: `dirty:${displayPath}`,
      path: dirtyPath,
      displayPath,
      status: "未保存",
      staged: false,
      dirty: true,
    });
  }

  return Array.from(changes.values()).sort((a, b) =>
    a.displayPath.localeCompare(b.displayPath)
  );
}

export function SourceControlPanel({
  rootPath,
  gitStatus,
  gitStatusLoading,
  gitStatusError,
  dirtyPaths,
  readOnly,
  onRefresh,
  onOpenFile,
}: SourceControlPanelProps) {
  const assetWorkspace = useMemo(
    () => parseAssetWorkspacePath(rootPath),
    [rootPath]
  );
  const currentBranch = gitStatus?.branch ?? assetWorkspace?.ref ?? "";
  const changes = useMemo(
    () => buildChangeItems(rootPath, gitStatus, dirtyPaths),
    [dirtyPaths, gitStatus, rootPath]
  );
  const [branches, setBranches] = useState<Branch[]>([]);
  const [branchesLoading, setBranchesLoading] = useState(false);
  const [branchesError, setBranchesError] = useState<string | null>(null);
  const [newBranchName, setNewBranchName] = useState("");
  const [creatingBranch, setCreatingBranch] = useState(false);
  const [branchReloadToken, setBranchReloadToken] = useState(0);

  useEffect(() => {
    if (!assetWorkspace) {
      setBranches([]);
      setBranchesError(null);
      setBranchesLoading(false);
      return;
    }

    let cancelled = false;
    setBranchesLoading(true);
    setBranchesError(null);
    assetsApi
      .listBranches(assetWorkspace.assetId, { page: 1, limit: 100 })
      .then((items) => {
        if (!cancelled) setBranches(items);
      })
      .catch((error) => {
        if (cancelled) return;
        const message = error instanceof Error ? error.message : "分支加载失败";
        setBranchesError(message);
      })
      .finally(() => {
        if (!cancelled) setBranchesLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [assetWorkspace?.assetId, branchReloadToken]);

  const activeBranch = useMemo(
    () => branches.find((branch) => branch.name === currentBranch) ?? null,
    [branches, currentBranch]
  );

  const copyBranchWorkspacePath = useCallback(
    async (branchName: string) => {
      if (!assetWorkspace) return;
      const path = buildAssetWorkspaceRoot(assetWorkspace.assetId, branchName);
      try {
        await writeClipboardText(path);
        toast.success("分支工作区路径已复制");
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "复制失败");
      }
    },
    [assetWorkspace]
  );

  const createBranch = useCallback(async () => {
    if (!assetWorkspace) return;
    const name = newBranchName.trim();
    if (!name) {
      toast.error("请输入分支名称");
      return;
    }
    if (branches.some((branch) => branch.name === name)) {
      toast.error("分支已存在");
      return;
    }
    const commitSha = activeBranch?.commitSha ?? branches[0]?.commitSha;
    if (!commitSha) {
      toast.error("缺少基准提交，无法创建分支");
      return;
    }

    setCreatingBranch(true);
    try {
      await assetsApi.createBranch(assetWorkspace.assetId, {
        name,
        commitSha,
      });
      setNewBranchName("");
      setBranchReloadToken((value) => value + 1);
      onRefresh();
      toast.success(`已创建分支 ${name}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "创建分支失败");
    } finally {
      setCreatingBranch(false);
    }
  }, [
    activeBranch?.commitSha,
    assetWorkspace,
    branches,
    newBranchName,
    onRefresh,
  ]);

  if (!rootPath) {
    return (
      <div className="file-tree-source-control-panel">
        <div className="file-tree-source-state">
          <GitBranch className="size-5" aria-hidden="true" />
          <p>未打开工作区</p>
        </div>
      </div>
    );
  }

  if (!gitStatusLoading && gitStatus && !gitStatus.isGitRepo) {
    return (
      <div className="file-tree-source-control-panel">
        <div className="file-tree-source-toolbar">
          <button
            type="button"
            className="file-tree-source-toolbar-button"
            onClick={onRefresh}
          >
            <RefreshCw className="size-3.5" aria-hidden="true" />
            刷新
          </button>
        </div>
        <div className="file-tree-source-state">
          <FileWarning className="size-5" aria-hidden="true" />
          <p>当前目录不是 Git 仓库</p>
        </div>
      </div>
    );
  }

  return (
    <div className="file-tree-source-control-panel">
      <div className="file-tree-source-toolbar">
        <div className="file-tree-source-branch" title={currentBranch || "-"}>
          <GitBranch className="size-3.5" aria-hidden="true" />
          <span>{currentBranch || "无分支"}</span>
        </div>
        <button
          type="button"
          className="file-tree-source-toolbar-button"
          onClick={onRefresh}
          disabled={gitStatusLoading}
        >
          {gitStatusLoading ? (
            <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
          ) : (
            <RefreshCw className="size-3.5" aria-hidden="true" />
          )}
          刷新
        </button>
      </div>

      {gitStatusError ? (
        <div className="file-tree-source-alert" role="alert">
          <AlertTriangle className="size-3.5" aria-hidden="true" />
          <span>{gitStatusError}</span>
        </div>
      ) : null}

      {dirtyPaths.size > 0 ? (
        <div className="file-tree-source-alert is-warning">
          <AlertTriangle className="size-3.5" aria-hidden="true" />
          <span>存在未保存文件，分支操作前建议先保存。</span>
        </div>
      ) : null}

      <section className="file-tree-source-section">
        <div className="file-tree-source-section-title">
          <span>变更</span>
          <span>{changes.length}</span>
        </div>
        {changes.length === 0 && !gitStatusLoading ? (
          <div className="file-tree-source-empty">工作区干净</div>
        ) : null}
        {changes.length > 0 ? (
          <div className="file-tree-source-change-list">
            {changes.map((change) => (
              <button
                key={change.id}
                type="button"
                className="file-tree-source-change"
                onClick={() => onOpenFile(change.path)}
                title={change.displayPath}
              >
                <span
                  className={cn(
                    "file-tree-source-change-status",
                    change.dirty && "is-dirty",
                    change.staged && "is-staged"
                  )}
                >
                  {change.staged ? "暂存" : change.status}
                </span>
                <span className="file-tree-source-change-path">
                  {change.displayPath}
                </span>
              </button>
            ))}
          </div>
        ) : null}
      </section>

      {assetWorkspace ? (
        <section className="file-tree-source-section">
          <div className="file-tree-source-section-title">
            <span>资产分支</span>
            <span>{branches.length}</span>
          </div>
          <div className="file-tree-source-branch-create">
            <input
              value={newBranchName}
              onChange={(event) => setNewBranchName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") void createBranch();
              }}
              placeholder="新分支名称"
              disabled={readOnly || creatingBranch}
              className="file-tree-source-input"
            />
            <button
              type="button"
              onClick={() => void createBranch()}
              disabled={readOnly || creatingBranch}
              className="file-tree-source-icon-button"
              aria-label="创建分支"
              title={readOnly ? "只读模式不能创建分支" : "创建分支"}
            >
              {creatingBranch ? (
                <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
              ) : (
                <Plus className="size-3.5" aria-hidden="true" />
              )}
            </button>
          </div>

          {branchesError ? (
            <div className="file-tree-source-empty is-error">
              {branchesError}
            </div>
          ) : null}
          {branchesLoading ? (
            <div className="file-tree-source-empty">
              <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
              加载分支...
            </div>
          ) : null}
          {!branchesLoading && branches.length > 0 ? (
            <div className="file-tree-source-branch-list">
              {branches.map((branch) => {
                const active = branch.name === currentBranch;
                return (
                  <div
                    key={branch.id}
                    className={cn(
                      "file-tree-source-branch-row",
                      active && "is-active"
                    )}
                  >
                    <div className="file-tree-source-branch-main">
                      <GitBranch className="size-3.5" aria-hidden="true" />
                      <span className="file-tree-source-branch-name">
                        {branch.name}
                      </span>
                      {branch.isProtected ? (
                        <ShieldCheck
                          className="size-3.5"
                          aria-label="受保护分支"
                        />
                      ) : null}
                    </div>
                    <div className="file-tree-source-branch-meta">
                      <GitCommit className="size-3" aria-hidden="true" />
                      <span>{shortSha(branch.commitSha)}</span>
                      <span>{formatBranchTime(branch.createdAt)}</span>
                    </div>
                    <button
                      type="button"
                      className="file-tree-source-icon-button"
                      onClick={() => void copyBranchWorkspacePath(branch.name)}
                      aria-label={`复制 ${branch.name} 分支工作区路径`}
                      title="复制分支工作区路径"
                    >
                      <Copy className="size-3.5" aria-hidden="true" />
                    </button>
                  </div>
                );
              })}
            </div>
          ) : null}
        </section>
      ) : (
        <section className="file-tree-source-section">
          <div className="file-tree-source-section-title">
            <span>分支</span>
          </div>
          <div className="file-tree-source-empty">
            本地分支切换需要后端工作区 Git 操作接口接入后开放。
          </div>
        </section>
      )}
    </div>
  );
}
