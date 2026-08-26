const LATIN_STOP_WORDS = new Set([
    "the",
    "and",
    "for",
    "with",
    "from",
    "that",
    "this",
    "into",
    "are",
    "was",
    "were",
    "has",
    "have",
    "had",
]);

const HAN_STOP_TOKENS = new Set([
    "什么",
    "为什",
    "怎么",
    "如何",
    "为何",
    "请问",
    "帮我",
    "麻烦",
    "查询",
    "查找",
    "搜索",
    "一下",
    "是否",
]);

export interface KnowledgeTokenOptions {
    maxTokens?: number;
    minLatinLength?: number;
    includeHanPhrases?: boolean;
}

/**
 * Produce the same bounded lexical features for search, local-semantic
 * collision checks and grounding planning. Han text has no whitespace word
 * boundary, so contiguous runs contribute stable bigrams plus a short phrase;
 * Latin/identifier tokens retain their original underscore and dash syntax.
 */
export function knowledgeSearchTokens(value: string, options: KnowledgeTokenOptions = {}): string[] {
    const normalized = value.normalize("NFKC").toLowerCase();
    const maxTokens = Math.max(1, Math.min(256, options.maxTokens ?? 80));
    const minLatinLength = Math.max(1, Math.min(8, options.minLatinLength ?? 2));
    const tokens = new Set<string>();
    const add = (token: string) => {
        const trimmed = token.trim();
        if (!trimmed || tokens.size >= maxTokens) return;
        if (LATIN_STOP_WORDS.has(trimmed) || HAN_STOP_TOKENS.has(trimmed)) return;
        tokens.add(trimmed);
    };

    for (const token of normalized.match(/[a-z0-9][a-z0-9_-]*/g) ?? []) {
        if (token.length >= minLatinLength) add(token);
    }
    for (const run of normalized.match(/[\p{Script=Han}]+/gu) ?? []) {
        if (options.includeHanPhrases !== false && run.length >= 2 && run.length <= 24) add(run);
        for (let index = 0; index < run.length - 1 && tokens.size < maxTokens; index += 1) {
            add(run.slice(index, index + 2));
        }
    }
    return Array.from(tokens);
}

export function hasKnowledgeTokenOverlap(left: string, right: string): boolean {
    const leftTokens = new Set(knowledgeSearchTokens(left, { minLatinLength: 3, maxTokens: 128 }));
    if (leftTokens.size === 0) return false;
    return knowledgeSearchTokens(right, { minLatinLength: 3, maxTokens: 256 }).some((token) => leftTokens.has(token));
}
