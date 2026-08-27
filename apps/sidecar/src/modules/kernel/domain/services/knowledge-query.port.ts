export const KNOWLEDGE_QUERY_PORT = Symbol("KNOWLEDGE_QUERY_PORT");

export type KnowledgeQueryScope = "personal" | "docs" | "global";

export type KnowledgeQueryScalar = string | number | boolean;

export interface KnowledgeReadFilter {
    column: string;
    op: "eq" | "in";
    value: KnowledgeQueryScalar | KnowledgeQueryScalar[];
}

export interface KnowledgeStructuredQueryRequest {
    assetId?: string;
    from: string;
    select?: string[];
    filters?: Array<{
        column: string;
        op: "eq" | "in" | "contains" | "gt" | "gte" | "lt" | "lte";
        value: KnowledgeQueryScalar | KnowledgeQueryScalar[];
    }>;
    aggregates?: Array<{ op: "count" | "sum" | "min" | "max"; column?: string; as: string }>;
    joins?: Array<{
        targetPath: string;
        sourceColumn: string;
        targetColumn: string;
        type?: "inner" | "left";
    }>;
    orderBy?: Array<{ column: string; direction?: "asc" | "desc" }>;
    limit?: number;
    cursor?: string;
    expectedRevision?: string;
}

export interface KnowledgeQueryPort {
    searchScope(
        scope: KnowledgeQueryScope,
        userId: string,
        query: string,
        limit?: number,
        includeTableCatalog?: boolean,
        options?: { searchCursor?: string; catalogCursor?: string },
    ): Promise<unknown>;
    readScopedConcept(
        scope: KnowledgeQueryScope,
        userId: string,
        pathOrConceptId: string,
        assetId?: string,
        identifiers?: string[],
        expectedRevision?: string,
        filters?: KnowledgeReadFilter[],
    ): Promise<unknown>;
    listScopedDirectory(
        scope: KnowledgeQueryScope,
        userId: string,
        directory?: string,
        assetId?: string,
    ): Promise<unknown>;
    listScopedTags(scope: KnowledgeQueryScope, userId: string, assetId?: string): Promise<unknown>;
    queryStructuredScope(
        scope: KnowledgeQueryScope,
        userId: string,
        input: KnowledgeStructuredQueryRequest,
    ): Promise<unknown>;
}
