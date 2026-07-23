export interface KnowledgeRetrievalSettings {
  keywordWeight: number;
  vectorWeight: number;
  mmrLambda: number;
}

export const KNOWLEDGE_RETRIEVAL_PRESETS = {
  balanced: { label: "平衡（推荐）", keywordWeight: 1, vectorWeight: 6, mmrLambda: 0.78 },
  precise: { label: "精确匹配", keywordWeight: 2, vectorWeight: 8, mmrLambda: 0.88 },
  recall: { label: "高召回", keywordWeight: 4, vectorWeight: 6, mmrLambda: 0.64 },
} as const;

export function retrievalPresetId(
  embedding: KnowledgeRetrievalSettings,
): keyof typeof KNOWLEDGE_RETRIEVAL_PRESETS | "custom" {
  for (const [id, preset] of Object.entries(KNOWLEDGE_RETRIEVAL_PRESETS)) {
    if (
      embedding.keywordWeight === preset.keywordWeight &&
      embedding.vectorWeight === preset.vectorWeight &&
      embedding.mmrLambda === preset.mmrLambda
    ) {
      return id as keyof typeof KNOWLEDGE_RETRIEVAL_PRESETS;
    }
  }
  return "custom";
}
