import type { AgentProcessInfo } from "./types";

export interface CreatedSessionProjection {
  sessionId: string;
  agentId?: string | null;
  title?: string;
  cwd?: string;
  model?: string;
  followDefaultModel?: boolean;
  permissionMode?: string;
  assetId?: string;
  agentPhase?: string;
  metadata?: Record<string, unknown>;
}

export interface BuildCreatedSessionInfoInput {
  session: CreatedSessionProjection;
  normalizedAgentId?: string | null;
  permissionMode: string;
  cwd: string;
  createdAt: number;
  name: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function stringFromRecord(record: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = record?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function booleanFromRecord(record: Record<string, unknown> | undefined, key: string): boolean | undefined {
  const value = record?.[key];
  return typeof value === "boolean" ? value : undefined;
}

export function buildCreatedSessionInfo(input: BuildCreatedSessionInfoInput): AgentProcessInfo {
  const metadata = isRecord(input.session.metadata) ? input.session.metadata : undefined;
  const model = input.session.model?.trim() || stringFromRecord(metadata, "model");
  const followDefaultModel =
    input.session.followDefaultModel ?? booleanFromRecord(metadata, "followDefaultModel") ?? !model;
  return {
    sessionId: input.session.sessionId,
    agentId: input.normalizedAgentId,
    state: "connected",
    model,
    followDefaultModel,
    permissionMode:
      input.session.permissionMode?.trim() || stringFromRecord(metadata, "permissionMode") || input.permissionMode,
    cwd: input.cwd,
    createdAt: input.createdAt,
    name: input.name,
    assetId: input.session.assetId ?? stringFromRecord(metadata, "assetId"),
    agentPhase: input.session.agentPhase ?? stringFromRecord(metadata, "agentPhase"),
    metadata,
  };
}
