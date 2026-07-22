export interface KnowledgeAssetCitation {
  assetId: string;
  relativePath: string;
}
export function parseKnowledgeAssetCitation(value: string | null | undefined): KnowledgeAssetCitation | null {
  const normalized = String(value || "").trim().replace(/[),.;，。；：]+$/, "");
  if (!normalized.startsWith("asset://")) return null;
  const segments = normalized.slice("asset://".length).split("/").filter(Boolean);
  if (segments.length < 2) return null;
  try {
    return {
      assetId: decodeURIComponent(segments[0]),
      relativePath: segments.slice(1).map((part) => decodeURIComponent(part)).join("/"),
    };
  } catch {
    return { assetId: segments[0], relativePath: segments.slice(1).join("/") };
  }
}
