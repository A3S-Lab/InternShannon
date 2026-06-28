import {
  AlertTriangle,
  FolderOpen,
  Loader2,
  RefreshCw,
  Settings2,
  UsersRound,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useSnapshot } from "valtio";

import { AgentAvatar } from "@/components/agent-page/agent-avatar";
import AgentConfigPanel from "@/components/agent-page/agent-config-panel";
import {
  AssetFileManager,
  type AssetFileManagerStateSnapshot,
} from "@/components/workspace/asset-file-manager";
import { Button } from "@/components/ui/button";
import { DEFAULT_AGENT_ID, getAgentById, normalizeAgentId } from "@/lib/builtins";
import { cn } from "@/lib/utils";
import { workspaceApi } from "@/lib/workspace-api";
import { getSharedSkillsPath, getUserSkillsPath } from "@/lib/workspace-utils";
import agentRegistryModel from "@/models/agent-registry.model";
import { SectionHeader, SidebarLayout, type SidebarSection } from "@/desktop/layouts/sidebar-layout";
import type { SkillsPageSection, SkillsPageStatus } from "./skills-page-state";
import { getSkillsPageSectionFromSearch, resolveSkillsPageStatus } from "./skills-page-state";

interface SkillsWorkspaceState {
  skillsPath: string | null;
  sharedSkillsPath: string | null;
  loading: boolean;
  error: string | null;
}

const sections: SidebarSection<SkillsPageSection>[] = [
  {
    id: "config",
    label: "参数配置",
    icon: Settings2,
    description: "配置书小安新会话的模型、权限和默认技能。",
  },
  {
    id: "personal",
    label: "我的技能",
    icon: FolderOpen,
    description: "编辑当前用户自己的本地技能文件。",
  },
  {
    id: "shared",
    label: "共享技能",
    icon: UsersRound,
    description: "编辑书小安可复用的共享技能文件。",
  },
];

function skillTemplate(stem: string): string {
  return `---
name: ${stem}
description: 技能描述
kind: instruction
tags:
  - custom
version: 1.0.0
---

# ${stem}

在这里写下这个技能的触发场景、工作原则和输出要求。
`;
}

function useSkillsWorkspace(agentId: string, reloadKey: number) {
  const registryRevision = useSnapshot(agentRegistryModel.state).revision;
  const [workspaceState, setWorkspaceState] = useState<SkillsWorkspaceState>({
    skillsPath: null,
    sharedSkillsPath: null,
    loading: false,
    error: null,
  });

  useEffect(() => {
    let cancelled = false;
    setWorkspaceState((current) => ({ ...current, loading: true, error: null }));

    async function loadWorkspace() {
      try {
        await agentRegistryModel.loadServerAgents();
        const [skillsPath, sharedSkillsPath] = await Promise.all([
          getUserSkillsPath(null),
          getSharedSkillsPath(null),
        ]);

        await Promise.all([workspaceApi.mkdir(skillsPath), workspaceApi.mkdir(sharedSkillsPath)]);

        if (cancelled) return;
        setWorkspaceState({
          skillsPath,
          sharedSkillsPath,
          loading: false,
          error: null,
        });
      } catch (error) {
        if (cancelled) return;
        setWorkspaceState({
          skillsPath: null,
          sharedSkillsPath: null,
          loading: false,
          error: error instanceof Error ? error.message : "加载书小安技能工作区失败",
        });
      }
    }

    void loadWorkspace();

    return () => {
      cancelled = true;
    };
  }, [agentId, reloadKey]);

  const currentAgent = useMemo(() => {
    void registryRevision;
    const currentAgentId = normalizeAgentId(agentId) ?? DEFAULT_AGENT_ID;
    return agentRegistryModel.getAllAgents().find((agent) => agent.id === currentAgentId) ?? getAgentById(currentAgentId) ?? null;
  }, [agentId, registryRevision]);

  return {
    currentAgent,
    ...workspaceState,
  };
}

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
    <div className="flex h-full min-h-[320px] items-center justify-center px-4 py-6" aria-live="polite">
      <div className="flex max-w-md flex-col items-center text-center">
        <div
          className={cn(
            "flex size-10 items-center justify-center rounded-lg",
            isProgress ? "bg-primary/10 text-primary" : "bg-destructive/10 text-destructive",
          )}
        >
          <Icon className={cn("size-5", isProgress && "animate-spin")} />
        </div>
        <h2 className="mt-3 text-sm font-semibold text-foreground">{status.title}</h2>
        <p className="mt-1 max-w-sm text-xs leading-5 text-muted-foreground">{status.description}</p>
        {isProgress ? null : (
          <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
            <Button type="button" variant="outline" size="sm" onClick={onRetry}>
              <RefreshCw className="size-3.5" />
              重试
            </Button>
            <Button type="button" size="sm" onClick={onOpenSettings}>
              打开工作区设置
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

function SkillWorkspacePanel({
  title,
  description,
  icon,
  rootPath,
  commandScope,
  shared,
}: {
  title: string;
  description: string;
  icon: typeof FolderOpen;
  rootPath: string | null | undefined;
  commandScope: string;
  shared?: boolean;
}) {
  const [dirtyFileCount, setDirtyFileCount] = useState(0);
  const handleStateChange = useCallback((snapshot: AssetFileManagerStateSnapshot) => {
    setDirtyFileCount(snapshot.dirtyFileCount);
  }, []);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 border-b border-border-light bg-white px-4 py-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <SectionHeader title={title} description={description} icon={icon} />
          <div className="rounded-md border border-border-light bg-[#fbfcfd] px-3 py-2 text-xs text-muted-foreground">
            {dirtyFileCount > 0 ? `有 ${dirtyFileCount} 个文件未保存` : "文件已保存"}
          </div>
        </div>
        <div className="min-w-0 rounded-md border border-border-light bg-[#fbfcfd] px-3 py-2 text-xs text-muted-foreground">
          <div className="font-medium text-foreground">{shared ? "共享技能目录" : "个人技能目录"}</div>
          <div className="mt-1 break-all font-mono">{rootPath || "未准备"}</div>
        </div>
      </div>
      <div className="min-h-0 flex-1">
        <AssetFileManager
          key={commandScope}
          rootPath={rootPath}
          newFileTemplate={skillTemplate}
          className="h-full"
          commandScope={commandScope}
          autoExpandDepth={2}
          onStateChange={handleStateChange}
        />
      </div>
    </div>
  );
}

export default function SkillsPage() {
  const { agentId: agentIdParam } = useParams<{ agentId: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const [reloadKey, setReloadKey] = useState(0);
  const [retrying, setRetrying] = useState(false);
  const retryObservedLoadingRef = useRef(false);
  const agentId = normalizeAgentId(agentIdParam) ?? DEFAULT_AGENT_ID;
  const { currentAgent, skillsPath, sharedSkillsPath, loading, error } = useSkillsWorkspace(agentId, reloadKey);
  const status = resolveSkillsPageStatus({ loading, retrying, error, skillsPath, sharedSkillsPath });
  const workspaceReady = status.kind === "ready" && skillsPath && sharedSkillsPath;
  const currentSection = getSkillsPageSectionFromSearch(location.search);

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

  const handleSectionChange = useCallback(
    (section: SkillsPageSection) => {
      const next = new URLSearchParams(searchParams);
      if (section === "config") next.delete("section");
      else next.set("section", section);
      setSearchParams(next, { replace: true });
    },
    [searchParams, setSearchParams],
  );

  const headerSlot = (
    <div className="px-4 py-4">
      <div className="flex min-w-0 items-center gap-2.5">
        <AgentAvatar
          agent={currentAgent}
          className="size-8 shrink-0 rounded-lg shadow-sm shadow-black/5 ring-1 ring-border/60"
        />
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-[var(--col-text01)]">书小安配置</div>
          <div className="truncate text-xs text-[var(--col-text04)]">
            {status.kind === "ready" ? "参数配置与本地技能文件" : status.title}
          </div>
        </div>
      </div>
    </div>
  );

  if (!workspaceReady) {
    return (
      <div className="flex h-full w-full flex-col bg-background">
        <SkillsPageStatusPanel
          status={status}
          onRetry={handleRetry}
          onOpenSettings={() => navigate("/settings?section=workspace")}
        />
      </div>
    );
  }

  const content =
    currentSection === "config" ? (
      <AgentConfigPanel agentId={agentId} skillsPath={skillsPath} />
    ) : currentSection === "personal" ? (
      <SkillWorkspacePanel
        title="我的技能"
        description="这些 skill 文件只属于当前本地用户，适合沉淀个人写作、分析和工作习惯。"
        icon={FolderOpen}
        rootPath={skillsPath}
        commandScope={`skills:${agentId}:personal`}
      />
    ) : currentSection === "shared" ? (
      <SkillWorkspacePanel
        title="共享技能"
        description="这些 skill 文件可作为书小安的共享能力素材，适合放团队通用流程。"
        icon={UsersRound}
        rootPath={sharedSkillsPath}
        commandScope={`skills:${agentId}:shared`}
        shared
      />
    ) : null;

  return (
    <SidebarLayout
      title="书小安配置"
      subtitle="智能体参数与技能文件"
      headerSlot={headerSlot}
      sections={sections}
      current={currentSection}
      onChange={handleSectionChange}
      footer="书小安"
      noPadding
      contentMaxWidth="max-w-4xl"
      contentOverflow="hidden"
    >
      {content}
    </SidebarLayout>
  );
}
