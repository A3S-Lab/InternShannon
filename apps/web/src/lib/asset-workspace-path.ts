import { normalizeWorkspacePath } from "./workspace-path";

const ASSET_WORKSPACE_PREFIX = "asset://";
const DEFAULT_ASSET_WORKSPACE_REF = "main";

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export interface AssetWorkspacePath {
  assetId: string;
  ref: string;
  relativePath: string;
}

export function buildAssetWorkspaceRoot(assetId: string, ref?: string | null): string {
  return `${ASSET_WORKSPACE_PREFIX}${encodeURIComponent(assetId)}/${encodeURIComponent(
    ref?.trim() || DEFAULT_ASSET_WORKSPACE_REF,
  )}`;
}

export function parseAssetWorkspacePath(value: string | null | undefined): AssetWorkspacePath | null {
  const normalized = normalizeWorkspacePath(value);
  if (!normalized.startsWith(ASSET_WORKSPACE_PREFIX)) return null;

  const segments = normalized.slice(ASSET_WORKSPACE_PREFIX.length).split("/");
  const assetId = safeDecode(segments[0] ?? "");
  if (!assetId) return null;

  const ref = safeDecode(segments[1] ?? "") || DEFAULT_ASSET_WORKSPACE_REF;
  const relativePath = segments.slice(2).filter(Boolean).join("/");

  return {
    assetId,
    ref,
    relativePath,
  };
}
