import { useReactive } from "ahooks";
import { AlertCircle, Bot, CheckCircle2, Loader2 } from "lucide-react";
import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { useSnapshot } from "valtio";
import { AiProviderSettings } from "@/components/chat";
import { notifyClientError } from "@/lib/client-error";
import { cn } from "@/lib/utils";
import settingsModel from "@/models/settings.model";
import type { ModelConfig, ProviderConfig } from "../../../../lib/shared";
import {
  type AiDefaultModelFeedback,
  type AiSettingsSyncFeedback,
  type AiSettingsSyncStatus,
  resolveAiDefaultModelFeedback,
  resolveAiSettingsSyncFeedback,
} from "./ai-section-state";
import { SettingsCard, SettingsSection } from "./shared";

function AiSettingsStatusPanel({ feedback }: { feedback: AiSettingsSyncFeedback | AiDefaultModelFeedback }) {
  const Icon = feedback.tone === "success" ? CheckCircle2 : feedback.tone === "info" ? Loader2 : AlertCircle;

  return (
    <div
      role={feedback.role}
      aria-live={feedback.ariaLive}
      className={cn(
        "mb-4 flex items-start gap-2 rounded-lg border px-3 py-2 text-xs",
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

export function AiSection({ embedded: _embedded = false }: { embedded?: boolean } = {}) {
  const snap = useSnapshot(settingsModel.state);
  const state = useReactive({
    rebuildingCache: false,
    syncStatus: { kind: "idle" } as AiSettingsSyncStatus,
  });
  const seededRef = useRef(false);
  const skipNextSyncRef = useRef(false);
  const syncSeqRef = useRef(0);
  const syncFeedback = resolveAiSettingsSyncFeedback(state.syncStatus);
  const defaultModelFeedback = resolveAiDefaultModelFeedback({
    providers: snap.providers as ProviderConfig[],
    defaultProvider: snap.defaultProvider,
    defaultModel: snap.defaultModel,
  });

  const syncSettingsToBackend = (source: string, reservedSyncSeq?: number) => {
    const syncSeq = reservedSyncSeq ?? syncSeqRef.current + 1;
    syncSeqRef.current = syncSeq;
    state.syncStatus = { kind: "syncing" };
    return settingsModel
      .syncToBackend()
      .then(() => {
        if (syncSeqRef.current === syncSeq) {
          state.syncStatus = { kind: "synced" };
        }
      })
      .catch((e: unknown) => {
        console.warn("Failed to sync settings to backend:", e);
        if (syncSeqRef.current === syncSeq) {
          const normalized = notifyClientError(e, {
            title: "AI 配置保存失败",
            source,
            display: "inline",
          });
          state.syncStatus = { kind: "error", message: normalized.message };
        }
      });
  };

  useEffect(() => {
    let cancelled = false;
    settingsModel.waitForSeed().then(() => {
      if (!cancelled) {
        skipNextSyncRef.current = true;
        seededRef.current = true;
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    void settingsModel.seedFromBackend().then((applied) => {
      if (!cancelled && applied) {
        skipNextSyncRef.current = true;
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: autosave is intentionally keyed by Valtio snapshot fields and mutates ahooks reactive state.
  useEffect(() => {
    if (!seededRef.current) return;
    if (skipNextSyncRef.current) {
      skipNextSyncRef.current = false;
      return;
    }
    const syncSeq = syncSeqRef.current + 1;
    syncSeqRef.current = syncSeq;
    state.syncStatus = { kind: "idle" };
    const timer = setTimeout(() => {
      if (syncSeqRef.current !== syncSeq) return;
      void syncSettingsToBackend("settings.ai.autosave", syncSeq);
    }, 800);
    return () => clearTimeout(timer);
  }, [snap.providers, snap.defaultProvider, snap.defaultModel]);

  const handleRebuildCache = async () => {
    state.rebuildingCache = true;
    try {
      await settingsModel.rebuildModelConfigCache();
      toast.success("模型配置缓存已清理，并已用当前配置重新覆盖");
    } catch (error) {
      notifyClientError(error, {
        title: "模型配置缓存重建失败",
        source: "settings.ai.rebuild-cache",
      });
    } finally {
      state.rebuildingCache = false;
    }
  };

  return (
    <SettingsSection title="AI 服务" description="配置模型提供商与默认模型设置" icon={Bot} accentColor="blue">
      <SettingsCard title="默认模型" description="选择默认使用的模型" icon={Bot} accentColor="blue">
        <AiSettingsStatusPanel feedback={defaultModelFeedback} />
        {syncFeedback ? <AiSettingsStatusPanel feedback={syncFeedback} /> : null}
        <AiProviderSettings
          providers={snap.providers as ProviderConfig[]}
          defaultProvider={snap.defaultProvider}
          defaultModel={snap.defaultModel}
          onSetDefault={(providerName, modelId) => {
            settingsModel.setDefault(providerName, modelId);
            toast.success("已设置默认模型");
          }}
          onAddProvider={(provider) => {
            if (snap.providers.some((item) => item.name === provider.name)) {
              toast.error(`"${provider.name}" 已存在`);
              return;
            }
            settingsModel.addProvider(provider);
            toast.success(`已添加 ${provider.name}`);
          }}
          onRemoveProvider={(providerName) => {
            settingsModel.removeProvider(providerName);
            toast.success(`已删除 ${providerName}`);
          }}
          onUpdateProvider={(providerName, patch) => {
            skipNextSyncRef.current = true;
            settingsModel.updateProvider(providerName, patch);
            void syncSettingsToBackend("settings.ai.apply-connection");
          }}
          onAddModel={(providerName, model) => {
            const provider = snap.providers.find((p) => p.name === providerName);
            if (provider?.models.some((item) => item.id === model.id)) {
              toast.error(`模型 "${model.id}" 已存在`);
              return;
            }
            settingsModel.addModel(providerName, model);
            toast.success(`已添加模型 ${model.name}`);
          }}
          onAddModels={(providerName, models) => {
            const provider = snap.providers.find((p) => p.name === providerName);
            const existingModelIds = new Set(provider?.models.map((model) => model.id) ?? []);
            const uniqueModels = models.filter((model) => !existingModelIds.has(model.id));
            if (uniqueModels.length === 0) {
              toast.info("没有可导入的新模型");
              return;
            }
            for (const model of uniqueModels) {
              settingsModel.addModel(providerName, model);
            }
            toast.success(`已导入 ${uniqueModels.length} 个模型`);
          }}
          onUpdateModel={(providerName, modelId, patch) => {
            const provider = snap.providers.find((p) => p.name === providerName);
            if (patch.id?.trim() && patch.id !== modelId && provider?.models.some((item) => item.id === patch.id)) {
              toast.error(`模型 "${patch.id}" 已存在`);
              return;
            }
            settingsModel.updateModel(providerName, modelId, patch as Partial<ModelConfig>);
            toast.success("已更新模型");
          }}
          onRemoveModel={(providerName, modelId) => {
            settingsModel.removeModel(providerName, modelId);
            toast.success("已删除模型");
          }}
          onRebuildCache={handleRebuildCache}
          isRebuildingCache={state.rebuildingCache}
        />
      </SettingsCard>
    </SettingsSection>
  );
}
