import { useReactive } from "ahooks";
import { AlertTriangle, Copy, Loader2, RefreshCw } from "lucide-react";
import { type ReactNode, useEffect, useRef } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { getCurrentAppVersion } from "@/desktop/lib/app-version";
import { getSpaRuntimeKind, invokeDesktopOptional } from "@/desktop/lib/tauri-runtime";
import { markBackendReady } from "@/lib/backend-ready";
import { notifyClientError } from "@/lib/client-error";
import { writeClipboardText } from "@/lib/clipboard";
import { probeSidecarHealth } from "@/lib/sidecar-http";
import settingsModel, { getGatewayUrl, getGatewayUrls } from "@/models/settings.model";
import {
  buildBackendStartupDiagnosticClipboardText,
  buildBackendStartupFailureDetails,
  type EmbeddedGatewayStatus,
  formatEmbeddedGatewayState,
  resolveBackendStartupRecoveryHint,
} from "./backend-startup-diagnostics";

type GuardState =
  | {
      phase: "checking";
      message: string;
      healthUrl?: string;
      healthEndpoint?: string;
      lastProbe?: string;
      details?: string;
      embeddedGateway?: EmbeddedGatewayStatus | null;
    }
  | {
      phase: "ready";
      message: string;
      healthUrl: string;
      healthEndpoint?: string;
      lastProbe?: string;
      details?: string;
      embeddedGateway?: EmbeddedGatewayStatus | null;
    }
  | {
      phase: "error";
      message: string;
      healthUrl?: string;
      healthEndpoint?: string;
      lastProbe?: string;
      details?: string;
      embeddedGateway?: EmbeddedGatewayStatus | null;
    };

const STARTUP_WAIT_MS = 60000;
const STARTUP_LOADING_DIAGNOSTICS_MS = 8000;
const RETRY_INTERVAL_MS = 700;
const HEALTH_REQUEST_TIMEOUT_MS = 2500;
const BACKEND_STARTUP_DIALOG_TITLE_ID = "backend-startup-dialog-title";
const BACKEND_STARTUP_DIALOG_DESCRIPTION_ID = "backend-startup-dialog-description";

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function primaryHealthEndpoint() {
  const [gateway] = getGatewayUrls();
  return `${gateway || getGatewayUrl()}/api/v1/health`;
}

async function readEmbeddedGatewayStatus(): Promise<EmbeddedGatewayStatus | null> {
  try {
    return await invokeDesktopOptional<EmbeddedGatewayStatus>("get_embedded_gateway_status");
  } catch {
    return null;
  }
}

function buildFailureDetails(
  embeddedGateway: EmbeddedGatewayStatus | null,
  healthError?: string,
  healthAttempts?: string[],
) {
  return buildBackendStartupFailureDetails({
    gateway: getGatewayUrl(),
    gatewayCandidates: getGatewayUrls(),
    embeddedGateway,
    healthError,
    healthAttempts,
  });
}

export function BackendStartupGuard(props: { children?: ReactNode }) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const lastFocusedPhaseRef = useRef<string | null>(null);
  const ui = useReactive<
    GuardState & {
      retryToken: number;
      appVersion: string;
      showDiagnostics: boolean;
    }
  >({
    phase: "checking",
    message: "正在等待InternShannon本地 API 启动。",
    retryToken: 0,
    appVersion: "",
    showDiagnostics: false,
    embeddedGateway: null,
  });

  useEffect(() => {
    if (ui.phase === "ready") {
      lastFocusedPhaseRef.current = null;
      return;
    }
    if (lastFocusedPhaseRef.current === ui.phase) return;
    lastFocusedPhaseRef.current = ui.phase;
    window.requestAnimationFrame(() => dialogRef.current?.focus());
  }, [ui.phase]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: ui is a stable ahooks reactive proxy; app version is loaded once.
  useEffect(() => {
    getCurrentAppVersion()
      .then((version) => {
        ui.appVersion = version;
      })
      .catch(() => {});
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: retryToken is the restart trigger; ui is a stable ahooks reactive proxy mutated by the startup loop.
  useEffect(() => {
    let cancelled = false;
    void ui.retryToken;

    const run = async () => {
      ui.showDiagnostics = false;
      ui.phase = "checking";
      ui.message = "正在等待InternShannon本地 API 启动。";
      ui.details = undefined;
      ui.healthEndpoint = primaryHealthEndpoint();
      ui.lastProbe = undefined;
      ui.embeddedGateway = null;

      await settingsModel.hydrateGatewayUrlFromRuntime();

      const startedAt = Date.now();
      let lastHealthError = "Local gateway health check failed";
      let lastHealthAttempts: string[] = [];

      while (!cancelled) {
        const [health, embeddedGateway] = await Promise.all([
          probeSidecarHealth({ timeoutMs: HEALTH_REQUEST_TIMEOUT_MS }),
          readEmbeddedGatewayStatus(),
        ]);

        const nativeReady = getSpaRuntimeKind() === "tauri" && embeddedGateway?.started === true;
        if ((health.ok && health.url) || nativeReady) {
          if (!cancelled) {
            const readyGateway = health.url || embeddedGateway?.configuredUrl || getGatewayUrl();
            markBackendReady();
            ui.phase = "ready";
            ui.message = "InternShannon本地后端已经就绪。";
            ui.healthUrl = readyGateway;
            ui.healthEndpoint = `${readyGateway}/api/v1/health`;
            ui.lastProbe = health.attempts.at(-1);
            ui.embeddedGateway = embeddedGateway;
            void settingsModel
              .seedFromBackend({
                retries: 2,
                retryDelayMs: 300,
              })
              .catch((error) => {
                console.warn("Failed to seed settings after backend ready:", error);
              });
          }
          return;
        }

        lastHealthError = health.error || lastHealthError;
        lastHealthAttempts = health.attempts;
        ui.healthEndpoint = primaryHealthEndpoint();
        ui.lastProbe = lastHealthAttempts.at(-1);
        ui.embeddedGateway = embeddedGateway;
        if (Date.now() - startedAt >= STARTUP_LOADING_DIAGNOSTICS_MS) {
          ui.details = buildFailureDetails(embeddedGateway, lastHealthError, lastHealthAttempts);
        }

        const startupError = embeddedGateway?.lastError?.trim();
        if (startupError) {
          if (!cancelled) {
            ui.phase = "error";
            ui.message = "InternShannon本地后端启动失败，依赖 API 的功能暂时不可用。";
            ui.healthUrl = health.url;
            ui.details = buildFailureDetails(embeddedGateway, lastHealthError, lastHealthAttempts);
            ui.embeddedGateway = embeddedGateway;
          }
          return;
        }

        if (Date.now() - startedAt >= STARTUP_WAIT_MS) {
          if (!cancelled) {
            ui.phase = "error";
            ui.message = "InternShannon本地后端启动超时，依赖 API 的功能暂时不可用。";
            ui.healthUrl = health.url;
            ui.details = buildFailureDetails(embeddedGateway, lastHealthError, lastHealthAttempts);
            ui.embeddedGateway = embeddedGateway;
          }
          return;
        }

        await sleep(RETRY_INTERVAL_MS);
      }
    };

    void run();

    return () => {
      cancelled = true;
    };
  }, [ui.retryToken]);

  if (ui.phase === "ready") {
    return <>{props.children ?? null}</>;
  }

  const diagnosticPath = ui.embeddedGateway?.diagnosticReportPath?.trim() || undefined;
  const diagnosticCopyText = buildBackendStartupDiagnosticClipboardText({
    details: ui.phase === "error" ? ui.details : undefined,
    diagnosticReportPath: diagnosticPath,
  });
  const canCopy = diagnosticCopyText.length > 0;
  const isChecking = ui.phase === "checking";
  const recoveryHint = resolveBackendStartupRecoveryHint({
    embeddedGateway: ui.embeddedGateway,
    healthError: ui.details,
    phase: ui.phase,
  });
  const retryBackendStartup = () => {
    ui.retryToken = ui.retryToken + 1;
  };
  const toggleDiagnostics = () => {
    ui.showDiagnostics = !ui.showDiagnostics;
  };

  return (
    <div
      ref={dialogRef}
      className="fixed inset-0 z-[200] flex items-start justify-center overflow-y-auto bg-[radial-gradient(circle_at_top_left,#eff6ff,#f8fafc_42%,#e2e8f0)] p-3 py-4 text-slate-950 focus:outline-none sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby={BACKEND_STARTUP_DIALOG_TITLE_ID}
      aria-describedby={BACKEND_STARTUP_DIALOG_DESCRIPTION_ID}
      tabIndex={-1}
    >
      <div className="w-full min-w-0 max-w-[calc(100vw-1.5rem)] overflow-hidden rounded-lg border border-slate-200 bg-white shadow-[0_12px_16px_-4px_rgba(36,36,36,0.08)] sm:max-w-[680px]">
        <div className="border-b border-slate-200 bg-slate-50 px-3 py-3 sm:px-4">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg bg-white text-slate-900 shadow-sm ring-1 ring-slate-200">
              {isChecking ? (
                <Loader2 className="size-5 animate-spin" />
              ) : (
                <AlertTriangle className="size-5 text-amber-600" />
              )}
            </div>
            <div className="min-w-0 flex-1">
              <div id={BACKEND_STARTUP_DIALOG_TITLE_ID} className="text-base font-semibold text-slate-950">
                {isChecking ? "InternShannon正在启动" : "本地 API 暂不可用"}
              </div>
              <output
                id={BACKEND_STARTUP_DIALOG_DESCRIPTION_ID}
                className="mt-1 text-sm leading-6 text-slate-600"
                aria-live="polite"
                aria-atomic="true"
              >
                {ui.message}
              </output>
              {isChecking && ui.healthEndpoint ? (
                <div className="mt-2 min-w-0 text-xs leading-5 text-slate-500">
                  <span>正在检测本机接口：</span>
                  <span className="break-all font-mono text-slate-700">{ui.healthEndpoint}</span>
                </div>
              ) : null}
            </div>
          </div>
        </div>

        <div className="space-y-4 px-3 py-3 sm:px-4">
          {isChecking ? (
            <div className="overflow-hidden rounded-full bg-slate-100">
              <div className="h-1.5 w-1/2 animate-pulse rounded-full bg-primary" />
            </div>
          ) : null}

          <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
            <div className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600" />
              <div className="min-w-0">
                <div className="text-xs font-semibold text-amber-950">{recoveryHint.title}</div>
                <div className="mt-1 text-xs leading-5 text-amber-900">{recoveryHint.description}</div>
              </div>
            </div>
          </div>

          <div className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-3 font-mono text-[11px] leading-5 text-slate-600 sm:gap-x-4 sm:px-4">
            <span className="text-slate-400">app</span>
            <span className="min-w-0 truncate">{ui.appVersion || "-"}</span>
            <span className="text-slate-400">gateway</span>
            <span className="min-w-0 truncate">{getGatewayUrl()}</span>
            {ui.lastProbe ? (
              <>
                <span className="text-slate-400">latest</span>
                <span className="min-w-0 truncate">{ui.lastProbe}</span>
              </>
            ) : null}
            <span className="text-slate-400">embedded</span>
            <span className="min-w-0 truncate">{formatEmbeddedGatewayState(ui.embeddedGateway)}</span>
            {ui.embeddedGateway?.lastErrorStage ? (
              <>
                <span className="text-slate-400">stage</span>
                <span className="min-w-0 truncate">{ui.embeddedGateway.lastErrorStage}</span>
              </>
            ) : null}
            {diagnosticPath ? (
              <>
                <span className="text-slate-400">report</span>
                <span className="min-w-0 truncate">{diagnosticPath}</span>
              </>
            ) : null}
          </div>

          {ui.showDiagnostics || (!isChecking && ui.details) ? (
            <pre className="max-h-56 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-slate-950 px-4 py-3 text-[11px] leading-5 text-slate-100">
              {ui.details || "本地 API 仍在启动中，暂时没有错误细节。"}
            </pre>
          ) : null}

          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" size="sm" onClick={retryBackendStartup}>
              {isChecking ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
              重新检测
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={!canCopy}
              onClick={async () => {
                try {
                  await writeClipboardText(diagnosticCopyText);
                  toast.success("诊断信息已复制");
                } catch (error) {
                  notifyClientError(error, {
                    title: "复制诊断信息失败",
                    source: "backend-startup-guard",
                  });
                }
              }}
            >
              <Copy className="size-4" />
              复制
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={toggleDiagnostics}>
              {ui.showDiagnostics ? "收起详情" : "查看详情"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
