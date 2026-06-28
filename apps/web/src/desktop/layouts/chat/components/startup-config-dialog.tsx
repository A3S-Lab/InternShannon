import { FolderOpen, Loader2, Settings2, UserRound } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useSnapshot } from "valtio";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { AvatarUploader } from "@/desktop/components/avatar-uploader";
import { workspaceAssetPath } from "@/desktop/constants";
import { fileToDataUrl } from "@/desktop/lib/image";
import { desktopOnlyMessage, openNativeDirectoryDialog } from "@/desktop/lib/tauri-runtime";
import { AiSection } from "@/desktop/pages/settings/components/ai-section";
import { notifyClientError } from "@/lib/client-error";
import {
  ensureWorkspaceReadiness,
  formatWorkspaceValidationError,
  inspectWorkspaceReadiness,
} from "@/lib/workspace-utils";
import globalModel from "@/models/global.model";
import type { ProviderConfig } from "@/models/settings.model";
import settingsModel from "@/models/settings.model";

const OPENAI_PROVIDER = "openai";
const DEFAULT_OPENAI_BASE_URL = "https://api.openai.com/v1";
const DEFAULT_PROFILE_NICKNAME = "本地用户";

async function ensureBackendModelsLoaded() {
  if (
    settingsModel.state.providers.length > 0 &&
    settingsModel.state.defaultProvider.trim() &&
    settingsModel.state.defaultModel.trim()
  ) {
    return;
  }

  await settingsModel.seedFromBackend({ retries: 20, retryDelayMs: 500 });
}

function ensureOpenAiProvider() {
  const existing = settingsModel.state.providers.find((provider) => provider.name === OPENAI_PROVIDER);
  if (existing) return existing;

  const provider: ProviderConfig = {
    name: OPENAI_PROVIDER,
    apiKey: "",
    baseUrl: DEFAULT_OPENAI_BASE_URL,
    models: [],
  };
  settingsModel.addProvider(provider);
  return provider;
}

export function StartupConfigDialog() {
  const snap = useSnapshot(settingsModel.state);
  const profileSnap = useSnapshot(globalModel.state);
  const [seeded, setSeeded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [nickname, setNickname] = useState("");
  const [avatar, setAvatar] = useState(workspaceAssetPath("logo.png"));
  const [workspaceRoot, setWorkspaceRoot] = useState("");
  const dialogContentRef = useRef<HTMLDivElement>(null);
  const defaultWorkspaceLoadedRef = useRef(false);
  const workspaceDraftTouchedRef = useRef(false);

  useEffect(() => {
    let mounted = true;
    settingsModel.waitForSeed().then(async () => {
      if (!mounted) return;
      await ensureBackendModelsLoaded();
      if (!mounted) return;

      const fallbackProvider = settingsModel.state.providers[0] || ensureOpenAiProvider();
      if (!settingsModel.state.defaultProvider) {
        const defaultProviderName = settingsModel.state.providers[0]?.name || fallbackProvider.name;
        const defaultModelId =
          settingsModel.state.providers.find((provider) => provider.name === defaultProviderName)?.models[0]?.id || "";
        settingsModel.setDefault(defaultProviderName, defaultModelId);
      }
      setSeeded(true);
    });
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (!seeded) return;
    setNickname(profileSnap.user.nickname || DEFAULT_PROFILE_NICKNAME);
    setAvatar(profileSnap.user.avatar || workspaceAssetPath("logo.png"));
    setWorkspaceRoot(snap.agentDefaults.workspaceRoot || "");
  }, [seeded, profileSnap.user.avatar, profileSnap.user.nickname, snap.agentDefaults.workspaceRoot]);

  useEffect(() => {
    if (!seeded || defaultWorkspaceLoadedRef.current) return;
    if (snap.agentDefaults.workspaceRoot.trim() || workspaceRoot.trim()) {
      defaultWorkspaceLoadedRef.current = true;
      return;
    }

    defaultWorkspaceLoadedRef.current = true;
    let cancelled = false;
    inspectWorkspaceReadiness()
      .then((readiness) => {
        if (cancelled) return;
        if (settingsModel.state.agentDefaults.workspaceRoot.trim()) return;
        if (workspaceDraftTouchedRef.current) return;
        if (!readiness.workspaceRoot.trim()) return;
        setWorkspaceRoot(readiness.workspaceRoot);
      })
      .catch((error) => {
        console.warn("[startup] failed to load default workspace root", error);
      });

    return () => {
      cancelled = true;
    };
  }, [seeded, snap.agentDefaults.workspaceRoot, workspaceRoot]);

  const needsProfile = seeded && !profileSnap.isOnboarded;
  const needsWorkspace = seeded && !snap.agentDefaults.workspaceRoot.trim();
  const needsModel = seeded && (!snap.defaultProvider.trim() || !snap.defaultModel.trim());
  const open = seeded && (needsProfile || needsWorkspace || needsModel);
  const currentDefaultProvider = snap.providers.find((provider) => provider.name === snap.defaultProvider);
  const currentDefaultModel = currentDefaultProvider?.models.find((model) => model.id === snap.defaultModel);

  const handlePickWorkspace = async () => {
    const selected = await openNativeDirectoryDialog();
    if (selected) {
      workspaceDraftTouchedRef.current = true;
      setWorkspaceRoot(selected);
      return;
    }
    toast.info(desktopOnlyMessage("目录选择"));
  };

  const handleSubmit = async () => {
    const trimmedNickname = nickname.trim();
    const trimmedWorkspace = workspaceRoot.trim();
    if (!avatar.trim()) {
      toast.error("请先设置头像");
      return;
    }
    if (!trimmedNickname) {
      toast.error("请先填写昵称");
      return;
    }
    if (!trimmedWorkspace) {
      toast.error("请先配置默认工作区");
      return;
    }
    if (!snap.defaultProvider.trim()) {
      toast.error("请先配置默认 Provider");
      return;
    }
    if (!snap.defaultModel.trim()) {
      toast.error("请先配置默认模型");
      return;
    }

    setSaving(true);
    try {
      settingsModel.setAgentDefaults({ workspaceRoot: trimmedWorkspace });
      await settingsModel.syncToBackend();
      const readiness = await ensureWorkspaceReadiness(trimmedWorkspace);
      if (readiness.needsRepair) {
        throw new Error(formatWorkspaceValidationError(readiness));
      }
      globalModel.setProfile(trimmedNickname, avatar);
      toast.success("首次配置已完成");
    } catch (error) {
      notifyClientError(error, {
        title: "首次配置保存失败",
        source: "startup-config.save",
      });
    } finally {
      setSaving(false);
    }
  };

  const handleOpenAutoFocus = (event: Event) => {
    event.preventDefault();
    window.requestAnimationFrame(() => dialogContentRef.current?.focus());
  };

  return (
    <Dialog open={open}>
      <DialogContent
        ref={dialogContentRef}
        tabIndex={-1}
        wrapperClassName="items-start justify-start overflow-x-hidden py-4 sm:items-center sm:justify-center sm:p-4"
        className="flex max-h-[88vh] w-[342px] min-w-0 max-w-[calc(100vw-3rem)] flex-col overflow-hidden border-slate-200 bg-white p-0 shadow-[0_12px_16px_-4px_rgba(36,36,36,0.08)] sm:w-[84vw] sm:max-w-5xl [&>button]:hidden"
        onOpenAutoFocus={handleOpenAutoFocus}
        onEscapeKeyDown={(event) => event.preventDefault()}
        onPointerDownOutside={(event) => event.preventDefault()}
        onInteractOutside={(event) => event.preventDefault()}
      >
        <div className="border-b border-slate-200/80 bg-[linear-gradient(135deg,#f8fafc,#eef2ff)] px-3 py-3 sm:px-4">
          <DialogHeader className="space-y-1.5 text-left">
            <div className="flex min-w-0 items-start gap-2.5">
              <div className="flex size-8 items-center justify-center rounded-[8px] bg-slate-900 text-white shadow-sm">
                <Settings2 className="size-4" />
              </div>
              <div className="min-w-0">
                <DialogTitle className="text-lg font-semibold text-slate-950">完成首次默认配置</DialogTitle>
                <DialogDescription className="mt-1 break-words text-sm text-slate-600">
                  首次启动请先设置头像、昵称、默认工作区，并使用与“AI 服务”一致的配置组件完成默认模型设置。
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>
        </div>

        <div className="min-h-0 min-w-0 flex-1 overflow-y-auto px-3 py-4 sm:px-4">
          <div className="grid min-w-0 gap-4 xl:grid-cols-[200px_minmax(0,1fr)]">
            <div className="min-w-0 rounded-lg border border-slate-200 bg-slate-50/70 p-4">
              <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-900">
                <UserRound className="size-4" />
                个人资料
              </div>
              <div className="flex flex-col items-center gap-4">
                <AvatarUploader
                  className="size-20"
                  value={avatar}
                  onChange={setAvatar}
                  onUpload={fileToDataUrl}
                  cropProps={{}}
                />
                <div className="w-full space-y-1.5">
                  <label htmlFor="startup-nickname" className="text-sm font-medium text-slate-900">
                    昵称 <span className="text-destructive">*</span>
                  </label>
                  <Input
                    id="startup-nickname"
                    value={nickname}
                    onChange={(event) => setNickname(event.target.value)}
                    placeholder={DEFAULT_PROFILE_NICKNAME}
                    maxLength={20}
                    className="h-10"
                  />
                </div>
              </div>
            </div>

            <div className="min-w-0 space-y-4">
              <div className="min-w-0 rounded-lg border border-slate-200 bg-white p-4">
                <div className="mb-3 text-sm font-medium text-slate-900">
                  默认工作区 <span className="text-destructive">*</span>
                </div>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <Input
                    value={workspaceRoot}
                    onChange={(event) => {
                      workspaceDraftTouchedRef.current = true;
                      setWorkspaceRoot(event.target.value);
                    }}
                    placeholder="/path/to/workspace"
                    className="h-11 min-w-0 font-mono text-sm"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    className="h-11 w-full shrink-0 justify-center sm:w-auto"
                    onClick={handlePickWorkspace}
                  >
                    <FolderOpen className="mr-1 size-4" />
                    浏览
                  </Button>
                </div>
                <p className="mt-2 break-words text-xs text-slate-500">
                  用于统一存放会话、智能体和工作区文件。网页版暂不支持浏览本机目录时，请直接手动输入路径。
                </p>
              </div>

              <div className="min-w-0 rounded-lg border border-slate-200 bg-white p-4">
                <div className="mb-3 text-sm font-medium text-slate-900">
                  AI 服务 <span className="text-destructive">*</span>
                </div>
                {needsModel ? (
                  <AiSection embedded />
                ) : (
                  <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-sm text-emerald-900">
                    <div className="font-medium">默认模型已从后端配置加载</div>
                    <div className="mt-1 text-xs text-emerald-700">
                      {currentDefaultProvider && currentDefaultModel
                        ? `${currentDefaultProvider.name} / ${currentDefaultModel.name}`
                        : `${snap.defaultProvider} / ${snap.defaultModel}`}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        <DialogFooter className="min-w-0 border-t border-slate-200/80 px-3 py-3 sm:px-4">
          <p className="w-full min-w-0 break-words text-xs text-slate-500 sm:mr-auto sm:w-auto">
            首次配置未完成前，主界面的“新建会话”会被阻止。
          </p>
          <Button
            type="button"
            className="w-full sm:w-auto"
            onClick={handleSubmit}
            disabled={
              saving ||
              !avatar.trim() ||
              !nickname.trim() ||
              !workspaceRoot.trim() ||
              !snap.defaultProvider ||
              !snap.defaultModel
            }
          >
            {saving ? <Loader2 className="mr-2 size-4 animate-spin" /> : null}
            开始使用书小安
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
