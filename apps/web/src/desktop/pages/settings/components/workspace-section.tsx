import { useReactive } from "ahooks";
import { AlertCircle, CheckCircle2, FolderOpen, HardDrive, Loader2, Save } from "lucide-react";
import { toast } from "sonner";
import { useSnapshot } from "valtio";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { notifyClientError } from "@/lib/client-error";
import { desktopOnlyMessage, openNativeDirectoryDialog } from "@/lib/tauri-runtime";
import { cn } from "@/lib/utils";
import settingsModel from "@/models/settings.model";
import { SettingsCard, SettingsSection } from "./shared";
import {
  resolveWorkspaceRootValidationFeedback,
  resolveWorkspaceSaveButton,
  resolveWorkspaceSaveFeedback,
  type WorkspaceSaveFeedback,
  type WorkspaceSaveStatus,
} from "./workspace-section-state";

function WorkspaceSaveStatusPanel({ feedback }: { feedback: WorkspaceSaveFeedback }) {
  const Icon = feedback.tone === "success" ? CheckCircle2 : feedback.tone === "info" ? Loader2 : AlertCircle;

  return (
    <div
      role={feedback.role}
      aria-live={feedback.ariaLive}
      className={cn(
        "flex items-start gap-2 rounded-lg border px-3 py-2 text-xs",
        feedback.tone === "success"
          ? "border-emerald-200 bg-emerald-50 text-emerald-700"
          : feedback.tone === "warning"
            ? "border-amber-200 bg-amber-50 text-amber-700"
            : feedback.tone === "error"
              ? "border-destructive/20 bg-destructive/5 text-destructive"
              : "border-primary/20 bg-primary/5 text-primary",
      )}
    >
      <Icon className={cn("mt-0.5 size-4 shrink-0", feedback.tone === "info" ? "animate-spin" : "")} />
      <div className="min-w-0">
        <div className="font-medium">{feedback.title}</div>
        <div className="mt-0.5 break-words leading-5 opacity-80">{feedback.description}</div>
      </div>
    </div>
  );
}

export function WorkspaceSection() {
  const snap = useSnapshot(settingsModel.state);
  const workspaceRoot = snap.agentDefaults.workspaceRoot;
  const ui = useReactive({
    saveStatus: { kind: "idle" } as WorkspaceSaveStatus,
  });
  const validationFeedback = resolveWorkspaceRootValidationFeedback(workspaceRoot);
  const saveFeedback = resolveWorkspaceSaveFeedback(ui.saveStatus) ?? validationFeedback;
  const saveButton = resolveWorkspaceSaveButton(ui.saveStatus, { workspaceRoot });
  const saving = ui.saveStatus.kind === "saving";

  const handleChange = (value: string) => {
    settingsModel.setAgentDefaults({ workspaceRoot: value });
    if (ui.saveStatus.kind !== "saving") {
      ui.saveStatus = { kind: "idle" };
    }
  };

  const handlePick = async () => {
    const selected = await openNativeDirectoryDialog();
    if (selected) {
      handleChange(selected);
      return;
    }
    toast.info(desktopOnlyMessage("目录选择"));
  };

  const handleSave = async () => {
    if (validationFeedback) return;
    ui.saveStatus = { kind: "saving" };
    try {
      await settingsModel.syncToBackend();
      ui.saveStatus = { kind: "saved" };
      toast.success("工作区配置已保存");
    } catch (error) {
      const normalized = notifyClientError(error, {
        title: "工作区配置保存失败",
        source: "settings.workspace.save",
        display: "inline",
      });
      ui.saveStatus = { kind: "error", message: normalized.message };
    }
  };

  return (
    <div className="space-y-8">
      <SettingsSection
        title="工作区"
        description="统一管理智能体和会话的默认工作目录，保持文件结构稳定。"
        icon={HardDrive}
        accentColor="slate"
      >
        <SettingsCard
          title="工作区根目录"
          description="设置后，程序会在该目录下自动组织智能体目录和会话目录。"
          icon={FolderOpen}
          accentColor="blue"
        >
          <div className="space-y-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <Input
                id="workspace-root"
                value={workspaceRoot}
                onChange={(e) => handleChange(e.target.value)}
                className="h-11 min-w-0 font-mono text-sm border-slate-200 rounded-lg focus:border-primary focus:ring-1 focus:ring-primary/20"
                placeholder="/path/to/workspace"
                disabled={saving}
              />
              <div className="grid grid-cols-2 gap-2 sm:flex sm:shrink-0">
                <Button
                  type="button"
                  variant="outline"
                  className="h-11 w-full sm:w-auto"
                  onClick={handlePick}
                  disabled={saving}
                >
                  <FolderOpen className="mr-1 size-4" />
                  浏览
                </Button>
                <Button
                  type="button"
                  className="h-11 w-full sm:w-auto"
                  onClick={handleSave}
                  disabled={saveButton.disabled}
                  aria-label={saveButton.ariaLabel}
                >
                  {saveButton.disabled ? (
                    <Loader2 className="mr-1 size-4 animate-spin" />
                  ) : (
                    <Save className="mr-1 size-4" />
                  )}
                  {saveButton.label}
                </Button>
              </div>
            </div>
            {saveFeedback ? <WorkspaceSaveStatusPanel feedback={saveFeedback} /> : null}
          </div>
        </SettingsCard>

        <SettingsCard
          title="约定式目录结构"
          description="这些目录会作为InternShannon的约定式工作区组织方式。"
          icon={FolderOpen}
          accentColor="slate"
        >
          <div className="space-y-3">
            <div className="rounded-lg border border-slate-200 bg-slate-50/50 px-4 py-3">
              <div className="text-xs text-slate-500 mb-1">智能体工作区</div>
              <div className="font-mono text-sm text-slate-800">agents/&lt;agent-id&gt;/</div>
              <div className="mt-2 text-xs text-slate-400">包含 `skills/`、`tasks/`、`knowledge/` 等默认目录。</div>
            </div>
            <div className="rounded-lg border border-slate-200 bg-slate-50/50 px-4 py-3">
              <div className="text-xs text-slate-500 mb-1">会话工作区</div>
              <div className="font-mono text-sm text-slate-800">sessions/&lt;session-folder&gt;/</div>
              <div className="mt-2 text-xs text-slate-400">为每个会话提供独立目录，避免文件和上下文互相污染。</div>
            </div>
          </div>
        </SettingsCard>
      </SettingsSection>
    </div>
  );
}
