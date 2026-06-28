import type { AgentSessionState } from "../../lib/types";

export interface SessionStatusPatchContext {
  currentAgentId?: string | null;
  currentCwd?: string;
  resolveWorkspacePath: (storageWorkspace: string, currentCwd: string, statusWorkspace: string) => string;
}

export function normalizeSlashCommands(commands: unknown): string[] {
  if (!Array.isArray(commands)) return [];
  const names = commands
    .map((command) => {
      if (typeof command === "string") return command;
      if (!isRecord(command)) return "";
      const value = command.name ?? command.command ?? command.id ?? command.title ?? command.label;
      return typeof value === "string" ? value : "";
    })
    .map((command) => command.trim())
    .filter(Boolean);
  return Array.from(new Set(names));
}

export function normalizeRuntimeSkills(skills: unknown): {
  names: string[];
  details: Array<{ name: string; description?: string; kind?: string }>;
} {
  if (!Array.isArray(skills)) return { names: [], details: [] };
  const details = skills
    .map((skill) => {
      if (typeof skill === "string") {
        const name = skill.trim();
        return name ? { name } : null;
      }
      if (!isRecord(skill)) return null;
      const name = nonEmptyString(skill.name);
      if (!name) return null;
      return {
        name,
        description: optionalString(skill.description),
        kind: optionalString(skill.kind),
      };
    })
    .filter((skill): skill is { name: string; description?: string; kind?: string } => Boolean(skill));
  const deduped = Array.from(new Map(details.map((skill) => [skill.name, skill])).values()).sort((a, b) =>
    a.name.localeCompare(b.name),
  );
  return {
    names: deduped.map((skill) => skill.name),
    details: deduped,
  };
}

export function normalizeSessionStatusPatch(
  data: unknown,
  context: SessionStatusPatchContext,
): Partial<AgentSessionState> {
  if (!isRecord(data)) return {};

  const currentCwd = context.currentCwd ?? "";
  const storageWorkspace = optionalString(data.storageWorkspace) ?? "";
  const statusWorkspace = optionalString(data.workspace) ?? "";
  const runtimeSkills = normalizeRuntimeSkills(data.skills);

  const patch: Partial<AgentSessionState> = {
    agentId: normalizeNullableString(data.agentId, context.currentAgentId),
    cwd: context.resolveWorkspacePath(storageWorkspace, currentCwd, statusWorkspace),
    tools: normalizeStringList(data.toolNames),
    skillDetails: runtimeSkills.details,
    skills: runtimeSkills.names,
    slashCommands: normalizeSlashCommands(data.commands),
    mcpServers: normalizeMcpServers(data.mcpStatus),
  };

  if ("toolDefinitions" in data) {
    patch.toolDefinitions = data.toolDefinitions;
  }
  return patch;
}

function normalizeMcpServers(value: unknown): Array<{ name: string; status: string }> {
  if (!Array.isArray(value)) return [];
  return value.flatMap((server) => {
    if (!isRecord(server)) return [];
    const name = nonEmptyString(server.name);
    if (!name) return [];
    return [
      {
        name,
        status: server.connected === true ? "connected" : (nonEmptyString(server.error) ?? "disconnected"),
      },
    ];
  });
}

function normalizeStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(
    new Set(
      value.flatMap((item) => {
        const text = nonEmptyString(item);
        return text ? [text] : [];
      }),
    ),
  );
}

function normalizeNullableString(value: unknown, fallback?: string | null): string | null | undefined {
  if (value === null) return null;
  if (typeof value === "string") return value;
  return fallback;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function nonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
