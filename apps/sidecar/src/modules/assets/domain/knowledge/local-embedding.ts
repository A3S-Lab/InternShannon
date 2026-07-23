import { createHash } from 'node:crypto';

export const LOCAL_EMBEDDING_MODEL = 'local-hash-v1';
export const LOCAL_EMBEDDING_DIMENSIONS = 192;

const SYNONYMS: Array<[RegExp, string]> = [
    [/\b(income|sales|turnover|earnings)\b|收入|营收|销售额/giu, ' revenue '],
    [/\b(renewal|renew|subscription extension)\b|续订|续费|续约/giu, ' renewal '],
    [/\b(outage|incident|service disruption)\b|故障|事故|服务中断/giu, ' incident '],
    [/\b(customer|client|buyer)\b|客户|用户|买家/giu, ' customer '],
    [/\b(refund|reimbursement|money back)\b|退款|退费/giu, ' refund '],
];

export function localEmbedding(text: string): number[] {
    const normalized = normalizeSemanticText(text);
    const vector = Array<number>(LOCAL_EMBEDDING_DIMENSIONS).fill(0);
    const terms = normalized.match(/[\p{Script=Han}]|[a-z0-9]+/gu) ?? [];
    const features = [...terms];
    for (let index = 0; index < terms.length - 1; index += 1) features.push(`${terms[index]}_${terms[index + 1]}`);
    for (const term of terms) {
        if (/^[\p{Script=Han}]$/u.test(term)) continue;
        for (let index = 0; index < term.length - 2; index += 1) features.push(`~${term.slice(index, index + 3)}`);
    }
    for (const feature of features) {
        const digest = createHash('sha1').update(feature).digest();
        const slot = digest.readUInt16BE(0) % LOCAL_EMBEDDING_DIMENSIONS;
        vector[slot] += digest[2] % 2 === 0 ? 1 : -1;
    }
    const magnitude = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
    return magnitude ? vector.map(value => Number((value / magnitude).toFixed(6))) : vector;
}

export function cosineSimilarity(left: number[], right: number[]): number {
    const length = Math.min(left.length, right.length);
    let dot = 0;
    let leftMagnitude = 0;
    let rightMagnitude = 0;
    for (let index = 0; index < length; index += 1) {
        dot += left[index] * right[index];
        leftMagnitude += left[index] * left[index];
        rightMagnitude += right[index] * right[index];
    }
    if (!leftMagnitude || !rightMagnitude) return 0;
    return Math.max(0, Math.min(1, dot / Math.sqrt(leftMagnitude * rightMagnitude)));
}

export function normalizeSemanticText(text: string): string {
    let normalized = text.normalize('NFKC').toLowerCase();
    for (const [pattern, replacement] of SYNONYMS) normalized = normalized.replace(pattern, replacement);
    return normalized.replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

const LOCAL_SEMANTIC_STOP_WORDS = new Set([
    'the', 'and', 'for', 'with', 'from', 'that', 'this', 'into', 'are', 'was', 'were', 'has', 'have', 'had',
]);

/**
 * local-hash-v1 is a compact lexical hash, not a neural embedding. Requiring a
 * real normalized token overlap prevents hash collisions in large corpora from
 * becoming semantic-only search hits while retaining the built-in synonyms.
 */
export function hasLocalSemanticTokenOverlap(left: string, right: string): boolean {
    const tokens = (value: string) =>
        (normalizeSemanticText(value).match(/[a-z0-9]+/g) ?? []).filter(
            token => token.length >= 3 && !LOCAL_SEMANTIC_STOP_WORDS.has(token),
        );
    const leftTokens = new Set(tokens(left));
    return leftTokens.size > 0 && tokens(right).some(token => leftTokens.has(token));
}
