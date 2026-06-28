import {
  AlertCircle,
  Bot,
  CheckCircle2,
  FolderOpen,
  Loader2,
  Settings2,
  ShoppingBag,
  Sparkles,
  UploadCloud,
  X,
} from "lucide-react";
import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useSnapshot } from "valtio";

import AgentConfigPanel, { AdminAgentConfigPanel } from "@/components/agent-page/agent-config-panel";
import {
  ExternalSkillDropZone,
  ExternalSkillImportButton,
} from "@/components/agent-page/external-skill-import-controls";
import {
  type ExternalSkillImportFeedbackTone,
  type ExternalSkillImportStatus,
  resolveExternalSkillImportFeedback,
} from "@/components/agent-page/external-skill-import-state";
import { AssetFileManager, type AssetFileManagerStateSnapshot } from "@/components/workspace/asset-file-manager";
import { isDefaultAgentId, normalizeAgentId } from "@/lib/builtins";
import { allowsLocalWorkspacePaths } from "@/lib/runtime-environment";
import { cn } from "@/lib/utils";
import { workspaceApi } from "@/lib/workspace-api";
import { getSharedSkillsPath, getUserSkillsPath } from "@/lib/workspace-utils";
import agentRegistryModel from "@/models/agent-registry.model";
import globalModel from "@/models/global.model";

export type AgentSettingsTab = "config" | "skills" | "install";
export type AgentSkillsSubTab = "my" | "shared";

const agentSettingsTabs = [
  {
    key: "config",
    label: "参数配置",
    shortLabel: "参数",
    description: "模型、提示词和运行策略",
    icon: Settings2,
  },
  {
    key: "skills",
    label: "技能工作区",
    shortLabel: "技能",
    description: "管理个人与共享技能文件",
    icon: FolderOpen,
  },
  {
    key: "install",
    label: "技能市场",
    shortLabel: "市场",
    description: "浏览并安装可用技能",
    icon: ShoppingBag,
  },
] satisfies Array<{
  key: AgentSettingsTab;
  label: string;
  shortLabel: string;
  description: string;
  icon: typeof Settings2;
}>;

const agentSettingsSections = [
  {
    id: "agent",
    name: "智能体",
    icon: Bot,
    tabKeys: ["config"] as AgentSettingsTab[],
  },
  {
    id: "skills",
    name: "技能",
    icon: Sparkles,
    tabKeys: ["skills", "install"] as AgentSettingsTab[],
  },
];

const agentSettingsTabKeys = new Set<AgentSettingsTab>(agentSettingsTabs.map((tab) => tab.key));

function getAgentSettingsTabFromHash(hash: string): AgentSettingsTab | null {
  const value = decodeURIComponent(hash.replace(/^#/, ""));
  return agentSettingsTabKeys.has(value as AgentSettingsTab) ? (value as AgentSettingsTab) : null;
}

const LazySkillMarketBrowser = lazy(() =>
  import("@/components/agent-page/skill-market-browser").then((module) => ({
    default: module.SkillMarketBrowser,
  })),
);

const LazyAdminSkillMarketBrowser = lazy(() =>
  import("@/components/agent-page/skill-market-browser").then((module) => ({
    default: module.AdminSkillMarketBrowser,
  })),
);

export interface AgentSkillsWorkspaceState {
  currentAgent: ReturnType<typeof agentRegistryModel.getAllAgents>[number] | null;
  skillsPath: string | null;
  sharedSkillsPath: string | null;
  loading: boolean;
  error: string | null;
}

export interface AgentSkillsWorkspaceOptions {
  reloadKey?: number;
}

export interface AgentConfigSkillsWorkspaceProps {
  agentId: string;
  skillsPath: string | null | undefined;
  sharedSkillsPath: string | null | undefined;
  className?: string;
  defaultTab?: AgentSettingsTab;
  routeTabs?: boolean;
}

type AgentSkillsWorkspaceChrome = "desktop" | "admin";

const WORKSPACE_CHROME = {
  desktop: {
    root: "flex h-full min-h-0 w-full flex-col bg-background",
    tabBar: "shrink-0 border-b px-4 py-2",
    tabBarInner: "flex items-center gap-2",
    tabList: "flex items-center gap-0.5 rounded-md bg-muted p-0.5",
    tabButton: "rounded-md px-3 py-1 text-xs font-medium transition-colors",
    tabActive: "bg-background text-foreground shadow-sm",
    tabInactive: "text-muted-foreground hover:text-foreground",
    content: "min-h-0 flex-1",
    subTabBar: "shrink-0 border-b px-4 py-2",
    subTabBarInner: "flex items-center gap-2",
    subTabList: "flex shrink-0 items-center gap-0.5 rounded-md bg-muted p-0.5",
    subTabButton: "rounded-md px-2.5 py-0.5 text-[11px] font-medium transition-colors",
    subTabActive: "bg-background text-foreground shadow-sm",
    subTabInactive: "text-muted-foreground hover:text-foreground",
    marketClassName: "h-full",
  },
  admin: {
    root: "flex h-full min-h-0 w-full flex-col bg-white",
    tabBar: "shrink-0 border-b border-border-light bg-white px-3",
    tabBarInner: "flex h-10 items-center gap-3",
    tabList: "flex h-full items-center gap-4",
    tabButton:
      "relative flex h-full items-center border-b-2 border-transparent px-0 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground",
    tabActive: "border-primary text-foreground",
    tabInactive: "border-transparent",
    content: "min-h-0 flex-1 bg-white",
    subTabBar: "shrink-0 border-b border-border-light bg-[#fafafa] px-3 py-1.5",
    subTabBarInner: "flex items-center justify-between gap-3",
    subTabList: "inline-flex shrink-0 items-center gap-0.5 rounded-[4px] border border-border bg-white p-0.5",
    subTabButton: "h-6 rounded-[4px] px-2 text-xs font-medium transition-colors",
    subTabActive: "bg-muted/40 text-foreground shadow-sm",
    subTabInactive: "text-muted-foreground hover:bg-[#fafafa] hover:text-foreground",
    marketClassName: "h-full",
  },
} satisfies Record<AgentSkillsWorkspaceChrome, Record<string, string>>;

type WorkspaceChromeStyles = (typeof WORKSPACE_CHROME)[AgentSkillsWorkspaceChrome];

function resolveSkillWorkspaceUserId(authUserId: string | number | null | undefined, _localUserId: string | number) {
  const signedInUserId = String(authUserId ?? "").trim();
  return signedInUserId || (allowsLocalWorkspacePaths() ? "local" : "default");
}

function canManageSharedSkillWorkspace(chrome: AgentSkillsWorkspaceChrome): boolean {
  if (chrome === "desktop") return true;
  return false;
}

export function skillTemplate(stem: string): string {
  return `---
name: ${stem}
description: 技能描述
kind: instruction
tags:
  - custom
version: 1.0.0
---

# ${stem}

技能内容...
`;
}

function PanelLoadingFallback() {
  return (
    <div className="flex h-full items-center justify-center">
      <Loader2 className="size-5 animate-spin text-muted-foreground" />
    </div>
  );
}

export function useAgentSkillsWorkspace(
  agentId: string | null | undefined,
  options: AgentSkillsWorkspaceOptions = {},
): AgentSkillsWorkspaceState {
  const reloadKey = options.reloadKey ?? 0;
  const agentRegistryRevision = useSnapshot(agentRegistryModel.state).revision;
  const profileSnap = useSnapshot(globalModel.state);
  const [workspaceState, setWorkspaceState] = useState({
    skillsPath: null as string | null,
    sharedSkillsPath: null as string | null,
    loading: false,
    error: null as string | null,
  });

  useEffect(() => {
    void reloadKey;
    let cancelled = false;

    if (!agentId) {
      setWorkspaceState({
        skillsPath: null,
        sharedSkillsPath: null,
        loading: false,
        error: null,
      });
      return () => {
        cancelled = true;
      };
    }

    const currentAgentId = normalizeAgentId(agentId) ?? agentId;
    const currentUserId = resolveSkillWorkspaceUserId(null, profileSnap.user.id);
    setWorkspaceState((current) => ({ ...current, loading: true, error: null }));

    async function loadWorkspace() {
      try {
        await agentRegistryModel.loadServerAgents();
        const [skillsPath, sharedSkillsPath] = await Promise.all([
          getUserSkillsPath(currentUserId),
          getSharedSkillsPath(currentUserId),
        ]);

        const { getAgentById } = await import("@/lib/builtins");
        const builtinAgent = getAgentById(currentAgentId);
        if (builtinAgent?.builtin && !isDefaultAgentId(currentAgentId)) {
          const { initializeAgentDefaults } = await import("@/lib/workspace-utils");
          await initializeAgentDefaults("", currentAgentId);
        }

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
        console.error("[agent-skills] failed to prepare workspace:", error);
        setWorkspaceState({
          skillsPath: null,
          sharedSkillsPath: null,
          loading: false,
          error: error instanceof Error ? error.message : "加载智能体技能工作区失败",
        });
      }
    }

    void loadWorkspace();

    return () => {
      cancelled = true;
    };
  }, [agentId, profileSnap.user.id, reloadKey]);

  const currentAgent = useMemo(() => {
    void agentRegistryRevision;
    if (!agentId) return null;
    const currentAgentId = normalizeAgentId(agentId) ?? agentId;
    return agentRegistryModel.getAllAgents().find((agent) => agent.id === currentAgentId) ?? null;
  }, [agentId, agentRegistryRevision]);

  return {
    currentAgent,
    skillsPath: workspaceState.skillsPath,
    sharedSkillsPath: workspaceState.sharedSkillsPath,
    loading: workspaceState.loading,
    error: workspaceState.error,
  };
}

function skillScopeDescription(scope: AgentSkillsSubTab, canManageSharedSkills: boolean) {
  if (scope === "my") {
    return {
      label: "我的技能",
      badge: "个人",
      hint: "仅当前用户可用，可拖入 ZIP / Markdown 导入",
    };
  }
  return {
    label: "共享技能",
    badge: canManageSharedSkills ? "系统" : "只读",
    hint: canManageSharedSkills ? "系统级共享目录，可拖入 ZIP / Markdown 导入" : "共享技能由系统或管理员管理，当前只读",
  };
}

function SkillScopeTabs({
  activeTab,
  canManageSharedSkills,
  styles,
  onChange,
}: {
  activeTab: AgentSkillsSubTab;
  canManageSharedSkills: boolean;
  styles: WorkspaceChromeStyles;
  onChange: (tab: AgentSkillsSubTab) => void;
}) {
  return (
    <div className={styles.subTabList} role="tablist" aria-label="技能工作区范围">
      {(["my", "shared"] satisfies AgentSkillsSubTab[]).map((tabKey) => {
        const active = activeTab === tabKey;
        const meta = skillScopeDescription(tabKey, canManageSharedSkills);
        return (
          <button
            key={tabKey}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(tabKey)}
            className={cn(styles.subTabButton, active ? styles.subTabActive : styles.subTabInactive)}
          >
            <span>{meta.label}</span>
            <span
              className={cn(
                "ml-1.5 rounded-[4px] px-1.5 py-0.5 text-[10px] font-medium",
                active ? "bg-primary/10 text-primary" : "bg-[#f2f3f5] text-muted-foreground",
              )}
            >
              {meta.badge}
            </span>
          </button>
        );
      })}
    </div>
  );
}

const IMPORT_STATUS_TONE_CLASSNAME = {
  info: "border-primary/15 bg-primary/[0.04] text-primary",
  success: "border-emerald-200 bg-emerald-50 text-emerald-700",
  error: "border-destructive/20 bg-destructive/[0.06] text-destructive",
} satisfies Record<ExternalSkillImportFeedbackTone, string>;

function SkillImportStatusStrip({ status, onDismiss }: { status: ExternalSkillImportStatus; onDismiss: () => void }) {
  const feedback = resolveExternalSkillImportFeedback(status);
  if (!feedback) return null;

  const Icon = status.kind === "importing" ? Loader2 : feedback.tone === "success" ? CheckCircle2 : AlertCircle;
  const canDismiss = status.kind !== "importing";

  return (
    <div
      className={cn("shrink-0 border-b px-4 py-2", IMPORT_STATUS_TONE_CLASSNAME[feedback.tone])}
      role={feedback.role}
      aria-live={feedback.ariaLive}
    >
      <div className="flex min-h-7 items-center gap-2 text-xs">
        <Icon className={cn("size-4 shrink-0", status.kind === "importing" && "animate-spin")} aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <span className="font-medium">{feedback.title}</span>
          <span className="ml-2 break-words text-foreground/75">{feedback.description}</span>
        </div>
        {canDismiss ? (
          <button
            type="button"
            aria-label="关闭导入状态"
            title="关闭导入状态"
            className="inline-flex size-6 shrink-0 items-center justify-center rounded-[4px] text-current opacity-70 transition-opacity hover:opacity-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-current/40"
            onClick={onDismiss}
          >
            <X className="size-3.5" aria-hidden="true" />
          </button>
        ) : null}
      </div>
    </div>
  );
}

function SkillWorkspacePanel({
  agentId,
  chrome,
  styles,
  skillsPath,
  sharedSkillsPath,
  skillsSubTab,
  canManageSharedSkills,
  onSubTabChange,
  onWorkspaceStateChange,
}: {
  agentId: string;
  chrome: AgentSkillsWorkspaceChrome;
  styles: WorkspaceChromeStyles;
  skillsPath: string | null | undefined;
  sharedSkillsPath: string | null | undefined;
  skillsSubTab: AgentSkillsSubTab;
  canManageSharedSkills: boolean;
  onSubTabChange: (tab: AgentSkillsSubTab) => void;
  onWorkspaceStateChange: (snapshot: AssetFileManagerStateSnapshot) => void;
}) {
  const activeSkillsRootPath = skillsSubTab === "my" ? skillsPath : sharedSkillsPath;
  const activeSkillsTargetLabel = skillsSubTab === "my" ? "我的技能" : "共享技能";
  const skillsCommandScope = `skills:${agentId || "unknown"}:${skillsSubTab}`;
  const activeSkillsReadOnly = skillsSubTab === "shared" && !canManageSharedSkills;
  const activeMeta = skillScopeDescription(skillsSubTab, canManageSharedSkills);
  const [skillImportStatus, setSkillImportStatus] = useState<ExternalSkillImportStatus>({ kind: "idle" });

  useEffect(() => {
    void activeSkillsRootPath;
    void skillsCommandScope;
    setSkillImportStatus({ kind: "idle" });
  }, [activeSkillsRootPath, skillsCommandScope]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className={styles.subTabBar}>
        <div className={styles.subTabBarInner}>
          {chrome === "admin" ? (
            <div className="hidden min-w-0 items-center gap-1.5 text-xs font-medium text-primary md:flex">
              <FolderOpen className="size-3.5 shrink-0" />
              <span className="truncate">技能工作区</span>
            </div>
          ) : null}

          <SkillScopeTabs
            activeTab={skillsSubTab}
            canManageSharedSkills={canManageSharedSkills}
            styles={styles}
            onChange={onSubTabChange}
          />

          <div className="hidden min-w-0 flex-1 items-center justify-end gap-2 text-xs text-muted-foreground sm:flex">
            <UploadCloud className="size-3.5 shrink-0 text-primary" />
            <span className="truncate">{activeMeta.hint}</span>
            <ExternalSkillImportButton
              rootPath={activeSkillsRootPath}
              commandScope={skillsCommandScope}
              targetLabel={activeSkillsTargetLabel}
              disabled={activeSkillsReadOnly}
              disabledReason="共享技能目录需要管理权限"
              onImportStatusChange={setSkillImportStatus}
            />
          </div>
          <div className="shrink-0 sm:hidden">
            <ExternalSkillImportButton
              rootPath={activeSkillsRootPath}
              commandScope={skillsCommandScope}
              targetLabel={activeSkillsTargetLabel}
              disabled={activeSkillsReadOnly}
              disabledReason="共享技能目录需要管理权限"
              onImportStatusChange={setSkillImportStatus}
            />
          </div>
        </div>
      </div>

      <SkillImportStatusStrip status={skillImportStatus} onDismiss={() => setSkillImportStatus({ kind: "idle" })} />

      <div className="min-h-0 flex-1">
        <ExternalSkillDropZone
          rootPath={activeSkillsRootPath}
          commandScope={skillsCommandScope}
          targetLabel={activeSkillsTargetLabel}
          disabled={activeSkillsReadOnly}
          disabledReason="共享技能目录需要管理权限"
          onImportStatusChange={setSkillImportStatus}
        >
          <AssetFileManager
            key={`${agentId}-${skillsSubTab}`}
            rootPath={activeSkillsRootPath}
            newFileTemplate={skillTemplate}
            className="h-full"
            readOnly={activeSkillsReadOnly}
            commandScope={skillsCommandScope}
            onStateChange={onWorkspaceStateChange}
          />
        </ExternalSkillDropZone>
      </div>
    </div>
  );
}

function AgentConfigSkillsWorkspaceBase({
  agentId,
  skillsPath,
  sharedSkillsPath,
  className,
  defaultTab = "config",
  chrome,
  controlledTab,
  onTabChange,
}: AgentConfigSkillsWorkspaceProps & {
  chrome: AgentSkillsWorkspaceChrome;
  controlledTab?: AgentSettingsTab;
  onTabChange?: (tab: AgentSettingsTab) => void;
}) {
  const styles = WORKSPACE_CHROME[chrome];
  const ConfigPanel = chrome === "admin" ? AdminAgentConfigPanel : AgentConfigPanel;
  const MarketBrowser = chrome === "admin" ? LazyAdminSkillMarketBrowser : LazySkillMarketBrowser;
  const initialTab = controlledTab ?? defaultTab;
  const defaultSkillsSubTab: AgentSkillsSubTab = chrome === "admin" ? "shared" : "my";
  const [tab, setTab] = useState<AgentSettingsTab>(initialTab);
  const [skillsSubTab, setSkillsSubTab] = useState<AgentSkillsSubTab>(defaultSkillsSubTab);
  const [skillsDirtyCount, setSkillsDirtyCount] = useState(0);
  const activeTab = controlledTab ?? tab;
  const resetTab = controlledTab ?? defaultTab;
  const resetKey = `${agentId}:${resetTab}`;

  useEffect(() => {
    if (!resetKey) return;
    setTab(resetTab);
    setSkillsSubTab(defaultSkillsSubTab);
    setSkillsDirtyCount(0);
  }, [defaultSkillsSubTab, resetKey, resetTab]);

  const confirmDiscardSkillEdits = useCallback(() => {
    return skillsDirtyCount === 0 || window.confirm("当前技能文件还有未保存修改，切换页面会关闭当前编辑器。是否继续？");
  }, [skillsDirtyCount]);

  const handleTabChange = useCallback(
    (nextTab: AgentSettingsTab) => {
      if (activeTab === nextTab) return;
      if (activeTab === "skills" && !confirmDiscardSkillEdits()) return;
      if (controlledTab === undefined) {
        setTab(nextTab);
      }
      onTabChange?.(nextTab);
      if (nextTab !== "skills") {
        setSkillsDirtyCount(0);
      }
    },
    [activeTab, confirmDiscardSkillEdits, controlledTab, onTabChange],
  );

  const handleSkillsSubTabChange = useCallback(
    (nextTab: AgentSkillsSubTab) => {
      if (skillsSubTab === nextTab) return;
      if (!confirmDiscardSkillEdits()) return;
      setSkillsDirtyCount(0);
      setSkillsSubTab(nextTab);
    },
    [confirmDiscardSkillEdits, skillsSubTab],
  );

  const handleWorkspaceStateChange = useCallback((snapshot: AssetFileManagerStateSnapshot) => {
    setSkillsDirtyCount(snapshot.dirtyFileCount);
  }, []);

  const selectedTab = agentSettingsTabs.find((tab) => tab.key === activeTab) ?? agentSettingsTabs[0];
  const SelectedTabIcon = selectedTab.icon;
  const canManageSharedSkills = useMemo(() => canManageSharedSkillWorkspace(chrome), [chrome]);
  const marketInstallPath = chrome === "admin" ? sharedSkillsPath : skillsPath;
  const marketInstallLabel = chrome === "admin" ? "InternShannon共享技能" : "我的技能";

  const activePanel =
    activeTab === "config" ? (
      <ConfigPanel agentId={agentId} skillsPath={chrome === "admin" ? sharedSkillsPath : skillsPath} />
    ) : activeTab === "skills" ? (
      <SkillWorkspacePanel
        agentId={agentId}
        chrome={chrome}
        styles={styles}
        skillsPath={skillsPath}
        sharedSkillsPath={sharedSkillsPath}
        skillsSubTab={skillsSubTab}
        canManageSharedSkills={canManageSharedSkills}
        onSubTabChange={handleSkillsSubTabChange}
        onWorkspaceStateChange={handleWorkspaceStateChange}
      />
    ) : (
      <Suspense fallback={<PanelLoadingFallback />}>
        <MarketBrowser
          className={styles.marketClassName}
          installPath={marketInstallPath}
          installLabel={marketInstallLabel}
        />
      </Suspense>
    );

  if (chrome === "admin") {
    return (
      <div className={cn("flex h-full min-h-0 bg-muted/40", className)}>
        <aside className="hidden w-60 shrink-0 flex-col border-r border-border-light bg-white md:flex">
          <div className="border-b border-border-light px-4 py-3">
            <div className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-primary">
              <Bot className="size-3.5" />
              智能体
            </div>
            <h2 className="text-base font-semibold text-foreground">配置</h2>
            <p className="mt-0.5 text-xs leading-4 text-muted-foreground">管理默认参数、技能工作区和市场安装。</p>
          </div>

          <nav className="min-h-0 flex-1 overflow-y-auto p-2" aria-label="智能体配置">
            {agentSettingsSections.map((section) => {
              const SectionIcon = section.icon;
              return (
                <div key={section.id} className="mb-3 last:mb-0">
                  <div className="mb-1 flex items-center gap-1.5 px-2 text-[11px] font-semibold text-muted-foreground">
                    <SectionIcon className="size-3" />
                    {section.name}
                  </div>
                  <div className="space-y-1">
                    {section.tabKeys.map((tabKey) => {
                      const tab = agentSettingsTabs.find((item) => item.key === tabKey) ?? agentSettingsTabs[0];
                      const Icon = tab.icon;
                      const active = tab.key === activeTab;
                      return (
                        <button
                          key={tab.key}
                          type="button"
                          aria-current={active ? "page" : undefined}
                          onClick={() => handleTabChange(tab.key)}
                          className={cn(
                            "group flex w-full items-start gap-2 rounded-[4px] px-2.5 py-2 text-left transition-colors",
                            active
                              ? "bg-primary/10 text-primary"
                              : "text-muted-foreground hover:bg-[#f6f8fa] hover:text-foreground",
                          )}
                        >
                          <Icon className="mt-0.5 size-3.5 shrink-0" />
                          <span className="min-w-0 flex-1">
                            <span className="block text-sm font-medium leading-5">{tab.label}</span>
                            <span
                              className={cn(
                                "block truncate text-[11px] leading-4",
                                active ? "text-primary/70" : "text-muted-foreground group-hover:text-muted-foreground",
                              )}
                            >
                              {tab.description}
                            </span>
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </nav>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <div className="border-b border-border-light bg-white p-2.5 md:hidden">
            <div className="flex items-center gap-1.5 text-xs font-medium text-primary">
              <SelectedTabIcon className="size-3.5" />
              配置 / {selectedTab.label}
            </div>
            <div className="mt-2 flex gap-1.5 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {agentSettingsTabs.map((tab) => {
                const Icon = tab.icon;
                const active = tab.key === activeTab;
                return (
                  <button
                    key={tab.key}
                    type="button"
                    aria-current={active ? "page" : undefined}
                    onClick={() => handleTabChange(tab.key)}
                    className={cn(
                      "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-[4px] border px-2.5 text-xs transition-colors",
                      active
                        ? "border-primary/20 bg-primary/10 text-primary"
                        : "border-border-light bg-white text-muted-foreground",
                    )}
                  >
                    <Icon className="size-3.5" />
                    {tab.shortLabel}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="min-h-0 flex-1 bg-white">{activePanel}</div>
        </div>
      </div>
    );
  }

  return (
    <div className={cn(styles.root, className)}>
      <div className={styles.tabBar}>
        <div className={styles.tabBarInner}>
          <div className={styles.tabList}>
            {agentSettingsTabs.map((tab) => (
              <button
                key={tab.key}
                type="button"
                onClick={() => {
                  handleTabChange(tab.key);
                }}
                className={cn(styles.tabButton, activeTab === tab.key ? styles.tabActive : styles.tabInactive)}
              >
                {tab.shortLabel}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className={styles.content}>{activePanel}</div>
    </div>
  );
}

export function AgentConfigSkillsWorkspace(props: AgentConfigSkillsWorkspaceProps) {
  return <AgentConfigSkillsWorkspaceBase {...props} chrome="desktop" />;
}

export function AdminAgentConfigSkillsWorkspace(props: AgentConfigSkillsWorkspaceProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const routeTabs = props.routeTabs ?? true;
  const activeTab = routeTabs
    ? (getAgentSettingsTabFromHash(location.hash) ?? props.defaultTab ?? "config")
    : undefined;
  const handleTabChange = useCallback(
    (tab: AgentSettingsTab) => {
      if (!routeTabs) return;
      navigate(
        {
          pathname: location.pathname,
          search: location.search,
          hash: tab === "config" ? "" : tab,
        },
        { replace: true },
      );
    },
    [location.pathname, location.search, navigate, routeTabs],
  );

  return (
    <AgentConfigSkillsWorkspaceBase
      {...props}
      chrome="admin"
      controlledTab={activeTab}
      onTabChange={routeTabs ? handleTabChange : undefined}
    />
  );
}
