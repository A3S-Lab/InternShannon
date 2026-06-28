/**
 * ReadonlyFileTree - A read-only file tree for non-editing contexts
 */
import { useReactive } from "ahooks";
import { useEffect, useId, type KeyboardEvent, type MouseEvent } from "react";
import { AlertCircle, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { type FsNode, fetchTree } from "./FileTreeEditor";
import { FileIcon, FolderIcon } from "./file-icons";

export interface ReadonlyFileTreeProps {
  rootPath: string;
  activeFile?: string | null;
  onSelect: (path: string) => void;
}

function ReadonlyTreeNode({
  node,
  depth,
  activeFile,
  onSelect,
}: {
  node: FsNode;
  depth: number;
  activeFile: string | null;
  onSelect: (path: string) => void;
}) {
  const state = useReactive({
    open: depth < 1,
    children: null as FsNode[] | null,
    childLoading: false,
    childError: null as string | null,
  });
  const groupId = useId();

  useEffect(() => {
    if (!node.is_dir || state.children !== null) return;
    state.childLoading = true;
    state.childError = null;
    fetchTree(node.path, 1)
      .then((t) => {
        state.children = t.children ?? null;
      })
      .catch(() => {
        state.children = [];
        state.childError = "无法加载目录";
      })
      .finally(() => {
        state.childLoading = false;
      });
  }, [node.is_dir, node.path, state, depth]);

  const activateNode = () => {
    if (!node.is_dir) {
      onSelect(node.path);
      return;
    }
    state.open = !state.open;
  };

  const handleClick = (e: MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    activateNode();
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      activateNode();
      return;
    }
    if (!node.is_dir) {
      return;
    }
    if (e.key === "ArrowRight" && !state.open) {
      e.preventDefault();
      state.open = true;
    }
    if (e.key === "ArrowLeft" && state.open) {
      e.preventDefault();
      state.open = false;
    }
  };

  const isActive = activeFile === node.path;
  const hasChildren = Boolean(state.children?.length);

  return (
    <div role="none">
      <button
        type="button"
        role="treeitem"
        aria-level={depth + 1}
        aria-expanded={node.is_dir ? state.open : undefined}
        aria-current={isActive ? "page" : undefined}
        aria-selected={isActive}
        aria-controls={node.is_dir ? groupId : undefined}
        aria-label={`${node.is_dir ? "文件夹" : "文件"} ${node.name}`}
        className={cn(
          "flex w-full cursor-pointer select-none items-center rounded-md border-0 bg-transparent p-0 text-left hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/40",
          isActive && "bg-primary/12"
        )}
        onClick={handleClick}
        onKeyDown={handleKeyDown}
        style={{ paddingLeft: `${depth * 14 + 14}px` }}
      >
        <span className="flex min-w-0 flex-1 items-center gap-1.5 px-1 py-[3px]">
          {node.is_dir ? (
            <FolderIcon open={state.open} />
          ) : (
            <FileIcon name={node.name} />
          )}
          <span
            className={cn(
              "truncate text-[12px]",
              isActive ? "text-primary font-medium" : "text-foreground/70"
            )}
          >
            {node.name}
          </span>
          {state.childLoading && (
            <Loader2
              className="ml-auto size-3 animate-spin text-muted-foreground"
              aria-hidden="true"
            />
          )}
        </span>
      </button>
      {state.open && (
        <div id={groupId} role="group">
          {state.childError && (
            <div
              className="flex items-center gap-1.5 py-1 pr-2 text-[12px] text-destructive"
              role="alert"
              style={{ paddingLeft: `${(depth + 1) * 14 + 14}px` }}
            >
              <AlertCircle className="size-3.5 shrink-0" aria-hidden="true" />
              <span className="truncate">{state.childError}</span>
            </div>
          )}
          {!state.childLoading &&
            !state.childError &&
            state.children &&
            !hasChildren && (
              <div
                className="py-1 pr-2 text-[12px] text-muted-foreground"
                style={{ paddingLeft: `${(depth + 1) * 14 + 14}px` }}
              >
                目录为空
              </div>
            )}
          {state.children?.map((child) => (
            <ReadonlyTreeNode
              key={child.path}
              node={child}
              depth={depth + 1}
              activeFile={activeFile}
              onSelect={onSelect}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export function ReadonlyFileTree({
  rootPath,
  activeFile = null,
  onSelect,
}: ReadonlyFileTreeProps) {
  const state = useReactive({
    tree: null as FsNode | null,
    loading: true,
    error: null as string | null,
  });

  useEffect(() => {
    if (!rootPath) return;
    state.loading = true;
    state.error = null;
    fetchTree(rootPath, 1)
      .then((t) => (state.tree = t))
      .catch(() => {
        state.tree = null;
        state.error = "无法加载目录树";
      })
      .finally(() => {
        state.loading = false;
      });
  }, [rootPath, state]);

  if (!rootPath) {
    return (
      <div className="py-4 text-center text-xs text-muted-foreground">
        未选择工作目录
      </div>
    );
  }

  if (state.loading) {
    return (
      <div
        className="flex items-center justify-center gap-2 py-6 text-xs text-muted-foreground"
        aria-live="polite"
      >
        <Loader2 className="size-4 animate-spin" aria-hidden="true" />
        <span>正在加载目录</span>
      </div>
    );
  }

  if (state.error) {
    return (
      <div
        className="flex items-center justify-center gap-2 py-4 text-xs text-destructive"
        role="alert"
      >
        <AlertCircle className="size-4" aria-hidden="true" />
        <span>{state.error}</span>
      </div>
    );
  }

  if (!state.tree || !state.tree.children?.length) {
    return (
      <div className="py-4 text-center text-xs text-muted-foreground">
        目录为空
      </div>
    );
  }

  return (
    <div className="py-1" role="tree" aria-label="只读文件树">
      {state.tree.children.map((child) => (
        <ReadonlyTreeNode
          key={child.path}
          node={child}
          depth={0}
          activeFile={activeFile}
          onSelect={onSelect}
        />
      ))}
    </div>
  );
}
