/**
 * PR #7 intentionally targets the single-owner local desktop workspace. A
 * future auth_user multi-user mode must replace this shared UI/runtime scope
 * deliberately instead of letting the two call sites resolve independently.
 */
export const LOCAL_DESKTOP_SKILL_USER_SCOPE = null;

export interface SkillDirResolvers {
  getAgentWorkspacePath(agentId: string): Promise<string>;
  getUserSkillsPath(userId: string | number | null): Promise<string>;
  getSharedSkillsPath(userId: string | number | null): Promise<string>;
}

/**
 * Compose agent, personal, and shared skill roots. Duplicate and empty paths
 * are removed so a missing optional resolver cannot block session creation.
 */
export function composeSkillDirs(agentSkillsPath: string, userSkillsPath: string, sharedSkillsPath: string): string[] {
  return Array.from(
    new Set([agentSkillsPath, userSkillsPath, sharedSkillsPath].map((dir) => dir.trim()).filter(Boolean)),
  );
}

/**
 * Resolve the exact skill directory list consumed by buildAgentRuntimeConfig.
 *
 * SkillsPage intentionally represents the local desktop owner with an explicit
 * null scope. Runtime resolution uses the same value for personal and shared
 * paths so a future auth_user implementation cannot silently split the UI and
 * runtime directories again.
 */
export async function resolveAgentSkillDirs(agentId: string, resolvers: SkillDirResolvers): Promise<string[]> {
  const agentSkillsPath = `${await resolvers.getAgentWorkspacePath(agentId)}/skills`;
  const [userSkillsPath, sharedSkillsPath] = await Promise.all([
    resolvers.getUserSkillsPath(LOCAL_DESKTOP_SKILL_USER_SCOPE).catch(() => ""),
    resolvers.getSharedSkillsPath(LOCAL_DESKTOP_SKILL_USER_SCOPE).catch(() => ""),
  ]);

  return composeSkillDirs(agentSkillsPath, userSkillsPath, sharedSkillsPath);
}
