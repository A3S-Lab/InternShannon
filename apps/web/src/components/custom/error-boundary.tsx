import React, { Component, type ReactNode } from "react";
import { RefreshCw } from "lucide-react";
import { InlineErrorDisplay } from "./unified-error";
import { clientErrorToDetails, normalizeClientError, notifyClientError } from "@/lib/client-error";

interface Props {
  children: ReactNode;
  /** Fallback UI to render when an error is caught */
  fallback?:
    | ReactNode
    | ((state: { error: Error | null; errorInfo?: React.ErrorInfo; reset: () => void }) => ReactNode);
  /** Called when an error is caught, useful for logging */
  onError?: (error: Error, errorInfo: React.ErrorInfo) => void;
  /** If true, the error boundary will log errors to console */
  verbose?: boolean;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo?: React.ErrorInfo;
}

/** sessionStorage guard so a stale-chunk auto-reload happens at most once per
 *  session — prevents a reload loop if the chunk is genuinely gone. */
const CHUNK_RELOAD_KEY = "a3s_chunk_reload";

/** A lazy chunk failing to load almost always means the deployed bundle was
 *  replaced (new build, new hashes) while this tab held a stale index/bundle. */
function isChunkLoadError(error: unknown): boolean {
  const message =
    error instanceof Error
      ? `${error.name} ${error.message}`
      : String((error as { message?: unknown })?.message ?? error ?? "");
  return /Loading chunk|Loading CSS chunk|ChunkLoadError|failed to fetch dynamically imported module|error loading dynamically imported module/i.test(
    message,
  );
}

/** Reload once to fetch the current build's chunks. Returns true if a reload was
 *  triggered (caller should stop surfacing the error). */
function recoverFromChunkLoadError(): boolean {
  if (typeof window === "undefined") return false;
  try {
    if (window.sessionStorage.getItem(CHUNK_RELOAD_KEY) === "1") {
      // Already reloaded once and the chunk still fails → give up, show the error.
      window.sessionStorage.removeItem(CHUNK_RELOAD_KEY);
      return false;
    }
    window.sessionStorage.setItem(CHUNK_RELOAD_KEY, "1");
    window.location.reload();
    return true;
  } catch {
    return false;
  }
}

/**
 * Error boundary that catches React errors in child components.
 * Use this to prevent errors in one part of the UI from crashing the entire page.
 *
 * @example
 * <ErrorBoundary>
 *   <SomeUnstableComponent />
 * </ErrorBoundary>
 */
export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  private reset = () => {
    this.setState({
      hasError: false,
      error: null,
      errorInfo: undefined,
    });
  };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    // Stale-bundle recovery: a lazy chunk that 404s after a redeploy auto-reloads
    // once to pick up the current build, instead of dead-ending on the error UI.
    if (isChunkLoadError(error) && recoverFromChunkLoadError()) {
      return;
    }
    if (this.props.verbose || process.env.NODE_ENV === "development") {
      console.error("[ErrorBoundary] Caught error:", error, errorInfo);
    }
    this.setState({ errorInfo });
    notifyClientError(error, {
      kind: "render",
      title: "界面渲染出错",
      source: "react-error-boundary",
      details: errorInfo.componentStack ?? undefined,
    });
    this.props.onError?.(error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        if (typeof this.props.fallback === "function") {
          return this.props.fallback({
            error: this.state.error,
            errorInfo: this.state.errorInfo,
            reset: this.reset,
          });
        }
        return this.props.fallback;
      }
      const clientError = normalizeClientError(this.state.error, {
        kind: "render",
        title: "界面渲染出错",
        source: "react-error-boundary",
        details: this.state.errorInfo?.componentStack ?? undefined,
      });
      return (
        <div className="flex min-h-[160px] flex-col gap-3 p-4">
          <InlineErrorDisplay
            error={{
              title: clientError.title,
              message: clientError.message,
              details: clientErrorToDetails(clientError),
            }}
          />
          <div>
            <button
              type="button"
              onClick={this.reset}
              className="inline-flex items-center gap-2 rounded-md border border-border bg-background px-4 py-2 text-sm font-medium transition-all hover:border-muted-foreground/30 hover:bg-muted"
            >
              <RefreshCw className="size-4" />
              重试
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

/**
 * Simpler version that renders an inline error message instead of a try-again button.
 */
export function InlineErrorBoundary({
  children,
  onError,
  fallbackMessage,
}: {
  children: ReactNode;
  onError?: (error: Error) => void;
  fallbackMessage?: string;
}) {
  return (
    <ErrorBoundary
      onError={(error) => onError?.(error)}
      fallback={
        <InlineErrorDisplay
          error={{
            title: "渲染错误",
            message: fallbackMessage || "组件渲染失败",
          }}
          className="m-4"
        />
      }
    >
      {children}
    </ErrorBoundary>
  );
}
