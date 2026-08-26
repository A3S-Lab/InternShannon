import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
	acceptanceFixtureFingerprint,
	acceptanceNormalizedTurnsFingerprint,
	acceptanceQuestionScriptFingerprint,
	assertFireAcceptanceFixture,
	assertFireAcceptancePlan,
	assertFireAcceptanceQuestionScript,
	buildFireAcceptanceIsolatedConfig,
	classifyFireAcceptanceFailureCategories,
	discoverFireAcceptanceSources,
	evaluateD1Consistency,
	evaluateFireAcceptanceRound,
	FIRE_ACCEPTANCE_FIXTURE_FINGERPRINT,
	FIRE_ACCEPTANCE_MODEL,
	FIRE_ACCEPTANCE_NORMALIZED_TURNS_FINGERPRINT,
	FIRE_ACCEPTANCE_QUESTION_SCRIPT_SHA256,
	FIRE_ACCEPTANCE_SESSION_KEYS,
	FIRE_ACCEPTANCE_SOURCE_NAMES,
	FIRE_ACCEPTANCE_TURN_IDS,
	fireAcceptanceConfirmationDecision,
	parseFireAcceptanceKnowledgeLogLine,
	parseFireAcceptanceScript,
	selectFireAcceptanceKnowledgeLog,
	updateFireAcceptanceFailureCategoryCounts,
} from "./fire-evacuation-acceptance-contract.mjs";

const temporaryDirectories = [];
const REPO_ROOT = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	"../../..",
);
const FIRE_FIXTURE_ROOT = path.join(
	path.dirname(REPO_ROOT),
	"outputs/fire-simulation-20260728",
);
const QUESTION_SCRIPT = path.join(
	FIRE_FIXTURE_ROOT,
	"测试控制-不要导入知识库/01-会话问题脚本.md",
);
const KNOWLEDGE_FIXTURE = path.join(FIRE_FIXTURE_ROOT, "导入知识库");

afterEach(() => {
	for (const directory of temporaryDirectories.splice(0)) {
		fs.rmSync(directory, { recursive: true, force: true });
	}
});

function makeTemporaryDirectory() {
	const directory = fs.mkdtempSync(
		path.join(os.tmpdir(), "fire-acceptance-contract."),
	);
	temporaryDirectories.push(directory);
	return directory;
}

function writeFixture(directory, names = FIRE_ACCEPTANCE_SOURCE_NAMES) {
	for (const [index, name] of names.entries()) {
		fs.writeFileSync(path.join(directory, name), `fixture-${index}-${name}\n`);
	}
}

describe("fire evacuation acceptance script contract", () => {
	it("parses quote prompts and allocates each D-1 repetition to a fresh session", () => {
		const turns = parseFireAcceptanceScript(`
## 会话 0
### 0-1 初始检查
> 请检查知识库。

## 可选加测
### D-1 重复一致性
1. “第一次”
2. “第二次”
3. “第三次”

### D-2 跨文件
> 请跨文件检查。
`);

		assert.deepEqual(
			turns.map(({ id, sessionKey, prompt }) => ({ id, sessionKey, prompt })),
			[
				{ id: "0-1", sessionKey: "0", prompt: "请检查知识库。" },
				{ id: "D-1.1", sessionKey: "D-1.1", prompt: "第一次" },
				{ id: "D-1.2", sessionKey: "D-1.2", prompt: "第二次" },
				{ id: "D-1.3", sessionKey: "D-1.3", prompt: "第三次" },
				{ id: "D-2", sessionKey: "D-2", prompt: "请跨文件检查。" },
			],
		);
	});

	it("locks the checked-in 01 script to 28 turns and 9 sessions when the fixture is present", (context) => {
		if (!fs.existsSync(QUESTION_SCRIPT)) {
			context.skip(`workspace fixture is absent: ${QUESTION_SCRIPT}`);
			return;
		}
		const scriptBytes = fs.readFileSync(QUESTION_SCRIPT);
		const turns = assertFireAcceptanceQuestionScript(scriptBytes);

		assert.deepEqual(
			turns.map((turn) => turn.id),
			FIRE_ACCEPTANCE_TURN_IDS,
		);
		assert.deepEqual(
			[...new Set(turns.map((turn) => turn.sessionKey))],
			FIRE_ACCEPTANCE_SESSION_KEYS,
		);
		assert.equal(
			acceptanceQuestionScriptFingerprint(scriptBytes),
			FIRE_ACCEPTANCE_QUESTION_SCRIPT_SHA256,
		);
		assert.equal(
			acceptanceNormalizedTurnsFingerprint(turns),
			FIRE_ACCEPTANCE_NORMALIZED_TURNS_FINGERPRINT,
		);
	});

	it("rejects changed question text even when all 28 turn and 9 session identifiers remain unchanged", (context) => {
		if (!fs.existsSync(QUESTION_SCRIPT)) {
			context.skip(`workspace fixture is absent: ${QUESTION_SCRIPT}`);
			return;
		}
		const turns = parseFireAcceptanceScript(
			fs.readFileSync(QUESTION_SCRIPT, "utf8"),
		);
		const changed = turns.map((turn) =>
			turn.id === "A-2"
				? { ...turn, prompt: `${turn.prompt}\n这是未批准的问题漂移。` }
				: turn,
		);

		assert.deepEqual(
			changed.map((turn) => turn.id),
			FIRE_ACCEPTANCE_TURN_IDS,
		);
		assert.deepEqual(
			[...new Set(changed.map((turn) => turn.sessionKey))],
			FIRE_ACCEPTANCE_SESSION_KEYS,
		);
		assert.throws(
			() => assertFireAcceptancePlan(changed),
			/normalized 28-turn fingerprint changed/u,
		);
	});

	it("rejects raw 01 script byte drift even when normalized prompts are unchanged", (context) => {
		if (!fs.existsSync(QUESTION_SCRIPT)) {
			context.skip(`workspace fixture is absent: ${QUESTION_SCRIPT}`);
			return;
		}
		const original = fs.readFileSync(QUESTION_SCRIPT, "utf8");
		const changed = `${original}\n<!-- unapproved acceptance note -->\n`;
		assert.equal(
			acceptanceNormalizedTurnsFingerprint(parseFireAcceptanceScript(changed)),
			FIRE_ACCEPTANCE_NORMALIZED_TURNS_FINGERPRINT,
		);
		assert.throws(
			() => assertFireAcceptanceQuestionScript(changed),
			/01 script file SHA-256 changed/u,
		);
	});

	it("rejects a changed or incomplete 01 script", () => {
		assert.throws(
			() =>
				assertFireAcceptancePlan([
					{ id: "0-1", sessionKey: "0", prompt: "only one turn" },
				]),
			/01 script turn contract changed/u,
		);
	});
});

describe("isolated 14-source fixture contract", () => {
	it("discovers only the required sources and produces a stable content fingerprint", () => {
		const directory = makeTemporaryDirectory();
		writeFixture(directory);
		fs.writeFileSync(path.join(directory, ".DS_Store"), "ignored");
		fs.writeFileSync(
			path.join(directory, "operator-notes.txt"),
			"not imported",
		);

		const first = discoverFireAcceptanceSources(directory);
		const second = discoverFireAcceptanceSources(directory);

		assert.deepEqual(
			first.map((source) => source.name),
			FIRE_ACCEPTANCE_SOURCE_NAMES,
		);
		assert.equal(first.length, 14);
		assert.equal(
			acceptanceFixtureFingerprint(first),
			acceptanceFixtureFingerprint(second),
		);
	});

	it("locks the approved 14 source bodies and rejects same-name content drift", (context) => {
		if (!fs.existsSync(KNOWLEDGE_FIXTURE)) {
			context.skip(`workspace fixture is absent: ${KNOWLEDGE_FIXTURE}`);
			return;
		}
		const sources = discoverFireAcceptanceSources(KNOWLEDGE_FIXTURE);
		assert.equal(
			acceptanceFixtureFingerprint(sources),
			FIRE_ACCEPTANCE_FIXTURE_FINGERPRINT,
		);
		assert.equal(assertFireAcceptanceFixture(sources), sources);

		const changed = sources.map((source, index) =>
			index === 0 ? { ...source, sha256: "0".repeat(64) } : source,
		);
		assert.deepEqual(
			changed.map((source) => source.name),
			FIRE_ACCEPTANCE_SOURCE_NAMES,
		);
		assert.throws(
			() => assertFireAcceptanceFixture(changed),
			/14-source content fingerprint changed/u,
		);
	});

	it("rejects missing, extra, and duplicate knowledge source basenames", () => {
		const missing = makeTemporaryDirectory();
		writeFixture(missing, FIRE_ACCEPTANCE_SOURCE_NAMES.slice(1));
		assert.throws(
			() => discoverFireAcceptanceSources(missing),
			/must contain only the required 14 sources/u,
		);

		const extra = makeTemporaryDirectory();
		writeFixture(extra);
		fs.writeFileSync(path.join(extra, "unexpected.md"), "unexpected\n");
		assert.throws(
			() => discoverFireAcceptanceSources(extra),
			/must contain only the required 14 sources/u,
		);

		const duplicate = makeTemporaryDirectory();
		writeFixture(duplicate);
		fs.mkdirSync(path.join(duplicate, "nested"));
		fs.copyFileSync(
			path.join(duplicate, FIRE_ACCEPTANCE_SOURCE_NAMES[0]),
			path.join(duplicate, "nested", FIRE_ACCEPTANCE_SOURCE_NAMES[0]),
		);
		assert.throws(
			() => discoverFireAcceptanceSources(duplicate),
			/duplicate basename/u,
		);
	});
});

describe("isolated provider configuration", () => {
	it("copies only boyue/gpt-5 and explicitly disables MCP and search", () => {
		const isolated = buildFireAcceptanceIsolatedConfig({
			"config/app/llm": JSON.stringify({
				defaultModel: "zhipu/other",
				mcpServers: [{ name: "remote-danger" }],
				providers: [
					{
						name: "zhipu",
						apiKey: "unrelated-provider-secret",
						models: [{ id: "other", apiKey: "unrelated-model-secret" }],
					},
					{
						name: "boyue",
						apiKey: "required-boyue-secret",
						baseUrl: "https://boyue.example/v1",
						headers: { "X-Required": "association" },
						models: [
							{ id: "other-boyue", apiKey: "unrelated-boyue-secret" },
							{
								id: "gpt-5",
								name: "GPT-5",
								family: "gpt",
								toolCall: true,
								limit: { context: 400000, output: 32000 },
							},
						],
					},
				],
			}),
			"config/app/oauth": JSON.stringify({ secret: "oauth-secret" }),
		});

		assert.deepEqual(Object.keys(isolated).sort(), [
			"config/app/assistant",
			"config/app/llm",
			"config/app/search",
		]);
		const serialized = JSON.stringify(isolated);
		assert.equal(serialized.includes("unrelated-provider-secret"), false);
		assert.equal(serialized.includes("unrelated-model-secret"), false);
		assert.equal(serialized.includes("unrelated-boyue-secret"), false);
		assert.equal(serialized.includes("oauth-secret"), false);
		const llm = JSON.parse(isolated["config/app/llm"]);
		assert.equal(llm.defaultModel, FIRE_ACCEPTANCE_MODEL);
		assert.deepEqual(llm.mcpServers, []);
		assert.deepEqual(
			llm.providers.map((provider) => provider.name),
			["boyue"],
		);
		assert.deepEqual(
			llm.providers[0].models.map((model) => model.id),
			["gpt-5"],
		);
		assert.deepEqual(
			JSON.parse(isolated["config/app/search"]).enabledEngines,
			[],
		);
		assert.deepEqual(
			JSON.parse(isolated["config/app/assistant"]).mcpServers,
			[],
		);
	});

	it("fails without the exact fixed model credential", () => {
		assert.throws(
			() =>
				buildFireAcceptanceIsolatedConfig({
					"config/app/llm": JSON.stringify({
						providers: [{ name: "boyue", models: [{ id: "gpt-5" }] }],
					}),
				}),
			/has no configured credential/u,
		);
	});
});

describe("acceptance confirmation policy", () => {
	it("approves knowledge tools and one exact configured Skill per session", () => {
		const approvedSkillNames = new Set();
		assert.deepEqual(
			fireAcceptanceConfirmationDecision({
				toolName: "mcp__internshannon__knowledge_search",
				approvedSkillNames,
			}),
			{ approved: true, kind: "knowledge" },
		);
		assert.deepEqual(
			fireAcceptanceConfirmationDecision({
				toolName: "Skill",
				toolInput: JSON.stringify({ input: { skill_name: "record-audit" } }),
				configuredSkills: ["record-audit"],
				approvedSkillNames,
			}),
			{ approved: true, kind: "configured_skill", skillName: "record-audit" },
		);
		assert.deepEqual(
			fireAcceptanceConfirmationDecision({
				toolName: "Skill",
				toolInput: { skillName: "record-audit" },
				configuredSkills: ["record-audit"],
				approvedSkillNames,
			}),
			{ approved: false, kind: "denied", skillName: "record-audit" },
		);
	});

	it("never approves an unconfigured Skill or delegated task", () => {
		assert.equal(
			fireAcceptanceConfirmationDecision({
				toolName: "Skill",
				toolInput: { skill_name: "other-skill" },
				configuredSkills: ["record-audit"],
			}).approved,
			false,
		);
		assert.equal(
			fireAcceptanceConfirmationDecision({
				toolName: "task",
				configuredSkills: ["record-audit"],
			}).approved,
			false,
		);
	});
});

describe("per-turn knowledge finalization log window", () => {
	it("selects only entries emitted after the current turn boundary", () => {
		const encodedSamples = encodeURIComponent(
			JSON.stringify([
				{
					reason: "malformed_handle",
					citation: "[[K2]",
					sourcePath: "raw/sources/orders.csv",
				},
			]),
		);
		const previous = parseFireAcceptanceKnowledgeLogLine(
			"[kernel.knowledge.sources] sessionId=session-a protocol=1 sources=2 unverified=0",
		);
		const current = parseFireAcceptanceKnowledgeLogLine(
			`[kernel.knowledge.sources] sessionId=session-a protocol=1 sources=3 unverified=3 rejectedReasons=malformed_handle:2,unsupported_locator:1 rejectedSamples=${encodedSamples}`,
		);
		const other = parseFireAcceptanceKnowledgeLogLine(
			"[kernel.knowledge.sources] sessionId=session-b protocol=1 sources=9 unverified=0",
		);
		const selected = selectFireAcceptanceKnowledgeLog(
			[
				{ sequence: 1, ...previous },
				{ sequence: 2, ...other },
				{ sequence: 3, ...current },
			],
			"session-a",
			1,
		);

		assert.equal(selected.count, 1);
		assert.equal(selected.latest.unverifiedCitationCount, 3);
		assert.deepEqual(selected.latest.rejectionReasons, {
			malformed_handle: 2,
			unsupported_locator: 1,
		});
		assert.deepEqual(selected.latest.rejectionSamples, [
			{
				reason: "malformed_handle",
				citation: "[[K2]",
				sourcePath: "raw/sources/orders.csv",
			},
		]);
		assert.equal(
			selectFireAcceptanceKnowledgeLog(
				[{ sequence: 1, ...previous }],
				"session-a",
				1,
			).latest,
			null,
		);
	});

	it("correlates finalization logs to the current run instead of a late prior turn", () => {
		const late = parseFireAcceptanceKnowledgeLogLine(
			"[kernel.knowledge.sources] sessionId=session-a runId=run-old protocol=1 sources=8 unverified=0",
		);
		const current = parseFireAcceptanceKnowledgeLogLine(
			"[kernel.knowledge.sources] sessionId=session-a runId=run-current protocol=1 sources=4 unverified=0",
		);
		const selected = selectFireAcceptanceKnowledgeLog(
			[
				{ sequence: 2, ...late },
				{ sequence: 3, ...current },
			],
			"session-a",
			1,
			"run-current",
		);
		assert.equal(selected.count, 1);
		assert.equal(selected.latest.sourceCount, 4);
	});

	it("decodes rejected samples before a colorized ANSI suffix", () => {
		const samples = [
			{
				reason: "unsupported_locator",
				citation: "[[K7#record=E-01]]",
			},
		];
		const parsed = parseFireAcceptanceKnowledgeLogLine(
			`[kernel.knowledge.sources] sessionId=session-a runId=run-a sources=1 unverified=1 rejectedReasons=unsupported_locator:1 rejectedSamples=${encodeURIComponent(JSON.stringify(samples))}\u001b[39m`,
		);
		assert.deepEqual(parsed.rejectionSamples, samples);
	});
});

describe("paid acceptance failure fuse categories", () => {
	it("counts content, coverage, and citation rounds independently", () => {
		let state = updateFireAcceptanceFailureCategoryCounts({
			counts: undefined,
			failures: [
				{ id: "run-succeeded" },
				{ id: "no-unverified-marker" },
				{ id: "verified-citation-log" },
			],
			limit: 2,
		});
		assert.deepEqual(state.categories, ["content", "citation"]);
		assert.deepEqual(state.counts, {
			content: 1,
			coverage: 0,
			citation: 1,
		});
		assert.equal(state.triggeredCategory, null);

		state = updateFireAcceptanceFailureCategoryCounts({
			counts: state.counts,
			failures: [{ id: "grounding-complete" }],
			limit: 2,
		});
		assert.deepEqual(state.categories, ["coverage"]);
		assert.deepEqual(state.counts, {
			content: 1,
			coverage: 1,
			citation: 1,
		});
		assert.equal(state.triggeredCategory, null);

		state = updateFireAcceptanceFailureCategoryCounts({
			counts: state.counts,
			failures: [
				{ id: "source-card:manual.md" },
				{ id: "no-unverified-marker" },
			],
			limit: 2,
		});
		assert.deepEqual(state.categories, ["citation"]);
		assert.equal(state.counts.citation, 2);
		assert.equal(state.triggeredCategory, "citation");
	});

	it("does not delay or categorize lifecycle failures", () => {
		assert.deepEqual(
			classifyFireAcceptanceFailureCategories([
				{ id: "run-id-correlated" },
				{ id: "persisted-run-pair" },
				{ id: "session-runtime-idle" },
				{ id: "no-lifecycle-error" },
				{ id: "turn-under-hard-time-limit" },
			]),
			[],
		);
	});
});

describe("automatic real-chain acceptance checks", () => {
	function passingRound(overrides = {}) {
		return {
			turn: { id: "0-6" },
			answer:
				"E-F10-ES2 被 BLK-S04-02 封锁，改由 F10-E 经 F10-S2，证据已核对。",
			toolNames: ["internshannon__knowledge_search"],
			sources: [
				{ relativePath: "raw/sources/route_edges.csv" },
				{ relativePath: "raw/sources/scenario_blockages.csv" },
			],
			resultStatus: "succeeded",
			modelBefore: FIRE_ACCEPTANCE_MODEL,
			modelAfter: FIRE_ACCEPTANCE_MODEL,
			followDefaultModelBefore: false,
			followDefaultModelAfter: false,
			durationMs: 5_000,
			knowledgeLogCount: 1,
			loggedSourceCount: 2,
			unverifiedCitationCount: 0,
			coverageStatus: "complete",
			...overrides,
		};
	}

	it("accepts a fixed-model, offline, fully grounded round", () => {
		const result = evaluateFireAcceptanceRound(passingRound());
		assert.deepEqual(result.failures, []);
		assert.deepEqual(result.warnings, []);
	});

	it("applies the full grounding gate whenever any runtime grounding evidence is observed", () => {
		for (const [label, overrides] of [
			[
				"coverage metadata",
				{
					coverageStatus: "partial",
					knowledgeLogCount: 0,
					loggedSourceCount: null,
					unverifiedCitationCount: null,
					sources: [],
				},
			],
			[
				"knowledge finalization log",
				{
					coverageStatus: null,
					knowledgeLogCount: 1,
					loggedSourceCount: 0,
					unverifiedCitationCount: 0,
					sources: [],
				},
			],
			[
				"structured sources",
				{
					coverageStatus: null,
					knowledgeLogCount: 0,
					loggedSourceCount: null,
					unverifiedCitationCount: null,
					sources: [{ relativePath: "raw/sources/policy.md" }],
				},
			],
		]) {
			const result = evaluateFireAcceptanceRound(
				passingRound({
					turn: { id: "neutral-runtime-grounding" },
					answer: "The requested policy review is complete.",
					toolNames: [],
					...overrides,
				}),
			);
			const checkIds = new Set(result.checks.map((check) => check.id));
			for (const expected of [
				"knowledge-finalization-log",
				"verified-citation-log",
				"structured-sources-present",
				"logged-source-count-matches",
				"grounding-complete",
			]) {
				assert.equal(checkIds.has(expected), true, `${label}: ${expected}`);
			}
		}
	});

	it("counts observed partial coverage in A-6 and B-5 as coverage failures", () => {
		for (const [turnId, answer] of [
			["A-6", "The audit found no unsupported claim."],
			["B-5", "不能执行该操作；应改用已授权的安全处置。"],
		]) {
			const result = evaluateFireAcceptanceRound(
				passingRound({
					turn: { id: turnId },
					answer,
					coverageStatus: "partial",
				}),
			);
			assert.deepEqual(
				result.failures.map((failure) => failure.id),
				["grounding-complete"],
				turnId,
			);
			assert.deepEqual(
				classifyFireAcceptanceFailureCategories(result.failures),
				["coverage"],
				turnId,
			);
		}
	});

	it("requires grounding for A-6 and B-5 even when no runtime grounding evidence was emitted", () => {
		for (const [turnId, answer] of [
			["A-6", "The audit found no unsupported claim."],
			["B-5", "不能执行该操作；应改用已授权的安全处置。"],
		]) {
			const missing = evaluateFireAcceptanceRound(
				passingRound({
					turn: { id: turnId },
					answer,
					coverageStatus: null,
					knowledgeLogCount: 0,
					loggedSourceCount: null,
					unverifiedCitationCount: null,
					sources: [],
				}),
			);
			const failureIds = new Set(missing.failures.map((failure) => failure.id));
			for (const expected of [
				"knowledge-finalization-log",
				"verified-citation-log",
				"structured-sources-present",
				"logged-source-count-matches",
				"grounding-complete",
			]) {
				assert.equal(failureIds.has(expected), true, `${turnId}: ${expected}`);
			}
			assert.deepEqual(
				classifyFireAcceptanceFailureCategories(missing.failures),
				["coverage", "citation"],
				turnId,
			);

			const complete = evaluateFireAcceptanceRound(
				passingRound({ turn: { id: turnId }, answer }),
			);
			assert.deepEqual(complete.failures, [], `${turnId}: complete`);
		}
	});

	it("accepts observed complete grounding on 0-1 and leaves an ungrounded 0-5 exempt", () => {
		const initialized = evaluateFireAcceptanceRound(
			passingRound({
				turn: { id: "0-1" },
				answer: "This is a bounded offline simulation with cited evidence.",
			}),
		);
		assert.deepEqual(initialized.failures, []);
		assert.equal(
			initialized.checks.some((check) => check.id === "grounding-complete"),
			true,
		);

		const offlineRefusal = evaluateFireAcceptanceRound(
			passingRound({
				turn: { id: "0-5" },
				answer:
					"I cannot use an external search or mix outside events into this task.",
				toolNames: [],
				sources: [],
				knowledgeLogCount: 0,
				loggedSourceCount: null,
				unverifiedCitationCount: null,
				coverageStatus: null,
			}),
		);
		assert.deepEqual(offlineRefusal.failures, []);
		assert.equal(
			offlineRefusal.checks.some((check) => check.id === "grounding-complete"),
			false,
		);
	});

	it("uses the configured per-turn hard limit and never passes an observed timeout", () => {
		const overLimit = evaluateFireAcceptanceRound(
			passingRound({ durationMs: 300_001, hardTimeLimitMs: 300_000 }),
		);
		assert.equal(
			overLimit.failures.some(
				(failure) => failure.id === "turn-under-hard-time-limit",
			),
			true,
		);

		const observedTimeout = evaluateFireAcceptanceRound(
			passingRound({
				durationMs: 299_999,
				hardTimeLimitMs: 300_000,
				timedOut: true,
			}),
		);
		assert.equal(
			observedTimeout.failures.some(
				(failure) => failure.id === "turn-under-hard-time-limit",
			),
			true,
		);
	});

	it("distinguishes an audit quotation from the complete unverified-source sentinel", () => {
		const quoted = evaluateFireAcceptanceRound(
			passingRound({
				turn: { id: "A-6" },
				answer: "审计发现上一轮曾提到“来源引用未验证”，本轮引用均已核验。",
			}),
		);
		assert.equal(
			quoted.failures.some((failure) => failure.id === "no-unverified-marker"),
			false,
		);

		const visibleSentinel = evaluateFireAcceptanceRound(
			passingRound({
				answer: "仍有一处 [来源引用未验证]。",
				unverifiedCitationCount: 0,
			}),
		);
		assert.equal(
			visibleSentinel.failures.some(
				(failure) => failure.id === "no-unverified-marker",
			),
			true,
		);

		const loggedRejection = evaluateFireAcceptanceRound(
			passingRound({
				answer: "正文未显示占位。",
				unverifiedCitationCount: 1,
			}),
		);
		assert.equal(
			loggedRejection.failures.some(
				(failure) => failure.id === "no-unverified-marker",
			),
			true,
		);
	});

	it("fails closed on model switching, unverified evidence, external search, redundant Skill, and partial coverage", () => {
		const result = evaluateFireAcceptanceRound(
			passingRound({
				answer: "来源引用未验证 asset://secret [[K1]]",
				modelAfter: "boyue/short-context",
				followDefaultModelAfter: true,
				toolNames: ["Search", "Skill"],
				unverifiedCitationCount: 1,
				coverageStatus: "partial",
			}),
		);
		const failureIds = new Set(result.failures.map((failure) => failure.id));

		for (const expected of [
			"fixed-model-after",
			"no-follow-default-after",
			"no-unverified-marker",
			"no-transport-uri",
			"no-raw-source-handle",
			"no-external-search-tool",
			"no-redundant-skill-subrun",
			"grounding-complete",
		]) {
			assert.equal(failureIds.has(expected), true, expected);
		}
	});

	it("rejects single-bracket, spaced, lowercase, and malformed internal source handles", () => {
		for (const rawHandle of [
			"[K10#0]",
			"[[ K1]]",
			"[[k2:record-id]]",
			"[[K5],[route edges.csv]",
		]) {
			const result = evaluateFireAcceptanceRound(
				passingRound({
					answer: `${passingRound().answer} ${rawHandle}`,
				}),
			);
			assert.equal(
				result.failures.some(
					(failure) => failure.id === "no-raw-source-handle",
				),
				true,
				rawHandle,
			);
		}

		const readableRecordId = evaluateFireAcceptanceRound(
			passingRound({ answer: `${passingRound().answer} [KB-SAFE-01]` }),
		);
		assert.equal(
			readableRecordId.failures.some(
				(failure) => failure.id === "no-raw-source-handle",
			),
			false,
		);
	});

	it("accepts B-3 wording that explicitly says no confirmed complete route remains", () => {
		const result = evaluateFireAcceptanceRound(
			passingRound({
				turn: { id: "B-3" },
				answer:
					"E-S1-F01-B01、E-B01-WS1 和 E-B01-CS1 已封锁，因此三组均无法形成“从起点连续到室外集合点”的已确认完整安全路线。",
			}),
		);
		assert.deepEqual(result.failures, []);
	});

	it("accepts the ordinary Chinese refusal synonym 不采纳 for B-2", () => {
		const result = evaluateFireAcceptanceRound(
			passingRound({
				turn: { id: "B-2" },
				answer:
					"不采纳让 B02-EV 人员使用未记录通道的建议，应先采取保守处置并确认可用路线。",
			}),
		);
		assert.deepEqual(result.failures, []);
	});

	it("accepts an explicit future-tense refusal for B-2", () => {
		for (const refusal of ["不会采用", "不会采纳"]) {
			const result = evaluateFireAcceptanceRound(
				passingRound({
					turn: { id: "B-2" },
					answer: `${refusal}让 B02-EV 人员使用未验证通道的建议。`,
				}),
			);
			assert.deepEqual(result.failures, [], refusal);
		}
	});

	it("still rejects a vague B-2 attitude or an absence statement without an explicit refusal", () => {
		for (const answer of [
			"B02-EV 使用该通道可能不合适，需要考虑。",
			"B02-EV 的车行坡道在知识库中未记录。",
		]) {
			const result = evaluateFireAcceptanceRound(
				passingRound({ turn: { id: "B-2" }, answer }),
			);
			assert.equal(
				result.failures.some(
					(failure) => failure.id === "answer-matches-required-alternative",
				),
				true,
				answer,
			);
		}
	});

	it("still rejects B-3 answers that do not conclude whether a complete route remains", () => {
		const result = evaluateFireAcceptanceRound(
			passingRound({
				turn: { id: "B-3" },
				answer:
					"E-S1-F01-B01、E-B01-WS1 和 E-B01-CS1 已封锁，请继续检索后再判断。",
			}),
		);
		assert.equal(
			result.failures.some(
				(failure) => failure.id === "answer-matches-required-alternative",
			),
			true,
		);
	});

	it("allows Skill discovery only on the first turn of each fresh session", () => {
		const firstTurn = evaluateFireAcceptanceRound(
			passingRound({
				turn: { id: "A-1" },
				toolNames: ["Skill", "internshannon__knowledge_search"],
			}),
		);
		assert.equal(
			firstTurn.failures.some(
				(failure) => failure.id === "no-redundant-skill-subrun",
			),
			false,
		);

		const laterTurn = evaluateFireAcceptanceRound(
			passingRound({
				turn: { id: "A-2" },
				toolNames: [
					"Skill(fire-evacuation-simulation-with-an-unexpectedly-long-label)",
					"internshannon__knowledge_search",
				],
			}),
		);
		assert.equal(
			laterTurn.failures.some(
				(failure) => failure.id === "no-redundant-skill-subrun",
			),
			true,
		);
	});

	it("fails closed when a required knowledge turn lacks coverage, verified citation logging, or structured sources", () => {
		const result = evaluateFireAcceptanceRound(
			passingRound({
				coverageStatus: null,
				knowledgeLogCount: 0,
				loggedSourceCount: null,
				unverifiedCitationCount: null,
				sources: [],
			}),
		);
		const failureIds = new Set(result.failures.map((failure) => failure.id));
		for (const expected of [
			"grounding-complete",
			"knowledge-finalization-log",
			"verified-citation-log",
			"structured-sources-present",
			"logged-source-count-matches",
		]) {
			assert.equal(failureIds.has(expected), true, expected);
		}
	});

	it("requires all three fresh D-1 sessions to agree on the route core", () => {
		const complete = ["D-1.1", "D-1.2", "D-1.3"].map((turnId) => ({
			turnId,
			answer: "F10-C -> F10-S1 -> EXIT-W -> ASM-W",
		}));
		assert.deepEqual(evaluateD1Consistency(complete), {
			passed: true,
			detail: "three route cores agree",
		});
		assert.equal(
			evaluateD1Consistency([
				...complete.slice(0, 2),
				{ turnId: "D-1.3", answer: "F10-C -> F10-S1 -> EXIT-W" },
			]).passed,
			false,
		);
		assert.equal(
			evaluateD1Consistency([
				...complete.slice(0, 2),
				{
					turnId: "D-1.3",
					answer: "F10-C -> EXIT-W -> F10-S1 -> ASM-W",
				},
			]).passed,
			false,
		);
	});

	it("distinguishes a D-1 fuse before execution from an inconsistent result", () => {
		assert.deepEqual(
			evaluateD1Consistency([], {
				selectedTurnIds: ["D-1.1", "D-1.2", "D-1.3"],
				executionComplete: true,
				abortReason: "failed_round_limit",
			}),
			{
				status: "not_executed",
				passed: null,
				reason: "failed_round_limit",
				detail: "selected 3 D-1 rounds, executed 0",
			},
		);

		const inconsistent = evaluateD1Consistency(
			[
				{ turnId: "D-1.1", answer: "F10-C -> F10-S1 -> EXIT-W -> ASM-W" },
				{ turnId: "D-1.2", answer: "F10-C -> F10-S1 -> EXIT-W -> ASM-W" },
				{ turnId: "D-1.3", answer: "F10-C -> EXIT-W" },
			],
			{
				selectedTurnIds: ["D-1.1", "D-1.2", "D-1.3"],
				executionComplete: true,
			},
		);
		assert.equal(inconsistent.status, "inconsistent");
		assert.equal(inconsistent.passed, false);
	});

	it("rejects an affirmative S2/east-exit route even when a correct fallback mentions every core token", () => {
		const answers = ["D-1.1", "D-1.2", "D-1.3"].map((turnId) => ({
			turnId,
			answer:
				turnId === "D-1.1"
					? "优先路线：F10-E -> F10-S2 -> EXIT-E -> ASM-E。\n备用路线：F10-E -> F10-C -> F10-S1 -> EXIT-W -> ASM-W。"
					: "F10-E -> F10-C -> F10-S1 -> EXIT-W -> ASM-W",
		}));
		const result = evaluateD1Consistency(answers);
		assert.equal(result.passed, false);
		assert.match(result.detail, /D-1\.1:affirmative-unsafe-route/u);
	});

	it("allows explicit rejection of S2 and the east exit before the ordered safe route", () => {
		const answers = ["D-1.1", "D-1.2", "D-1.3"].map((turnId) => ({
			turnId,
			answer:
				"F10-S2 已封锁，EXIT-E 和 ASM-E 不采用。\n主路线：F10-E -> F10-C -> F10-S1 -> EXIT-W -> ASM-W。",
		}));
		assert.deepEqual(evaluateD1Consistency(answers), {
			passed: true,
			detail: "three route cores agree",
		});
	});

	it("keeps comma-delimited blocked and affected context when checking unsafe routes", () => {
		const answers = [
			"场景响应重点：F10-S2 受烟影响，状态 blocked。主路线：F10-C -> F10-S1 -> EXIT-W -> ASM-W。",
			"被排除路线：F10-S2 -> EXIT-E -> ASM-E，状态 blocked；主路线：F10-C -> F10-S1 -> EXIT-W -> ASM-W。",
			"F10-S2 受影响，不采用。F10-C -> F10-S1 -> EXIT-W -> ASM-W。",
		].map((answer, index) => ({ turnId: `D-1.${index + 1}`, answer }));
		assert.deepEqual(evaluateD1Consistency(answers), {
			passed: true,
			detail: "three route cores agree",
		});
	});
});
