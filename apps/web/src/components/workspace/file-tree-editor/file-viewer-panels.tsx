/**
 * File viewer panels - image, binary, mermaid viewers
 */
import { useReactive } from "ahooks";
import { lazy, Suspense, useEffect, useRef, type ReactNode } from "react";
import { toast } from "sonner";
import {
  AlertCircle,
  Copy,
  ExternalLink,
  File,
  FileText,
  Loader2,
  Presentation,
  Table2,
} from "lucide-react";
import {
  getOfficeFileCapability,
  type OfficeFileCapability,
  type OfficeFileKind,
} from "@a3s-lab/ooxml/capabilities";
import { cn } from "@/lib/utils";
import { writeClipboardText } from "@/lib/clipboard";
import { hasTauriCore } from "@/lib/runtime-environment";
import { workspaceApi } from "@/lib/workspace-api";
import type { IDockviewPanelProps } from "@/desktop/components/dockview";
import { Button } from "@/components/ui/button";
import MermaidRenderer from "@/components/memoized-markdown/mermaid";
import { createImageObjectUrl, getImageMimeType } from "./image-viewer-state";

const LazyPdfViewerPanel = lazy(() =>
  import("./pdf-viewer-panel").then((module) => ({
    default: module.PdfViewerPanel,
  }))
);

const LazyUniverSpreadsheetPanel = lazy(() =>
  import("./univer-spreadsheet-panel").then((module) => ({
    default: module.UniverSpreadsheetPanel,
  }))
);

const LazyUniverDocumentPanel = lazy(() =>
  import("./univer-document-panel").then((module) => ({
    default: module.UniverDocumentPanel,
  }))
);

const LazyUniverPresentationPanel = lazy(() =>
  import("./univer-presentation-panel").then((module) => ({
    default: module.UniverPresentationPanel,
  }))
);

function EditorPanelFrame({
  children,
  className,
  label = "文件预览",
}: {
  children: ReactNode;
  className?: string;
  label?: string;
}) {
  return (
    <section
      className={cn("flex h-full min-h-0 flex-col", className)}
      aria-label={label}
    >
      <div className="min-h-0 flex-1">{children}</div>
    </section>
  );
}

function ViewerLoadingFallback() {
  return (
    <EditorPanelFrame>
      <div
        className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground"
        aria-live="polite"
      >
        <Loader2 className="size-5 animate-spin" aria-hidden="true" />
        <span>正在加载预览</span>
      </div>
    </EditorPanelFrame>
  );
}

async function copyViewerFilePath(path?: string) {
  if (!path) {
    toast.error("没有可复制的文件路径");
    return;
  }
  try {
    await writeClipboardText(path);
    toast.success("文件路径已复制");
  } catch {
    toast.error("无法复制文件路径");
  }
}

async function openViewerFileWithSystem(path?: string) {
  if (!path) {
    toast.error("没有可打开的文件路径");
    return;
  }
  try {
    const { invoke: tauriInvoke } = await import("@tauri-apps/api/core");
    await tauriInvoke("plugin:shell|open", { path });
  } catch {
    toast.error("无法打开文件");
  }
}

function ViewerFallbackPanel({
  title,
  description,
  detail,
  icon,
  path,
  label,
  extraAction,
}: {
  title: string;
  description: string;
  detail?: ReactNode;
  icon: ReactNode;
  path?: string;
  label: string;
  extraAction?: ReactNode;
}) {
  const supportsNativeShell = hasTauriCore();

  return (
    <EditorPanelFrame label={label}>
      <div className="flex h-full flex-col items-center justify-center gap-4 px-6 text-muted-foreground">
        <div
          className="flex size-16 items-center justify-center rounded-md border bg-muted/40"
          aria-hidden="true"
        >
          {icon}
        </div>
        <div className="max-w-lg text-center">
          <p
            className="truncate text-sm font-medium text-foreground"
            title={title}
          >
            {title}
          </p>
          <p className="mt-1 text-xs">{description}</p>
          {detail ? <div className="mt-2 text-xs">{detail}</div> : null}
          {path ? (
            <p
              className="mt-3 max-w-lg truncate rounded-md bg-muted px-2 py-1 font-mono text-[11px] text-muted-foreground"
              title={path}
            >
              {path}
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center justify-center gap-2">
          {extraAction}
          {supportsNativeShell ? (
            <Button
              type="button"
              onClick={() => void openViewerFileWithSystem(path)}
              aria-label={`用系统应用打开 ${title}`}
            >
              <ExternalLink className="size-3.5" aria-hidden="true" />
              用系统应用打开
            </Button>
          ) : (
            <Button
              type="button"
              onClick={() => void copyViewerFilePath(path)}
              aria-label={`复制 ${title} 的路径`}
            >
              <Copy className="size-3.5" aria-hidden="true" />
              复制文件路径
            </Button>
          )}
          {supportsNativeShell ? (
            <Button
              type="button"
              variant="outline"
              onClick={() => void copyViewerFilePath(path)}
              aria-label={`复制 ${title} 的路径`}
            >
              <Copy className="size-3.5" aria-hidden="true" />
              复制路径
            </Button>
          ) : null}
        </div>
      </div>
    </EditorPanelFrame>
  );
}

export function ImageViewerPanel({
  params,
}: IDockviewPanelProps<{ path: string }>) {
  const state = useReactive({
    src: null as string | null,
    error: null as string | null,
    loading: true,
    retryCount: 0,
    sourceKind: null as "native" | "object-url" | null,
    forceWorkspaceFallback: false,
  });
  const lastPathRef = useRef<string | null>(null);
  const fileName = params?.path?.split("/").pop() ?? "图片";

  // biome-ignore lint/correctness/useExhaustiveDependencies: state.retryCount is the explicit retry trigger; the ahooks reactive proxy is stable, so depending on it re-runs the load on retry.
  useEffect(() => {
    if (!params?.path) return;
    if (lastPathRef.current !== params.path) {
      lastPathRef.current = params.path;
      state.forceWorkspaceFallback = false;
    }
    let objectUrl: string | null = null;
    let cancelled = false;
    const path = params.path;
    const fail = () => {
      if (!cancelled) {
        state.error = "图片加载失败";
        state.loading = false;
        state.sourceKind = null;
      }
    };
    const loadWorkspaceImage = async () => {
      const data = await workspaceApi.readBinaryFile(path);
      if (cancelled) return;
      objectUrl = createImageObjectUrl(data, getImageMimeType(path));
      state.src = objectUrl;
      state.error = null;
      state.loading = false;
      state.sourceKind = "object-url";
    };
    state.src = null;
    state.error = null;
    state.loading = true;
    state.sourceKind = null;
    if (hasTauriCore() && !state.forceWorkspaceFallback) {
      import("@tauri-apps/api/core")
        .then(({ convertFileSrc }) => {
          if (!cancelled) {
            state.src = convertFileSrc(path);
            state.loading = false;
            state.sourceKind = "native";
          }
        })
        .catch(() => {
          void loadWorkspaceImage().catch(fail);
        });
      return () => {
        cancelled = true;
        if (objectUrl) URL.revokeObjectURL(objectUrl);
      };
    }
    void loadWorkspaceImage().catch(fail);
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [params?.path, state.retryCount]);

  return (
    <EditorPanelFrame label={`图片预览：${fileName}`}>
      <div className="flex h-full items-center justify-center bg-muted/20 p-4">
        {state.src ? (
          <img
            src={state.src as string}
            alt={fileName}
            className="max-h-full max-w-full rounded-md object-contain"
            onError={() => {
              if (state.sourceKind === "native") {
                state.forceWorkspaceFallback = true;
                state.retryCount += 1;
                return;
              }
              state.src = null;
              state.error = "图片加载失败";
              state.loading = false;
              state.sourceKind = null;
            }}
          />
        ) : state.error ? (
          <div
            className="flex max-w-md flex-col items-center gap-3 text-center text-muted-foreground"
            role="alert"
          >
            <AlertCircle
              className="size-6 text-destructive"
              aria-hidden="true"
            />
            <p className="text-sm">{state.error}</p>
            <button
              type="button"
              onClick={() => {
                state.forceWorkspaceFallback = false;
                state.retryCount += 1;
              }}
              className="rounded-md border px-3 py-1.5 text-xs transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/40"
            >
              重试
            </button>
          </div>
        ) : (
          <div
            className="flex items-center gap-2 text-sm text-muted-foreground"
            aria-live="polite"
          >
            <Loader2 className="size-5 animate-spin" aria-hidden="true" />
            <span>{state.loading ? "正在加载图片" : "等待图片数据"}</span>
          </div>
        )}
      </div>
    </EditorPanelFrame>
  );
}

export function PdfViewerPanel(props: IDockviewPanelProps<{ path: string }>) {
  return (
    <Suspense fallback={<ViewerLoadingFallback />}>
      <LazyPdfViewerPanel {...props} />
    </Suspense>
  );
}

export function BinaryFilePanel({
  params,
}: IDockviewPanelProps<{ path: string; onOpenAsText?: (path: string) => void }>) {
  const filename = params?.path?.split("/").pop() ?? "";
  const ext = filename.split(".").pop()?.toUpperCase() ?? "";
  const onOpenAsText = params?.onOpenAsText;
  const path = params?.path;

  return (
    <ViewerFallbackPanel
      title={filename || "未知文件"}
      description={`${ext || "未知"} 文件 · 不支持在线预览`}
      icon={<File className="size-7" />}
      path={path}
      label={`二进制文件：${filename}`}
      // 逃生口:未识别扩展名也能强制用文本编辑器打开(真二进制会显示乱码,但这是用户的明确选择)。
      extraAction={
        onOpenAsText && path ? (
          <Button type="button" onClick={() => onOpenAsText(path)} aria-label={`以文本方式打开 ${filename}`}>
            <FileText className="size-3.5" aria-hidden="true" />
            以文本方式打开
          </Button>
        ) : undefined
      }
    />
  );
}

function OfficeKindIcon({ kind }: { kind: OfficeFileKind | null }) {
  if (kind === "spreadsheet") {
    return <Table2 className="size-7 text-[#059669]" aria-hidden="true" />;
  }
  if (kind === "presentation") {
    return (
      <Presentation className="size-7 text-[#ea580c]" aria-hidden="true" />
    );
  }
  return <FileText className="size-7 text-[#2563eb]" aria-hidden="true" />;
}

function getUnsupportedOfficeMessage(capability: OfficeFileCapability) {
  if (capability.unsupportedReason === "legacy-binary") {
    return "旧版二进制 Office 格式暂未接入直接导入器。";
  }
  if (capability.unsupportedReason === "opendocument-unsupported") {
    return "OpenDocument 格式暂未接入 Univer 直接导入器。";
  }
  return "当前文件格式暂不支持在线预览。";
}

function UnsupportedOfficeFilePanel({
  params,
  capability,
}: IDockviewPanelProps<{ path: string }> & {
  capability: OfficeFileCapability;
}) {
  const filename = params?.path?.split("/").pop() ?? "";

  return (
    <ViewerFallbackPanel
      title={filename || "Office 文件"}
      description={getUnsupportedOfficeMessage(capability)}
      detail={
        <span className="inline-flex items-center justify-center gap-1">
          <AlertCircle className="size-3.5" aria-hidden="true" />
          不会转 PDF；后续需要接入原生二进制或 OpenDocument 导入器。
        </span>
      }
      icon={<OfficeKindIcon kind={capability.kind} />}
      path={params?.path}
      label={`Office 文件：${filename}`}
    />
  );
}

export function OfficeViewerPanel(
  props: IDockviewPanelProps<{
    path: string;
    commandScope?: string;
    readOnly?: boolean;
    onDirtyChange?: (path: string, isDirty: boolean) => void;
    workbenchVariant?: "default" | "vscode";
  }>
) {
  const capability = getOfficeFileCapability(props.params?.path ?? "");
  if (!capability.kind) {
    return <BinaryFilePanel {...props} />;
  }
  if (!capability.directUniver) {
    return <UnsupportedOfficeFilePanel {...props} capability={capability} />;
  }
  if (capability.kind === "spreadsheet") {
    return (
      <Suspense fallback={<ViewerLoadingFallback />}>
        <LazyUniverSpreadsheetPanel {...props} />
      </Suspense>
    );
  }
  if (capability.kind === "document") {
    return (
      <Suspense fallback={<ViewerLoadingFallback />}>
        <LazyUniverDocumentPanel {...props} />
      </Suspense>
    );
  }
  if (capability.kind === "presentation") {
    return (
      <Suspense fallback={<ViewerLoadingFallback />}>
        <LazyUniverPresentationPanel {...props} />
      </Suspense>
    );
  }
  return <BinaryFilePanel {...props} />;
}

export function MermaidViewerPanel({
  params,
}: IDockviewPanelProps<{ path: string }>) {
  const state = useReactive({
    content: "",
    loading: true,
    error: null as string | null,
    retryCount: 0,
  });
  const fileName = params?.path?.split("/").pop() ?? "Mermaid 图表";

  // biome-ignore lint/correctness/useExhaustiveDependencies: state.retryCount is the explicit retry trigger for this lightweight viewer.
  useEffect(() => {
    if (!params?.path) return;
    state.loading = true;
    state.error = null;
    workspaceApi
      .readFile(params.path)
      .then((c) => (state.content = c))
      .catch((error) => {
        state.content = "";
        state.error =
          error instanceof Error ? error.message : "Mermaid 文件加载失败";
      })
      .finally(() => {
        state.loading = false;
      });
  }, [params?.path, state.retryCount]);

  if (state.loading) {
    return (
      <EditorPanelFrame label={`Mermaid 图表：${fileName}`}>
        <div
          className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground"
          aria-live="polite"
        >
          <Loader2 className="size-5 animate-spin" aria-hidden="true" />
          <span>正在加载 Mermaid 图表</span>
        </div>
      </EditorPanelFrame>
    );
  }

  return (
    <EditorPanelFrame label={`Mermaid 图表：${fileName}`}>
      <div className="flex h-full flex-col">
        <div className="flex items-center justify-between border-b border-border/50 px-3 py-2">
          <span
            className="min-w-0 truncate text-xs text-muted-foreground"
            title={fileName}
          >
            Mermaid 图表 · {fileName}
          </span>
        </div>
        <div className="min-h-0 flex-1 overflow-auto">
          {state.error ? (
            <div
              className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center text-muted-foreground"
              role="alert"
            >
              <AlertCircle
                className="size-6 text-destructive"
                aria-hidden="true"
              />
              <div className="max-w-md text-sm">{state.error}</div>
              <button
                type="button"
                onClick={() => {
                  state.retryCount += 1;
                }}
                className="rounded-md border px-3 py-1.5 text-xs transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/40"
              >
                重试
              </button>
            </div>
          ) : (
            <MermaidRenderer code={state.content} />
          )}
        </div>
      </div>
    </EditorPanelFrame>
  );
}
