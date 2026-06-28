const CURRENT_DESKTOP_DATA_DIR = ".internshannon";
const LEGACY_DESKTOP_DATA_DIR = ".a3s";
const WORKSPACE_DIR = "workspace";

function normalizeForWorkspaceMigration(value?: string | null): string {
  return (value ?? "").trim().replace(/\\/g, "/").replace(/\/+$/g, "");
}

export function getLegacyDesktopDefaultWorkspaceRoot(defaultWorkspaceRoot?: string | null): string | null {
  const normalizedDefaultRoot = normalizeForWorkspaceMigration(defaultWorkspaceRoot);
  const currentSuffix = `/${CURRENT_DESKTOP_DATA_DIR}/${WORKSPACE_DIR}`;
  if (!normalizedDefaultRoot.endsWith(currentSuffix)) {
    return null;
  }

  return `${normalizedDefaultRoot.slice(0, -currentSuffix.length)}/${LEGACY_DESKTOP_DATA_DIR}/${WORKSPACE_DIR}`;
}

export function resolveMigratedDesktopWorkspaceRoot(
  currentWorkspaceRoot?: string | null,
  defaultWorkspaceRoot?: string | null,
): string {
  const currentRoot = (currentWorkspaceRoot ?? "").trim();
  const defaultRoot = (defaultWorkspaceRoot ?? "").trim();
  if (!currentRoot || !defaultRoot) {
    return currentRoot;
  }

  const legacyRoot = getLegacyDesktopDefaultWorkspaceRoot(defaultRoot);
  if (!legacyRoot) {
    return currentRoot;
  }

  return normalizeForWorkspaceMigration(currentRoot) === legacyRoot ? defaultRoot : currentRoot;
}
