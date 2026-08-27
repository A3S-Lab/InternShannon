export interface KnowledgeTableRelation {
    sourceColumn: string;
    targetPath: string;
    targetColumn: string;
    confidence: "declared" | "high" | "medium";
    reason: "schema" | "column_identity" | "column_entity_match";
}

export interface KnowledgeTableCatalogEntry {
    assetId?: string;
    path: string;
    title: string;
    mime: string;
    columns: string[];
    primaryKey: string | null;
    recordCount: number;
    recordIds: string[];
    recordIdsTruncated: boolean;
    resource: string;
    aliases?: string[];
    relations?: KnowledgeTableRelation[];
}

interface DeclaredTable {
    path: string;
    aliases: string[];
    primaryKey?: string;
    relations: Array<{ column: string; targetPath: string; targetColumn: string }>;
}

const MAX_DECLARED_TABLES = 50;
const MAX_ALIASES_PER_TABLE = 16;
const MAX_RELATIONS_PER_TABLE = 24;
const MAX_SCHEMA_STRING = 240;

function safeString(value: unknown): string | null {
    if (typeof value !== "string") return null;
    const trimmed = value.trim();
    return trimmed && trimmed.length <= MAX_SCHEMA_STRING ? trimmed : null;
}

function safeSourcePath(value: unknown): string | null {
    const path = safeString(value);
    if (!path || !path.startsWith("raw/sources/") || path.includes("..") || path.includes("\\")) return null;
    return path;
}

function parseSchemaPayload(schemaMarkdown: string): Record<string, unknown> | null {
    const fenced = schemaMarkdown.match(/```(?:knowledge-grounding|json\s+knowledge-grounding)\s*\r?\n([\s\S]*?)```/i);
    if (!fenced?.[1]) return null;
    try {
        const parsed = JSON.parse(fenced[1]);
        return parsed && typeof parsed === "object" && !Array.isArray(parsed)
            ? (parsed as Record<string, unknown>)
            : null;
    } catch {
        return null;
    }
}

export function parseKnowledgeGroundingSchema(schemaMarkdown: string): DeclaredTable[] {
    const payload = parseSchemaPayload(schemaMarkdown);
    if (!payload || payload.version !== 1 || !Array.isArray(payload.tables)) return [];
    const tables: DeclaredTable[] = [];
    for (const value of payload.tables.slice(0, MAX_DECLARED_TABLES)) {
        if (!value || typeof value !== "object" || Array.isArray(value)) continue;
        const record = value as Record<string, unknown>;
        const path = safeSourcePath(record.path);
        if (!path) continue;
        const aliases = Array.isArray(record.aliases)
            ? Array.from(
                  new Set(
                      record.aliases
                          .slice(0, MAX_ALIASES_PER_TABLE)
                          .map(safeString)
                          .filter((item): item is string => Boolean(item)),
                  ),
              )
            : [];
        const primaryKey = safeString(record.primaryKey) ?? undefined;
        const relations: DeclaredTable["relations"] = [];
        if (Array.isArray(record.relations)) {
            for (const relationValue of record.relations.slice(0, MAX_RELATIONS_PER_TABLE)) {
                if (!relationValue || typeof relationValue !== "object" || Array.isArray(relationValue)) continue;
                const relation = relationValue as Record<string, unknown>;
                const column = safeString(relation.column);
                const targetPath = safeSourcePath(relation.targetPath);
                const targetColumn = safeString(relation.targetColumn);
                if (column && targetPath && targetColumn) relations.push({ column, targetPath, targetColumn });
            }
        }
        tables.push({ path, aliases, primaryKey, relations });
    }
    return tables;
}

function columnEntity(value: string): string {
    return value
        .trim()
        .toLowerCase()
        .replace(/[^\p{L}\p{N}]+/gu, "_")
        .replace(/_id$/u, "")
        .replace(/^(?:from|to|start|end|source|target|origin|destination|location|current|assigned)_/u, "")
        .replace(/^id_/u, "");
}

function inferPrimaryKey(entry: KnowledgeTableCatalogEntry): string | null {
    if (entry.primaryKey && entry.columns.includes(entry.primaryKey)) return entry.primaryKey;
    const idColumn = entry.columns.find((column) => /(?:^id$|_id$)/i.test(column));
    return idColumn ?? entry.columns[0] ?? null;
}

/**
 * Enrich lightweight table summaries with declarative aliases/relations and
 * conservative column-name relations. Inferred relations are retrieval hints
 * only; callers must never present them as verified facts.
 */
export function buildKnowledgeTableCatalog(
    summaries: KnowledgeTableCatalogEntry[],
    schemaByAsset: ReadonlyMap<string, string> = new Map(),
): KnowledgeTableCatalogEntry[] {
    const declaredByAssetPath = new Map<string, DeclaredTable>();
    for (const [assetId, markdown] of schemaByAsset) {
        for (const table of parseKnowledgeGroundingSchema(markdown)) {
            declaredByAssetPath.set(`${assetId}:${table.path}`, table);
        }
    }

    const catalog = summaries.map((summary) => {
        const declared = declaredByAssetPath.get(`${summary.assetId ?? ""}:${summary.path}`);
        const primaryKey =
            declared?.primaryKey && summary.columns.includes(declared.primaryKey)
                ? declared.primaryKey
                : inferPrimaryKey(summary);
        return {
            ...summary,
            primaryKey,
            ...(declared?.aliases.length ? { aliases: declared.aliases } : {}),
            relations: [] as KnowledgeTableRelation[],
        };
    });

    for (const entry of catalog) {
        const declared = declaredByAssetPath.get(`${entry.assetId ?? ""}:${entry.path}`);
        const relations = new Map<string, KnowledgeTableRelation>();
        for (const relation of declared?.relations ?? []) {
            const target = catalog.find(
                (candidate) => candidate.assetId === entry.assetId && candidate.path === relation.targetPath,
            );
            if (!entry.columns.includes(relation.column) || !target?.columns.includes(relation.targetColumn)) continue;
            relations.set(`${relation.column}:${relation.targetPath}:${relation.targetColumn}`, {
                sourceColumn: relation.column,
                targetPath: relation.targetPath,
                targetColumn: relation.targetColumn,
                confidence: "declared",
                reason: "schema",
            });
        }

        for (const column of entry.columns) {
            if (column === entry.primaryKey) continue;
            const entity = columnEntity(column);
            if (!entity) continue;
            for (const target of catalog) {
                if (target.assetId !== entry.assetId || target.path === entry.path || !target.primaryKey) continue;
                const targetEntity = columnEntity(target.primaryKey);
                if (!targetEntity || entity !== targetEntity) continue;
                const exact = column.toLowerCase() === target.primaryKey.toLowerCase();
                const relation: KnowledgeTableRelation = {
                    sourceColumn: column,
                    targetPath: target.path,
                    targetColumn: target.primaryKey,
                    confidence: exact ? "high" : "medium",
                    reason: exact ? "column_identity" : "column_entity_match",
                };
                const key = `${column}:${target.path}:${target.primaryKey}`;
                if (!relations.has(key)) relations.set(key, relation);
            }
        }
        entry.relations = Array.from(relations.values()).slice(0, MAX_RELATIONS_PER_TABLE);
    }
    return catalog;
}
