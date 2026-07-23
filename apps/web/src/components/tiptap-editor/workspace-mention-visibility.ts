const INTERNAL_WORKSPACE_NAMES = new Set([
  ".memory",
  ".sessions",
  ".internshannon",
  "traces",
  "subagent_tasks",
]);

/** Files offered to the model/user must exclude application state and hidden metadata. */
export function isWorkspaceMentionVisibleName(name: string): boolean {
  const normalized = name.trim();
  return Boolean(normalized) && !normalized.startsWith(".") && !INTERNAL_WORKSPACE_NAMES.has(normalized);
}
export function filterWorkspaceMentionNodes<T extends { name: string }>(nodes: readonly T[] | null | undefined): T[] {
  return (nodes ?? []).filter((node) => isWorkspaceMentionVisibleName(node.name));
}
