import type { AgentProcessInfo } from "../lib/types";

export interface PersistedSdkSessionNormalizeOptions {
  fallbackCreatedAt?: number;
  exposeWorkspacePath?: (path: string) => string;
}

export function normalizePersistedSessionCreatedAt(value: unknown, fallback = Date.now()): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return normalizeTimestampMagnitude(value);
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return fallback;

    const numeric = Number(trimmed);
    if (Number.isFinite(numeric)) {
      return normalizeTimestampMagnitude(numeric);
    }

    const parsed = Date.parse(trimmed);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return fallback;
}

export function normalizePersistedSdkSessions(
  value: unknown,
  options: PersistedSdkSessionNormalizeOptions = {},
): AgentProcessInfo[] {
  if (!Array.isArray(value)) return [];

  return value.flatMap((item): AgentProcessInfo[] => {
    const record = normalizeRecord(item);
    if (!record) return [];

    const sessionId = normalizeIdentifier(record.sessionId);
    if (!sessionId) return [];

    const cwd = normalizeOptionalString(record.cwd) ?? "";
    const session: AgentProcessInfo = {
      sessionId,
      agentId: normalizeNullableIdentifier(record.agentId),
      state: normalizeSessionState(record.state),
      cwd: options.exposeWorkspacePath ? options.exposeWorkspacePath(cwd) : cwd,
      createdAt: normalizePersistedSessionCreatedAt(record.createdAt, options.fallbackCreatedAt ?? Date.now()),
    };

    const pid = normalizeOptionalFiniteNumber(record.pid);
    const exitCode =
      record.exitCode === null ? null : normalizeOptionalFiniteNumber(record.exitCode ?? record.exit_code);
    const model = normalizeOptionalString(record.model);
    const permissionMode = normalizeOptionalString(record.permissionMode ?? record.permission_mode);
    const cliSessionId = normalizeOptionalString(record.cliSessionId ?? record.cli_session_id);
    const name = normalizeOptionalString(record.name);
    const assetId = normalizeOptionalString(record.assetId ?? record.asset_id);
    const agentPhase = normalizeOptionalString(record.agentPhase ?? record.agent_phase);
    const metadata = normalizeRecord(record.metadata);

    if (pid !== undefined) session.pid = pid;
    if (exitCode !== undefined) session.exitCode = exitCode;
    if (model !== undefined) session.model = model;
    const followDefaultModel = normalizeOptionalBoolean(record.followDefaultModel ?? record.follow_default_model);
    if (followDefaultModel !== undefined) {
      session.followDefaultModel = followDefaultModel;
    }
    if (permissionMode !== undefined) session.permissionMode = permissionMode;
    if (cliSessionId !== undefined) session.cliSessionId = cliSessionId;
    if (name !== undefined) session.name = name;
    if (assetId !== undefined) session.assetId = assetId;
    if (agentPhase !== undefined) session.agentPhase = agentPhase;
    if (metadata) session.metadata = metadata;

    return [session];
  });
}

export function normalizePersistedSessionNames(value: unknown): Record<string, string> {
  const record = normalizeRecord(value);
  if (!record) return {};

  const names: Record<string, string> = {};
  for (const [rawSessionId, rawName] of Object.entries(record)) {
    const sessionId = rawSessionId.trim();
    if (!sessionId) continue;
    const name = normalizeDisplayText(rawName);
    if (!name) continue;
    names[sessionId] = name;
  }
  return names;
}

function normalizeTimestampMagnitude(value: number): number {
  return value > 0 && value < 1e12 ? value * 1000 : value;
}

function normalizeRecord(value: unknown): Record<string, unknown> | null {
  return !!value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function normalizeIdentifier(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

function normalizeNullableIdentifier(value: unknown): string | null {
  return normalizeIdentifier(value);
}

function normalizeOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function normalizeDisplayText(value: unknown): string | null {
  if (typeof value === "string") return value.trim() || null;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

function normalizeOptionalFiniteNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  return undefined;
}

function normalizeOptionalBoolean(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value;
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().toLowerCase();
  if (normalized === "true" || normalized === "yes" || normalized === "1") return true;
  if (normalized === "false" || normalized === "no" || normalized === "0") return false;
  return undefined;
}

function normalizeSessionState(value: unknown): AgentProcessInfo["state"] {
  if (
    value === "starting" ||
    value === "connected" ||
    value === "running" ||
    value === "exited" ||
    value === "creating"
  ) {
    return value;
  }
  return "connected";
}
