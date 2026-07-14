export const KNOWLEDGE_QUERY_PORT = Symbol('KNOWLEDGE_QUERY_PORT');

export type KnowledgeQueryScope = 'personal' | 'docs' | 'global';

export interface KnowledgeQueryPort {
    searchScope(scope: KnowledgeQueryScope, userId: string, query: string, limit?: number): Promise<unknown>;
    readScopedConcept(
        scope: KnowledgeQueryScope,
        userId: string,
        pathOrConceptId: string,
        assetId?: string,
    ): Promise<unknown>;
    listScopedDirectory(
        scope: KnowledgeQueryScope,
        userId: string,
        directory?: string,
        assetId?: string,
    ): Promise<unknown>;
    listScopedTags(scope: KnowledgeQueryScope, userId: string, assetId?: string): Promise<unknown>;
}
