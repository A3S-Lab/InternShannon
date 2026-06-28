import { useCallback, useEffect, useState } from "react";
import { useReactive } from "ahooks";
import { ChevronDown, ChevronRight, File, FileCode, FileText, Folder, FolderOpen, Image, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { ScrollArea } from "@/components/ui/scroll-area";

export interface FileNode {
  path: string;
  name: string;
  isDirectory: boolean;
  children?: FileNode[];
}

interface SimpleFileTreeProps {
  rootPath: string;
  activeFile?: string | null;
  onFileSelect: (path: string) => void;
  onLoadChildren?: (path: string) => Promise<FileNode[]>;
}

function getFileIcon(fileName: string) {
  const ext = fileName.split(".").pop()?.toLowerCase();

  const iconMap: Record<string, React.ComponentType<{ className?: string }>> = {
    // Code files
    ts: FileCode,
    tsx: FileCode,
    js: FileCode,
    jsx: FileCode,
    py: FileCode,
    java: FileCode,
    cpp: FileCode,
    c: FileCode,
    go: FileCode,
    rs: FileCode,

    // Text files
    txt: FileText,
    md: FileText,
    json: FileText,
    yaml: FileText,
    yml: FileText,
    xml: FileText,

    // Images
    png: Image,
    jpg: Image,
    jpeg: Image,
    gif: Image,
    svg: Image,
    webp: Image,
  };

  return iconMap[ext || ""] || File;
}

function TreeNode({
  node,
  depth,
  activeFile,
  onFileSelect,
  onLoadChildren,
}: {
  node: FileNode;
  depth: number;
  activeFile: string | null;
  onFileSelect: (path: string) => void;
  onLoadChildren?: (path: string) => Promise<FileNode[]>;
}) {
  const state = useReactive({
    isOpen: depth < 1, // Auto-expand first level
    isLoading: false,
    children: node.children || null,
  });

  useEffect(() => {
    // Auto-load children for directories at first level
    if (node.isDirectory && depth < 1 && !state.children && onLoadChildren) {
      state.isLoading = true;
      onLoadChildren(node.path)
        .then((children) => {
          state.children = children;
        })
        .catch(() => {
          state.children = [];
        })
        .finally(() => {
          state.isLoading = false;
        });
    }
  }, [node.isDirectory, node.path, depth, onLoadChildren, state]);

  const handleToggle = useCallback(
    async (e: React.MouseEvent) => {
      e.stopPropagation();

      if (!node.isDirectory) {
        onFileSelect(node.path);
        return;
      }

      // Toggle open state
      state.isOpen = !state.isOpen;

      // Load children if not loaded yet
      if (state.isOpen && !state.children && onLoadChildren) {
        state.isLoading = true;
        try {
          const children = await onLoadChildren(node.path);
          state.children = children;
        } catch (error) {
          state.children = [];
        } finally {
          state.isLoading = false;
        }
      }
    },
    [node.isDirectory, node.path, onFileSelect, onLoadChildren, state],
  );

  const isActive = activeFile === node.path;
  const Icon = node.isDirectory ? (state.isOpen ? FolderOpen : Folder) : getFileIcon(node.name);

  return (
    <div>
      <button
        type="button"
        className={cn(
          "flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-left text-sm transition-colors hover:bg-muted/60",
          isActive && "bg-primary/10 text-primary font-medium",
        )}
        onClick={handleToggle}
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
      >
        {node.isDirectory && (
          <span className="flex-shrink-0">
            {state.isLoading ? (
              <Loader2 className="size-4 animate-spin text-muted-foreground" />
            ) : state.isOpen ? (
              <ChevronDown className="size-4 text-muted-foreground" />
            ) : (
              <ChevronRight className="size-4 text-muted-foreground" />
            )}
          </span>
        )}
        <Icon className={cn("size-4 flex-shrink-0", node.isDirectory ? "text-blue-500" : "text-muted-foreground")} />
        <span className="truncate">{node.name}</span>
      </button>

      {state.isOpen && state.children && (
        <div>
          {state.children.map((child) => (
            <TreeNode
              key={child.path}
              node={child}
              depth={depth + 1}
              activeFile={activeFile}
              onFileSelect={onFileSelect}
              onLoadChildren={onLoadChildren}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export function SimpleFileTree({ rootPath, activeFile, onFileSelect, onLoadChildren }: SimpleFileTreeProps) {
  const [rootNode, setRootNode] = useState<FileNode | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!onLoadChildren) {
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    onLoadChildren(rootPath)
      .then((children) => {
        setRootNode({
          path: rootPath,
          name: rootPath.split("/").pop() || rootPath,
          isDirectory: true,
          children,
        });
      })
      .catch(() => {
        setRootNode(null);
      })
      .finally(() => {
        setIsLoading(false);
      });
  }, [rootPath, onLoadChildren]);

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!rootNode) {
    return (
      <div className="flex h-full items-center justify-center p-4 text-center">
        <p className="text-sm text-muted-foreground">无法加载文件树</p>
      </div>
    );
  }

  return (
    <ScrollArea className="h-full">
      <div className="p-2">
        {rootNode.children?.map((child) => (
          <TreeNode
            key={child.path}
            node={child}
            depth={0}
            activeFile={activeFile ?? null}
            onFileSelect={onFileSelect}
            onLoadChildren={onLoadChildren}
          />
        ))}
      </div>
    </ScrollArea>
  );
}
