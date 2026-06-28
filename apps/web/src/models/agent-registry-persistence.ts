import type { AgentProfile, AgentSessionOptions, ScheduledTask } from "../lib/agent-profile.types.ts";
import { normalizeMcpServerConfigs } from "../lib/mcp-server-config.ts";

type AgentOverride = Partial<
  Pick<
    AgentProfile,
    | "defaultModel"
    | "defaultPermissionMode"
    | "systemPrompt"
    | "defaultSkills"
    | "sessionOptions"
    | "defaultKnowledgeBases"
    | "scheduledTasks"
  >
>;

const DEFAULT_AGENT_ID = "default";
const LEGACY_DEFAULT_AGENT_ID = "super-admin";
const PLANNING_MODES = new Set(["auto", "enabled", "disabled"]);

export function normalizePersistedSessionAgents(value: unknown): Record<string, string> {
  const record = normalizeRecord(value);
  if (!record) return {};

  const mappings: Record<string, string> = {};
  for (const [rawSessionId, rawAgentId] of Object.entries(record)) {
    const sessionId = rawSessionId.trim();
    const agentId = normalizeAgentKey(rawAgentId);
    if (!sessionId || !agentId) continue;
    mappings[sessionId] = agentId;
  }
  return mappings;
}

export function normalizePersistedCustomAgents(value: unknown): AgentProfile[] {
  if (!Array.isArray(value)) return [];

  const seenIds = new Set<string>();
  return value.flatMap((item): AgentProfile[] => {
    const record = normalizeRecord(item);
    if (!record) return [];

    const id = normalizeAgentKey(record.id);
    if (!id || seenIds.has(id)) return [];
    seenIds.add(id);

    const name = normalizeDisplayText(record.name) ?? id;
    const description = normalizeDisplayText(record.description) ?? "";
    const systemPrompt = normalizeStringText(record.systemPrompt ?? record.system_prompt) ?? "";
    const avatar = normalizeAvatar(record.avatar);
    const sessionOptions = normalizeAgentSessionOptions(record.sessionOptions ?? record.session_options);

    const agent: AgentProfile = {
      id,
      name,
      description,
      avatar,
      systemPrompt,
      builtin: false,
    };

    const defaultModel = normalizeDisplayText(record.defaultModel ?? record.default_model);
    const defaultPermissionMode = normalizeDisplayText(record.defaultPermissionMode ?? record.default_permission_mode);
    const defaultWorkspace = normalizeDisplayText(record.defaultWorkspace ?? record.default_workspace);
    const defaultSkills = normalizeStringList(record.defaultSkills ?? record.default_skills);
    const defaultKnowledgeBases = normalizeStringList(record.defaultKnowledgeBases ?? record.default_knowledge_bases);
    const hasScheduledTasks = "scheduledTasks" in record || "scheduled_tasks" in record;
    const scheduledTasks = normalizeScheduledTasks(record.scheduledTasks ?? record.scheduled_tasks);
    const tags = normalizeStringList(record.tags);
    const hidden = normalizeOptionalBoolean(record.hidden);
    const undeletable = normalizeOptionalBoolean(record.undeletable);

    if (defaultModel !== null) agent.defaultModel = defaultModel;
    if (defaultPermissionMode !== null) agent.defaultPermissionMode = defaultPermissionMode;
    if (defaultWorkspace !== null) agent.defaultWorkspace = defaultWorkspace;
    if (defaultSkills.length > 0) agent.defaultSkills = defaultSkills;
    if (defaultKnowledgeBases.length > 0) agent.defaultKnowledgeBases = defaultKnowledgeBases;
    if (scheduledTasks.length > 0 || hasScheduledTasks) agent.scheduledTasks = scheduledTasks;
    if (tags.length > 0) agent.tags = tags;
    if (sessionOptions) agent.sessionOptions = sessionOptions;
    if (hidden !== undefined) agent.hidden = hidden;
    if (undeletable !== undefined) agent.undeletable = undeletable;

    return [agent];
  });
}

export function normalizePersistedAgentOverrides(value: unknown): Record<string, AgentOverride> {
  const record = normalizeRecord(value);
  if (!record) return {};

  const overrides: Record<string, AgentOverride> = {};
  for (const [rawAgentId, rawOverride] of Object.entries(record)) {
    const agentId = normalizeAgentKey(rawAgentId);
    const overrideRecord = normalizeRecord(rawOverride);
    if (!agentId || !overrideRecord) continue;

    const override: AgentOverride = {};
    const defaultModel = normalizeDisplayText(overrideRecord.defaultModel ?? overrideRecord.default_model);
    const defaultPermissionMode = normalizeDisplayText(
      overrideRecord.defaultPermissionMode ?? overrideRecord.default_permission_mode,
    );
    const systemPrompt = normalizeStringText(overrideRecord.systemPrompt ?? overrideRecord.system_prompt);
    const defaultSkills = normalizeStringList(overrideRecord.defaultSkills ?? overrideRecord.default_skills);
    const defaultKnowledgeBases = normalizeStringList(
      overrideRecord.defaultKnowledgeBases ?? overrideRecord.default_knowledge_bases,
    );
    const scheduledTasks = normalizeScheduledTasks(overrideRecord.scheduledTasks ?? overrideRecord.scheduled_tasks);
    const sessionOptions = normalizeAgentSessionOptions(
      overrideRecord.sessionOptions ?? overrideRecord.session_options,
    );

    if (defaultModel !== null) override.defaultModel = defaultModel;
    if (defaultPermissionMode !== null) override.defaultPermissionMode = defaultPermissionMode;
    if (systemPrompt !== null) override.systemPrompt = systemPrompt;
    if (defaultSkills.length > 0) override.defaultSkills = defaultSkills;
    if (defaultKnowledgeBases.length > 0) override.defaultKnowledgeBases = defaultKnowledgeBases;
    if (scheduledTasks.length > 0 || "scheduledTasks" in overrideRecord || "scheduled_tasks" in overrideRecord) {
      override.scheduledTasks = scheduledTasks;
    }
    if (sessionOptions) override.sessionOptions = sessionOptions;

    if (Object.keys(override).length > 0) {
      overrides[agentId] = override;
    }
  }
  return overrides;
}

export function normalizePersistedAgentWorkspaces(value: unknown): Record<string, string> {
  const record = normalizeRecord(value);
  if (!record) return {};

  const workspaces: Record<string, string> = {};
  for (const [rawAgentId, rawWorkspace] of Object.entries(record)) {
    const agentId = normalizeAgentKey(rawAgentId);
    const workspace = normalizeDisplayText(rawWorkspace);
    if (!agentId || !workspace) continue;
    workspaces[agentId] = workspace;
  }
  return workspaces;
}

function normalizeAgentSessionOptions(value: unknown): AgentSessionOptions | undefined {
  const record = normalizeRecord(value);
  if (!record) return undefined;

  const options: AgentSessionOptions = {};
  const builtinSkills = normalizeOptionalBoolean(record.builtinSkills ?? record.builtin_skills);
  const goalTracking = normalizeOptionalBoolean(record.goalTracking ?? record.goal_tracking);
  const continuationEnabled = normalizeOptionalBoolean(record.continuationEnabled ?? record.continuation_enabled);
  const autoCompact = normalizeOptionalBoolean(record.autoCompact ?? record.auto_compact);
  const maxToolRounds = normalizeOptionalFiniteNumber(record.maxToolRounds ?? record.max_tool_rounds);
  const maxContinuationTurns = normalizeOptionalFiniteNumber(
    record.maxContinuationTurns ?? record.max_continuation_turns,
  );
  const autoCompactThreshold = normalizeOptionalFiniteNumber(
    record.autoCompactThreshold ?? record.auto_compact_threshold,
  );
  const temperature = normalizeOptionalFiniteNumber(record.temperature);
  const thinkingBudget = normalizeOptionalFiniteNumber(record.thinkingBudget ?? record.thinking_budget);
  const planningMode = normalizePlanningMode(record.planningMode ?? record.planning_mode);
  const mcpServers = normalizeMcpServerConfigs(record.mcpServers ?? record.mcp_servers);
  const searchConfig = normalizeRecord(record.searchConfig ?? record.search_config);

  if (builtinSkills !== undefined) options.builtinSkills = builtinSkills;
  if (planningMode) options.planningMode = planningMode;
  if (goalTracking !== undefined) options.goalTracking = goalTracking;
  if (maxToolRounds !== undefined) options.maxToolRounds = maxToolRounds;
  if (continuationEnabled !== undefined) options.continuationEnabled = continuationEnabled;
  if (maxContinuationTurns !== undefined) options.maxContinuationTurns = maxContinuationTurns;
  if (autoCompact !== undefined) options.autoCompact = autoCompact;
  if (autoCompactThreshold !== undefined) options.autoCompactThreshold = autoCompactThreshold;
  if (temperature !== undefined) options.temperature = temperature;
  if (thinkingBudget !== undefined) options.thinkingBudget = thinkingBudget;
  if (mcpServers.length > 0) options.mcpServers = mcpServers;
  if (searchConfig) options.searchConfig = searchConfig;

  return Object.keys(options).length > 0 ? options : undefined;
}

function normalizeScheduledTasks(value: unknown): ScheduledTask[] {
  if (!Array.isArray(value)) return [];

  const seenIds = new Set<string>();
  return value.flatMap((item): ScheduledTask[] => {
    const record = normalizeRecord(item);
    if (!record) return [];

    const id = normalizeIdentifier(record.id);
    const name = normalizeDisplayText(record.name);
    const schedule = normalizeDisplayText(record.schedule);
    const prompt = normalizeDisplayText(record.prompt);
    if (!id || !name || !schedule || !prompt || seenIds.has(id)) return [];
    seenIds.add(id);

    return [
      {
        id,
        name,
        schedule,
        prompt,
        enabled: normalizeOptionalBoolean(record.enabled) ?? true,
      },
    ];
  });
}

function normalizeStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];

  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of value) {
    const text = normalizeStringText(item);
    if (!text || seen.has(text)) continue;
    seen.add(text);
    result.push(text);
  }
  return result;
}

function normalizeAvatar(value: unknown): AgentProfile["avatar"] {
  const record = normalizeRecord(value);
  return (record ?? {}) as AgentProfile["avatar"];
}

function normalizeAgentKey(value: unknown): string | null {
  const id = normalizeIdentifier(value);
  if (!id) return null;
  return id === LEGACY_DEFAULT_AGENT_ID ? DEFAULT_AGENT_ID : id;
}

function normalizeIdentifier(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

function normalizeDisplayText(value: unknown): string | null {
  if (typeof value === "string") return value.trim() || null;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

function normalizeStringText(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizeOptionalFiniteNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return undefined;
  const parsed = Number(value.trim());
  return Number.isFinite(parsed) ? parsed : undefined;
}

function normalizeOptionalBoolean(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value;
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().toLowerCase();
  if (normalized === "true" || normalized === "yes" || normalized === "1") return true;
  if (normalized === "false" || normalized === "no" || normalized === "0") return false;
  return undefined;
}

function normalizePlanningMode(value: unknown): AgentSessionOptions["planningMode"] | undefined {
  const mode = normalizeDisplayText(value);
  if (!mode) return undefined;
  return PLANNING_MODES.has(mode) ? (mode as AgentSessionOptions["planningMode"]) : "auto";
}

function normalizeRecord(value: unknown): Record<string, unknown> | null {
  return !!value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}
