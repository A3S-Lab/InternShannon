import { Check, FileText, Link2, RefreshCw, RotateCcw, X } from "lucide-react";
import type { WikiCurationSuggestion } from "@/lib/api/assets";
import { cn } from "@/lib/utils";
import { pageTitle } from "../knowledge-page-utils";

export function CurationPane(props: {
  suggestions: WikiCurationSuggestion[];
  busy: boolean;
  onRefresh: () => void;
  onReview: (suggestionId: string, decision: "accept" | "reject" | "revert") => void;
}) {
  const suggestions = props.suggestions.slice().sort((left, right) => {
    if (left.status !== right.status) return left.status === "pending" ? -1 : right.status === "pending" ? 1 : 0;
    if (left.status === "pending") return right.similarity - left.similarity;
    return (
      new Date(right.reviewedAt ?? right.createdAt).getTime() - new Date(left.reviewedAt ?? left.createdAt).getTime()
    );
  });
  return (
    <div className="flex h-full min-h-0 flex-col bg-[#f7f7f5]">
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border-light bg-white px-2">
        <div className="min-w-0 flex-1 truncate text-xs font-semibold text-foreground">
          待审阅 {suggestions.filter((item) => item.status === "pending").length}
        </div>
        <button
          type="button"
          onClick={props.onRefresh}
          disabled={props.busy}
          className="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
          aria-label="刷新策展建议"
          title="刷新策展建议"
        >
          <RefreshCw className={cn("size-3.5", props.busy && "animate-spin")} />
        </button>
      </div>
      <div className="min-h-0 flex-1 space-y-1 overflow-y-auto p-2">
        {suggestions.map((suggestion) => (
          <div key={suggestion.id} className="rounded-md border border-border-light bg-white px-2 py-2">
            <div className="flex items-start gap-2">
              {suggestion.kind === "link" ? (
                <Link2 className="mt-0.5 size-3.5 shrink-0 text-primary" />
              ) : (
                <FileText className="mt-0.5 size-3.5 shrink-0 text-primary" />
              )}
              <div className="min-w-0 flex-1">
                <div className="truncate text-xs font-medium text-foreground">
                  {suggestion.kind === "link"
                    ? "建链"
                    : suggestion.kind === "summary"
                      ? "摘要"
                      : suggestion.kind === "merge"
                        ? "合并草稿"
                        : "页面草稿"}{" "}
                  · {pageTitle(suggestion.sourcePath)}
                </div>
                <div className="mt-0.5 flex items-center gap-1 truncate text-[10px] text-muted-foreground">
                  <span className="truncate">{suggestion.targetTitle}</span>
                  <span className="shrink-0">{Math.round(suggestion.similarity * 100)}%</span>
                </div>
                {suggestion.proposedContent ? (
                  <div className="mt-1 line-clamp-2 text-[10px] leading-4 text-muted-foreground">
                    {suggestion.proposedContent}
                  </div>
                ) : null}
              </div>
              {suggestion.status === "pending" ? (
                <div className="flex shrink-0 items-center gap-0.5">
                  <button
                    type="button"
                    onClick={() => props.onReview(suggestion.id, "accept")}
                    disabled={props.busy}
                    className="inline-flex size-7 items-center justify-center rounded-md text-emerald-700 transition-colors hover:bg-emerald-50 disabled:opacity-50"
                    aria-label="接受建链建议"
                    title="接受建链建议"
                  >
                    <Check className="size-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => props.onReview(suggestion.id, "reject")}
                    disabled={props.busy}
                    className="inline-flex size-7 items-center justify-center rounded-md text-rose-700 transition-colors hover:bg-rose-50 disabled:opacity-50"
                    aria-label="拒绝建链建议"
                    title="拒绝建链建议"
                  >
                    <X className="size-3.5" />
                  </button>
                </div>
              ) : suggestion.status === "accepted" ? (
                <button
                  type="button"
                  onClick={() => props.onReview(suggestion.id, "revert")}
                  disabled={props.busy}
                  className="inline-flex size-7 shrink-0 items-center justify-center rounded-md text-amber-700 transition-colors hover:bg-amber-50 disabled:opacity-50"
                  aria-label="撤销已接受的建议"
                  title="撤销已接受的建议"
                >
                  <RotateCcw className="size-3.5" />
                </button>
              ) : (
                <span className="shrink-0 text-[10px] text-muted-foreground">
                  {suggestion.status === "reverted" ? "已撤销" : "已拒绝"}
                </span>
              )}
            </div>
          </div>
        ))}
        {suggestions.length === 0 ? (
          <div className="rounded-md border border-dashed border-border px-3 py-6 text-center text-xs text-muted-foreground">
            暂无策展建议
          </div>
        ) : null}
      </div>
    </div>
  );
}
