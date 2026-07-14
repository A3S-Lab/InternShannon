import { Asset } from "../domain/entities/asset.entity";
import type { IAssetRepository } from "../domain/repositories/asset.repository.interface";
import { CapabilitiesToolService } from "../../kernel/application/capabilities-tool.service";
import type { IKernelService } from "../../kernel/domain/services/kernel-service.interface";
import { AssetServiceImpl } from "./asset.service";
import { KnowledgeQueryService } from "./knowledge-query.service";
import { KnowledgeIngestionService } from "./knowledge-ingestion.service";

function createKnowledgeHarness() {
	const asset = Asset.create({
		name: "personal-knowledge",
		ownerId: "user-1",
		ownerType: "user",
		category: "knowledge",
		visibility: "private",
		metadata: {
			knowledge: { personal: true },
			blobContents: {
				"wiki/index.md":
					'---\nokf_version: "0.1"\n---\n\n# Personal knowledge\n',
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
			},
		},
	});
	const repository = {
		findById: jest.fn(async (id: string) => (id === asset.id ? asset : null)),
		findPersonalKnowledge: jest.fn(async (ownerId: string) =>
			ownerId === asset.ownerId ? asset : null,
		),
		findGlobalKnowledgeByDomain: jest.fn(async () => null),
		listGlobalKnowledge: jest.fn(async () => []),
		save: jest.fn(async () => undefined),
	} as unknown as IAssetRepository;
	const assets = new AssetServiceImpl(repository);
	const ingestion = new KnowledgeIngestionService(assets);
	const knowledge = new KnowledgeQueryService(assets, ingestion);
	return { asset, assets, ingestion, knowledge };
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

	it("falls back to the concept resource or asset path when the page has no explicit citation", async () => {
		const { asset, knowledge } = createKnowledgeHarness();

		const result = await knowledge.searchAsset(asset.id, "incident freshness", 8);
		const incident = result.hits.find((hit) => hit.path === "wiki/playbooks/incident.md");
		const read = await knowledge.readConcept(asset.id, "playbooks/incident");

		expect(incident?.citations).toEqual([
			`asset://${asset.id}/wiki/playbooks/incident.md`,
		]);
		expect(read.citations).toEqual([
			`asset://${asset.id}/wiki/playbooks/incident.md`,
		]);
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
		const capabilities = new CapabilitiesToolService(
			kernel,
			assets,
			undefined,
			knowledge,
		);

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
		});

		const source = await knowledge.readItem(asset.id, hit?.conceptId ?? "");
		expect(source).toMatchObject({
			kind: "source",
			path: "raw/sources/quarterly-notes.txt",
		});
		expect(source.content).toContain("renewal conversion");

		const synonymResult = await knowledge.searchAsset(
			asset.id,
			"subscription extension",
		);
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

	it("returns semantically similar OKF concepts with a declared embedding model", async () => {
		const { asset, assets, knowledge } = createKnowledgeHarness();
		await assets.updateBlob(
			asset.id,
			"wiki/metrics/income.md",
			"---\ntype: Metric\ntitle: Income trend\n---\n\nMonthly income and subscription extension results.\n",
			"Add related concept",
			"main",
		);

		const result = await knowledge.findSimilarConcepts(
			asset.id,
			"metrics/revenue",
		);

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
});
