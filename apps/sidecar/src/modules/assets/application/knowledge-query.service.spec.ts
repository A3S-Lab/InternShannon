import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { CapabilitiesToolService } from "../../kernel/application/capabilities-tool.service";
import type { IKernelService } from "../../kernel/domain/services/kernel-service.interface";
import { Asset } from "../domain/entities/asset.entity";
import { cosineSimilarity, localEmbedding } from "../domain/knowledge/local-embedding";
import type { IAssetRepository } from "../domain/repositories/asset.repository.interface";
import { AssetServiceImpl } from "./asset.service";
import type { KnowledgeEmbeddingService } from "./knowledge-embedding.service";
import { KnowledgeIngestionService } from "./knowledge-ingestion.service";
import { KnowledgeQueryService } from "./knowledge-query.service";

function createKnowledgeHarness(embeddings?: KnowledgeEmbeddingService) {
    const asset = Asset.create({
        name: "personal-knowledge",
        ownerId: "user-1",
        ownerType: "user",
        category: "knowledge",
        visibility: "private",
        metadata: {
            knowledge: { personal: true },
            blobContents: {
                "wiki/index.md": '---\nokf_version: "0.1"\n---\n\n# Personal knowledge\n',
                "wiki/metrics/revenue.md": [
                    "---",
                    "type: Metric",
                    "title: Monthly Revenue",
                    "description: Revenue recognized each calendar month.",
                    "resource: https://example.com/metrics/revenue",
                    "tags: [finance, sales]",
                    "---",
                    "",
                    "Monthly revenue excludes refunds and internal test orders.",
                    "",
                    "# Citations",
                    "",
                    "[1] [Finance policy](https://example.com/policy/revenue)",
                ].join("\n"),
                "wiki/playbooks/incident.md":
                    "---\ntype: Playbook\ntitle: Incident response\ntags: [oncall]\n---\n\nTriage freshness alerts.\n",
                "wiki/policies/freeze-window.md":
                    "---\ntype: Policy\ntitle: 发布冻结窗口\ntags: [发布]\n---\n\n冻结窗口从每周五 18:00 开始。\n",
            },
        },
    });
    const repository = {
        findById: jest.fn(async (id: string) => (id === asset.id ? asset : null)),
        findPersonalKnowledge: jest.fn(async (ownerId: string) => (ownerId === asset.ownerId ? asset : null)),
        findGlobalKnowledgeByDomain: jest.fn(async () => null),
        listGlobalKnowledge: jest.fn(async () => []),
        save: jest.fn(async () => undefined),
    } as unknown as IAssetRepository;
    const assets = new AssetServiceImpl(repository);
    const ingestion = new KnowledgeIngestionService(assets);
    const knowledge = new KnowledgeQueryService(assets, ingestion, embeddings);
    return { asset, assets, ingestion, knowledge };
}

type KnowledgeReadResult = Awaited<ReturnType<KnowledgeQueryService["readItem"]>>;
type KnowledgeSourceReadResult = Extract<KnowledgeReadResult, { kind: "source" }>;

function expectSourceReadResult(result: KnowledgeReadResult): asserts result is KnowledgeSourceReadResult {
    if (!("kind" in result) || result.kind !== "source") {
        throw new Error(`Expected a source read result, received ${"path" in result ? result.path : "unknown"}`);
    }
}

describe("KnowledgeQueryService", () => {
    it("searches OKF fields and returns traceable snippets and citations", async () => {
        const { asset, knowledge } = createKnowledgeHarness();

        const result = await knowledge.searchAsset(asset.id, "revenue refunds", 8);

        expect(result.hits[0]).toMatchObject({
            assetId: asset.id,
            conceptId: "metrics/revenue",
            path: "wiki/metrics/revenue.md",
            title: "Monthly Revenue",
            type: "Metric",
            resource: "https://example.com/metrics/revenue",
            tags: ["finance", "sales"],
            citations: ["https://example.com/policy/revenue"],
        });
        expect(result.hits[0].snippet).toContain("refunds");
        expect(result.hits[0].score).toBeGreaterThan(0);
        expect(result.searchCandidateCount).toBeGreaterThanOrEqual(result.hits.length);
        expect(result.searchTruncated).toBe(result.searchCandidateCount > result.hits.length);
    });

    it("retries once when the knowledge snapshot changes during search", async () => {
        const { asset, ingestion, knowledge } = createKnowledgeHarness();
        const actualSnapshot = ingestion.getIndexSnapshot.bind(ingestion);
        const revisions = ["attempt-1-start", "attempt-1-end", "attempt-2", "attempt-2"];
        jest.spyOn(ingestion, "getIndexSnapshot").mockImplementation(async (...args) => ({
            ...(await actualSnapshot(...args)),
            revision: revisions.shift() ?? "attempt-2",
        }));

        const result = await knowledge.searchAsset(asset.id, "revenue refunds", 1);

        expect(result.indexSnapshot).toMatchObject({ revision: "attempt-2" });
        expect(ingestion.getIndexSnapshot).toHaveBeenCalledTimes(4);
        expect(result.searchCandidateCount).toBeGreaterThanOrEqual(result.hits.length);
    });

    it("fails closed when the knowledge snapshot changes throughout both search attempts", async () => {
        const { asset, ingestion, knowledge } = createKnowledgeHarness();
        const actualSnapshot = ingestion.getIndexSnapshot.bind(ingestion);
        let revision = 0;
        jest.spyOn(ingestion, "getIndexSnapshot").mockImplementation(async (...args) => ({
            ...(await actualSnapshot(...args)),
            revision: `moving-${revision++}`,
        }));

        await expect(knowledge.searchAsset(asset.id, "revenue refunds", 8)).rejects.toThrow(
            "知识库索引在检索期间持续变化",
        );
        expect(ingestion.getIndexSnapshot).toHaveBeenCalledTimes(4);
    });

    it("keeps internal wiki snapshots out of search, directory and direct reads", async () => {
        const { asset, assets, knowledge } = createKnowledgeHarness();
        await assets.updateBlob(
            asset.id,
            "wiki/.shuan-os-snapshots/private.md",
            "---\ntitle: Hidden snapshot\n---\n\nLEAK-MARKER-7429",
            "Snapshot",
            "main",
        );

        const search = await knowledge.searchAsset(asset.id, "LEAK-MARKER-7429");
        const root = await knowledge.listDirectory(asset.id);

        expect(search.hits).toEqual([]);
        expect(root.entries.map((entry) => entry.path)).not.toContain(".shuan-os-snapshots/");
        await expect(knowledge.readConcept(asset.id, ".shuan-os-snapshots/private")).rejects.toThrow();
    });

    it("extracts the subject from a Chinese natural-language question", async () => {
        const { asset, knowledge } = createKnowledgeHarness();

        const result = await knowledge.searchAsset(asset.id, "冻结窗口是什么时候", 8);

        expect(result.hits[0]).toMatchObject({
            path: "wiki/policies/freeze-window.md",
            title: "发布冻结窗口",
        });
    });

    it("retrieves a Chinese source through aligned local semantic tokens", async () => {
        const { asset, assets, ingestion, knowledge } = createKnowledgeHarness();
        await assets.updateBlob(
            asset.id,
            "raw/sources/building-layout.txt",
            "本文档记录建筑平面布局、安全分区和楼层出口。",
            "Add Chinese source",
            "main",
        );
        await ingestion.reindex(asset.id);

        const related = await knowledge.searchAsset(asset.id, "建筑布局与分区", 8);
        const unrelated = await knowledge.searchAsset(asset.id, "客户续费收入", 8);

        expect(related.hits).toEqual(
            expect.arrayContaining([expect.objectContaining({ path: "raw/sources/building-layout.txt" })]),
        );
        expect(unrelated.hits.some((hit) => hit.path === "raw/sources/building-layout.txt")).toBe(false);
    });

    it("reads concepts and supports progressive directory/tag traversal", async () => {
        const { asset, knowledge } = createKnowledgeHarness();

        const concept = await knowledge.readConcept(asset.id, "metrics/revenue");
        const root = await knowledge.listDirectory(asset.id);
        const tags = await knowledge.listTags(asset.id);

        expect(concept.frontmatter).toMatchObject({
            type: "Metric",
            title: "Monthly Revenue",
        });
        expect(concept.body).toContain("Monthly revenue excludes refunds");
        expect(root.entries).toEqual(
            expect.arrayContaining([
                { name: "metrics", path: "metrics/", type: "directory" },
                { name: "playbooks", path: "playbooks/", type: "directory" },
            ]),
        );
        expect(tags.tags).toEqual(
            expect.arrayContaining([
                { tag: "finance", count: 1 },
                { tag: "oncall", count: 1 },
            ]),
        );
    });

    it("binds concept reads to the search index snapshot", async () => {
        const { asset, assets, knowledge } = createKnowledgeHarness();
        const search = await knowledge.searchAsset(asset.id, "monthly revenue", 8);
        const revision = Array.isArray(search.indexSnapshot)
            ? search.indexSnapshot[0]?.revision
            : search.indexSnapshot.revision;

        const read = await knowledge.readItem(asset.id, "metrics/revenue", undefined, revision);
        expect(read).toMatchObject({ indexSnapshot: { revision } });

        await assets.updateBlob(
            asset.id,
            "wiki/metrics/revenue.md",
            "---\ntitle: Revised revenue\n---\n\nNew revision.",
            "Revise concept",
            "main",
        );
        await expect(knowledge.readItem(asset.id, "metrics/revenue", undefined, revision)).rejects.toThrow();
    });

    it("falls back to the concept resource or asset path when the page has no explicit citation", async () => {
        const { asset, knowledge } = createKnowledgeHarness();

        const result = await knowledge.searchAsset(asset.id, "incident freshness", 8);
        const incident = result.hits.find((hit) => hit.path === "wiki/playbooks/incident.md");
        const read = await knowledge.readConcept(asset.id, "playbooks/incident");

        expect(incident?.citations).toEqual([`asset://${asset.id}/wiki/playbooks/incident.md`]);
        expect(read.citations).toEqual([`asset://${asset.id}/wiki/playbooks/incident.md`]);
    });

    it("exposes OKF search/read through the capabilities virtual knowledge module", async () => {
        const { asset, assets, knowledge } = createKnowledgeHarness();
        const kernel = {
            listModules: jest.fn(async () => []),
            getModule: jest.fn(async () => null),
            searchOperations: jest.fn(async () => []),
            executeOperation: jest.fn(async () => {
                throw new Error("desktop API explorer should not be used");
            }),
        } as unknown as IKernelService;
        const capabilities = new CapabilitiesToolService(kernel, assets, undefined, knowledge);

        const modules = await capabilities.dispatch({ action: "list" }, "user-1");
        const search = (await capabilities.dispatch(
            {
                action: "execute",
                module: "knowledge",
                operation: "search",
                params: { scope: "personal", query: "monthly revenue" },
            },
            "user-1",
        )) as { hits: Array<{ assetId: string; conceptId: string }> };
        const concept = (await capabilities.dispatch(
            {
                action: "execute",
                module: "knowledge",
                operation: "read",
                params: { scope: "personal", path: search.hits[0].conceptId },
            },
            "user-1",
        )) as { assetId: string; body: string };

        expect(modules).toEqual([expect.objectContaining({ name: "knowledge" })]);
        expect(search.hits[0]).toMatchObject({
            assetId: asset.id,
            conceptId: "metrics/revenue",
        });
        expect(concept.assetId).toBe(asset.id);
        expect(concept.body).toContain("excludes refunds");
        expect(kernel.executeOperation).not.toHaveBeenCalled();
        await expect(
            capabilities.dispatch(
                {
                    action: "execute",
                    module: "knowledge",
                    operation: "search",
                    params: {
                        scope: "personal",
                        query: "monthly revenue",
                        searchCursor: "forged-cursor",
                    },
                },
                "user-1",
            ),
        ).rejects.toThrow("无效或已过期");
    });

    it("searches and reads indexed source chunks with an asset citation", async () => {
        const { asset, assets, ingestion, knowledge } = createKnowledgeHarness();
        await assets.updateBlob(
            asset.id,
            "raw/sources/quarterly-notes.txt",
            "The Zephyr retention experiment improved renewal conversion by twelve percent.",
            "Add source",
            "main",
        );
        await ingestion.reindex(asset.id);

        const result = await knowledge.searchAsset(asset.id, "Zephyr renewal");
        const hit = result.hits.find((item) => item.kind === "source");
        expect(hit).toMatchObject({
            path: "raw/sources/quarterly-notes.txt",
            title: "quarterly notes.txt",
            type: "Source",
            citations: [`asset://${asset.id}/raw/sources/quarterly-notes.txt`],
            sourceSha: expect.any(String),
        });
        expect(result.indexSnapshot).toMatchObject({
            revision: expect.any(String),
            incompleteSourceCount: 0,
        });

        const revision = Array.isArray(result.indexSnapshot)
            ? result.indexSnapshot[0]?.revision
            : result.indexSnapshot.revision;
        const source = await knowledge.readItem(asset.id, hit?.conceptId ?? "", undefined, revision);
        expect(source).toMatchObject({
            kind: "source",
            path: "raw/sources/quarterly-notes.txt",
            sourceSha: hit?.sourceSha,
            indexSnapshot: { revision },
        });
        expect(source.content).toContain("renewal conversion");

        await assets.updateBlob(
            asset.id,
            "raw/sources/quarterly-notes.txt",
            "A newer source revision must not be mixed into the prior search result.",
            "Change source",
            "main",
        );
        await expect(knowledge.readItem(asset.id, hit?.conceptId ?? "", undefined, revision)).rejects.toThrow();

        const synonymResult = await knowledge.searchAsset(asset.id, "subscription extension");
        expect(synonymResult.hits).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    kind: "source",
                    path: "raw/sources/quarterly-notes.txt",
                    semanticScore: expect.any(Number),
                }),
            ]),
        );
    });

    it("reindexes, searches, and reads both paths when source bytes are identical", async () => {
        const { asset, assets, ingestion, knowledge } = createKnowledgeHarness();
        const identical = "TWIN-SOURCE-READ regression content is intentionally identical.";
        await assets.updateBlob(asset.id, "raw/sources/team-a/twin.txt", identical, "Add team A", "main");
        await assets.updateBlob(asset.id, "raw/sources/team-b/twin.txt", identical, "Add team B", "main");

        const indexed = await ingestion.reindex(asset.id);
        const result = await knowledge.searchAsset(asset.id, "TWIN-SOURCE-READ", 8);
        const twinHits = result.hits.filter((hit) => hit.kind === "source" && hit.path.endsWith("/twin.txt"));
        const revision = Array.isArray(result.indexSnapshot)
            ? result.indexSnapshot[0]?.revision
            : result.indexSnapshot.revision;
        const reads = await Promise.all(
            twinHits.map((hit) => knowledge.readItem(asset.id, hit.conceptId, undefined, revision)),
        );

        expect(indexed).toMatchObject({ indexedSourceCount: 2, errorSourceCount: 0 });
        expect(twinHits.map((hit) => hit.path).sort()).toEqual([
            "raw/sources/team-a/twin.txt",
            "raw/sources/team-b/twin.txt",
        ]);
        expect(reads).toEqual([
            expect.objectContaining({ path: twinHits[0]?.path, content: identical }),
            expect.objectContaining({ path: twinHits[1]?.path, content: identical }),
        ]);
    });

    it("does not fall back to a mutable raw source when a revision-pinned artifact is missing", async () => {
        const { asset, assets, ingestion, knowledge } = createKnowledgeHarness();
        await assets.updateBlob(
            asset.id,
            "raw/sources/pinned-notes.txt",
            "Pinned retrieval must use the indexed artifact.",
            "Add pinned source",
            "main",
        );
        await ingestion.reindex(asset.id);
        const search = await knowledge.searchAsset(asset.id, "Pinned retrieval");
        const hit = search.hits.find((item) => item.path === "raw/sources/pinned-notes.txt");
        const revision = Array.isArray(search.indexSnapshot)
            ? search.indexSnapshot[0]?.revision
            : search.indexSnapshot.revision;
        const manifest = await ingestion.getManifest(asset.id);
        const source = manifest.sources.find((entry) => entry.path === "raw/sources/pinned-notes.txt");
        expect(source?.extractedTextPath).toBeTruthy();
        await assets.deleteBlob(asset.id, source?.extractedTextPath ?? "missing", "Remove artifact", "main");

        await expect(knowledge.readItem(asset.id, hit?.conceptId ?? "", undefined, revision)).rejects.toThrow(
            "派生文本不可用",
        );
    });

    it("rejects a source read when the raw source SHA changes during the operation", async () => {
        const { asset, assets, ingestion, knowledge } = createKnowledgeHarness();
        await assets.updateBlob(
            asset.id,
            "raw/sources/changing-notes.txt",
            "The initial source contains a changing marker.",
            "Add changing source",
            "main",
        );
        await ingestion.reindex(asset.id);
        const search = await knowledge.searchAsset(asset.id, "changing marker");
        const hit = search.hits.find((item) => item.path === "raw/sources/changing-notes.txt");
        const revision = Array.isArray(search.indexSnapshot)
            ? search.indexSnapshot[0]?.revision
            : search.indexSnapshot.revision;
        const manifest = await ingestion.getManifest(asset.id);
        const source = manifest.sources.find((entry) => entry.path === "raw/sources/changing-notes.txt");
        const getBlobContent = assets.getBlobContent.bind(assets);
        let changed = false;
        jest.spyOn(assets, "getBlobContent").mockImplementation(async (assetId, path) => {
            const content = await getBlobContent(assetId, path);
            if (!changed && path === source?.extractedTextPath) {
                changed = true;
                await assets.updateBlob(
                    asset.id,
                    "raw/sources/changing-notes.txt",
                    "The source changed while the old artifact was being read.",
                    "Change source during read",
                    "main",
                );
            }
            return content;
        });

        await expect(knowledge.readItem(asset.id, hit?.conceptId ?? "", undefined, revision)).rejects.toThrow(
            "来源在读取期间已变化",
        );
    });

    it("reads CSV sources without overlap corruption and returns record-aware table summaries", async () => {
        const { asset, assets, ingestion, knowledge } = createKnowledgeHarness();
        const csv = [
            "edge_id,from_node,to_node,accessible,base_status",
            ...Array.from(
                { length: 131 },
                (_, index) => `E-${String(index + 1).padStart(4, "0")},F10-C,F10-S1,yes,open`,
            ),
        ].join("\n");
        await assets.updateBlob(asset.id, "raw/sources/route_edges.csv", csv, "Add route edge table", "main");
        await ingestion.reindex(asset.id);

        const search = await knowledge.searchAsset(asset.id, "E-0100", 8);
        const hit = search.hits.find((item) => item.path === "raw/sources/route_edges.csv");
        const chunk = await knowledge.readItem(asset.id, hit?.conceptId ?? "");
        const complete = await knowledge.readItem(asset.id, "raw/sources/route_edges.csv");
        const exact = await knowledge.readItem(asset.id, "source:raw/sources/route_edges.csv#0", ["E-0100", "E-9999"]);
        const inventory = await knowledge.searchAsset(asset.id, "统计路线边记录数", 8);

        expectSourceReadResult(complete);
        expectSourceReadResult(exact);

        expect(chunk.content).toMatch(/^edge_id,from_node,to_node,accessible,base_status/m);
        expect(chunk.content).toContain("E-0100,F10-C,F10-S1,yes,open");
        expect(complete.content).toBe(csv);
        expect(complete.content.match(/^E-/gm)).toHaveLength(131);
        expect(complete.tableSummary).toMatchObject({
            path: "raw/sources/route_edges.csv",
            primaryKey: "edge_id",
            recordCount: 131,
            recordIdsTruncated: false,
        });
        if (!complete.tableSummary) throw new Error("Expected a table summary for the CSV source");
        expect(complete.tableSummary.recordIds).toContain("E-0100");
        expect(exact.content).toContain("E-0100,F10-C,F10-S1,yes,open");
        expect(exact.content).not.toContain("E-0099,F10-C,F10-S1,yes,open");
        expect(exact.matchedIdentifiers).toEqual(["E-0100"]);
        expect(exact.missingIdentifiers).toEqual(["E-9999"]);
        expect(exact.matchedRecordIds).toEqual(["E-0100"]);
        const nonPrimaryKey = await knowledge.readItem(asset.id, "source:raw/sources/route_edges.csv#0", [
            "F10-C",
            "open",
        ]);
        expectSourceReadResult(nonPrimaryKey);
        expect(nonPrimaryKey.matchedIdentifiers).toEqual([]);
        expect(nonPrimaryKey.missingIdentifiers).toEqual(["F10-C", "open"]);
        expect(nonPrimaryKey.matchedRecordIds).toEqual([]);
        expect(nonPrimaryKey.content).toBe("edge_id,from_node,to_node,accessible,base_status");
        expect(inventory.tableSummaries).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    path: "raw/sources/route_edges.csv",
                    recordCount: 131,
                    primaryKey: "edge_id",
                }),
            ]),
        );
        expect(inventory).toMatchObject({
            catalogCandidateCount: 1,
            catalogTruncated: false,
            catalogOmittedCount: 0,
        });
    });

    it("uses a declared non-first primary key consistently for direct reads and catalog record IDs", async () => {
        const { asset, assets, ingestion, knowledge } = createKnowledgeHarness();
        await assets.updateBlob(
            asset.id,
            "raw/sources/orders.csv",
            "status,order_id,owner\nOPEN,O-1,Ada\nCLOSED,O-2,Lin",
            "Add orders",
            "main",
        );
        await assets.updateBlob(
            asset.id,
            "schema.md",
            [
                "```knowledge-grounding",
                JSON.stringify({
                    version: 1,
                    tables: [{ path: "raw/sources/orders.csv", primaryKey: "order_id" }],
                }),
                "```",
            ].join("\n"),
            "Declare primary key",
            "main",
        );
        await ingestion.reindex(asset.id);

        const direct = await knowledge.readItem(asset.id, "source:raw/sources/orders.csv", ["O-2", "OPEN"]);
        const byOwner = await knowledge.readItem(asset.id, "source:raw/sources/orders.csv", undefined, undefined, [
            { column: "owner", op: "eq", value: "Lin" },
        ]);
        const invalidRelation = await knowledge.readItem(
            asset.id,
            "source:raw/sources/orders.csv",
            undefined,
            undefined,
            [{ column: "missing_column", op: "eq", value: "Lin" }],
        );
        const catalog = await knowledge.searchAsset(asset.id, "盘点全部表和记录数", 8, true);

        expectSourceReadResult(direct);
        expectSourceReadResult(byOwner);
        expectSourceReadResult(invalidRelation);

        expect(direct.tableSummary).toMatchObject({ primaryKey: "order_id", recordIds: ["O-1", "O-2"] });
        expect(direct.matchedIdentifiers).toEqual(["O-2"]);
        expect(direct.missingIdentifiers).toEqual(["OPEN"]);
        expect(direct.matchedRecordIds).toEqual(["O-2"]);
        expect(byOwner.content).toContain("CLOSED,O-2,Lin");
        expect(byOwner.content).not.toContain("OPEN,O-1,Ada");
        expect(byOwner.matchedIdentifiers).toEqual(["Lin"]);
        expect(byOwner.matchedRecordIds).toEqual(["O-2"]);
        expect(invalidRelation.matchedIdentifiers).toEqual([]);
        expect(invalidRelation.missingIdentifiers).toEqual(["Lin"]);
        expect(invalidRelation.content).toBe("status,order_id,owner");
        expect(catalog.tableSummaries?.[0]).toMatchObject({
            primaryKey: "order_id",
            recordIds: ["O-1", "O-2"],
        });
    });

    it("fails a relation filter closed when the requested CSV header is duplicated", async () => {
        const { asset, assets, ingestion, knowledge } = createKnowledgeHarness();
        await assets.updateBlob(
            asset.id,
            "raw/sources/assignments.csv",
            "assignment_id,owner_id,owner_id\nAS-1,OWNER-A,OWNER-B",
            "Add ambiguous assignments",
            "main",
        );
        await ingestion.reindex(asset.id);

        const result = await knowledge.readItem(asset.id, "source:raw/sources/assignments.csv", undefined, undefined, [
            { column: "owner_id", op: "eq", value: "OWNER-A" },
        ]);

        expectSourceReadResult(result);
        expect(result.matchedIdentifiers).toEqual([]);
        expect(result.missingIdentifiers).toEqual(["OWNER-A"]);
        expect(result.matchedRecordIds).toEqual([]);
        expect(result.content).toBe("assignment_id,owner_id,owner_id");
    });

    it("marks a bounded table catalog partial instead of silently omitting the 33rd CSV", async () => {
        const { asset, assets, ingestion, knowledge } = createKnowledgeHarness();
        for (let index = 0; index < 33; index += 1) {
            const name = `table-${String(index + 1).padStart(2, "0")}.csv`;
            await assets.updateBlob(
                asset.id,
                `raw/sources/${name}`,
                `id,value\nR-${index + 1},${index + 1}`,
                `Add ${name}`,
                "main",
            );
        }
        await ingestion.reindex(asset.id);

        const inventory = await knowledge.searchAsset(asset.id, "盘点全部表和记录数", 8, true);

        expect(inventory.tableSummaries).toHaveLength(32);
        expect(inventory).toMatchObject({
            catalogCandidateCount: 33,
            catalogTruncated: true,
            catalogOmittedCount: 1,
            catalogOffset: 0,
            catalogUnretrievableCount: 0,
        });
        expect(inventory.nextCatalogCursor).toEqual(expect.any(String));

        const next = await knowledge.searchAsset(asset.id, "盘点全部表和记录数", 8, true, {
            catalogCursor: inventory.nextCatalogCursor,
        });
        expect(next.tableSummaries).toHaveLength(1);
        expect(next.tableSummaries?.[0]?.path).toBe("raw/sources/table-33.csv");
        expect(next.catalogOffset).toBe(32);
        expect(next.nextCatalogCursor).toBeUndefined();
        expect(new Set(inventory.tableSummaries?.map((entry) => entry.path))).not.toContain(
            next.tableSummaries?.[0]?.path,
        );
    });

    it("reports oversized CSV catalog omissions instead of treating the catalog as exhaustive", async () => {
        const { asset, assets, ingestion, knowledge } = createKnowledgeHarness();
        await assets.updateBlob(asset.id, "raw/sources/small.csv", "id,value\nR-1,small", "Add small table", "main");
        await assets.updateBlob(
            asset.id,
            "raw/sources/oversized.csv",
            "id,value\nR-big,large",
            "Add oversized table",
            "main",
        );
        await ingestion.reindex(asset.id);
        const manifest = await ingestion.getManifest(asset.id);
        await assets.updateBlob(
            asset.id,
            ".internshannon/knowledge/index/manifest.json",
            `${JSON.stringify(
                {
                    ...manifest,
                    sources: manifest.sources.map((source) =>
                        source.path === "raw/sources/oversized.csv" ? { ...source, size: 2 * 1024 * 1024 + 1 } : source,
                    ),
                },
                null,
                2,
            )}\n`,
            "Simulate an indexed CSV above the catalog summary byte cap",
            "main",
        );

        const inventory = await knowledge.searchAsset(asset.id, "盘点全部表和记录数", 8, true);

        expect(inventory.tableSummaries).toHaveLength(1);
        expect(inventory).toMatchObject({
            catalogCandidateCount: 2,
            catalogTruncated: true,
            catalogOmittedCount: 1,
            catalogUnretrievableCount: 1,
        });
        expect(inventory.nextCatalogCursor).toBeUndefined();
    });

    it("paginates stable search candidates without duplicates and rejects query or limit mismatches", async () => {
        const { asset, assets, ingestion, knowledge } = createKnowledgeHarness();
        for (let index = 0; index < 5; index += 1) {
            await assets.updateBlob(
                asset.id,
                `raw/sources/page-${index}.txt`,
                `stable pagination marker row ${index}`,
                `Add search page ${index}`,
                "main",
            );
        }
        await ingestion.reindex(asset.id);

        const first = await knowledge.searchAsset(asset.id, "stable pagination marker", 2);
        expect(first).toMatchObject({ searchOffset: 0, searchTruncated: true });
        expect(first.nextSearchCursor).toEqual(expect.any(String));
        const second = await knowledge.searchAsset(asset.id, "stable pagination marker", 2, false, {
            searchCursor: first.nextSearchCursor,
        });

        expect(second.searchOffset).toBe(2);
        expect(second.hits).toHaveLength(2);
        expect(new Set(first.hits.map((hit) => hit.conceptId))).not.toContain(second.hits[0]?.conceptId);
        expect(new Set(first.hits.map((hit) => hit.conceptId))).not.toContain(second.hits[1]?.conceptId);
        await expect(
            knowledge.searchAsset(asset.id, "different pagination query", 2, false, {
                searchCursor: first.nextSearchCursor,
            }),
        ).rejects.toThrow("不匹配");
        await expect(
            knowledge.searchAsset(asset.id, "stable pagination marker", 3, false, {
                searchCursor: first.nextSearchCursor,
            }),
        ).rejects.toThrow("不匹配");
    });

    it("fails closed when a search cursor revision is stale or its signature is forged", async () => {
        const { asset, assets, ingestion, knowledge } = createKnowledgeHarness();
        await assets.updateBlob(
            asset.id,
            "raw/sources/cursor.txt",
            Array.from({ length: 4 }, (_, index) => `cursor revision marker block ${index} ${"x".repeat(1_300)}`).join(
                "\n",
            ),
            "Add cursor source",
            "main",
        );
        await ingestion.reindex(asset.id);
        const first = await knowledge.searchAsset(asset.id, "cursor revision marker", 1);
        expect(first.nextSearchCursor).toEqual(expect.any(String));

        const cursor = first.nextSearchCursor as string;
        const [encoded, signature] = cursor.split(".");
        const signatureBytes = Buffer.from(signature, "base64url");
        signatureBytes[0] ^= 1;
        const forged = `${encoded}.${signatureBytes.toString("base64url")}`;
        await expect(
            knowledge.searchAsset(asset.id, "cursor revision marker", 1, false, { searchCursor: forged }),
        ).rejects.toThrow("无效或已过期");

        await assets.updateBlob(
            asset.id,
            "raw/sources/cursor.txt",
            Array.from(
                { length: 4 },
                (_, index) => `cursor revision marker changed block ${index} ${"x".repeat(1_300)}`,
            ).join("\n"),
            "Change cursor source",
            "main",
        );
        await ingestion.reindex(asset.id);
        await expect(
            knowledge.searchAsset(asset.id, "cursor revision marker", 1, false, {
                searchCursor: first.nextSearchCursor,
            }),
        ).rejects.toThrow("不匹配");
    });

    it("invalidates old cursors and pinned reads when embedding bytes change under the same model", async () => {
        let embeddingValue = 0.1;
        const embeddings = {
            getAssetConfig: () => ({
                provider: "test",
                model: "stable-model-name",
                dimensions: 2,
                keywordWeight: 1,
                vectorWeight: 1,
                mmrLambda: 0.78,
                timeoutMs: 1_000,
            }),
            embed: async (_asset: Asset, texts: string[]) => ({
                provider: "test",
                model: "stable-model-name",
                dimensions: 2,
                vectors: texts.map((_, index) => [embeddingValue, index + 1]),
            }),
        } as unknown as KnowledgeEmbeddingService;
        const harness = createKnowledgeHarness();
        const { asset, assets } = harness;
        const ingestion = new KnowledgeIngestionService(assets, undefined, embeddings);
        const knowledge = new KnowledgeQueryService(assets, ingestion, embeddings);
        for (let index = 0; index < 4; index += 1) {
            await assets.updateBlob(
                asset.id,
                `raw/sources/vector-revision-${index}.txt`,
                `vector artifact revision marker ${index}`,
                `Add vector revision source ${index}`,
                "main",
            );
        }
        const firstIndex = await ingestion.reindex(asset.id);
        const first = await knowledge.searchAsset(asset.id, "vector artifact revision marker", 1);
        const firstRevision = Array.isArray(first.indexSnapshot)
            ? first.indexSnapshot[0]?.revision
            : first.indexSnapshot.revision;
        expect(first.nextSearchCursor).toEqual(expect.any(String));

        embeddingValue = 0.9;
        const secondIndex = await ingestion.reindex(asset.id);

        expect(secondIndex.manifest.vectorIndexPath).not.toBe(firstIndex.manifest.vectorIndexPath);
        expect(secondIndex.manifest.revision).not.toBe(firstIndex.manifest.revision);
        await expect(
            knowledge.searchAsset(asset.id, "vector artifact revision marker", 1, false, {
                searchCursor: first.nextSearchCursor,
            }),
        ).rejects.toThrow("\u4e0d\u5339\u914d");
        await expect(
            knowledge.readItem(asset.id, first.hits[0]?.conceptId ?? "", undefined, firstRevision),
        ).rejects.toThrow("\u7d22\u5f15\u7248\u672c\u5df2\u53d8\u5316");
    });

    it("rejects a search cursor after ranking weights change without reindexing", async () => {
        let keywordWeight = 1;
        const embeddings = {
            getAssetConfig: () => ({
                provider: "local",
                model: "local-hash-v1",
                dimensions: 192,
                keywordWeight,
                vectorWeight: 6,
                mmrLambda: 0.78,
            }),
            embed: async (_asset: Asset, texts: string[]) => ({
                provider: "local",
                model: "local-hash-v1",
                dimensions: 192,
                vectors: texts.map(() => Array.from({ length: 192 }, () => 0)),
            }),
        } as unknown as KnowledgeEmbeddingService;
        const { asset, assets, ingestion, knowledge } = createKnowledgeHarness(embeddings);
        for (let index = 0; index < 4; index += 1) {
            await assets.updateBlob(
                asset.id,
                `raw/sources/ranking-${index}.txt`,
                `ranking cursor marker ${index}`,
                `Add ranking source ${index}`,
                "main",
            );
        }
        await ingestion.reindex(asset.id);

        const first = await knowledge.searchAsset(asset.id, "ranking cursor marker", 2);
        expect(first.nextSearchCursor).toEqual(expect.any(String));
        keywordWeight = 2;

        await expect(
            knowledge.searchAsset(asset.id, "ranking cursor marker", 2, false, {
                searchCursor: first.nextSearchCursor,
            }),
        ).rejects.toThrow("不匹配");
    });

    it("binds cursors to scope and the resolved asset set", async () => {
        const { asset, assets, ingestion, knowledge } = createKnowledgeHarness();
        await assets.updateBlob(
            asset.id,
            "raw/sources/scope-cursor.txt",
            Array.from({ length: 4 }, (_, index) => `scope cursor marker block ${index} ${"x".repeat(1_300)}`).join(
                "\n",
            ),
            "Add scoped cursor source",
            "main",
        );
        await ingestion.reindex(asset.id);
        const first = await knowledge.searchAsset(asset.id, "scope cursor marker", 1);
        expect(first.nextSearchCursor).toEqual(expect.any(String));

        await expect(
            knowledge.searchScope("personal", "user-1", "scope cursor marker", 1, false, {
                searchCursor: first.nextSearchCursor,
            }),
        ).rejects.toThrow("不匹配");

        const decoded = (
            knowledge as unknown as {
                decodePageCursor: (cursor: string) => {
                    assetIds: string[];
                    revisions: Array<{ assetId: string; revision: string }>;
                };
            }
        ).decodePageCursor(first.nextSearchCursor as string);
        decoded.assetIds = ["different-asset"];
        decoded.revisions = [{ assetId: "different-asset", revision: decoded.revisions[0]?.revision ?? "" }];
        const mismatchedAssets = (
            knowledge as unknown as { encodePageCursor: (payload: unknown) => string }
        ).encodePageCursor(decoded);
        await expect(
            knowledge.searchAsset(asset.id, "scope cursor marker", 1, false, {
                searchCursor: mismatchedAssets,
            }),
        ).rejects.toThrow("不匹配");
    });

    it("bounds oversized wiki reads and exposes the omission as incomplete search", async () => {
        const { asset, assets, knowledge } = createKnowledgeHarness();
        await assets.updateBlob(
            asset.id,
            "wiki/oversized.md",
            `---\ntitle: Oversized page\n---\n\n${"oversized-wiki-marker ".repeat(105_000)}`,
            "Add oversized wiki page",
            "main",
        );
        const getBlobContent = jest.spyOn(assets, "getBlobContent");

        const result = await knowledge.searchAsset(asset.id, "oversized-wiki-marker", 8);

        expect(result.hits.some((hit) => hit.path === "wiki/oversized.md")).toBe(false);
        expect(result.searchTruncated).toBe(true);
        expect(result.searchCandidateCount).toBeGreaterThan(result.hits.length);
        const snapshot = Array.isArray(result.indexSnapshot) ? result.indexSnapshot[0] : result.indexSnapshot;
        expect(snapshot.incompleteReasons).toEqual(
            expect.arrayContaining([expect.stringMatching(/^knowledge_wiki_document_size_limit_exceeded:1\/2097152$/)]),
        );
        expect(getBlobContent.mock.calls.filter(([, path]) => path === "wiki/oversized.md")).toHaveLength(0);
    });

    it("returns semantically similar OKF concepts with a declared embedding model", async () => {
        const { asset, assets, knowledge } = createKnowledgeHarness();
        await assets.updateBlob(
            asset.id,
            "wiki/metrics/income.md",
            "---\ntype: Metric\ntitle: Income trend\n---\n\nMonthly income and subscription extension results.\n",
            "Add related concept",
            "main",
        );

        const result = await knowledge.findSimilarConcepts(asset.id, "metrics/revenue");

        expect(result.model).toBe("local-hash-v1");
        expect(result.hits).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    path: "wiki/metrics/income.md",
                    similarity: expect.any(Number),
                }),
            ]),
        );
    });

    it("returns an empty grounded result for unknown knowledge instead of fabricating a citation", async () => {
        const { asset, knowledge } = createKnowledgeHarness();

        const result = await knowledge.searchAsset(asset.id, "ZXQ-unknown-fact-99117");

        expect(result.query).toBe("ZXQ-unknown-fact-99117");
        expect(result.hits).toEqual([]);
    });

    it("does not turn local-hash collisions from a large source into semantic-only hits", async () => {
        const { asset, assets, ingestion, knowledge } = createKnowledgeHarness();
        const largeUnrelatedSource = Array.from(
            { length: 12_000 },
            (_, index) => `research-token-${index} object localization evidence`,
        ).join("\n");
        await assets.updateBlob(
            asset.id,
            "raw/sources/large-research-corpus.txt",
            largeUnrelatedSource,
            "Add large source",
            "main",
        );
        await ingestion.reindex(asset.id);

        const result = await knowledge.searchAsset(asset.id, "ZXQUNSEENRS274901");

        expect(result.hits).toEqual([]);
    });

    it("requires a lexical match for identifiers that share natural-language prefixes", async () => {
        const { asset, assets, ingestion, knowledge } = createKnowledgeHarness();
        await assets.updateBlob(
            asset.id,
            "raw/sources/concurrency-notes.txt",
            "Concurrency soak results are reviewed after every release.",
            "Add concurrency notes",
            "main",
        );
        await ingestion.reindex(asset.id);

        const absent = await knowledge.searchAsset(asset.id, "CONCURRENCY-SOAK-RUN-7429");
        expect(absent.hits).toEqual([]);

        await assets.updateBlob(
            asset.id,
            "raw/sources/concurrency-notes.txt",
            "The exact release marker is CONCURRENCY-SOAK-RUN-7429.",
            "Add exact marker",
            "main",
        );
        await ingestion.reindex(asset.id);

        const present = await knowledge.searchAsset(asset.id, "CONCURRENCY-SOAK-RUN-7429");
        expect(present.hits).toEqual(
            expect.arrayContaining([expect.objectContaining({ path: "raw/sources/concurrency-notes.txt" })]),
        );
    });

    it("rejects external semantic-only matches for unknown identifier queries", async () => {
        const embeddings = {
            getAssetConfig: () => ({
                provider: "external",
                model: "external-embedding",
                dimensions: 2,
                keywordWeight: 1,
                vectorWeight: 6,
                mmrLambda: 0.78,
            }),
            embed: async (_asset: Asset, texts: string[]) => ({
                provider: "external",
                model: "external-embedding",
                dimensions: 2,
                vectors: texts.map(() => [1, 0]),
            }),
        } as unknown as KnowledgeEmbeddingService;
        const { asset, knowledge } = createKnowledgeHarness(embeddings);

        const result = await knowledge.searchAsset(asset.id, "ZXQUNSEENRN983104");

        expect(result.hits).toEqual([]);
    });

    it("keeps high-confidence natural-language matches from external embeddings", async () => {
        const embeddings = {
            getAssetConfig: () => ({
                provider: "external",
                model: "external-embedding",
                dimensions: 2,
                keywordWeight: 1,
                vectorWeight: 6,
                mmrLambda: 0.78,
            }),
            embed: async (_asset: Asset, texts: string[]) => ({
                provider: "external",
                model: "external-embedding",
                dimensions: 2,
                vectors: texts.map(() => [1, 0]),
            }),
        } as unknown as KnowledgeEmbeddingService;
        const { asset, knowledge } = createKnowledgeHarness(embeddings);

        const result = await knowledge.searchAsset(asset.id, "customer retention objective");

        expect(result.hits.length).toBeGreaterThan(0);
        expect(result.hits[0].semanticScore).toBe(1);
    });

    it("reports recall and reciprocal rank through the hybrid MMR evaluation contract", async () => {
        const { asset, knowledge } = createKnowledgeHarness();

        const evaluation = await knowledge.evaluateAsset(
            asset.id,
            [{ query: "monthly revenue refunds", expectedPaths: ["wiki/metrics/revenue.md"] }],
            5,
        );

        expect(evaluation).toMatchObject({
            caseCount: 1,
            recallAtK: 1,
            mrr: 1,
            emptyResultRate: 0,
            ranking: "hybrid-mmr-v1",
        });
    });

    it("bounds the MMR reranking pool for broad queries", () => {
        const { asset, knowledge } = createKnowledgeHarness();
        const hits = Array.from({ length: 2_000 }, (_, index) => ({
            kind: "source" as const,
            assetId: asset.id,
            bundle: "personal-knowledge",
            conceptId: `source:${index}`,
            path: `raw/sources/${String(index).padStart(4, "0")}.txt`,
            title: `Candidate ${index}`,
            type: "Source",
            tags: [],
            snippet: index < 512 ? "common broad-query result" : `unique tail ${index}`,
            score: 2_000 - index,
            citations: [`asset://${asset.id}/raw/sources/${index}.txt`],
        }));
        const diversify = (
            knowledge as unknown as {
                diversify: (input: typeof hits, limit: number, lambda: number) => typeof hits;
            }
        ).diversify.bind(knowledge);

        const selected = diversify(hits, 8, 0.78);

        expect(selected).toHaveLength(8);
        expect(selected.every((hit) => Number(hit.conceptId.slice("source:".length)) < 512)).toBe(true);
    });

    it("forms one global MMR ranking before pagination and keeps limit-independent prefixes", () => {
        const { asset, knowledge } = createKnowledgeHarness();
        const hit = (conceptId: string, snippet: string, score: number) => ({
            kind: "source" as const,
            assetId: asset.id,
            bundle: "personal-knowledge",
            conceptId,
            path: `raw/sources/${conceptId}.txt`,
            title: conceptId,
            type: "Source",
            tags: [],
            snippet,
            score,
            citations: [`asset://${asset.id}/${conceptId}`],
        });
        const ranked = [
            hit("A", "identical duplicate evidence", 10),
            hit("B", "identical duplicate evidence", 9.9),
            hit("C", "independent diverse material", 9.8),
        ];
        const diversify = (
            knowledge as unknown as {
                diversify: (input: typeof ranked, limit: number, lambda: number) => typeof ranked;
            }
        ).diversify.bind(knowledge);

        const full = diversify(ranked, ranked.length, 0.6);
        const small = diversify(ranked, 2, 0.6);

        expect(full.map((item) => item.conceptId)).toEqual(["A", "C", "B"]);
        expect(small).toEqual(full.slice(0, 2));
        expect(new Set([...full.slice(0, 2), ...full.slice(2)]).size).toBe(3);
    });

    it("keeps incremental MMR exactly equivalent while bounding 512-candidate work", () => {
        const { asset, knowledge } = createKnowledgeHarness();
        const hits = Array.from({ length: 512 }, (_, index) => ({
            kind: "source" as const,
            assetId: asset.id,
            bundle: "personal-knowledge",
            conceptId: `equivalence-${index}`,
            path: `raw/sources/equivalence-${index}.txt`,
            title: `Candidate ${index % 17}`,
            type: "Source",
            tags: [],
            snippet: `cluster ${index % 23} evidence ${index}`,
            score: 512 - index / 512,
            citations: [`asset://${asset.id}/equivalence-${index}`],
        }));
        const diversify = (
            knowledge as unknown as {
                diversify: (input: typeof hits, limit: number, lambda: number) => typeof hits;
            }
        ).diversify.bind(knowledge);
        const legacy = (input: typeof hits, limit: number, lambda: number) => {
            const candidates = input.map((hit) => ({
                hit,
                embedding: localEmbedding(`${hit.title}\n${hit.snippet}`),
            }));
            const selected: typeof candidates = [];
            const maxScore = Math.max(...input.map((hit) => hit.score), 1);
            while (candidates.length > 0 && selected.length < limit) {
                let bestIndex = 0;
                let bestScore = Number.NEGATIVE_INFINITY;
                for (const [index, candidate] of candidates.entries()) {
                    const redundancy = selected.length
                        ? Math.max(...selected.map((item) => cosineSimilarity(candidate.embedding, item.embedding)))
                        : 0;
                    const score = lambda * (candidate.hit.score / maxScore) - (1 - lambda) * redundancy;
                    if (score > bestScore) {
                        bestScore = score;
                        bestIndex = index;
                    }
                }
                selected.push(candidates.splice(bestIndex, 1)[0]);
            }
            return selected.map((item) => item.hit);
        };

        const expected = legacy(hits, 48, 0.78);
        const started = performance.now();
        const actual = diversify(hits, hits.length, 0.78);
        const elapsedMs = performance.now() - started;

        expect(actual.slice(0, expected.length)).toEqual(expected);
        expect(actual).toHaveLength(512);
        // This guards against the former repeated selected-set scan without
        // imposing a millisecond-scale, machine-sensitive microbenchmark.
        expect(elapsedMs).toBeLessThan(5_000);
    });

    it("creates a missing first-run data directory before publishing the cursor secret", () => {
        const originalDataDir = process.env.INTERNSHANNON_DATA_DIR;
        const parent = fs.mkdtempSync(path.join(os.tmpdir(), "knowledge-cursor-first-run-"));
        const missingDataDir = path.join(parent, "nested", "profile");
        try {
            process.env.INTERNSHANNON_DATA_DIR = missingDataDir;
            expect(fs.existsSync(missingDataDir)).toBe(false);
            createKnowledgeHarness();
            const secret = path.join(missingDataDir, "knowledge-cursor-signing-key");
            expect(fs.readFileSync(secret)).toHaveLength(32);
        } finally {
            if (originalDataDir === undefined) delete process.env.INTERNSHANNON_DATA_DIR;
            else process.env.INTERNSHANNON_DATA_DIR = originalDataDir;
            fs.rmSync(parent, { recursive: true, force: true });
        }
    });

    it("persists cursor signatures across service instances and isolates data directories", async () => {
        const originalDataDir = process.env.INTERNSHANNON_DATA_DIR;
        const firstDir = fs.mkdtempSync(path.join(os.tmpdir(), "knowledge-cursor-first-"));
        const secondDir = fs.mkdtempSync(path.join(os.tmpdir(), "knowledge-cursor-second-"));
        try {
            process.env.INTERNSHANNON_DATA_DIR = firstDir;
            const firstHarness = createKnowledgeHarness();
            for (let index = 0; index < 3; index += 1) {
                await firstHarness.assets.updateBlob(
                    firstHarness.asset.id,
                    `raw/sources/cross-instance-${index}.txt`,
                    `cross instance cursor marker ${index}`,
                    "Add cursor fixture",
                    "main",
                );
            }
            await firstHarness.ingestion.reindex(firstHarness.asset.id);
            const firstPage = await firstHarness.knowledge.searchAsset(
                firstHarness.asset.id,
                "cross instance cursor marker",
                1,
            );
            expect(firstPage.nextSearchCursor).toEqual(expect.any(String));

            const restarted = new KnowledgeQueryService(firstHarness.assets, firstHarness.ingestion);
            await expect(
                restarted.searchAsset(firstHarness.asset.id, "cross instance cursor marker", 1, false, {
                    searchCursor: firstPage.nextSearchCursor,
                }),
            ).resolves.toMatchObject({ searchOffset: 1 });

            process.env.INTERNSHANNON_DATA_DIR = secondDir;
            const isolated = new KnowledgeQueryService(firstHarness.assets, firstHarness.ingestion);
            await expect(
                isolated.searchAsset(firstHarness.asset.id, "cross instance cursor marker", 1, false, {
                    searchCursor: firstPage.nextSearchCursor,
                }),
            ).rejects.toThrow("无效或已过期");
        } finally {
            if (originalDataDir === undefined) delete process.env.INTERNSHANNON_DATA_DIR;
            else process.env.INTERNSHANNON_DATA_DIR = originalDataDir;
            fs.rmSync(firstDir, { recursive: true, force: true });
            fs.rmSync(secondDir, { recursive: true, force: true });
        }
    });

    it("rejects an oversized global asset scope before pinning any index", async () => {
        const globals = Array.from({ length: 17 }, (_, index) =>
            Asset.create({
                name: `global-knowledge-${String(index).padStart(2, "0")}`,
                ownerId: "builtin-docs",
                ownerType: "organization",
                category: "knowledge",
                visibility: "public",
                metadata: { knowledge: { globalDomain: `domain-${index}` } },
            }),
        );
        const repository = {
            findById: jest.fn(async (id: string) => globals.find((asset) => asset.id === id) ?? null),
            listGlobalKnowledge: jest.fn(async () => globals.slice().reverse()),
            save: jest.fn(async () => undefined),
        } as unknown as IAssetRepository;
        const assets = new AssetServiceImpl(repository);
        const ingestion = new KnowledgeIngestionService(assets);
        const manifest = jest.spyOn(ingestion, "getManifest");
        const knowledge = new KnowledgeQueryService(assets, ingestion);

        await expect(knowledge.searchScope("global", "user-1", "cross domain marker", 8)).rejects.toThrow(
            "超过单次跨域检索上限 16",
        );
        expect(manifest).not.toHaveBeenCalled();
    });
});
