import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import {
    chmodSync,
    closeSync,
    existsSync,
    fsyncSync,
    linkSync,
    mkdirSync,
    openSync,
    readFileSync,
    rmSync,
    writeSync,
} from "node:fs";
import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";

import path = require("node:path");
import XLSX = require("xlsx");

import { desktopDataDir } from "@/shared/infrastructure/desktop/desktop-paths";
import type { Asset } from "../domain/entities/asset.entity";
import { isPublicKnowledgeSourcePath } from "../domain/knowledge/knowledge-source-path.policy";
import { ASSET_SERVICE, type IAssetService } from "../domain/services/asset.service.interface";
import {
    type KnowledgeIndexSnapshot,
    KnowledgeIngestionService,
    type KnowledgeSourceManifest,
    type KnowledgeSourceManifestEntry,
} from "./knowledge-ingestion.service";
import { parseKnowledgeGroundingSchema } from "./knowledge-table-catalog";

export type KnowledgeStructuredScope = "personal" | "docs" | "global";
export type KnowledgeFilterOperator = "eq" | "in" | "contains" | "gt" | "gte" | "lt" | "lte";
export type KnowledgeScalar = string | number | boolean;

export interface KnowledgeStructuredFilter {
    column: string;
    op: KnowledgeFilterOperator;
    value: KnowledgeScalar | KnowledgeScalar[];
}

export interface KnowledgeStructuredAggregate {
    op: "count" | "sum" | "min" | "max";
    column?: string;
    as: string;
}

export interface KnowledgeStructuredJoin {
    targetPath: string;
    sourceColumn: string;
    targetColumn: string;
    type?: "inner" | "left";
}

export interface KnowledgeStructuredOrder {
    column: string;
    direction?: "asc" | "desc";
}

export interface KnowledgeStructuredQueryInput {
    assetId?: string;
    from: string;
    select?: string[];
    filters?: KnowledgeStructuredFilter[];
    aggregates?: KnowledgeStructuredAggregate[];
    joins?: KnowledgeStructuredJoin[];
    orderBy?: KnowledgeStructuredOrder[];
    limit?: number;
    cursor?: string;
    expectedRevision?: string;
}

interface ParsedTable {
    path: string;
    source: KnowledgeSourceManifestEntry;
    columns: string[];
    primaryKey: string | null;
    rows: Array<Record<string, KnowledgeScalar | "">>;
    resource: string;
}

interface JoinedRow {
    base: Record<string, KnowledgeScalar | "">;
    joined: Map<string, Record<string, KnowledgeScalar | ""> | null>;
}

interface KnowledgeStructuredCursorPayload {
    version: 1;
    kind: "structured";
    scope: KnowledgeStructuredScope;
    assetId: string;
    revision: string;
    queryFingerprint: string;
    offset: number;
    limit: number;
}

const MAX_QUERY_FILTERS = 16;
const MAX_QUERY_JOINS = 3;
const MAX_QUERY_AGGREGATES = 8;
const MAX_QUERY_ORDER = 4;
const MAX_QUERY_SELECT = 64;
const MAX_QUERY_LIMIT = 200;
const MAX_QUERY_ROWS = 100_000;
const MAX_JOINED_ROWS = 200_000;
const MAX_MATCHED_RECORD_IDS = 512;
const STRICT_DECIMAL_NUMBER = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;
const CURSOR_SECRET_BYTES = 32;
// Search, catalog and structured-query cursors intentionally share one durable,
// per-data-directory signing key. Their signed `kind` fields keep the protocols
// domain-separated while allowing cursors to survive a sidecar restart.
const CURSOR_SECRET_FILENAME = "knowledge-cursor-signing-key";
const MAX_CURSOR_CHARACTERS = 32_768;

@Injectable()
export class KnowledgeStructuredQueryService {
    private readonly cursorSecret = this.loadCursorSecret();

    constructor(
        @Inject(ASSET_SERVICE) private readonly assets: IAssetService,
        private readonly ingestion: KnowledgeIngestionService,
    ) {}

    async queryScope(scope: KnowledgeStructuredScope, userId: string, input: KnowledgeStructuredQueryInput) {
        const asset = await this.resolveAsset(scope, userId, input.assetId);
        const manifest = await this.ingestion.getManifest(asset.id);
        const snapshot = await this.ingestion.getIndexSnapshot(asset.id, manifest);
        this.assertRevision(input.expectedRevision, snapshot);
        if (snapshot.staleSourceCount > 0) {
            throw new BadRequestException("Knowledge index contains stale sources; reindex before structured query");
        }
        const cursor = this.decodeCursor(input.cursor);
        if (cursor && (cursor.scope !== scope || cursor.assetId !== asset.id)) {
            throw new BadRequestException("Structured query cursor does not match scope or asset");
        }
        if (cursor && cursor.revision !== snapshot.revision) {
            throw new BadRequestException(
                `Knowledge index revision changed: expected ${cursor.revision}, current ${snapshot.revision}`,
            );
        }

        const schemaMarkdown = await this.assets.getBlobContent(asset.id, "schema.md").catch(() => "");
        const schema = parseKnowledgeGroundingSchema(schemaMarkdown);
        const sourcePath = this.sourcePath(input.from);
        const requireIndexedArtifacts = Boolean(input.expectedRevision || cursor);
        const base = await this.readTable(asset, manifest, sourcePath, schema, requireIndexedArtifacts);
        const joins = this.boundedArray(input.joins, MAX_QUERY_JOINS, "joins").map((join) => ({
            targetPath: this.sourcePath(join.targetPath),
            sourceColumn: this.requiredName(join.sourceColumn, "join sourceColumn"),
            targetColumn: this.requiredName(join.targetColumn, "join targetColumn"),
            type:
                join.type === undefined || join.type === "inner" || join.type === "left"
                    ? join.type
                    : this.invalidJoinType(),
        }));
        if (new Set(joins.map((join) => join.targetPath)).size !== joins.length) {
            throw new BadRequestException("Structured query joins may reference each target table once");
        }
        const joinedTables = new Map<string, ParsedTable>();
        for (const join of joins) {
            const targetPath = this.sourcePath(join.targetPath);
            const declared = schema
                .find((table) => table.path === sourcePath)
                ?.relations.some(
                    (relation) =>
                        relation.column === join.sourceColumn &&
                        relation.targetPath === targetPath &&
                        relation.targetColumn === join.targetColumn,
                );
            if (!declared) {
                throw new BadRequestException(
                    `Join is not declared in schema.md: ${sourcePath}.${join.sourceColumn} -> ${targetPath}.${join.targetColumn}`,
                );
            }
            joinedTables.set(
                targetPath,
                await this.readTable(asset, manifest, targetPath, schema, requireIndexedArtifacts),
            );
        }

        const queryFingerprint = this.querySignature(input, sourcePath, joins);
        let rows = this.joinRows(base, joins, joinedTables);
        const filters = this.boundedArray(input.filters, MAX_QUERY_FILTERS, "filters").map((filter) =>
            this.normalizeFilter(filter),
        );
        rows = rows.filter((row) => filters.every((filter) => this.matchesFilter(row, base, joinedTables, filter)));
        const matchedRows = rows.length;
        const aggregates = this.aggregateRows(
            rows,
            base,
            joinedTables,
            this.boundedArray(input.aggregates, MAX_QUERY_AGGREGATES, "aggregates").map((aggregate) =>
                this.normalizeAggregate(aggregate),
            ),
        );
        const orders = this.boundedArray(input.orderBy, MAX_QUERY_ORDER, "orderBy").map((order) =>
            this.normalizeOrder(order),
        );
        if (orders.length > 0) rows.sort((left, right) => this.compareRows(left, right, base, joinedTables, orders));
        const selected = this.boundedArray(input.select, MAX_QUERY_SELECT, "select").map((column) =>
            this.requiredName(column, "select column"),
        );
        for (const column of selected) this.resolveColumnDescriptor(column, base, joinedTables);
        const limit = Math.max(1, Math.min(MAX_QUERY_LIMIT, Number(input.limit) || 50));
        if (cursor && (cursor.queryFingerprint !== queryFingerprint || cursor.limit !== limit)) {
            throw new BadRequestException("Structured query cursor does not match query");
        }
        const offset = cursor?.offset ?? 0;
        if (offset > matchedRows) throw new BadRequestException("Structured query cursor is outside the result set");
        const hasAggregates = Object.keys(aggregates).length > 0;
        const page = hasAggregates ? [] : rows.slice(offset, offset + limit);
        const truncated = !hasAggregates && offset + page.length < matchedRows;
        const returnedRecordIds = base.primaryKey
            ? Array.from(
                  new Set(page.map((row) => this.scalarString(row.base[base.primaryKey as string])).filter(Boolean)),
              )
            : [];
        const resources = [base, ...joinedTables.values()].map((table) => {
            const recordIds = table.primaryKey
                ? Array.from(
                      new Set(
                          page
                              .map((row) =>
                                  table.path === base.path
                                      ? this.scalarString(row.base[table.primaryKey as string])
                                      : this.scalarString(row.joined.get(table.path)?.[table.primaryKey as string]),
                              )
                              .filter(Boolean),
                      ),
                  )
                : [];
            return {
                path: table.path,
                resource: table.resource,
                sourceSha: table.source.sha,
                recordCount: table.rows.length,
                matchedRecordIds: recordIds.slice(0, MAX_MATCHED_RECORD_IDS),
                matchedRecordIdsTruncated: recordIds.length > MAX_MATCHED_RECORD_IDS,
            };
        });

        // The manifest is the atomic publication point for an index revision. Re-read it
        // after all table work so a concurrent reindex or source mutation cannot return a
        // result assembled across two revisions.
        const endingManifest = await this.ingestion.getManifest(asset.id);
        const endingSnapshot = await this.ingestion.getIndexSnapshot(asset.id, endingManifest);
        if (endingSnapshot.revision !== snapshot.revision || endingSnapshot.staleSourceCount > 0) {
            throw new BadRequestException(
                `Knowledge index changed during structured query: started ${snapshot.revision}, current ${endingSnapshot.revision}`,
            );
        }

        return {
            scope,
            assetId: asset.id,
            indexSnapshot: snapshot,
            from: base.path,
            columns: this.outputColumns(base, joinedTables, selected),
            rows: page.map((row) => this.projectRow(row, base, joinedTables, selected)),
            aggregates,
            scannedRows: base.rows.length,
            totalScannedRows:
                base.rows.length + Array.from(joinedTables.values()).reduce((sum, table) => sum + table.rows.length, 0),
            matchedRows,
            returnedRows: page.length,
            truncated,
            ...(truncated
                ? {
                      nextCursor: this.encodeCursor({
                          version: 1,
                          kind: "structured",
                          scope,
                          assetId: asset.id,
                          revision: snapshot.revision,
                          queryFingerprint,
                          offset: offset + page.length,
                          limit,
                      }),
                  }
                : {}),
            matchedRecordIds: returnedRecordIds.slice(0, MAX_MATCHED_RECORD_IDS),
            matchedRecordIdsTruncated: returnedRecordIds.length > MAX_MATCHED_RECORD_IDS,
            resources,
            joins: joins.map((join) => ({
                targetPath: join.targetPath,
                sourceColumn: join.sourceColumn,
                targetColumn: join.targetColumn,
                type: join.type ?? "inner",
                confidence: "declared" as const,
                scannedRows: joinedTables.get(join.targetPath)?.rows.length ?? 0,
            })),
            citations: resources.map((resource) => resource.resource),
        };
    }

    private async resolveAsset(scope: KnowledgeStructuredScope, userId: string, assetId?: string): Promise<Asset> {
        const candidates =
            scope === "personal"
                ? [await this.assets.getOrCreatePersonalKnowledge(userId)]
                : scope === "docs"
                  ? [await this.assets.getOrCreateGlobalDocsKnowledge()]
                  : (await this.assets.listGlobalKnowledge()).filter((asset) => {
                        const knowledge = asset.metadata?.knowledge;
                        return (
                            !knowledge ||
                            typeof knowledge !== "object" ||
                            (knowledge as Record<string, unknown>).archived !== true
                        );
                    });
        const asset = assetId ? candidates.find((candidate) => candidate.id === assetId) : candidates[0];
        if (!asset || (!assetId && candidates.length > 1)) {
            throw new NotFoundException(assetId ? "知识库不可用或无权访问" : "全局结构化查询需要指定 assetId");
        }
        return asset;
    }

    private async readTable(
        asset: Asset,
        manifest: KnowledgeSourceManifest,
        path: string,
        schema: ReturnType<typeof parseKnowledgeGroundingSchema>,
        requireIndexedArtifact: boolean,
    ): Promise<ParsedTable> {
        const source = manifest.sources.find((entry) => entry.path === path && entry.status === "indexed");
        if (!source) throw new NotFoundException(`Knowledge CSV is not indexed: ${path}`);
        const content = source.extractedTextPath
            ? await this.assets.getBlobContent(asset.id, source.extractedTextPath).catch(() => null)
            : null;
        if (content === null && requireIndexedArtifact) {
            throw new BadRequestException(
                `Knowledge indexed artifact is unavailable for revision-locked query: ${path}`,
            );
        }
        const sourceText = content ?? (await this.assets.getBlobContent(asset.id, path));
        const workbook = XLSX.read(sourceText, { type: "string", raw: true });
        const sheetName = workbook.SheetNames[0];
        const sheet = sheetName ? workbook.Sheets[sheetName] : undefined;
        if (!sheet) throw new BadRequestException(`Knowledge CSV has no readable sheet: ${path}`);
        const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: true, defval: "" });
        const columns = (matrix[0] ?? []).map((value) => this.scalarString(value));
        if (columns.length === 0 || columns.some((column) => !column) || new Set(columns).size !== columns.length) {
            throw new BadRequestException(`Knowledge CSV requires non-empty unique columns: ${path}`);
        }
        const rawRows = matrix.slice(1).filter((row) => Array.isArray(row) && row.some((value) => value !== ""));
        if (rawRows.length > MAX_QUERY_ROWS) {
            throw new BadRequestException(`Knowledge CSV exceeds ${MAX_QUERY_ROWS} structured-query rows: ${path}`);
        }
        const rows = rawRows.map((row) =>
            Object.fromEntries(columns.map((column, index) => [column, this.scalar(row[index])])),
        );
        const declaredPrimaryKey = schema.find((table) => table.path === path)?.primaryKey;
        const primaryKey =
            declaredPrimaryKey && columns.includes(declaredPrimaryKey) ? declaredPrimaryKey : (columns[0] ?? null);
        return {
            path,
            source,
            columns,
            primaryKey,
            rows,
            resource: `asset://${asset.id}/${path}`,
        };
    }

    private joinRows(
        base: ParsedTable,
        joins: KnowledgeStructuredJoin[],
        targets: Map<string, ParsedTable>,
    ): JoinedRow[] {
        let rows: JoinedRow[] = base.rows.map((row) => ({ base: row, joined: new Map() }));
        for (const join of joins) {
            if (!base.columns.includes(join.sourceColumn)) {
                throw new BadRequestException(`Unknown source column: ${join.sourceColumn}`);
            }
            const target = targets.get(join.targetPath);
            if (!target || !target.columns.includes(join.targetColumn)) {
                throw new BadRequestException(`Unknown target column: ${join.targetPath}.${join.targetColumn}`);
            }
            const index = new Map<string, Array<Record<string, KnowledgeScalar | "">>>();
            for (const row of target.rows) {
                const key = this.joinKey(row[join.targetColumn]);
                if (!key) continue;
                const matches = index.get(key) ?? [];
                matches.push(row);
                index.set(key, matches);
            }
            const next: JoinedRow[] = [];
            for (const row of rows) {
                // Every join is declared from the base table in schema.md. Reading the
                // source key from `base` also prevents chained/ambiguous joins from being
                // inferred implicitly by the query payload.
                const matches = index.get(this.joinKey(row.base[join.sourceColumn])) ?? [];
                if (matches.length === 0) {
                    if ((join.type ?? "inner") === "inner") continue;
                    const joined = new Map(row.joined);
                    joined.set(join.targetPath, null);
                    next.push({ base: row.base, joined });
                } else {
                    for (const match of matches) {
                        const joined = new Map(row.joined);
                        joined.set(join.targetPath, match);
                        next.push({ base: row.base, joined });
                        if (next.length > MAX_JOINED_ROWS) {
                            throw new BadRequestException(
                                `Structured query join exceeds ${MAX_JOINED_ROWS} result rows`,
                            );
                        }
                    }
                }
            }
            rows = next;
        }
        return rows;
    }

    private matchesFilter(
        row: JoinedRow,
        base: ParsedTable,
        targets: Map<string, ParsedTable>,
        filter: KnowledgeStructuredFilter,
    ): boolean {
        const actual = this.columnValue(row, this.resolveColumnDescriptor(filter.column, base, targets));
        const expected = filter.value;
        switch (filter.op) {
            case "eq":
                return !Array.isArray(expected) && this.compareScalar(actual, expected) === 0;
            case "in":
                return Array.isArray(expected) && expected.some((value) => this.compareScalar(actual, value) === 0);
            case "contains":
                return (
                    !Array.isArray(expected) &&
                    this.scalarString(actual).toLowerCase().includes(this.scalarString(expected).toLowerCase())
                );
            case "gt":
                return !Array.isArray(expected) && this.compareScalar(actual, expected) > 0;
            case "gte":
                return !Array.isArray(expected) && this.compareScalar(actual, expected) >= 0;
            case "lt":
                return !Array.isArray(expected) && this.compareScalar(actual, expected) < 0;
            case "lte":
                return !Array.isArray(expected) && this.compareScalar(actual, expected) <= 0;
            default:
                throw new BadRequestException(`Unsupported structured filter: ${String(filter.op)}`);
        }
    }

    private aggregateRows(
        rows: JoinedRow[],
        base: ParsedTable,
        targets: Map<string, ParsedTable>,
        definitions: KnowledgeStructuredAggregate[],
    ): Record<string, number | string | null> {
        const output: Record<string, number | string | null> = {};
        for (const definition of definitions) {
            const alias = definition.as?.trim();
            if (!alias || alias.length > 80 || Object.hasOwn(output, alias)) {
                throw new BadRequestException("Aggregate aliases must be unique non-empty strings");
            }
            if (definition.op === "count" && !definition.column) {
                output[alias] = rows.length;
                continue;
            }
            if (!definition.column) throw new BadRequestException(`${definition.op} requires a column`);
            const descriptor = this.resolveColumnDescriptor(definition.column, base, targets);
            // COUNT(column), SUM, MIN and MAX all ignore absent left-join values and
            // blank CSV cells. Keep false and zero: both are present scalar values.
            const values = rows
                .map((row) => this.columnValue(row, descriptor))
                .filter((value): value is KnowledgeScalar => this.isAggregateValuePresent(value));
            if (definition.op === "count") output[alias] = values.length;
            else if (definition.op === "sum") {
                const numbers = values.map((value) => this.strictAggregateNumber(value, definition.column as string));
                output[alias] = numbers.reduce((sum, value) => sum + value, 0);
            } else if (values.length === 0) output[alias] = null;
            else {
                const sorted = [...values].sort((left, right) => this.compareScalar(left, right));
                output[alias] = this.scalarString(definition.op === "min" ? sorted[0] : sorted.at(-1));
            }
        }
        return output;
    }

    private compareRows(
        left: JoinedRow,
        right: JoinedRow,
        base: ParsedTable,
        targets: Map<string, ParsedTable>,
        orders: KnowledgeStructuredOrder[],
    ): number {
        for (const order of orders) {
            const descriptor = this.resolveColumnDescriptor(order.column, base, targets);
            const compared = this.compareScalar(
                this.columnValue(left, descriptor),
                this.columnValue(right, descriptor),
            );
            if (compared !== 0) return order.direction === "desc" ? -compared : compared;
        }
        return 0;
    }

    private outputColumns(base: ParsedTable, targets: Map<string, ParsedTable>, selected: string[]): string[] {
        if (selected.length > 0) return selected;
        return [
            ...base.columns,
            ...Array.from(targets.values()).flatMap((target) =>
                target.columns.map((column) => `${this.tableAlias(target.path)}.${column}`),
            ),
        ].slice(0, MAX_QUERY_SELECT);
    }

    private projectRow(
        row: JoinedRow,
        base: ParsedTable,
        targets: Map<string, ParsedTable>,
        selected: string[],
    ): Record<string, KnowledgeScalar | "" | null> {
        const columns = this.outputColumns(base, targets, selected);
        return Object.fromEntries(
            columns.map((column) => {
                const descriptor = this.resolveColumnDescriptor(column, base, targets);
                return [column, this.columnValue(row, descriptor)];
            }),
        );
    }

    private resolveColumnDescriptor(
        value: string,
        base: ParsedTable,
        targets: Map<string, ParsedTable>,
    ): { path: string; column: string; base: boolean } {
        const column = value?.trim();
        if (!column) throw new BadRequestException("Structured query column is required");
        if (base.columns.includes(column)) return { path: base.path, column, base: true };
        for (const target of targets.values()) {
            for (const prefix of [`${target.path}.`, `${this.tableAlias(target.path)}.`]) {
                if (!column.startsWith(prefix)) continue;
                const targetColumn = column.slice(prefix.length);
                if (target.columns.includes(targetColumn))
                    return { path: target.path, column: targetColumn, base: false };
            }
        }
        throw new BadRequestException(`Unknown or ambiguous structured query column: ${column}`);
    }

    private columnValue(
        row: JoinedRow,
        descriptor: { path: string; column: string; base: boolean },
    ): KnowledgeScalar | "" | null {
        return descriptor.base
            ? row.base[descriptor.column]
            : (row.joined.get(descriptor.path)?.[descriptor.column] ?? null);
    }

    private compareScalar(left: unknown, right: unknown): number {
        const leftNumber = typeof left === "number" ? left : Number(left);
        const rightNumber = typeof right === "number" ? right : Number(right);
        if (
            this.scalarString(left) !== "" &&
            this.scalarString(right) !== "" &&
            Number.isFinite(leftNumber) &&
            Number.isFinite(rightNumber)
        ) {
            return leftNumber - rightNumber;
        }
        return this.scalarString(left)
            .normalize("NFKC")
            .toLowerCase()
            .localeCompare(this.scalarString(right).normalize("NFKC").toLowerCase());
    }

    private joinKey(value: unknown): string {
        return this.scalarString(value).normalize("NFKC").toLowerCase();
    }

    private scalar(value: unknown): KnowledgeScalar | "" {
        if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
        return value === null || value === undefined ? "" : String(value);
    }

    private scalarString(value: unknown): string {
        return typeof value === "string" || typeof value === "number" || typeof value === "boolean"
            ? String(value).trim()
            : "";
    }

    private sourcePath(value: string): string {
        const path = value?.trim();
        if (!path || !isPublicKnowledgeSourcePath(path) || !path.toLowerCase().endsWith(".csv")) {
            throw new BadRequestException("Structured queries require a public raw/sources/*.csv path");
        }
        return path;
    }

    private tableAlias(path: string): string {
        return (path.split("/").pop() ?? path).replace(/\.csv$/i, "");
    }

    private boundedArray<T>(value: T[] | undefined, max: number, label: string): T[] {
        if (value === undefined) return [];
        if (!Array.isArray(value) || value.length > max)
            throw new BadRequestException(`${label} accepts at most ${max} items`);
        return value;
    }

    private normalizeFilter(filter: KnowledgeStructuredFilter): KnowledgeStructuredFilter {
        const column = this.requiredName(filter?.column, "filter column");
        const allowed = new Set<KnowledgeFilterOperator>(["eq", "in", "contains", "gt", "gte", "lt", "lte"]);
        if (!allowed.has(filter?.op))
            throw new BadRequestException(`Unsupported structured filter: ${String(filter?.op)}`);
        const values = Array.isArray(filter.value) ? filter.value : [filter.value];
        if (values.length === 0 || values.length > 100 || values.some((value) => !this.isScalar(value))) {
            throw new BadRequestException("Structured filter values must contain 1-100 scalar values");
        }
        if (filter.op === "in" && !Array.isArray(filter.value))
            throw new BadRequestException("in filter requires an array");
        if (filter.op !== "in" && Array.isArray(filter.value)) {
            throw new BadRequestException(`${filter.op} filter requires one scalar value`);
        }
        return { column, op: filter.op, value: filter.value };
    }

    private normalizeAggregate(aggregate: KnowledgeStructuredAggregate): KnowledgeStructuredAggregate {
        if (!["count", "sum", "min", "max"].includes(aggregate?.op)) {
            throw new BadRequestException(`Unsupported structured aggregate: ${String(aggregate?.op)}`);
        }
        return {
            op: aggregate.op,
            ...(aggregate.column ? { column: this.requiredName(aggregate.column, "aggregate column") } : {}),
            as: this.requiredName(aggregate.as, "aggregate alias"),
        };
    }

    private normalizeOrder(order: KnowledgeStructuredOrder): KnowledgeStructuredOrder {
        if (order.direction !== undefined && order.direction !== "asc" && order.direction !== "desc") {
            throw new BadRequestException(`Unsupported structured order: ${String(order.direction)}`);
        }
        return { column: this.requiredName(order.column, "order column"), direction: order.direction ?? "asc" };
    }

    private requiredName(value: unknown, label: string): string {
        if (typeof value !== "string" || !value.trim() || value.trim().length > 240) {
            throw new BadRequestException(`${label} is required and must be at most 240 characters`);
        }
        return value.trim();
    }

    private isScalar(value: unknown): value is KnowledgeScalar {
        return (
            typeof value === "string" ||
            (typeof value === "number" && Number.isFinite(value)) ||
            typeof value === "boolean"
        );
    }

    private isAggregateValuePresent(value: KnowledgeScalar | "" | null): value is KnowledgeScalar {
        return value !== null && this.scalarString(value) !== "";
    }

    private strictAggregateNumber(value: KnowledgeScalar, column: string): number {
        if (typeof value === "number" && Number.isFinite(value)) return value;
        if (typeof value === "string" && STRICT_DECIMAL_NUMBER.test(value.trim())) {
            const parsed = Number(value.trim());
            if (Number.isFinite(parsed)) return parsed;
        }
        throw new BadRequestException(`sum requires numeric column: ${column}`);
    }

    private invalidJoinType(): never {
        throw new BadRequestException("Structured join type must be inner or left");
    }

    private querySignature(
        input: KnowledgeStructuredQueryInput,
        from: string,
        joins: KnowledgeStructuredJoin[],
    ): string {
        return createHash("sha256")
            .update(
                JSON.stringify({
                    from,
                    select: input.select ?? [],
                    filters: input.filters ?? [],
                    aggregates: input.aggregates ?? [],
                    joins,
                    orderBy: input.orderBy ?? [],
                    limit: Math.max(1, Math.min(MAX_QUERY_LIMIT, Number(input.limit) || 50)),
                }),
            )
            .digest("hex")
            .slice(0, 64);
    }

    private encodeCursor(cursor: KnowledgeStructuredCursorPayload): string {
        const encoded = Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
        const signature = createHmac("sha256", this.cursorSecret).update(encoded).digest("base64url");
        return `${encoded}.${signature}`;
    }

    private decodeCursor(value?: string): KnowledgeStructuredCursorPayload | null {
        if (!value) return null;
        try {
            if (!value.trim() || value.length > MAX_CURSOR_CHARACTERS) throw new Error("invalid cursor length");
            const [encoded, signature, extra] = value.split(".");
            if (!encoded || !signature || extra !== undefined) throw new Error("invalid cursor shape");
            if (!/^[A-Za-z0-9_-]+$/.test(encoded) || !/^[A-Za-z0-9_-]{43}$/.test(signature)) {
                throw new Error("invalid cursor encoding");
            }
            const suppliedSignature = Buffer.from(signature, "base64url");
            if (suppliedSignature.toString("base64url") !== signature) throw new Error("non-canonical signature");
            const expectedSignature = createHmac("sha256", this.cursorSecret).update(encoded).digest();
            if (
                suppliedSignature.length !== expectedSignature.length ||
                !timingSafeEqual(suppliedSignature, expectedSignature)
            ) {
                throw new Error("invalid cursor signature");
            }
            const parsed = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as Record<string, unknown>;
            if (
                parsed.version !== 1 ||
                parsed.kind !== "structured" ||
                !["personal", "docs", "global"].includes(String(parsed.scope ?? "")) ||
                typeof parsed.assetId !== "string" ||
                !parsed.assetId ||
                typeof parsed.revision !== "string" ||
                !parsed.revision ||
                typeof parsed.queryFingerprint !== "string" ||
                !/^[a-f0-9]{64}$/.test(parsed.queryFingerprint) ||
                typeof parsed.offset !== "number" ||
                !Number.isSafeInteger(parsed.offset) ||
                parsed.offset < 0 ||
                typeof parsed.limit !== "number" ||
                !Number.isSafeInteger(parsed.limit) ||
                parsed.limit < 1 ||
                parsed.limit > MAX_QUERY_LIMIT
            ) {
                throw new Error("invalid cursor");
            }
            return parsed as unknown as KnowledgeStructuredCursorPayload;
        } catch {
            throw new BadRequestException("Invalid structured query cursor");
        }
    }

    private loadCursorSecret(): Buffer {
        const dataDirectory = desktopDataDir();
        mkdirSync(dataDirectory, { recursive: true, mode: 0o700 });
        const secretPath = path.join(dataDirectory, CURSOR_SECRET_FILENAME);
        if (existsSync(secretPath)) return this.readCursorSecret(secretPath);

        const temporary = `${secretPath}.${process.pid}.${randomBytes(12).toString("hex")}.tmp`;
        const generated = randomBytes(CURSOR_SECRET_BYTES);
        let descriptor: number | undefined;
        try {
            descriptor = openSync(temporary, "wx", 0o600);
            writeSync(descriptor, generated);
            fsyncSync(descriptor);
            closeSync(descriptor);
            descriptor = undefined;
            linkSync(temporary, secretPath);
            chmodSync(secretPath, 0o600);
            return this.readCursorSecret(secretPath);
        } catch (error) {
            if (!existsSync(secretPath)) throw error;
            return this.readCursorSecret(secretPath);
        } finally {
            if (descriptor !== undefined) closeSync(descriptor);
            rmSync(temporary, { force: true });
        }
    }

    private readCursorSecret(secretPath: string): Buffer {
        const secret = readFileSync(secretPath);
        if (secret.length !== CURSOR_SECRET_BYTES) {
            throw new Error("Knowledge cursor signing key is corrupt; refusing an unsafe automatic rotation");
        }
        chmodSync(secretPath, 0o600);
        return secret;
    }

    private assertRevision(expectedRevision: string | undefined, snapshot: KnowledgeIndexSnapshot): void {
        if (!expectedRevision || expectedRevision === snapshot.revision) return;
        throw new BadRequestException(
            `Knowledge index revision changed: expected ${expectedRevision}, current ${snapshot.revision}`,
        );
    }
}
