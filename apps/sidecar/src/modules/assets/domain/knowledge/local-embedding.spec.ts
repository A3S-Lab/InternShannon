import {
    LOCAL_EMBEDDING_DIMENSIONS,
    LOCAL_EMBEDDING_MODEL,
    cosineSimilarity,
    localEmbedding,
} from './local-embedding';

describe('local embedding adapter', () => {
    it('produces stable vectors and aligns configured business synonyms', () => {
        const revenue = localEmbedding('Monthly revenue increased after renewal changes.');
        const income = localEmbedding('Monthly income increased after subscription extension changes.');
        const unrelated = localEmbedding('Incident response runbook for network outages.');

        expect(LOCAL_EMBEDDING_MODEL).toBe('local-hash-v1');
        expect(revenue).toHaveLength(LOCAL_EMBEDDING_DIMENSIONS);
        expect(localEmbedding('Monthly revenue increased after renewal changes.')).toEqual(revenue);
        expect(cosineSimilarity(revenue, income)).toBeGreaterThan(cosineSimilarity(revenue, unrelated));
        expect(cosineSimilarity(revenue, income)).toBeGreaterThan(0.3);
    });
});
