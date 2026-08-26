import fs = require("node:fs");
import os = require("node:os");
import path = require("node:path");

import { Asset } from "../domain/entities/asset.entity";
import type { IAssetRepository } from "../domain/repositories/asset.repository.interface";
import { AssetServiceImpl } from "./asset.service";
import { KnowledgeIngestionService } from "./knowledge-ingestion.service";
import { KnowledgeStructuredQueryService } from "./knowledge-structured-query.service";

function createHarness() {
    const asset = Asset.create({
        name: "structured-knowledge",
        ownerId: "user-1",
        ownerType: "user",
        category: "knowledge",
        visibility: "private",
        metadata: { knowledge: { personal: true } },
    });
    const externalBlobs = new Map<string, Buffer>();
    const repository = {
        findById: jest.fn(async (id: string) => (id === asset.id ? asset : null)),
        findPersonalKnowledge: jest.fn(async (ownerId: string) => (ownerId === asset.ownerId ? asset : null)),
        findGlobalKnowledgeByDomain: jest.fn(async () => null),
        listGlobalKnowledge: jest.fn(async () => []),
        save: jest.fn(async () => undefined),
        readBlobData: jest.fn(async (assetId: string, path: string) => externalBlobs.get(`${assetId}:${path}`) ?? null),
        writeBlobData: jest.fn(async (assetId: string, path: string, content: Buffer) => {
            externalBlobs.set(`${assetId}:${path}`, Buffer.from(content));
        }),
        deleteBlobData: jest.fn(async (assetId: string, path: string) => {
            externalBlobs.delete(`${assetId}:${path}`);
        }),
    } as unknown as IAssetRepository;
    const assets = new AssetServiceImpl(repository);
    const ingestion = new KnowledgeIngestionService(assets);
    const structured = new KnowledgeStructuredQueryService(assets, ingestion);
    return { asset, assets, ingestion, structured, externalBlobs };
}

async function seedTables(harness: ReturnType<typeof createHarness>) {
    const { asset, assets, ingestion } = harness;
    await assets.updateBlob(
        asset.id,
        "raw/sources/incidents.csv",
        ["incident_id,owner_id,severity,amount", "I-1,U-1,high,10", "I-2,U-2,low,20", "I-3,U-1,high,30"].join("\n"),
        "Add incidents",
        "main",
    );
    await assets.updateBlob(
        asset.id,
        "raw/sources/owners.csv",
        ["owner_id,name", "U-1,Ada", "U-2,Lin"].join("\n"),
        "Add owners",
        "main",
    );
    await assets.updateBlob(
        asset.id,
        "schema.md",
        [
            "```knowledge-grounding",
            JSON.stringify({
                version: 1,
                tables: [
                    {
                        path: "raw/sources/incidents.csv",
                        primaryKey: "incident_id",
                        relations: [
                            {
                                column: "owner_id",
                                targetPath: "raw/sources/owners.csv",
                                targetColumn: "owner_id",
                            },
                        ],
                    },
                    { path: "raw/sources/owners.csv", primaryKey: "owner_id" },
                ],
            }),
            "```",
        ].join("\n"),
        "Declare grounding schema",
        "main",
    );
    await ingestion.reindex(asset.id);
}

describe("KnowledgeStructuredQueryService", () => {
    const originalDataDir = process.env.INTERNSHANNON_DATA_DIR;
    const testDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "knowledge-structured-cursor-"));

    beforeAll(() => {
        process.env.INTERNSHANNON_DATA_DIR = testDataDir;
    });

    afterAll(() => {
        if (originalDataDir === undefined) delete process.env.INTERNSHANNON_DATA_DIR;
        else process.env.INTERNSHANNON_DATA_DIR = originalDataDir;
        fs.rmSync(testDataDir, { recursive: true, force: true });
    });

    it("runs bounded filters and aggregates with revision and scan evidence", async () => {
        const harness = createHarness();
        await seedTables(harness);

        const result = await harness.structured.queryScope("personal", "user-1", {
            from: "raw/sources/incidents.csv",
            filters: [{ column: "severity", op: "eq", value: "high" }],
            aggregates: [
                { op: "count", as: "incidentCount" },
                { op: "sum", column: "amount", as: "totalAmount" },
            ],
        });

        expect(result).toMatchObject({
            assetId: harness.asset.id,
            from: "raw/sources/incidents.csv",
            aggregates: { incidentCount: 2, totalAmount: 40 },
            scannedRows: 3,
            matchedRows: 2,
            returnedRows: 0,
            truncated: false,
            indexSnapshot: { revision: expect.any(String), incompleteSourceCount: 0 },
        });
        expect(result.citations).toEqual([`asset://${harness.asset.id}/raw/sources/incidents.csv`]);
    });

    it("allows only schema-declared equi-joins and returns record-level evidence", async () => {
        const harness = createHarness();
        await seedTables(harness);

        const result = await harness.structured.queryScope("personal", "user-1", {
            from: "raw/sources/incidents.csv",
            joins: [
                {
                    targetPath: "raw/sources/owners.csv",
                    sourceColumn: "owner_id",
                    targetColumn: "owner_id",
                },
            ],
            filters: [{ column: "owners.name", op: "eq", value: "Ada" }],
            select: ["incident_id", "owners.name"],
            orderBy: [{ column: "incident_id" }],
        });

        expect(result.rows).toEqual([
            { incident_id: "I-1", "owners.name": "Ada" },
            { incident_id: "I-3", "owners.name": "Ada" },
        ]);
        expect(result.matchedRecordIds).toEqual(["I-1", "I-3"]);
        expect(result.joins).toEqual([
            expect.objectContaining({ targetPath: "raw/sources/owners.csv", confidence: "declared" }),
        ]);

        await expect(
            harness.structured.queryScope("personal", "user-1", {
                from: "raw/sources/incidents.csv",
                joins: [
                    {
                        targetPath: "raw/sources/owners.csv",
                        sourceColumn: "incident_id",
                        targetColumn: "owner_id",
                    },
                ],
            }),
        ).rejects.toThrow("Join is not declared in schema.md");
    });

    it("excludes unmatched left joins and blank cells from column aggregates", async () => {
        const harness = createHarness();
        await seedTables(harness);
        await harness.assets.updateBlob(
            harness.asset.id,
            "raw/sources/incidents.csv",
            ["incident_id,owner_id,severity,amount", "I-1,U-1,high,10", "I-2,U-2,low,20", "I-3,U-missing,high,30"].join(
                "\n",
            ),
            "Add an unmatched owner",
            "main",
        );
        await harness.assets.updateBlob(
            harness.asset.id,
            "raw/sources/owners.csv",
            ["owner_id,name,score", "U-1,Ada,10", "U-2,Lin,"].join("\n"),
            "Add optional owner score",
            "main",
        );
        await harness.ingestion.reindex(harness.asset.id);

        const result = await harness.structured.queryScope("personal", "user-1", {
            from: "raw/sources/incidents.csv",
            joins: [
                {
                    targetPath: "raw/sources/owners.csv",
                    sourceColumn: "owner_id",
                    targetColumn: "owner_id",
                    type: "left",
                },
            ],
            aggregates: [
                { op: "count", as: "rowCount" },
                { op: "count", column: "owners.owner_id", as: "matchedOwnerCount" },
                { op: "count", column: "owners.score", as: "scoreCount" },
                { op: "sum", column: "owners.score", as: "scoreSum" },
                { op: "min", column: "owners.score", as: "scoreMin" },
                { op: "max", column: "owners.score", as: "scoreMax" },
            ],
        });

        expect(result.aggregates).toEqual({
            rowCount: 3,
            matchedOwnerCount: 2,
            scoreCount: 1,
            scoreSum: 10,
            scoreMin: "10",
            scoreMax: "10",
        });
    });

    it("rejects non-decimal strings instead of coercing them during sum", async () => {
        const harness = createHarness();
        await seedTables(harness);
        await harness.assets.updateBlob(
            harness.asset.id,
            "raw/sources/owners.csv",
            ["owner_id,name,score", "U-1,Ada,0x10", "U-2,Lin,20"].join("\n"),
            "Add non-decimal owner score",
            "main",
        );
        await harness.ingestion.reindex(harness.asset.id);

        await expect(
            harness.structured.queryScope("personal", "user-1", {
                from: "raw/sources/incidents.csv",
                joins: [
                    {
                        targetPath: "raw/sources/owners.csv",
                        sourceColumn: "owner_id",
                        targetColumn: "owner_id",
                        type: "left",
                    },
                ],
                aggregates: [{ op: "sum", column: "owners.score", as: "scoreSum" }],
            }),
        ).rejects.toThrow("sum requires numeric column: owners.score");
    });

    it("uses opaque query-bound cursors and rejects revision drift", async () => {
        const harness = createHarness();
        await seedTables(harness);
        const query = {
            from: "raw/sources/incidents.csv",
            filters: [{ column: "severity", op: "eq" as const, value: "high" }],
            orderBy: [{ column: "incident_id", direction: "asc" as const }],
            limit: 1,
        };

        const first = await harness.structured.queryScope("personal", "user-1", query);
        expect(first).toMatchObject({
            rows: [{ incident_id: "I-1" }],
            truncated: true,
            nextCursor: expect.any(String),
        });
        const second = await harness.structured.queryScope("personal", "user-1", {
            ...query,
            cursor: first.nextCursor,
        });
        expect(second).toMatchObject({ rows: [{ incident_id: "I-3" }], truncated: false });

        const restarted = new KnowledgeStructuredQueryService(harness.assets, harness.ingestion);
        await expect(
            restarted.queryScope("personal", "user-1", { ...query, cursor: first.nextCursor }),
        ).resolves.toMatchObject({ rows: [{ incident_id: "I-3" }], truncated: false });
        await expect(
            harness.structured.queryScope("personal", "user-1", {
                ...query,
                filters: [{ column: "severity", op: "eq", value: "low" }],
                cursor: first.nextCursor,
            }),
        ).rejects.toThrow("does not match query");
        await expect(
            harness.structured.queryScope("personal", "user-1", {
                ...query,
                limit: 2,
                cursor: first.nextCursor,
            }),
        ).rejects.toThrow("does not match query");

        await harness.assets.updateBlob(
            harness.asset.id,
            "raw/sources/incidents.csv",
            "incident_id,owner_id,severity,amount\nI-4,U-1,high,40",
            "Change source",
            "main",
        );
        await expect(
            harness.structured.queryScope("personal", "user-1", { ...query, cursor: first.nextCursor }),
        ).rejects.toThrow();
        const stale = await harness.ingestion.getIndexSnapshot(harness.asset.id);
        expect(stale).toMatchObject({ staleSourceCount: 1, incompleteSourceCount: 1 });
        await expect(harness.structured.queryScope("personal", "user-1", query)).rejects.toThrow(
            "Knowledge index contains stale sources",
        );

        await harness.ingestion.reindex(harness.asset.id);
        await expect(
            harness.structured.queryScope("personal", "user-1", { ...query, cursor: first.nextCursor }),
        ).rejects.toThrow("Knowledge index revision changed");
    });

    it("rejects a cursor whose signed offset was modified", async () => {
        const harness = createHarness();
        await seedTables(harness);
        const query = {
            from: "raw/sources/incidents.csv",
            orderBy: [{ column: "incident_id", direction: "asc" as const }],
            limit: 1,
        };
        const first = await harness.structured.queryScope("personal", "user-1", query);
        const [encoded, signature] = String(first.nextCursor).split(".");
        const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as Record<string, unknown>;
        payload.offset = Number(payload.offset) + 1;
        const tampered = `${Buffer.from(JSON.stringify(payload), "utf8").toString("base64url")}.${signature}`;

        await expect(
            harness.structured.queryScope("personal", "user-1", { ...query, cursor: tampered }),
        ).rejects.toThrow("Invalid structured query cursor");
        await expect(
            harness.structured.queryScope("personal", "user-1", {
                ...query,
                cursor: Buffer.from(JSON.stringify(payload), "utf8").toString("base64url"),
            }),
        ).rejects.toThrow("Invalid structured query cursor");
        await expect(
            harness.structured.queryScope("personal", "user-1", {
                ...query,
                cursor: `${first.nextCursor}%`,
            }),
        ).rejects.toThrow("Invalid structured query cursor");
    });

    it("binds a valid cursor to its asset and scope", async () => {
        const firstHarness = createHarness();
        const secondHarness = createHarness();
        await seedTables(firstHarness);
        await seedTables(secondHarness);
        const query = {
            from: "raw/sources/incidents.csv",
            orderBy: [{ column: "incident_id", direction: "asc" as const }],
            limit: 1,
        };
        const first = await firstHarness.structured.queryScope("personal", "user-1", query);

        await expect(
            secondHarness.structured.queryScope("personal", "user-1", { ...query, cursor: first.nextCursor }),
        ).rejects.toThrow("does not match scope or asset");

        const [encoded] = String(first.nextCursor).split(".");
        const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as Record<string, unknown>;
        payload.scope = "docs";
        const crossScopeCursor = (
            firstHarness.structured as unknown as { encodeCursor: (value: Record<string, unknown>) => string }
        ).encodeCursor(payload);
        await expect(
            firstHarness.structured.queryScope("personal", "user-1", { ...query, cursor: crossScopeCursor }),
        ).rejects.toThrow("does not match scope or asset");
    });

    it("isolates cursor signatures between data directories", async () => {
        const harness = createHarness();
        await seedTables(harness);
        const query = {
            from: "raw/sources/incidents.csv",
            orderBy: [{ column: "incident_id", direction: "asc" as const }],
            limit: 1,
        };
        const first = await harness.structured.queryScope("personal", "user-1", query);
        const isolatedDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "knowledge-structured-isolated-"));
        try {
            process.env.INTERNSHANNON_DATA_DIR = isolatedDataDir;
            const isolated = new KnowledgeStructuredQueryService(harness.assets, harness.ingestion);
            await expect(
                isolated.queryScope("personal", "user-1", { ...query, cursor: first.nextCursor }),
            ).rejects.toThrow("Invalid structured query cursor");
        } finally {
            process.env.INTERNSHANNON_DATA_DIR = testDataDir;
            fs.rmSync(isolatedDataDir, { recursive: true, force: true });
        }
    });

    it("fails closed when a revision-locked indexed artifact is unavailable", async () => {
        const harness = createHarness();
        await seedTables(harness);
        const manifest = await harness.ingestion.getManifest(harness.asset.id);
        const snapshot = await harness.ingestion.getIndexSnapshot(harness.asset.id, manifest);
        jest.spyOn(harness.ingestion, "getIndexSnapshot").mockResolvedValue(snapshot);
        const source = manifest.sources.find((entry) => entry.path === "raw/sources/incidents.csv");
        expect(source?.extractedTextPath).toEqual(expect.any(String));
        harness.externalBlobs.delete(`${harness.asset.id}:${source?.extractedTextPath as string}`);

        await expect(
            harness.structured.queryScope("personal", "user-1", {
                from: "raw/sources/incidents.csv",
                expectedRevision: snapshot.revision,
            }),
        ).rejects.toThrow("Knowledge indexed artifact is unavailable for revision-locked query");
    });

    it("fails closed when the published revision changes during a query", async () => {
        const harness = createHarness();
        await seedTables(harness);
        const manifest = await harness.ingestion.getManifest(harness.asset.id);
        const getManifest = jest.spyOn(harness.ingestion, "getManifest");
        getManifest
            .mockResolvedValueOnce(manifest)
            .mockResolvedValueOnce({ ...manifest, revision: "concurrent-revision" });

        await expect(
            harness.structured.queryScope("personal", "user-1", {
                from: "raw/sources/incidents.csv",
            }),
        ).rejects.toThrow("Knowledge index changed during structured query");
    });

    it("rejects private paths, unknown columns, and arbitrary SQL-shaped input", async () => {
        const harness = createHarness();
        await seedTables(harness);

        await expect(
            harness.structured.queryScope("personal", "user-1", {
                from: ".internshannon/knowledge/index/manifest.json",
            }),
        ).rejects.toThrow("public raw/sources/*.csv");
        await expect(
            harness.structured.queryScope("personal", "user-1", {
                from: "raw/sources/incidents.csv; DROP TABLE owners",
            }),
        ).rejects.toThrow("public raw/sources/*.csv");
        await expect(
            harness.structured.queryScope("personal", "user-1", {
                from: "raw/sources/incidents.csv",
                filters: [{ column: "secret", op: "eq", value: "x" }],
            }),
        ).rejects.toThrow("Unknown or ambiguous structured query column");
    });
});
