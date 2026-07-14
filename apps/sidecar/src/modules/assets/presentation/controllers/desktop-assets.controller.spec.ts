import { createHash } from "node:crypto";
import JSZip = require("jszip");
import { AssetServiceImpl } from "../../application/asset.service";
import { KnowledgeQueryService } from "../../application/knowledge-query.service";
import { KnowledgeIngestionService } from "../../application/knowledge-ingestion.service";
import { Asset } from "../../domain/entities/asset.entity";
import type { IAssetRepository } from "../../domain/repositories/asset.repository.interface";
import { DesktopAssetsController } from "./desktop-assets.controller";

function createHarness(metadata: Record<string, unknown> = {}) {
	const asset = Asset.create({
		name: "personal-knowledge",
		ownerId: "user-1",
		ownerType: "user",
		category: "knowledge",
		visibility: "private",
		metadata,
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
	const service = new AssetServiceImpl(repository);
	const ingestion = new KnowledgeIngestionService(service);
	const knowledge = new KnowledgeQueryService(service, ingestion);
	return {
		asset,
		repository,
		service,
		ingestion,
		knowledge,
		controller: new DesktopAssetsController(service, ingestion, knowledge),
	};
}

describe("DesktopAssetsController knowledge safety", () => {
	it("hides internal snapshot, trash, and derived-index paths from every repository tree level", async () => {
		const { asset, controller, service } = createHarness();
		await service.updateBlob(asset.id, "wiki/page.md", "# Visible", "Add page", "main");
		await service.updateBlob(asset.id, "wiki/.shuan-os-snapshots/page/manifest.json", "[]", "Snapshot", "main");
		await service.updateBlob(asset.id, ".shuan-os-trash/page.md", "# Trashed", "Trash", "main");
		await service.updateBlob(asset.id, ".internshannon/knowledge/index/manifest.json", "{}", "Index", "main");

		const root = await controller.repositoryTree(asset.id);
		const wiki = await controller.repositoryTree(asset.id, undefined, "wiki");

		expect(root.items.map((item) => item.path)).not.toEqual(
			expect.arrayContaining([".internshannon", ".shuan-os-trash"]),
		);
		expect(wiki.items.map((item) => item.path)).toEqual(["wiki/page.md"]);
	});

	it("round-trips uploaded binary source bytes without UTF-8 decoding", async () => {
		const { asset, controller } = createHarness();
		const original = Buffer.from([
			0x00, 0xff, 0xfe, 0x25, 0x50, 0x44, 0x46, 0x0a,
		]);

		const uploaded = await controller.uploadWikiSources(asset.id, {
			sources: [
				{ name: "sample.pdf", contentBase64: original.toString("base64") },
			],
		});
		const stored = await controller.repositoryBlob(
			asset.id,
			"raw/sources/sample.pdf",
		);

		expect(uploaded.paths).toEqual(["raw/sources/sample.pdf"]);
		expect(stored.encoding).toBe("base64");
		expect(stored.isBinary).toBe(true);
		expect(stored.mime).toBe("application/pdf");
		expect(stored.size).toBe(original.byteLength);
		expect(stored.contentSha).toBe(
			createHash("sha1").update(original).digest("hex"),
		);
		expect(Buffer.from(stored.content, "base64")).toEqual(original);
		expect(asset.blobs[0]).toMatchObject({
			path: "raw/sources/sample.pdf",
			size: original.byteLength,
			isBinary: true,
		});
	});

	it("stores text sources as UTF-8 and opens legacy base64 text sources compatibly", async () => {
		const { asset, controller, service } = createHarness();
		const text = "客户沟通检查点 BQ-7429";
		await controller.uploadWikiSources(asset.id, {
			sources: [{ name: "plan.txt", contentBase64: Buffer.from(text).toString("base64") }],
		});
		expect(await controller.repositoryBlob(asset.id, "raw/sources/plan.txt")).toMatchObject({
			encoding: "utf8",
			content: text,
			isBinary: false,
			mime: "text/plain",
		});

		await service.updateBlobBinary(asset.id, "raw/sources/legacy.txt", Buffer.from(text), "Legacy upload", "main");
		expect(await controller.repositoryBlob(asset.id, "raw/sources/legacy.txt")).toMatchObject({
			encoding: "utf8",
			content: text,
			isBinary: false,
		});
	});

	it("keeps binary encoding metadata through rename and removes it on delete", async () => {
		const { asset, controller, service } = createHarness();
		const original = Buffer.from([0x00, 0x01, 0xfe, 0xff]);
		await service.updateBlobBinary(
			asset.id,
			"raw/sources/a.bin",
			original,
			"Import a.bin",
			"main",
		);

		await service.renameBlob(
			asset.id,
			"raw/sources/a.bin",
			"raw/sources/b.bin",
			"Rename",
			"main",
		);
		const renamed = await service.getBlobData(asset.id, "raw/sources/b.bin");
		expect(renamed.encoding).toBe("base64");
		expect(Buffer.from(renamed.content, "base64")).toEqual(original);
		await expect(
			service.getBlobContent(asset.id, "raw/sources/b.bin"),
		).rejects.toThrow("二进制文件不能作为 UTF-8 文本读取");

		await controller.deleteWikiSource(asset.id, "raw/sources/b.bin");
		expect(
			(asset.metadata?.blobEncodings as Record<string, string>)[
				"raw/sources/b.bin"
			],
		).toBeUndefined();
		await expect(
			service.getBlobData(asset.id, "raw/sources/b.bin"),
		).rejects.toThrow();
	});

	it("accepts base64 repository updates used by asset Office editors", async () => {
		const { asset, controller } = createHarness();
		const original = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0xff]);

		await controller.updateBlob(asset.id, "raw/sources/report.docx", {
			content: original.toString("base64"),
			encoding: "base64",
			message: "Edit report.docx",
			branch: "main",
		});
		const stored = await controller.repositoryBlob(
			asset.id,
			"raw/sources/report.docx",
		);

		expect(stored.encoding).toBe("base64");
		expect(stored.mime).toBe(
			"application/vnd.openxmlformats-officedocument.wordprocessingml.document",
		);
		expect(Buffer.from(stored.content, "base64")).toEqual(original);
	});

	it("reports resolved links, broken links, and true orphan pages", async () => {
		const { asset, controller } = createHarness({
			blobContents: {
				"wiki/index.md": "# Index\n",
				"wiki/a.md":
					"---\ntitle: A\ntype: concept\n---\n\nSee [[B]] and [[Missing]].\n",
				"wiki/b.md": "---\ntitle: B\ntype: concept\n---\n\nBody.\n",
			},
		});

		const health = await controller.wikiHealth(asset.id);
		const reindex = await controller.wikiReindex(asset.id);

		expect(health.brokenLinks).toEqual([
			{ srcPath: "wiki/a.md", srcTitle: "A", target: "Missing" },
		]);
		expect(health.orphanPages).toEqual([
			{ path: "wiki/a.md", title: "A", type: "concept" },
		]);
		expect(health.ingestedSourceCount).toBe(0);
		expect(health.lastIngestedAt).toBeNull();
		expect(reindex).toMatchObject({
			nodeCount: 3,
			linkCount: 1,
			brokenLinkCount: 1,
		});
	});

	it("imports, validates, and exports an OKF ZIP without rewriting extensions", async () => {
		const { asset, controller, service } = createHarness();
		const concept = [
			"---",
			"type: Playbook",
			"title: Incident response",
			"producer_extension:",
			"  owner: platform",
			"---",
			"",
			"See [metrics](../metrics/revenue.md).",
		].join("\n");
		const archive = new JSZip();
		archive.file(
			"example/index.md",
			'---\nokf_version: "0.1"\n---\n\n# Example\n',
		);
		archive.file("example/playbooks/incident.md", concept);
		archive.file(
			"example/metrics/revenue.md",
			"---\ntype: Metric\ntitle: Revenue\n---\n\n# Revenue\n",
		);

		const imported = await controller.importOkf(asset.id, {
			archiveBase64: await archive.generateAsync({ type: "base64" }),
		});
		const validation = await controller.validateOkf(asset.id);
		const exported = await controller.exportOkf(asset.id);
		const exportedArchive = await JSZip.loadAsync(
			Buffer.from(exported.contentBase64, "base64"),
		);

		expect(imported.imported).toBe(3);
		expect(validation.valid).toBe(true);
		expect(validation.concepts).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					conceptId: "playbooks/incident",
					extensions: { producer_extension: { owner: "platform" } },
				}),
			]),
		);
		expect(
			await service.getBlobContent(asset.id, "wiki/playbooks/incident.md"),
		).toBe(concept);
		expect(
			await exportedArchive.file("playbooks/incident.md")?.async("string"),
		).toBe(concept);
		expect(exported.filename).toBe("personal-knowledge.okf.zip");
	});

	it("includes standard OKF Markdown links in the graph", async () => {
		const { asset, controller } = createHarness({
			blobContents: {
				"wiki/tables/orders.md":
					"---\ntype: BigQuery Table\ntitle: Orders\n---\n\nSee [customers](/tables/customers.md).\n",
				"wiki/tables/customers.md":
					"---\ntype: BigQuery Table\ntitle: Customers\n---\n\n# Customers\n",
			},
		});

		const graph = await controller.wikiGraph(asset.id);

		expect(graph.edges).toEqual([
			expect.objectContaining({
				source: "wiki/tables/orders.md",
				target: "wiki/tables/customers.md",
			}),
		]);
	});

	it("keeps semantic link suggestions review-only and audits accept/reject decisions", async () => {
		const { asset, controller, service } = createHarness({
			blobContents: {
				"wiki/a.md":
					"---\ntype: Note\ntitle: Revenue plan\n---\n\nMonthly revenue renewal plan.\n",
				"wiki/b.md":
					"---\ntype: Note\ntitle: Income forecast\n---\n\nMonthly income subscription extension forecast.\n",
				"wiki/c.md":
					"---\ntype: Note\ntitle: Sales review\n---\n\nMonthly sales renewal review.\n",
			},
		});
		const original = await service.getBlobContent(asset.id, "wiki/a.md");

		const refreshed = await controller.refreshCurationSuggestions(asset.id);
		expect(refreshed.pendingCount).toBeGreaterThanOrEqual(2);
		expect(await service.getBlobContent(asset.id, "wiki/a.md")).toBe(original);

		const accepted = await controller.reviewCurationSuggestion(
			asset.id,
			refreshed.suggestions[0].id,
			"user-1",
			{ decision: "accept" },
		);
		const rejected = await controller.reviewCurationSuggestion(
			asset.id,
			refreshed.suggestions[1].id,
			"user-1",
			{ decision: "reject" },
		);

		expect(accepted.status).toBe("accepted");
		expect(rejected.status).toBe("rejected");
		expect(await service.getBlobContent(asset.id, accepted.sourcePath)).toContain(
			`](/${accepted.targetPath.replace(/^wiki\//, "")})`,
		);
		expect(asset.metadata?.knowledgeCurationAudit).toEqual([
			expect.objectContaining({
				action: "curation.rejected",
				actorId: "user-1",
			}),
			expect.objectContaining({
				action: "curation.accepted",
				actorId: "user-1",
			}),
		]);
		const refreshedAgain = await controller.refreshCurationSuggestions(asset.id);
		const refreshedAccepted = refreshedAgain.suggestions.find(
			(item) => item.id === accepted.id,
		);
		expect(refreshedAgain.suggestions).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ id: accepted.id, status: "accepted" }),
				expect.objectContaining({ id: rejected.id, status: "rejected" }),
			]),
		);
		expect(refreshedAccepted).toMatchObject({
			appliedText: accepted.appliedText,
			appliedContentSha: accepted.appliedContentSha,
			appliedMode: accepted.appliedMode,
		});

		const reverted = await controller.reviewCurationSuggestion(
			asset.id,
			accepted.id,
			"user-1",
			{ decision: "revert" },
		);
		expect(reverted.status).toBe("reverted");
		expect(await service.getBlobContent(asset.id, accepted.sourcePath)).toBe(
			original,
		);
	});

	it("reverts only the exact content applied by an accepted curation suggestion", async () => {
		const { asset, controller, service } = createHarness({
			blobContents: {
				"wiki/a.md": "---\ntype: Note\ntitle: Revenue plan\n---\n\nMonthly revenue renewal plan.\n",
				"wiki/b.md": "---\ntype: Note\ntitle: Income forecast\n---\n\nMonthly income subscription extension forecast.\n",
			},
		});
		const original = await service.getBlobContent(asset.id, "wiki/a.md");
		const refreshed = await controller.refreshCurationSuggestions(asset.id);
		const suggestion = refreshed.suggestions[0];

		await controller.reviewCurationSuggestion(asset.id, suggestion.id, "user-1", { decision: "accept" });
		const reverted = await controller.reviewCurationSuggestion(asset.id, suggestion.id, "user-1", { decision: "revert" });

		expect(reverted.status).toBe("reverted");
		expect(await service.getBlobContent(asset.id, "wiki/a.md")).toBe(original);
	});

	it("rejects append reverts after a later page edit and preserves user content", async () => {
		const { asset, controller, service } = createHarness({
			blobContents: {
				"wiki/a.md": "---\ntype: Note\ntitle: Revenue plan\n---\n\nMonthly revenue renewal plan.\n",
				"wiki/b.md": "---\ntype: Note\ntitle: Income forecast\n---\n\nMonthly income subscription extension forecast.\n",
			},
		});
		const original = await service.getBlobContent(asset.id, "wiki/a.md");
		const refreshed = await controller.refreshCurationSuggestions(asset.id);
		const suggestion = refreshed.suggestions.find((item) => item.kind === "link" && item.sourcePath === "wiki/a.md");
		expect(suggestion).toBeDefined();

		const accepted = await controller.reviewCurationSuggestion(asset.id, suggestion?.id ?? "", "user-1", { decision: "accept" });
		const laterContent = "\n\n## Manual note\n\nKeep this user-authored text.\n";
		await service.updateBlob(
			asset.id,
			accepted.sourcePath,
			`${await service.getBlobContent(asset.id, accepted.sourcePath)}${laterContent}`,
			"Manual edit",
			"main",
		);

		await expect(
			controller.reviewCurationSuggestion(asset.id, accepted.id, "user-1", { decision: "revert" }),
		).rejects.toThrow("页面在接受建议后已发生变化");
		expect(await service.getBlobContent(asset.id, accepted.sourcePath)).toBe(
			`${original}${accepted.appliedText}${laterContent}`,
		);
	});

	it("returns a still-valid reverted suggestion to pending on refresh", async () => {
		const { asset, controller } = createHarness({
			blobContents: {
				"wiki/a.md": "---\ntype: Note\ntitle: Revenue plan\n---\n\nMonthly revenue renewal plan.\n",
				"wiki/b.md": "---\ntype: Note\ntitle: Income forecast\n---\n\nMonthly income subscription extension forecast.\n",
			},
		});
		const refreshed = await controller.refreshCurationSuggestions(asset.id);
		const suggestion = refreshed.suggestions.find((item) => item.kind === "link");
		expect(suggestion).toBeDefined();

		const accepted = await controller.reviewCurationSuggestion(asset.id, suggestion?.id ?? "", "user-1", {
			decision: "accept",
		});
		await controller.reviewCurationSuggestion(asset.id, accepted.id, "user-1", { decision: "revert" });

		const refreshedAgain = await controller.refreshCurationSuggestions(asset.id);
		const pendingAgain = refreshedAgain.suggestions.find((item) => item.id === accepted.id);
		expect(pendingAgain).toMatchObject({ id: accepted.id, status: "pending" });
		expect(refreshedAgain.suggestions.some((item) => item.status === "reverted")).toBe(false);
		expect(pendingAgain).not.toHaveProperty("appliedText");
		expect(pendingAgain).not.toHaveProperty("appliedContentSha");
		expect(pendingAgain).not.toHaveProperty("appliedMode");
	});

	it("excludes generated and draft pages from curation and drops stale pending recursion", async () => {
		const stalePending = {
			id: "stale-recursive-link",
			kind: "link",
			status: "pending",
			sourcePath: "wiki/generated/source.md",
			targetPath: "wiki/drafts/merge-old.md",
			targetTitle: "Old merge",
			reason: "old recursive suggestion",
			similarity: 1,
			createdAt: "2026-01-01T00:00:00.000Z",
		};
		const reviewedHistory = { ...stalePending, id: "reviewed-history", status: "rejected" };
		const { asset, controller } = createHarness({
			knowledgeCurationSuggestions: [stalePending, reviewedHistory],
			blobContents: {
				"wiki/source.md": "---\ntype: Note\ntitle: Source\n---\n\nA sufficiently long normal knowledge page used for curation summary generation and semantic comparisons.\n",
				"wiki/generated/source.md": "---\ntype: Draft\ntitle: Generated\ntags: [generated, review-required]\n---\n\nGenerated content must not feed another curation cycle.\n",
				"wiki/drafts/merge-old.md": "---\ntype: Draft\ntitle: Merge review\ntags: [merge-proposal, review-required]\n---\n\nDraft content must not feed another curation cycle.\n",
			},
		});

		const refreshed = await controller.refreshCurationSuggestions(asset.id);
		expect(refreshed.suggestions).not.toEqual(expect.arrayContaining([expect.objectContaining({ id: stalePending.id })]));
		expect(refreshed.suggestions).toEqual(expect.arrayContaining([expect.objectContaining({ id: reviewedHistory.id, status: "rejected" })]));
		expect(refreshed.suggestions.filter((item) => item.status === "pending").every((item) => !item.sourcePath.startsWith("wiki/generated/") && !item.sourcePath.startsWith("wiki/drafts/"))).toBe(true);
	});

	it("keeps source-to-OKF page generation review-only and supports exact revert", async () => {
		const { asset, controller, service, ingestion } = createHarness();
		await service.updateBlob(
			asset.id,
			"raw/sources/launch-notes.txt",
			"The launch playbook requires a readiness review, owner approval, rollback validation, and a customer communication checkpoint.",
			"Add source",
			"main",
		);
		await ingestion.reindex(asset.id);

		const refreshed = await controller.refreshCurationSuggestions(asset.id);
		const proposal = refreshed.suggestions.find((item) => item.kind === "page");
		expect(proposal).toBeDefined();
		await expect(service.getBlobContent(asset.id, proposal?.targetPath ?? "")).rejects.toThrow();

		const accepted = await controller.reviewCurationSuggestion(asset.id, proposal?.id ?? "", "user-1", {
			decision: "accept",
		});
		expect(accepted).toMatchObject({ status: "accepted", appliedMode: "create" });
		expect(await service.getBlobContent(asset.id, accepted.targetPath)).toContain(
			`asset://${asset.id}/raw/sources/launch-notes.txt`,
		);

		await controller.reviewCurationSuggestion(asset.id, accepted.id, "user-1", { decision: "revert" });
		await expect(service.getBlobContent(asset.id, accepted.targetPath)).rejects.toThrow();
	});

	it("adds source-concept edges, communities, and graph filters from OKF frontmatter", async () => {
		const { asset, controller } = createHarness({
			blobContents: {
				"raw/sources/policy.txt": "Policy source",
				"wiki/policy.md": [
					"---",
					"type: Policy",
					"title: Retention Policy",
					"tags: [governance]",
					"sources: [raw/sources/policy.txt]",
					"---",
					"",
					"Policy body.",
				].join("\n"),
			},
		});

		const graph = await controller.wikiGraph(asset.id);

		expect(graph.nodes).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ path: "wiki/policy.md", community: expect.any(Number), tags: ["governance"] }),
				expect.objectContaining({ path: "raw/sources/policy.txt", kind: "source" }),
			]),
		);
		expect(graph.edges).toEqual([
			expect.objectContaining({ source: "raw/sources/policy.txt", target: "wiki/policy.md", kind: "source-concept" }),
		]);
		expect(graph.filters).toEqual(expect.objectContaining({ types: expect.arrayContaining(["Policy", "Source"]), tags: ["governance"] }));
	});
});
