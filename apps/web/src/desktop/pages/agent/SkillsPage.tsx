/**
 * Skills Editor - Manage agent defaults, local skills, shared skills, and backend marketplace installs.
 */

import { AlertTriangle, ArrowLeft, Loader2, RefreshCw, Settings2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { AgentAvatar } from "@/components/agent-page/agent-avatar";
import { AgentConfigSkillsWorkspace, useAgentSkillsWorkspace } from "@/components/agent-page/agent-skills-workspace";
import { DEFAULT_AGENT_ID } from "@/lib/builtins";
import type { SkillsPageStatus } from "./skills-page-state";
import { resolveSkillsPageStatus } from "./skills-page-state";

function SkillsPageStatusPanel({
  status,
  onRetry,
  onOpenSettings,
}: {
  status: SkillsPageStatus;
  onRetry: () => void;
  onOpenSettings: () => void;
}) {
  const isProgress = status.kind === "loading" || status.kind === "retrying";
  const Icon = isProgress ? Loader2 : AlertTriangle;

  return (
    <div className="flex h-full min-h-[280px] items-center justify-center px-4 py-6" aria-live="polite">
      <div className="flex max-w-md flex-col items-center text-center">
        <div
          className={
            isProgress
              ? "flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary"
              : "flex size-10 items-center justify-center rounded-lg bg-destructive/10 text-destructive"
          }
        >
          <Icon className={isProgress ? "size-5 animate-spin" : "size-5"} />
        </div>
        <h2 className="mt-3 text-sm font-semibold text-foreground">{status.title}</h2>
        <p className="mt-1 max-w-sm text-xs leading-5 text-muted-foreground">{status.description}</p>
        {isProgress ? null : (
          <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
            <button
              type="button"
              onClick={onRetry}
              className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-background px-3 text-xs font-medium text-foreground transition-colors hover:bg-muted"
            >
              <RefreshCw className="size-3.5" />
              重试
            </button>
            <button
              type="button"
              onClick={onOpenSettings}
              className="inline-flex h-8 items-center gap-1.5 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90"
            >
              <Settings2 className="size-3.5" />
              打开工作区设置
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export default function SkillsPage() {
  const { agentId: agentIdParam } = useParams<{ agentId: string }>();
  const navigate = useNavigate();
  const [reloadKey, setReloadKey] = useState(0);
  const [retrying, setRetrying] = useState(false);
  const retryObservedLoadingRef = useRef(false);
  const isMenuMode = !agentIdParam;
  const agentId = agentIdParam ?? DEFAULT_AGENT_ID;
  const { currentAgent, skillsPath, sharedSkillsPath, loading, error } = useAgentSkillsWorkspace(agentId, {
    reloadKey,
  });
  const status = resolveSkillsPageStatus({ loading, retrying, error, skillsPath, sharedSkillsPath });
  const workspaceReady = status.kind === "ready" && skillsPath && sharedSkillsPath;

  useEffect(() => {
    if (!retrying) {
      retryObservedLoadingRef.current = false;
      return;
    }

    if (loading) {
      retryObservedLoadingRef.current = true;
      return;
    }

    if (retryObservedLoadingRef.current) {
      retryObservedLoadingRef.current = false;
      setRetrying(false);
    }
  }, [loading, retrying]);

  const handleRetry = useCallback(() => {
    setRetrying(true);
    setReloadKey((current) => current + 1);
  }, []);

  return (
    <div className="flex h-full w-full flex-col bg-background">
      <div className="flex shrink-0 items-center gap-3 border-b px-4 py-2.5">
        {isMenuMode ? null : (
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            aria-label="返回"
          >
            <ArrowLeft className="size-3.5" />
          </button>
        )}
        <div className="flex min-w-0 flex-1 items-center gap-2.5">
          {currentAgent ? (
            <AgentAvatar
              agent={currentAgent}
              className="size-8 shrink-0 rounded-lg shadow-sm shadow-black/5 ring-1 ring-border/60"
            />
          ) : null}
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold text-foreground">{currentAgent?.name ?? "智能体配置"}</div>
            <div className="flex items-center gap-1.5 truncate text-[11px] text-muted-foreground">
              {status.kind === "loading" || status.kind === "retrying" ? (
                <Loader2 className="size-3 shrink-0 animate-spin" />
              ) : null}
              {status.kind === "error" || status.kind === "not-ready" ? (
                <AlertTriangle className="size-3 shrink-0 text-destructive" />
              ) : null}
              <span className="truncate">{status.kind === "ready" ? status.description : status.title}</span>
            </div>
          </div>
        </div>
      </div>

      <div className="relative min-h-0 flex-1 w-full">
        {workspaceReady ? (
          <AgentConfigSkillsWorkspace
            agentId={agentId}
            skillsPath={skillsPath}
            sharedSkillsPath={sharedSkillsPath}
            className="h-full"
          />
        ) : (
          <SkillsPageStatusPanel
            status={status}
            onRetry={handleRetry}
            onOpenSettings={() => navigate("/settings?section=workspace")}
          />
        )}
      </div>
    </div>
  );
}
