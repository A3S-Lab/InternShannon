import { Database, Loader2, RotateCcw, Square } from "lucide-react";
import type { WikiAuditEntry, WikiIngestJobStatus } from "@/lib/api/assets";
import type { PendingKnowledgeUpload } from "../knowledge-page-utils";
import { formatRelativeTime, pageTitle } from "../knowledge-page-utils";

function ingestProgress(job: WikiIngestJobStatus) {
  if (job.progress && typeof job.progress === "object" && "percent" in job.progress) {
    const progress = job.progress as { percent?: unknown; stage?: unknown; message?: unknown };
    return {
      percent: typeof progress.percent === "number" ? progress.percent : 0,
      stage: typeof progress.stage === "string" ? progress.stage : job.status,
      message: typeof progress.message === "string" ? progress.message : job.status,
    };
  }
  return {
    percent: typeof job.progress === "number" ? job.progress : 0,
    stage: job.status,
    message: job.status,
  };
}

export function OperationsPane(props: {
  uploads: PendingKnowledgeUpload[];
  jobs: WikiIngestJobStatus[];
  audit: WikiAuditEntry[];
  busy: boolean;
  onCancel: (jobId: string) => void;
  onRetry: (jobId: string) => void;
  onMigrate: () => void;
}) {
  return (
    <div className="h-full overflow-y-auto bg-[#f7f7f5] p-2">
      <div className="mb-2 flex items-center gap-2 text-[11px] font-semibold text-muted-foreground">
        <span className="min-w-0 flex-1">摄取任务</span>
        <button
          type="button"
          onClick={props.onMigrate}
          disabled={props.busy}
          className="inline-flex size-7 items-center justify-center rounded-md hover:bg-muted disabled:opacity-50"
          aria-label="迁移知识库存储"
          title="迁移知识库存储"
        >
          <Database className="size-3.5" />
        </button>
      </div>
      <div className="space-y-1">
        {props.uploads.map((upload) => (
          <div key={upload.id} className="rounded-md border border-border-light bg-white px-2 py-2">
            <div className="truncate text-xs font-medium text-foreground">
              {upload.stage === "reading" ? "正在读取" : upload.stage === "uploading" ? "正在上传" : "正在创建摄取任务"}
            </div>
            <div className="mt-0.5 truncate text-[10px] text-muted-foreground">
              {upload.name} · {(upload.size / 1024 / 1024).toFixed(1)} MiB · uploading
            </div>
            <div className="mt-2 h-1 overflow-hidden rounded bg-muted">
              <div className="h-full w-1/3 animate-pulse bg-primary" />
            </div>
          </div>
        ))}
        {props.jobs.slice(0, 12).map((job) => {
          const progress = ingestProgress(job);
          return (
            <div key={job.jobId} className="rounded-md border border-border-light bg-white px-2 py-2">
              <div className="flex items-center gap-2">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-xs font-medium text-foreground">{progress.message}</div>
                  <div className="mt-0.5 truncate text-[10px] text-muted-foreground">
                    {job.sourcePaths?.length === 1
                      ? pageTitle(job.sourcePaths[0])
                      : job.sourcePaths?.length
                        ? `${job.sourcePaths.length} 个来源`
                        : "全部来源"}{" "}
                    · {job.status}
                  </div>
                </div>
                {(job.status === "running" || job.status === "queued") && progress.stage !== "cancelling" ? (
                  <button
                    type="button"
                    onClick={() => props.onCancel(job.jobId)}
                    disabled={props.busy}
                    className="inline-flex size-7 items-center justify-center rounded-md text-rose-700 hover:bg-rose-50 disabled:opacity-50"
                    aria-label="取消摄取任务"
                    title="取消摄取任务"
                  >
                    <Square className="size-3" />
                  </button>
                ) : progress.stage === "cancelling" ? (
                  <Loader2
                    className="size-3.5 shrink-0 animate-spin text-muted-foreground"
                    aria-label="正在取消摄取任务"
                  />
                ) : job.status === "failed" || job.status === "cancelled" ? (
                  <button
                    type="button"
                    onClick={() => props.onRetry(job.jobId)}
                    disabled={props.busy}
                    className="inline-flex size-7 items-center justify-center rounded-md text-amber-700 hover:bg-amber-50 disabled:opacity-50"
                    aria-label="重试摄取任务"
                    title="重试摄取任务"
                  >
                    <RotateCcw className="size-3.5" />
                  </button>
                ) : null}
              </div>
              <div className="mt-2 h-1 overflow-hidden rounded bg-muted">
                <div
                  className="h-full bg-primary transition-[width]"
                  style={{ width: `${Math.max(0, Math.min(100, progress.percent))}%` }}
                />
              </div>
            </div>
          );
        })}
        {props.uploads.length === 0 && props.jobs.length === 0 ? (
          <div className="py-4 text-center text-xs text-muted-foreground">暂无摄取任务</div>
        ) : null}
      </div>

      <div className="mb-2 mt-4 text-[11px] font-semibold text-muted-foreground">最近审计</div>
      <div className="space-y-1">
        {props.audit.slice(0, 20).map((entry) => (
          <div key={entry.id} className="rounded-md border border-border-light bg-white px-2 py-1.5">
            <div className="truncate text-xs font-medium text-foreground">{entry.action}</div>
            <div className="mt-0.5 truncate text-[10px] text-muted-foreground">
              {entry.target || "知识库"} · {formatRelativeTime(entry.at)}
            </div>
          </div>
        ))}
        {props.audit.length === 0 ? (
          <div className="py-4 text-center text-xs text-muted-foreground">暂无审计记录</div>
        ) : null}
      </div>
    </div>
  );
}
