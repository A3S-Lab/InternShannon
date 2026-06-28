import { useEffect, useState } from "react";
import { AlertCircle, Loader2 } from "lucide-react";
import { PDFViewer } from "@embedpdf/react-pdf-viewer";
import type { IDockviewPanelProps } from "@/desktop/components/dockview";
import { workspaceApi } from "@/lib/workspace-api";

interface PdfViewerState {
  src: string | null;
  loading: boolean;
  error: string | null;
}

interface PdfDocumentViewerProps {
  src: string | null;
  loading?: boolean;
  error?: string | null;
  fileName?: string;
  onRetry?: () => void;
}

export function PdfDocumentViewer({
  src,
  loading = false,
  error = null,
  fileName = "PDF 文档",
  onRetry,
}: PdfDocumentViewerProps) {
  return (
    <section
      className="relative flex h-full min-h-0 flex-col bg-background"
      aria-label={`PDF 预览：${fileName}`}
      aria-busy={loading}
    >
      {src ? (
        <PDFViewer
          key={src}
          className="h-full min-h-0 w-full"
          style={{ height: "100%", width: "100%" }}
          config={{
            src,
            tabBar: "never",
            theme: {
              preference: "system",
              light: { accent: { primary: "#181e25" } },
              dark: { accent: { primary: "#f8fafc" } },
            },
          }}
        />
      ) : null}

      {loading && (
        <div
          className="absolute inset-0 flex items-center justify-center gap-2 bg-background text-sm text-muted-foreground"
          aria-live="polite"
        >
          <Loader2 className="size-5 animate-spin" aria-hidden="true" />
          <span>正在加载 PDF</span>
        </div>
      )}

      {error && (
        <div
          className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-background px-6 text-center text-muted-foreground"
          role="alert"
        >
          <AlertCircle className="size-6 text-destructive" aria-hidden="true" />
          <div className="max-w-md text-center text-sm">{error}</div>
          {onRetry && (
            <button
              type="button"
              onClick={onRetry}
              className="rounded-md border px-3 py-1.5 text-xs transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/40"
            >
              重试
            </button>
          )}
        </div>
      )}
    </section>
  );
}

export function PdfViewerPanel({
  params,
}: IDockviewPanelProps<{ path: string }>) {
  const [state, setState] = useState<PdfViewerState>({
    src: null,
    loading: true,
    error: null,
  });
  const [retryCount, setRetryCount] = useState(0);
  const fileName = params?.path?.split("/").pop() ?? "PDF 文档";

  useEffect(() => {
    const path = params?.path;
    if (!path) {
      setState({ src: null, loading: false, error: "未选择 PDF 文件" });
      return;
    }

    let disposed = false;
    let objectUrl: string | null = null;

    setState({ src: null, loading: true, error: null });

    workspaceApi
      .readBinaryFile(path)
      .then((data) => {
        if (disposed) return;
        const buffer = new ArrayBuffer(data.byteLength);
        new Uint8Array(buffer).set(data);
        objectUrl = URL.createObjectURL(
          new Blob([buffer], { type: "application/pdf" })
        );
        setState({ src: objectUrl, loading: false, error: null });
      })
      .catch((error) => {
        if (disposed) return;
        setState({
          src: null,
          loading: false,
          error: error instanceof Error ? error.message : "PDF 加载失败",
        });
      });

    return () => {
      disposed = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [params?.path, retryCount]);

  return (
    <PdfDocumentViewer
      src={state.src}
      loading={state.loading}
      error={state.error}
      fileName={fileName}
      onRetry={() => setRetryCount((value) => value + 1)}
    />
  );
}
