import { joinWorkspacePath } from "./workspace-path.ts";

const INVALID_WORKSPACE_PATH_CHARS = new Set(["<", ">", ":", '"', "|", "?", "*", "\\"]);

function replaceInvalidWorkspacePathCharacters(value: string): string {
  let result = "";
  for (const char of value) {
    result += char.charCodeAt(0) < 32 || INVALID_WORKSPACE_PATH_CHARS.has(char) ? "-" : char;
  }
  return result;
}

function normalizeWorkspacePathSegment(value: string | number | null | undefined, fallback: string): string {
  const normalized = replaceInvalidWorkspacePathCharacters(String(value ?? ""))
    .trim()
    .replace(/^\/+|\/+$/g, "");
  return normalized && normalized !== "." && normalized !== ".." ? normalized : fallback;
}

export function buildSessionWorkspacePath(userWorkspaceRoot: string, agentId: string, now = new Date()): string {
  const pad = (n: number, width = 2) => String(n).padStart(width, "0");
  const date = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
  const time = `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}${pad(now.getMilliseconds(), 3)}`;
  const agentSegment = normalizeWorkspacePathSegment(agentId, "general");
  return joinWorkspacePath(userWorkspaceRoot, "sessions", `${agentSegment}-${date}-${time}`);
}
