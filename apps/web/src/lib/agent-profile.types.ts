import type { AvatarFullConfig } from "react-nice-avatar";
import type { McpServerConfig } from "./mcp-server-config";

export interface ScheduledTask {
  id: string;
  name: string;
  /** Cron expression, e.g. "0 9 * * 1-5" */
  schedule: string;
  /** Prompt/instruction to execute on schedule */
  prompt: string;
  enabled: boolean;
}

export interface AgentSessionOptions {
  builtinSkills?: boolean;
  planningMode?: "auto" | "enabled" | "disabled";
  goalTracking?: boolean;
  maxToolRounds?: number;
  continuationEnabled?: boolean;
  maxContinuationTurns?: number;
  autoCompact?: boolean;
  autoCompactThreshold?: number;
  temperature?: number;
  thinkingBudget?: number;
  toolTimeoutMs?: number;
  queueTimeoutMs?: number;
  maxExecutionTimeMs?: number;
  streamStallWarningMs?: number;
  streamStallHardMs?: number;
  streamStallActiveToolHardMs?: number;
  maxConsecutiveToolErrors?: number;
  maxStreamRetries?: number;
  autoParallel?: boolean;
  maxParallelTasks?: number;
  autoDelegation?: {
    enabled?: boolean;
    autoParallel?: boolean;
    minConfidence?: number;
    maxTasks?: number;
  };
  artifactStoreLimits?: {
    maxArtifacts?: number;
    maxBytes?: number;
  };
  mcpServers?: McpServerConfig[];
  searchConfig?: Record<string, unknown>;
}

export interface AgentProfile {
  id: string;
  name: string;
  description: string;
  avatar: AvatarFullConfig;
  systemPrompt: string;
  defaultModel?: string;
  defaultPermissionMode?: string;
  autoWorkspaceMode?: "agent";
  builtin?: boolean;
  /** If true, reserved for internal agents and hidden from agent pickers/lists. */
  hidden?: boolean;
  /** If true, cannot be deleted by user. */
  undeletable?: boolean;
  /** Category tags for marketplace filtering. */
  tags?: string[];
  /** Default workspace path for this agent, shared across all sessions. */
  defaultWorkspace?: string;
  /** Default skills to enable for this agent. */
  defaultSkills?: string[];
  /** Default runtime parameters for new conversations with this agent. */
  sessionOptions?: AgentSessionOptions;
  /** IDs of knowledge bases this agent can access. */
  defaultKnowledgeBases?: string[];
  /** Scheduled tasks for this agent. */
  scheduledTasks?: ScheduledTask[];
}
