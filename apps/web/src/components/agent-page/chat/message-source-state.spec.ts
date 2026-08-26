import * as assert from "node:assert/strict";
import { test } from "node:test";
import {
	groupMessageSources,
	splitUniqueFileMentions,
} from "./message-source-state.ts";

test("renders one source card when resource and citations repeat the same knowledge file", () => {
	const segments = splitUniqueFileMentions(
		"resource:\nasset://personal-knowledge/raw/sources/renewal-freeze-plan.txt\n- citations:\nasset://personal-knowledge/raw/sources/renewal-freeze-plan.txt",
	);

	assert.equal(
		segments.filter((segment) => segment.type === "citation").length,
		1,
	);
	assert.equal(
		segments
			.filter((segment) => segment.type === "text")
			.map((segment) => segment.value)
			.join(""),
		"\n\n",
	);
});

test("hides resource field labels while preserving user-facing source headings", () => {
	const segments = splitUniqueFileMentions(
		"引用来源\nresource:\nasset://personal-knowledge/wiki/a.md",
	);

	assert.equal(
		segments
			.filter((segment) => segment.type === "text")
			.map((segment) => segment.value)
			.join(""),
		"引用来源\n",
	);
});

test("keeps distinct knowledge files independently openable", () => {
	const segments = splitUniqueFileMentions(
		"asset://personal-knowledge/wiki/a.md\nasset://personal-knowledge/wiki/b.md",
	);
	assert.deepEqual(
		segments
			.filter((segment) => segment.type === "citation")
			.map((segment) => segment.value),
		[
			"asset://personal-knowledge/wiki/a.md",
			"asset://personal-knowledge/wiki/b.md",
		],
	);
});

test("isolates malformed single-slash asset links so the UI can fail closed", () => {
	const segments = splitUniqueFileMentions(
		"来源 asset:/raw/sources/route_edges.csv。",
	);
	assert.deepEqual(
		segments
			.filter((segment) => segment.type === "citation")
			.map((segment) => segment.value),
		["asset:/raw/sources/route_edges.csv"],
	);
});

test("stops an asset citation before full-width Chinese prose punctuation", () => {
	const citation =
		"asset://b8f9cad0-5cc0-4510-9fa2-e5fc0f8a8ad9/raw/sources/02-建筑布局与分区说明.md";
	const firstAnswer = `- 02 建筑布局与分区说明.md（记录 ID：generated/02-建筑布局与分区说明，资源：${citation}）。文中“建筑概况”明确写明“层数：地上 12 层、地下 2 层”。`;
	const repeatedAnswer = `- 文件名：02 建筑布局与分区说明.md\n  - 资源：${citation}\n  - 摘要点：地上 12 层、地下 2 层`;

	for (const answer of [firstAnswer, repeatedAnswer]) {
		const citations = splitUniqueFileMentions(answer).filter(
			(segment) => segment.type === "citation",
		);
		assert.deepEqual(
			citations.map((segment) => segment.value),
			[citation],
		);
	}
});

test("stops asset citations at Markdown and common CJK delimiters", () => {
	const citation = "asset://personal-knowledge/wiki/a.md";
	for (const suffix of [
		"`",
		"）后文",
		"】后文",
		"。后文",
		"，后文",
		"；后文",
		"”后文",
		"、后文",
	]) {
		const citations = splitUniqueFileMentions(`${citation}${suffix}`).filter(
			(segment) => segment.type === "citation",
		);
		assert.deepEqual(
			citations.map((segment) => segment.value),
			[citation],
		);
	}
});

test("keeps record IDs visible while turning each source file into an openable card", () => {
	const answer = [
		"- route_edges.csv（记录 ID：E-F10-ES2，资源：asset://asset-1/raw/sources/route_edges.csv）",
		"- scenario_blockages.csv（记录 ID：BLK-S04-02，资源：asset://asset-1/raw/sources/scenario_blockages.csv）",
	].join("\n");
	const segments = splitUniqueFileMentions(answer);

	assert.deepEqual(
		segments
			.filter((segment) => segment.type === "citation")
			.map((segment) => segment.value),
		[
			"asset://asset-1/raw/sources/route_edges.csv",
			"asset://asset-1/raw/sources/scenario_blockages.csv",
		],
	);
	const visibleText = segments
		.filter((segment) => segment.type === "text")
		.map((segment) => segment.value)
		.join("");
	assert.match(visibleText, /记录 ID：E-F10-ES2/);
	assert.match(visibleText, /记录 ID：BLK-S04-02/);
});

test("removes paired wrappers around inline knowledge citations", () => {
	const answers = [
		"[floors.csv F04 asset://asset-1/raw/sources/floors.csv]",
		"(route_nodes.csv F04-AR asset://asset-1/raw/sources/route_nodes.csv)",
		"（fire_devices.csv DEV-CHAIR-F04-S2 asset://asset-1/raw/sources/fire_devices.csv）",
		"【occupants.csv OG-S04-02 asset://asset-1/raw/sources/occupants.csv】",
	].join("；");
	const segments = splitUniqueFileMentions(answers);

	assert.equal(
		segments.filter((segment) => segment.type === "citation").length,
		4,
	);
	const visibleText = segments
		.filter((segment) => segment.type === "text")
		.map((segment) => segment.value)
		.join("");
	assert.doesNotMatch(visibleText, /\[|\]|\(|\)|（|）|【|】/);
	assert.match(visibleText, /floors\.csv F04/);
	assert.match(visibleText, /route_nodes\.csv F04-AR/);
	assert.match(visibleText, /fire_devices\.csv DEV-CHAIR-F04-S2/);
	assert.match(visibleText, /occupants\.csv OG-S04-02/);
});

test("removes gtrgl2p citation brackets without hiding record IDs", () => {
	const answer = [
		"- 空间：无障碍等待区节点 F04-AR [02-建筑布局与分区说明.md 记录ID缺失 asset://asset-1/raw/sources/02-建筑布局与分区说明.md]; 节点存在性 [route_nodes.csv F04-AR asset://asset-1/raw/sources/route_nodes.csv]",
		"- 设备：疏散椅 DEV-CHAIR-F04-S2 [fire_devices.csv DEV-CHAIR-F04-S2 asset://asset-1/raw/sources/fire_devices.csv]",
	].join("\n");
	const segments = splitUniqueFileMentions(answer);

	assert.deepEqual(
		segments
			.filter((segment) => segment.type === "citation")
			.map((segment) => segment.value),
		[
			"asset://asset-1/raw/sources/02-建筑布局与分区说明.md",
			"asset://asset-1/raw/sources/route_nodes.csv",
			"asset://asset-1/raw/sources/fire_devices.csv",
		],
	);
	const visibleText = segments
		.filter((segment) => segment.type === "text")
		.map((segment) => segment.value)
		.join("");
	assert.doesNotMatch(visibleText, /(^|\n)\s*\]\s*($|\n|[；;。])/);
	assert.match(visibleText, /02-建筑布局与分区说明\.md 记录ID缺失/);
	assert.match(visibleText, /route_nodes\.csv F04-AR/);
	assert.match(visibleText, /fire_devices\.csv DEV-CHAIR-F04-S2/);
});

test("preserves unrelated and unmatched brackets", () => {
	const segments = splitUniqueFileMentions(
		"数组 [A, B]；来源 asset://asset-1/raw/sources/a.md。未配对 ] 保留",
	);
	const visibleText = segments
		.filter((segment) => segment.type === "text")
		.map((segment) => segment.value)
		.join("");

	assert.match(visibleText, /\[A, B\]/);
	assert.match(visibleText, /未配对 \] 保留/);
});

test("groups unique knowledge cards after one uninterrupted prose segment", () => {
	const first = "asset://asset-1/raw/sources/route_edges.csv";
	const second = "asset://asset-1/raw/sources/scenario_blockages.csv";
	const grouped = groupMessageSources(
		`路线边（route_edges.csv + E-F10-ES2；${first}）与覆盖记录（scenario_blockages.csv + BLK-S04-02；${second}）均已核对。`,
	);

	assert.deepEqual(
		grouped.citations.map((segment) => segment.value),
		[first, second],
	);
	assert.equal(grouped.contentSegments.length, 1);
	assert.equal(grouped.contentSegments[0]?.type, "text");
	assert.match(
		grouped.contentSegments[0]?.value ?? "",
		/route_edges\.csv \+ E-F10-ES2/,
	);
	assert.match(
		grouped.contentSegments[0]?.value ?? "",
		/scenario_blockages\.csv \+ BLK-S04-02/,
	);
});

test("repairs a shortened legacy citation only from one unique full citation in the same answer", () => {
	const full = "asset://asset-1/raw/sources/orders.csv";
	const grouped = groupMessageSources(
		`${full}\nasset://…/orders.csv\nasset://…/orders.csv`,
	);
	assert.deepEqual(
		grouped.citations.map((segment) => segment.value),
		[full],
	);
});

test("keeps an ambiguous shortened legacy citation unverified instead of guessing an asset", () => {
	const grouped = groupMessageSources(
		"asset://asset-1/raw/sources/shared.csv\nasset://asset-2/raw/sources/shared.csv\nasset://…/shared.csv",
	);
	assert.deepEqual(
		grouped.citations.map((segment) => segment.value),
		[
			"asset://asset-1/raw/sources/shared.csv",
			"asset://asset-2/raw/sources/shared.csv",
			"asset://…/shared.csv",
		],
	);
});
