import { useReactive } from "ahooks";
import {
  Bot,
  Check,
  HelpCircle,
  LoaderCircle,
  Plus,
  RotateCcw,
  Save,
  Settings2,
  Sparkle,
  Sparkles,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { useSnapshot } from "valtio";

import {
  SettingField,
  SettingSwitchRow,
  SettingsFieldGroup,
  SettingsMessage,
  SettingsStatusBanner,
  SettingsStatusPill,
} from "@/components/settings/settings-form";
import { SettingsSection } from "@/components/settings/settings-section";
import { AdminPageShell } from "@/components/custom/admin-page-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { agentApi } from "@/lib/agent-api";
import type { AgentProfile, AgentSessionOptions } from "@/lib/agent-profile.types";
import { getAgentById } from "@/lib/builtins";
import { CORE_AGENT_SKILLS, PROGRESSIVE_API_SKILL_NAME } from "@/lib/core-skills";
import { cn } from "@/lib/utils";
import agentRegistryModel from "@/models/agent-registry.model";
import { parameterHelpTriggerLabel } from "./agent-config-panel-accessibility";

type ModelOption = {
  id: string;
  name: string;
  provider?: string;
};

const GLOBAL_MODEL_VALUE = "__global_model__";

const DEFAULT_SESSION_OPTIONS: Required<
  Pick<
    AgentSessionOptions,
    | "builtinSkills"
    | "planningMode"
    | "goalTracking"
    | "maxToolRounds"
    | "continuationEnabled"
    | "maxContinuationTurns"
    | "autoCompact"
    | "autoCompactThreshold"
  >
> = {
  builtinSkills: true,
  planningMode: "auto",
  goalTracking: false,
  maxToolRounds: 50,
  continuationEnabled: true,
  maxContinuationTurns: 2,
  autoCompact: true,
  autoCompactThreshold: 0.8,
};

// 参数说明配置
const PARAM_HELP: Record<string, { title: string; description: string }> = {
  builtinSkills: {
    title: "内置技能",
    description: "启用 a3s-code 内置的工具能力，如文件读写、代码执行等。",
  },
  goalTracking: {
    title: "目标追踪",
    description: "开启后，智能体会持续追踪任务目标，适合复杂的多步骤任务。",
  },
  planningMode: {
    title: "规划模式",
    description: "自动：在执行前自动分析任务并规划步骤；总是启用：强制规划；关闭：不规划直接执行。",
  },
  maxToolRounds: {
    title: "最大工具轮次",
    description: "智能体调用工具的总次数上限。复杂任务建议 50+，简单对话 20-30 即可。",
  },
  continuationEnabled: {
    title: "自动继续",
    description: "当智能体回答被中断时，自动继续生成内容。",
  },
  maxContinuationTurns: {
    title: "自动继续次数",
    description: "自动继续的最大次数。设置为 0 则不限制。",
  },
  autoCompact: {
    title: "自动压缩",
    description: "当对话历史过长时，自动整理并压缩早期对话，保持上下文连贯。",
  },
  autoCompactThreshold: {
    title: "压缩阈值",
    description: "触发压缩的对话长度比例。0.8 表示对话达到 80% 长度时自动压缩。",
  },
  temperature: {
    title: "温度",
    description: "控制输出的随机性。较低值更确定，较高值更有创造性。建议范围 0.0-1.0。",
  },
  thinkingBudget: {
    title: "思考预算",
    description: "智能体的思考 token 数量上限。数值越大思考越充分，但消耗更多 token。",
  },
};

function formatModelOptionLabel(option: ModelOption): string {
  const name = option.name?.trim() || option.id;
  if (option.provider && name !== option.provider) {
    return `${name} · ${option.provider}`;
  }
  return name;
}

function stringifySkills(skills?: string[]): string {
  return (skills ?? []).join("\n");
}

function parseSkills(input: string): string[] {
  return Array.from(
    new Set(
      input
        .split(/[\n,，]/)
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  );
}

function ensureProgressiveApiSkill(skills: string[], locked: boolean): string[] {
  if (!locked) return skills;
  return Array.from(new Set([PROGRESSIVE_API_SKILL_NAME, ...skills]));
}

function toNumber(value: string, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toOptionalNumber(value: string): number | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function mergeSessionOptions(agent?: AgentProfile | null): AgentSessionOptions {
  return {
    ...DEFAULT_SESSION_OPTIONS,
    ...(agent?.sessionOptions ?? {}),
  };
}

type AgentConfigPanelChrome = "default" | "admin";

const CONFIG_PANEL_CHROME = {
  default: {
    root: "flex h-full flex-col bg-background",
    header: "flex shrink-0 items-center justify-between border-b px-4 py-2.5",
    content: "mx-auto max-w-4xl space-y-3 p-4",
  },
  admin: {
    root: "flex h-full flex-col bg-white",
    header: "flex shrink-0 items-center justify-between border-b border-border-light bg-white px-4 py-3",
    content: "mx-auto max-w-5xl space-y-3",
  },
} satisfies Record<AgentConfigPanelChrome, Record<string, string>>;

// 参数说明组件
function ParamHelpTooltip({ paramKey }: { paramKey: string }) {
  const help = PARAM_HELP[paramKey];
  if (!help) return null;

  const triggerLabel = parameterHelpTriggerLabel(help.title);

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={triggerLabel}
          title={triggerLabel}
          className="inline-flex size-6 items-center justify-center rounded-md text-muted-foreground/50 transition-colors hover:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/40"
        >
          <HelpCircle aria-hidden="true" className="size-3.5" />
        </button>
      </TooltipTrigger>
      <TooltipContent side="left" className="max-w-[280px]">
        <div className="font-medium">{help.title}</div>
        <div className="mt-1 text-muted-foreground">{help.description}</div>
      </TooltipContent>
    </Tooltip>
  );
}

interface AgentConfigPanelProps {
  agentId: string;
  skillsPath?: string | null;
}

function AgentConfigPanelBase({
  agentId,
  skillsPath,
  chrome,
}: AgentConfigPanelProps & { chrome: AgentConfigPanelChrome }) {
  const styles = CONFIG_PANEL_CHROME[chrome];
  const compact = chrome === "admin";
  const controlClassName = compact ? "h-8 rounded-md text-sm" : "h-9 rounded-md";
  const actionButtonClassName = compact ? "h-8 rounded-md px-2.5" : "h-9 rounded-md";
  const actionIconClassName = compact ? "size-3.5" : "size-4";
  const sectionDensity = compact ? "compact" : "default";
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const agentSnap = useSnapshot(agentRegistryModel.state);
  const state = useReactive({
    loadedAgentId: "",
    defaultModel: "",
    defaultPermissionMode: "default",
    defaultSkillsText: "",
    builtinSkills: DEFAULT_SESSION_OPTIONS.builtinSkills,
    planningMode: DEFAULT_SESSION_OPTIONS.planningMode,
    goalTracking: DEFAULT_SESSION_OPTIONS.goalTracking,
    maxToolRounds: String(DEFAULT_SESSION_OPTIONS.maxToolRounds),
    continuationEnabled: DEFAULT_SESSION_OPTIONS.continuationEnabled,
    maxContinuationTurns: String(DEFAULT_SESSION_OPTIONS.maxContinuationTurns),
    autoCompact: DEFAULT_SESSION_OPTIONS.autoCompact,
    autoCompactThreshold: String(DEFAULT_SESSION_OPTIONS.autoCompactThreshold),
    temperature: "",
    thinkingBudget: "",
    modelOptions: [] as ModelOption[],
    saving: false,
  });

  const currentAgent = useMemo(() => {
    void agentSnap.revision;
    return agentRegistryModel.getAllAgents().find((agent) => agent.id === agentId) ?? getAgentById(agentId) ?? null;
  }, [agentId, agentSnap.revision]);
  const locksProgressiveApiSkill = Boolean(currentAgent?.builtin);

  const applyAgentToState = (agent: AgentProfile | null) => {
    const options = mergeSessionOptions(agent);
    state.loadedAgentId = agent?.id ?? agentId;
    state.defaultModel = agent?.defaultModel ?? "";
    state.defaultPermissionMode = agent?.defaultPermissionMode ?? "default";
    state.defaultSkillsText = stringifySkills(agent?.defaultSkills);
    state.builtinSkills = options.builtinSkills ?? true;
    state.planningMode = options.planningMode ?? "auto";
    state.goalTracking = options.goalTracking ?? false;
    state.maxToolRounds = String(options.maxToolRounds ?? 50);
    state.continuationEnabled = options.continuationEnabled ?? DEFAULT_SESSION_OPTIONS.continuationEnabled;
    state.maxContinuationTurns = String(options.maxContinuationTurns ?? DEFAULT_SESSION_OPTIONS.maxContinuationTurns);
    state.autoCompact = options.autoCompact ?? DEFAULT_SESSION_OPTIONS.autoCompact;
    state.autoCompactThreshold = String(options.autoCompactThreshold ?? 0.8);
    state.temperature = typeof options.temperature === "number" ? String(options.temperature) : "";
    state.thinkingBudget = typeof options.thinkingBudget === "number" ? String(options.thinkingBudget) : "";
  };

  // biome-ignore lint/correctness/useExhaustiveDependencies: applyAgentToState mutates ahooks reactive state and should only run when the loaded agent changes.
  useEffect(() => {
    if (!agentId) return;
    if (state.loadedAgentId === agentId) return;
    applyAgentToState(currentAgent);
  }, [agentId, currentAgent, state.loadedAgentId]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: modelOptions.length is the load guard for this ahooks reactive state object.
  useEffect(() => {
    if (state.modelOptions.length > 0) return;
    agentApi
      .listModelOptions()
      .then((items) => {
        if (Array.isArray(items)) state.modelOptions = items;
      })
      .catch(() => {});
  }, [state.modelOptions.length]);

  useEffect(() => {
    if (!message) return;
    const timer = window.setTimeout(() => setMessage(null), 3000);
    return () => window.clearTimeout(timer);
  }, [message]);

  const enabledSkills = ensureProgressiveApiSkill(parseSkills(state.defaultSkillsText), locksProgressiveApiSkill);
  const selectedModelLabel = state.defaultModel
    ? formatModelOptionLabel(
        state.modelOptions.find((option) => option.id === state.defaultModel) ?? {
          id: state.defaultModel,
          name: state.defaultModel,
        },
      )
    : "跟随全局默认";
  const permissionModeLabel =
    {
      default: "默认模式",
      plan: "规划模式",
      auto: "自动执行",
    }[state.defaultPermissionMode] ?? state.defaultPermissionMode;

  const handleSave = () => {
    if (!agentId) return;
    state.saving = true;
    try {
      const sessionOptions: AgentSessionOptions = {
        builtinSkills: state.builtinSkills,
        planningMode: state.planningMode,
        goalTracking: state.goalTracking,
        maxToolRounds: toNumber(state.maxToolRounds, 50),
        continuationEnabled: state.continuationEnabled,
        maxContinuationTurns: toNumber(state.maxContinuationTurns, DEFAULT_SESSION_OPTIONS.maxContinuationTurns),
        autoCompact: state.autoCompact,
        autoCompactThreshold: toNumber(state.autoCompactThreshold, 0.8),
        temperature: toOptionalNumber(state.temperature),
        thinkingBudget: toOptionalNumber(state.thinkingBudget),
      };

      agentRegistryModel.updateAgentDefaults(agentId, {
        defaultModel: state.defaultModel.trim() || undefined,
        defaultPermissionMode: state.defaultPermissionMode,
        defaultSkills: enabledSkills,
        sessionOptions,
      });
      state.loadedAgentId = "";
      setMessage({ type: "success", text: "智能体配置已保存" });
      toast.success("智能体配置已保存");
    } catch (error) {
      setMessage({ type: "error", text: error instanceof Error ? error.message : "保存失败" });
      toast.error("保存失败");
    } finally {
      state.saving = false;
    }
  };

  const handleReset = () => {
    applyAgentToState(currentAgent);
    setMessage(null);
  };

  const actionButtons = (
    <div className="flex items-center gap-2">
      <Button type="button" variant="outline" size="sm" className={actionButtonClassName} onClick={handleReset}>
        <RotateCcw className={actionIconClassName} />
        还原
      </Button>
      <Button type="button" size="sm" className={actionButtonClassName} disabled={state.saving} onClick={handleSave}>
        {state.saving ? (
          <LoaderCircle className={cn(actionIconClassName, "animate-spin")} />
        ) : (
          <Save className={actionIconClassName} />
        )}
        {state.saving ? "保存中" : "保存配置"}
      </Button>
    </div>
  );

  const formContent = (
    <div className={styles.content}>
      {message ? <SettingsMessage type={message.type} text={message.text} /> : null}

      {!compact ? (
        <SettingsStatusBanner
          tone="info"
          icon={Bot}
          title="这些配置会作为该智能体新会话的默认行为"
          description="保存后不会强制改写已存在会话；重新打开或创建会话时会读取新的默认参数。"
        />
      ) : null}

      <SettingsSection
        density={sectionDensity}
        title="基础设置"
        description="控制智能体启动时使用的模型、权限模式和当前配置摘要。"
        extra={
          <div className="flex flex-wrap justify-end gap-2">
            <SettingsStatusPill tone="info" className={compact ? "h-6 px-2 text-[11px]" : undefined}>
              {selectedModelLabel}
            </SettingsStatusPill>
            <SettingsStatusPill tone="neutral" className={compact ? "h-6 px-2 text-[11px]" : undefined}>
              {permissionModeLabel}
            </SettingsStatusPill>
          </div>
        }
      >
        <SettingsFieldGroup>
          <SettingField
            label="默认模型"
            htmlFor="agent-default-model"
            description="留空时跟随系统 AI 设置中的全局默认模型。"
            compact={compact}
          >
            {state.modelOptions.length > 0 ? (
              <Select
                value={state.defaultModel || GLOBAL_MODEL_VALUE}
                onValueChange={(value) => {
                  state.defaultModel = value === GLOBAL_MODEL_VALUE ? "" : value;
                }}
              >
                <SelectTrigger id="agent-default-model" className={controlClassName}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={GLOBAL_MODEL_VALUE}>跟随全局默认</SelectItem>
                  {state.modelOptions.map((option) => (
                    <SelectItem key={option.id} value={option.id}>
                      {formatModelOptionLabel(option)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <Input
                id="agent-default-model"
                value={state.defaultModel}
                onChange={(event) => {
                  state.defaultModel = event.target.value;
                }}
                placeholder="跟随全局默认"
                className={controlClassName}
              />
            )}
          </SettingField>

          <SettingField
            label="默认权限模式"
            htmlFor="agent-permission-mode"
            description="决定新会话中工具调用和执行动作的默认约束。"
            compact={compact}
          >
            <Select
              value={state.defaultPermissionMode}
              onValueChange={(value) => {
                state.defaultPermissionMode = value;
                if (value === "plan") {
                  state.planningMode = "enabled";
                  state.goalTracking = true;
                }
              }}
            >
              <SelectTrigger id="agent-permission-mode" className={controlClassName}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="default">默认模式</SelectItem>
                <SelectItem value="plan">规划模式</SelectItem>
                <SelectItem value="auto">自动执行</SelectItem>
              </SelectContent>
            </Select>
          </SettingField>
        </SettingsFieldGroup>
      </SettingsSection>

      <SettingsSection
        density={sectionDensity}
        title="对话能力"
        description="定义智能体角色、默认技能，以及新会话进入时的能力边界。"
      >
        <SettingsFieldGroup>
          <SettingField
            label="默认启用技能"
            htmlFor="agent-default-skills"
            description="每行一个技能名称；内置系统技能会保持启用。"
            compact={compact}
          >
            <div className={compact ? "space-y-2" : "space-y-3"}>
              {CORE_AGENT_SKILLS.length > 0 ? (
                <div className={compact ? "space-y-1.5" : "space-y-2"}>
                  <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                    <Sparkle className="size-3.5" />
                    内置技能
                  </div>
                  <div className={compact ? "flex flex-wrap gap-1.5" : "flex flex-wrap gap-2"}>
                    {CORE_AGENT_SKILLS.map((skill) => {
                      const isSelected = enabledSkills.includes(skill.name);
                      const isLocked = locksProgressiveApiSkill && skill.name === PROGRESSIVE_API_SKILL_NAME;
                      return (
                        <button
                          key={skill.name}
                          type="button"
                          disabled={isLocked}
                          onClick={() => {
                            if (isLocked) return;
                            const nextSkills = isSelected
                              ? enabledSkills.filter((item) => item !== skill.name)
                              : [...enabledSkills, skill.name];
                            state.defaultSkillsText = nextSkills.join("\n");
                          }}
                          className={cn(
                            "inline-flex items-center gap-1.5 rounded-md border text-xs font-medium transition-colors",
                            compact ? "h-7 px-2" : "h-8 px-2.5",
                            isLocked
                              ? "cursor-not-allowed border-emerald-200 bg-emerald-50 text-emerald-700"
                              : isSelected
                                ? "border-primary/25 bg-primary/10 text-primary"
                                : "border-border bg-white text-muted-foreground hover:border-primary/20 hover:bg-muted/40 hover:text-foreground",
                          )}
                          title={isLocked ? "系统内置技能，内置智能体不可移除" : undefined}
                        >
                          {isSelected ? <Check className="size-3" /> : <Plus className="size-3" />}
                          {skill.name}
                          {isLocked ? <span className="text-[10px] font-medium">系统</span> : null}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ) : null}

              <Textarea
                id="agent-default-skills"
                value={state.defaultSkillsText}
                onChange={(event) => {
                  state.defaultSkillsText = event.target.value;
                }}
                className={cn(compact ? "min-h-[56px]" : "min-h-[80px]", "rounded-md font-mono text-xs leading-5")}
                placeholder="每行一个技能名称"
              />

              <div className="flex flex-wrap gap-1.5">
                {enabledSkills.length > 0 ? (
                  enabledSkills.map((skill) => (
                    <span
                      key={skill}
                      className="inline-flex items-center gap-1 rounded-md border border-primary/20 bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary"
                    >
                      <Check className="size-3" />
                      {skill}
                    </span>
                  ))
                ) : (
                  <span className="text-xs text-muted-foreground">未指定任何技能</span>
                )}
              </div>

              {skillsPath ? (
                <div
                  className={cn(
                    "rounded-md border border-[#edf0f3] bg-[#fbfcfd] text-xs text-muted-foreground",
                    compact ? "px-2.5 py-1.5" : "px-3 py-2",
                  )}
                >
                  技能文件目录：<span className="font-mono text-foreground">{skillsPath}</span>
                </div>
              ) : null}
            </div>
          </SettingField>
        </SettingsFieldGroup>
      </SettingsSection>

      <SettingsSection
        density={sectionDensity}
        title="运行策略"
        description="这些开关会影响智能体规划、目标追踪和上下文管理方式。"
      >
        <div className={compact ? "grid gap-2 md:grid-cols-2" : "grid gap-3 md:grid-cols-2"}>
          <SettingSwitchRow
            title="内置技能"
            description={PARAM_HELP.builtinSkills.description}
            icon={<Sparkles className={compact ? "size-3.5" : "size-4"} />}
            checked={state.builtinSkills}
            compact={compact}
            onCheckedChange={(checked) => {
              state.builtinSkills = checked;
            }}
          />
          <SettingSwitchRow
            title="目标追踪"
            description={PARAM_HELP.goalTracking.description}
            icon={<Check className={compact ? "size-3.5" : "size-4"} />}
            checked={state.goalTracking}
            compact={compact}
            onCheckedChange={(checked) => {
              state.goalTracking = checked;
            }}
          />
          <SettingSwitchRow
            title="自动继续"
            description={PARAM_HELP.continuationEnabled.description}
            icon={<Sparkle className={compact ? "size-3.5" : "size-4"} />}
            checked={state.continuationEnabled}
            compact={compact}
            onCheckedChange={(checked) => {
              state.continuationEnabled = checked;
            }}
          />
          <SettingSwitchRow
            title="自动压缩"
            description={PARAM_HELP.autoCompact.description}
            icon={<Settings2 className={compact ? "size-3.5" : "size-4"} />}
            checked={state.autoCompact}
            compact={compact}
            onCheckedChange={(checked) => {
              state.autoCompact = checked;
            }}
          />
        </div>
      </SettingsSection>

      <SettingsSection
        density={sectionDensity}
        title="高级参数"
        description="控制工具调用上限、上下文压缩阈值和模型采样参数。"
      >
        <SettingsFieldGroup>
          <SettingField
            label="规划模式"
            htmlFor="agent-planning-mode"
            description={PARAM_HELP.planningMode.description}
            extra={<ParamHelpTooltip paramKey="planningMode" />}
            compact={compact}
          >
            <Select
              value={state.planningMode ?? "auto"}
              onValueChange={(value) => {
                state.planningMode = value as NonNullable<AgentSessionOptions["planningMode"]>;
              }}
            >
              <SelectTrigger id="agent-planning-mode" className={controlClassName}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="auto">自动</SelectItem>
                <SelectItem value="enabled">总是启用</SelectItem>
                <SelectItem value="disabled">关闭</SelectItem>
              </SelectContent>
            </Select>
          </SettingField>

          <SettingField
            label="最大工具轮次"
            htmlFor="agent-max-tool-rounds"
            description={PARAM_HELP.maxToolRounds.description}
            extra={<ParamHelpTooltip paramKey="maxToolRounds" />}
            compact={compact}
          >
            <Input
              id="agent-max-tool-rounds"
              type="number"
              min={1}
              value={state.maxToolRounds}
              onChange={(event) => {
                state.maxToolRounds = event.target.value;
              }}
              placeholder="50"
              className={controlClassName}
            />
          </SettingField>

          <SettingField
            label="自动继续次数"
            htmlFor="agent-max-continuation-turns"
            description={PARAM_HELP.maxContinuationTurns.description}
            extra={<ParamHelpTooltip paramKey="maxContinuationTurns" />}
            compact={compact}
          >
            <Input
              id="agent-max-continuation-turns"
              type="number"
              min={0}
              value={state.maxContinuationTurns}
              onChange={(event) => {
                state.maxContinuationTurns = event.target.value;
              }}
              placeholder="0"
              className={controlClassName}
            />
          </SettingField>

          <SettingField
            label="压缩阈值"
            htmlFor="agent-auto-compact-threshold"
            description={PARAM_HELP.autoCompactThreshold.description}
            extra={<ParamHelpTooltip paramKey="autoCompactThreshold" />}
            compact={compact}
          >
            <Input
              id="agent-auto-compact-threshold"
              type="number"
              min={0}
              max={1}
              step={0.05}
              value={state.autoCompactThreshold}
              onChange={(event) => {
                state.autoCompactThreshold = event.target.value;
              }}
              placeholder="0.8"
              className={controlClassName}
            />
          </SettingField>

          <SettingField
            label="温度"
            htmlFor="agent-temperature"
            description={PARAM_HELP.temperature.description}
            extra={<ParamHelpTooltip paramKey="temperature" />}
            compact={compact}
          >
            <Input
              id="agent-temperature"
              type="number"
              min={0}
              max={2}
              step={0.1}
              value={state.temperature}
              onChange={(event) => {
                state.temperature = event.target.value;
              }}
              placeholder="使用模型默认值"
              className={controlClassName}
            />
          </SettingField>

          <SettingField
            label="思考预算"
            htmlFor="agent-thinking-budget"
            description={PARAM_HELP.thinkingBudget.description}
            extra={<ParamHelpTooltip paramKey="thinkingBudget" />}
            compact={compact}
          >
            <Input
              id="agent-thinking-budget"
              type="number"
              min={0}
              value={state.thinkingBudget}
              onChange={(event) => {
                state.thinkingBudget = event.target.value;
              }}
              placeholder="不限制"
              className={controlClassName}
            />
          </SettingField>
        </SettingsFieldGroup>
      </SettingsSection>
    </div>
  );

  if (chrome === "admin") {
    return (
      <AdminPageShell
        title="智能体配置"
        hideHeader
        headerClassName="px-3 py-2 md:px-3"
        contentClassName="bg-muted/40 p-3 md:p-3"
        navigation={
          <div className="flex min-w-0 items-center gap-1.5 text-xs font-medium text-primary">
            <Bot className="size-3.5 shrink-0" />
            <span>参数配置</span>
            {currentAgent ? <span className="truncate text-muted-foreground">/ {currentAgent.name}</span> : null}
          </div>
        }
        action={actionButtons}
      >
        {formContent}
      </AdminPageShell>
    );
  }

  return (
    <div className={styles.root}>
      <div className={styles.header}>
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-foreground">参数配置</h2>
          <p className="mt-0.5 text-[11px] text-muted-foreground">这些配置会作为该智能体新会话的默认行为</p>
        </div>
        {actionButtons}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto bg-muted/40">{formContent}</div>
    </div>
  );
}

export function AdminAgentConfigPanel(props: AgentConfigPanelProps) {
  return <AgentConfigPanelBase {...props} chrome="admin" />;
}

export default function AgentConfigPanel(props: AgentConfigPanelProps) {
  return <AgentConfigPanelBase {...props} chrome="default" />;
}
