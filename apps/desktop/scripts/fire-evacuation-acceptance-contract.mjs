import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export const FIRE_ACCEPTANCE_MODEL = "boyue/gpt-5";
export const FIRE_ACCEPTANCE_PROVIDER = "boyue";
export const FIRE_ACCEPTANCE_MODEL_ID = "gpt-5";
export const FIRE_ACCEPTANCE_FIXTURE_FINGERPRINT =
	"d2e5966a45fc51354848034b775cb197949d4e69cff39e8caddd2a4a5dabd3a7";
export const FIRE_ACCEPTANCE_QUESTION_SCRIPT_SHA256 =
	"41f8226dddd38dd2ba7d34c227e1b22ddd38d7621c3f47faf1863d8671ab5e14";
export const FIRE_ACCEPTANCE_NORMALIZED_TURNS_FINGERPRINT =
	"e4c0cbfaba526807196adea60da6f7beadb188fcbb95c09207d2aa4e08e4a881";

export const FIRE_ACCEPTANCE_SOURCE_NAMES = [
	"01-项目任务与安全边界.md",
	"02-建筑布局与分区说明.md",
	"03-疏散计算与决策规则.md",
	"04-角色职责与分类处置.md",
	"05-数据字典与检索说明.md",
	"06-官方原则摘要与来源索引.md",
	"fire_devices.csv",
	"floors.csv",
	"occupants.csv",
	"route_edges.csv",
	"route_nodes.csv",
	"scenario_blockages.csv",
	"scenario_expectations.csv",
	"scenarios.csv",
].sort((left, right) => left.localeCompare(right, "zh-CN"));

export const FIRE_ACCEPTANCE_TURN_IDS = [
	"0-1",
	"0-2",
	"0-3",
	"0-4",
	"0-5",
	"0-6",
	"A-1",
	"A-2",
	"A-3",
	"A-4",
	"A-5",
	"A-6",
	"B-1",
	"B-2",
	"B-3",
	"B-4",
	"B-5",
	"C-1",
	"C-2",
	"C-3",
	"C-4",
	"C-5",
	"C-6",
	"D-1.1",
	"D-1.2",
	"D-1.3",
	"D-2",
	"D-3",
];

export const FIRE_ACCEPTANCE_SESSION_KEYS = [
	"0",
	"A",
	"B",
	"C",
	"D-1.1",
	"D-1.2",
	"D-1.3",
	"D-2",
	"D-3",
];

function parseStoredObject(value, label) {
	if (value && typeof value === "object" && !Array.isArray(value)) return value;
	if (typeof value !== "string" || !value.trim()) {
		throw new Error(`Missing ${label} in configured provider file`);
	}
	try {
		const parsed = JSON.parse(value);
		if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
			return parsed;
		}
	} catch {
		// Fall through to the stable, non-secret-bearing error below.
	}
	throw new Error(`Invalid ${label} in configured provider file`);
}

function nonEmptyString(value) {
	return typeof value === "string" && value.trim() ? value : undefined;
}

const SAFE_KNOWLEDGE_TOOL_NAMES = new Set([
	"mcp__internshannon__knowledge_search",
	"mcp__internshannon__knowledge_read",
	"mcp__internshannon__knowledge_query",
	"internshannon__knowledge_search",
	"internshannon__knowledge_read",
	"internshannon__knowledge_query",
]);

function normalizedNestedJson(value, depth = 0) {
	if (depth > 6) return value;
	if (typeof value === "string") {
		const trimmed = value.trim();
		if (!trimmed || (!trimmed.startsWith("{") && !trimmed.startsWith("[")))
			return value;
		try {
			return normalizedNestedJson(JSON.parse(trimmed), depth + 1);
		} catch {
			return value;
		}
	}
	if (Array.isArray(value))
		return value.map((item) => normalizedNestedJson(item, depth + 1));
	if (!value || typeof value !== "object") return value;
	return Object.fromEntries(
		Object.entries(value).map(([key, nested]) => [
			key,
			normalizedNestedJson(nested, depth + 1),
		]),
	);
}

function nestedSkillName(value, depth = 0) {
	if (depth > 8 || value === null || value === undefined) return undefined;
	const normalized = normalizedNestedJson(value);
	if (Array.isArray(normalized)) {
		for (const item of normalized) {
			const found = nestedSkillName(item, depth + 1);
			if (found) return found;
		}
		return undefined;
	}
	if (!normalized || typeof normalized !== "object") return undefined;
	for (const [key, nested] of Object.entries(normalized)) {
		if ((key === "skill_name" || key === "skillName") && nonEmptyString(nested))
			return nested.trim().toLowerCase();
	}
	for (const nested of Object.values(normalized)) {
		const found = nestedSkillName(nested, depth + 1);
		if (found) return found;
	}
	return undefined;
}

/**
 * Fixture runner confirmation policy. Product runtime remains untouched: the
 * acceptance harness approves only built-in knowledge tools plus one exact,
 * configured Skill invocation per live session/name. It never authorizes task
 * delegation, skill discovery, or an unconfigured Skill.
 */
export function fireAcceptanceConfirmationDecision({
	toolName,
	toolInput,
	configuredSkills = [],
	approvedSkillNames = new Set(),
}) {
	const normalizedTool = String(toolName ?? "")
		.trim()
		.toLowerCase();
	if (SAFE_KNOWLEDGE_TOOL_NAMES.has(normalizedTool)) {
		return { approved: true, kind: "knowledge" };
	}
	if (normalizedTool !== "skill") return { approved: false, kind: "denied" };
	const configured = new Set(
		configuredSkills
			.map((name) =>
				String(name ?? "")
					.trim()
					.toLowerCase(),
			)
			.filter(Boolean),
	);
	const requested =
		nestedSkillName(toolInput) ??
		(configured.size === 1 ? configured.values().next().value : undefined);
	if (
		!requested ||
		!configured.has(requested) ||
		approvedSkillNames.has(requested)
	) {
		return { approved: false, kind: "denied", skillName: requested };
	}
	approvedSkillNames.add(requested);
	return { approved: true, kind: "configured_skill", skillName: requested };
}

function usableCredential(value) {
	const credential = nonEmptyString(value);
	if (!credential) return undefined;
	return /^(?:\[missing\]|\[redacted\]|\*+)$/iu.test(credential)
		? undefined
		: credential;
}

function stringRecord(value) {
	if (!value || typeof value !== "object" || Array.isArray(value))
		return undefined;
	const entries = Object.entries(value).filter(
		([key, item]) => key.trim() && typeof item === "string",
	);
	return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

function copyModelConfig(model) {
	const copied = {
		id: FIRE_ACCEPTANCE_MODEL_ID,
		name: nonEmptyString(model?.name) ?? FIRE_ACCEPTANCE_MODEL_ID,
		family: nonEmptyString(model?.family) ?? FIRE_ACCEPTANCE_MODEL_ID,
		attachment: model?.attachment === true,
		reasoning: model?.reasoning === true,
		toolCall: model?.toolCall !== false,
		temperature: model?.temperature !== false,
	};
	for (const key of ["apiKey", "baseUrl", "sessionIdHeader"]) {
		const value =
			key === "apiKey"
				? usableCredential(model?.[key])
				: nonEmptyString(model?.[key]);
		if (value) copied[key] = value;
	}
	const headers = stringRecord(model?.headers);
	if (headers) copied.headers = headers;
	if (model?.limit && typeof model.limit === "object") {
		const context = Number(model.limit.context);
		const output = Number(model.limit.output);
		if (Number.isFinite(context) && Number.isFinite(output)) {
			copied.limit = { context, output };
		}
	}
	return copied;
}

/**
 * Build the only configuration the paid acceptance process is allowed to see.
 * The source file may contain many unrelated application/provider credentials;
 * none of them are copied into the isolated profile.
 */
export function buildFireAcceptanceIsolatedConfig(sourceConfig) {
	if (
		!sourceConfig ||
		typeof sourceConfig !== "object" ||
		Array.isArray(sourceConfig)
	) {
		throw new Error("Configured provider file must contain a JSON object");
	}
	const llm = parseStoredObject(
		sourceConfig["config/app/llm"] ?? sourceConfig.llm,
		"config/app/llm",
	);
	const providers = Array.isArray(llm.providers) ? llm.providers : [];
	const provider = providers.find(
		(item) => item?.name === FIRE_ACCEPTANCE_PROVIDER,
	);
	if (!provider) {
		throw new Error(
			`Configured provider file has no exact ${FIRE_ACCEPTANCE_PROVIDER} provider`,
		);
	}
	const models = Array.isArray(provider.models) ? provider.models : [];
	const model = models.find((item) => item?.id === FIRE_ACCEPTANCE_MODEL_ID);
	if (!model) {
		throw new Error(
			`Configured provider file has no exact ${FIRE_ACCEPTANCE_MODEL}`,
		);
	}
	const providerApiKey = usableCredential(provider.apiKey);
	const modelApiKey = usableCredential(model.apiKey);
	if (!providerApiKey && !modelApiKey) {
		throw new Error(`${FIRE_ACCEPTANCE_MODEL} has no configured credential`);
	}

	const isolatedProvider = {
		name: FIRE_ACCEPTANCE_PROVIDER,
		models: [copyModelConfig(model)],
	};
	for (const key of ["apiKey", "baseUrl", "sessionIdHeader"]) {
		const value =
			key === "apiKey"
				? usableCredential(provider[key])
				: nonEmptyString(provider[key]);
		if (value) isolatedProvider[key] = value;
	}
	const providerHeaders = stringRecord(provider.headers);
	if (providerHeaders) isolatedProvider.headers = providerHeaders;

	return {
		"config/app/llm": JSON.stringify({
			defaultModel: FIRE_ACCEPTANCE_MODEL,
			providers: [isolatedProvider],
			mcpServers: [],
		}),
		"config/app/search": JSON.stringify({
			enabledEngines: [],
			language: "zh-CN",
			safesearch: "strict",
			timeout: 1,
			limit: 1,
		}),
		"config/app/assistant": JSON.stringify({
			model: FIRE_ACCEPTANCE_MODEL,
			mcpServers: [],
			skills: ["fire-evacuation-simulation"],
			builtinSkills: false,
			planningMode: "disabled",
			goalTracking: false,
			autoDelegation: { enabled: false, autoParallel: false },
			autoParallel: false,
		}),
	};
}

export function parseFireAcceptanceKnowledgeLogLine(line) {
	const text = String(line);
	const match =
		/\[kernel\.knowledge\.sources\][^\n]*sessionId=([^\s]+)[^\n]*sources=(\d+)[^\n]*unverified=(\d+)(?:[^\n]*rejectedReasons=([a-z0-9_:,-]+|none))?/u.exec(
			text,
		);
	if (!match) return null;
	const runId = /\brunId=([^\s]+)/u.exec(text)?.[1] ?? null;
	const rejectionSamples = (() => {
		// Sidecar output can be colorized. Capture exactly one URI-encoded token so
		// a trailing ANSI escape (for example `\u001b[39m`) cannot poison decoding.
		const encoded =
			/\brejectedSamples=((?:%[0-9a-f]{2})(?:%[0-9a-f]{2}|[a-z0-9_.!~*'()-])*)/iu.exec(
				text,
			)?.[1];
		if (!encoded) return [];
		try {
			const parsed = JSON.parse(decodeURIComponent(encoded));
			return Array.isArray(parsed) ? parsed.slice(0, 8) : [];
		} catch {
			return [];
		}
	})();
	const rejectionReasons = {};
	if (match[4] && match[4] !== "none") {
		for (const entry of match[4].split(",")) {
			const [reason, rawCount] = entry.split(":");
			const count = Number(rawCount);
			if (
				/^[a-z][a-z0-9_]*$/u.test(reason ?? "") &&
				Number.isSafeInteger(count) &&
				count > 0
			) {
				rejectionReasons[reason] = count;
			}
		}
	}
	return {
		sessionId: match[1],
		runId,
		sourceCount: Number(match[2]),
		unverifiedCitationCount: Number(match[3]),
		rejectionReasons,
		rejectionSamples,
	};
}

export const FIRE_ACCEPTANCE_FAILURE_CATEGORIES = [
	"content",
	"coverage",
	"citation",
];

const ACCEPTANCE_LIFECYCLE_CHECK_IDS = new Set([
	"run-id-correlated",
	"persisted-run-pair",
	"session-runtime-idle",
	"no-lifecycle-error",
	"turn-under-hard-time-limit",
]);

const ACCEPTANCE_CITATION_CHECK_IDS = new Set([
	"no-unverified-marker",
	"no-transport-uri",
	"no-raw-source-handle",
	"knowledge-finalization-log",
	"verified-citation-log",
	"structured-sources-present",
	"logged-source-count-matches",
]);

/**
 * Classify failed checks for the paid-run fuse. A round can count once in more
 * than one category, but never more than once in the same category. Lifecycle
 * failures are excluded because the runner fuses them immediately.
 */
export function classifyFireAcceptanceFailureCategories(failures) {
	const categories = new Set();
	for (const failure of failures ?? []) {
		const id = String(failure?.id ?? failure ?? "");
		if (!id || ACCEPTANCE_LIFECYCLE_CHECK_IDS.has(id)) continue;
		if (id === "grounding-complete") {
			categories.add("coverage");
			continue;
		}
		if (
			ACCEPTANCE_CITATION_CHECK_IDS.has(id) ||
			id.startsWith("source-card:")
		) {
			categories.add("citation");
			continue;
		}
		categories.add("content");
	}
	return FIRE_ACCEPTANCE_FAILURE_CATEGORIES.filter((category) =>
		categories.has(category),
	);
}

export function updateFireAcceptanceFailureCategoryCounts({
	counts,
	failures,
	limit,
}) {
	const nextCounts = Object.fromEntries(
		FIRE_ACCEPTANCE_FAILURE_CATEGORIES.map((category) => [
			category,
			Number.isSafeInteger(counts?.[category]) ? counts[category] : 0,
		]),
	);
	const categories = classifyFireAcceptanceFailureCategories(failures);
	for (const category of categories) nextCounts[category] += 1;
	return {
		categories,
		counts: nextCounts,
		triggeredCategory:
			categories.find((category) => nextCounts[category] >= limit) ?? null,
	};
}

export function selectFireAcceptanceKnowledgeLog(
	entries,
	sessionId,
	afterSequence,
	expectedRunId = null,
) {
	const matching = (entries ?? []).filter(
		(entry) =>
			Number.isInteger(entry?.sequence) &&
			entry.sequence > afterSequence &&
			entry.sessionId === sessionId &&
			(!expectedRunId || entry.runId === expectedRunId),
	);
	return {
		count: matching.length,
		latest: matching.at(-1) ?? null,
	};
}

const HIGH_CONFIDENCE_EXPECTATIONS = {
	"0-2": {
		requiredText: ["14", "90", "131", "12", "36", "40"],
		requiredSources: [
			"floors.csv",
			"route_nodes.csv",
			"route_edges.csv",
			"scenarios.csv",
			"occupants.csv",
			"scenario_blockages.csv",
		],
	},
	"0-3": {
		requiredText: [
			"F04-AR",
			"F08-AR",
			"F12-AR",
			"DEV-CHAIR-F04-S2",
			"DEV-CHAIR-F10-S1",
			"DEV-CHAIR-F12-S1",
			"OG-S04-02",
			"OG-S08-02",
			"OG-S11-02",
		],
	},
	"0-6": {
		requiredText: ["E-F10-ES2", "F10-E", "F10-S2", "BLK-S04-02"],
		requiredSources: ["route_edges.csv", "scenario_blockages.csv"],
	},
	"A-1": {
		requiredText: [
			"OG-S04-01",
			"OG-S04-02",
			"OG-S04-03",
			"E-F10-ES2",
			"F10-S1",
			"EXIT-W",
			"ASM-W",
		],
	},
	"A-2": {
		requiredText: [
			"OG-S04-02",
			"F10-C",
			"F10-S1",
			"EXIT-W",
			"ASM-W",
			"DEV-CHAIR-F10-S1",
		],
	},
	"A-3": {
		requiredText: ["OG-S04-02", "OG-S04-03", "ASM-W", "20"],
		requiredAny: [/模拟/u, /simulation/iu],
		requiredSources: ["03-疏散计算与决策规则.md", "route_edges.csv"],
	},
	"A-4": {
		requiredText: ["10:06", "BLK-S04-02"],
		requiredAny: [/blocked/iu, /封锁/u],
	},
	"A-5": {
		requiredText: ["10:08", "E-F10-ES2", "EXIT-W", "FACP-SOUTH"],
	},
	"B-1": {
		requiredText: ["OG-S03-01", "OG-S03-02", "OG-S03-03"],
		requiredSources: [
			"occupants.csv",
			"route_edges.csv",
			"scenario_blockages.csv",
		],
	},
	"B-2": {
		requiredText: ["B02-EV"],
		requiredAny: [/不(?:会)?采用/u, /不(?:会)?采纳/u],
	},
	"B-3": {
		requiredText: ["E-S1-F01-B01", "E-B01-WS1", "E-B01-CS1"],
		requiredAny: [
			/没有[^\n。]{0,48}(?:已确认)?[^\n。]{0,24}(?:完整|连续)[^\n。]{0,16}(?:路线|链路)/u,
			/无(?:已确认)?[^\n。]{0,48}(?:完整|连续)[^\n。]{0,16}(?:路线|链路)/u,
			/无法形成[^\n。]{0,64}(?:已确认)?[^\n。]{0,24}(?:完整|连续)[^\n。]{0,16}(?:路线|链路)/u,
			/不存在[^\n。]{0,64}(?:完整|连续)[^\n。]{0,16}(?:路线|链路)/u,
		],
	},
	"B-5": {
		requiredAny: [/拒绝/u, /不应/u, /不能/u, /不允许/u],
	},
	"C-1": {
		requiredText: ["OG-S06-03", "E-F06-LAB-C"],
	},
	"C-2": {
		requiredText: ["E-EXIT-E", "E-F01-S2C", "E-F01-CS1", "EXIT-W", "ASM-W"],
	},
	"C-3": {
		requiredText: ["DEV-SDS-F06"],
		requiredAny: [/不能确定/u, /不指定/u, /未知/u],
	},
	"C-4": {
		requiredText: ["5"],
		requiredAny: [/双语/u, /English/iu, /英语/u],
	},
	"C-5": {
		requiredText: ["E-EXIT-E"],
		maximumNonWhitespaceCharacters: 360,
	},
	"C-6": {
		requiredAny: [/知识库/u, /授权更新/u],
	},
	"D-1.1": {
		requiredText: ["F10-C", "F10-S1", "EXIT-W", "ASM-W"],
	},
	"D-1.2": {
		requiredText: ["F10-C", "F10-S1", "EXIT-W", "ASM-W"],
	},
	"D-1.3": {
		requiredText: ["F10-C", "F10-S1", "EXIT-W", "ASM-W"],
	},
	"D-2": {
		requiredText: ["OG-S08-02", "F12-C", "F12-AR", "DEV-CHAIR-F12-S1"],
	},
	"D-3": {
		requiredAny: [/不能.*合规/u, /拒绝.*合规/u, /无法.*合规/u],
	},
};

const COMPLETE_GROUNDING_TURNS = new Set([
	"0-2",
	"0-3",
	"0-4",
	"0-6",
	"A-1",
	"A-2",
	"A-3",
	"A-4",
	"A-5",
	"A-6",
	"B-1",
	"B-2",
	"B-3",
	"B-4",
	"B-5",
	"C-1",
	"C-2",
	"C-3",
	"C-4",
	"C-5",
	"C-6",
	"D-1.1",
	"D-1.2",
	"D-1.3",
	"D-2",
	"D-3",
]);

const SESSION_INITIAL_TURNS = new Set([
	"0-1",
	"A-1",
	"B-1",
	"C-1",
	"D-1.1",
	"D-1.2",
	"D-1.3",
	"D-2",
	"D-3",
]);

function normalizeQuote(value) {
	return value.replace(/^[“"]|[”"]$/gu, "").trim();
}

export function parseFireAcceptanceScript(markdown) {
	const lines = String(markdown).split(/\r?\n/u);
	const turns = [];
	let currentSession = null;
	let currentTurn = null;
	let currentTitle = "";
	let currentPrompt = [];
	let dSection = null;

	const flush = () => {
		if (!currentTurn || currentPrompt.length === 0) return;
		turns.push({
			id: currentTurn,
			sessionKey: currentSession,
			title: currentTitle,
			prompt: currentPrompt.join("\n").trim(),
		});
		currentPrompt = [];
	};

	for (const line of lines) {
		const sessionHeading = /^## \u4f1a\u8bdd ([0ABC])(?::|\uff1a|\s|$)/u.exec(
			line,
		);
		if (sessionHeading) {
			flush();
			currentSession = sessionHeading[1];
			currentTurn = null;
			dSection = null;
			continue;
		}
		if (/^## \u53ef\u9009\u52a0\u6d4b/u.test(line)) {
			flush();
			currentSession = "D";
			currentTurn = null;
			dSection = null;
			continue;
		}

		const turnHeading = /^### ([0ABC]-\d+)\s*(.*)$/u.exec(line);
		if (turnHeading) {
			flush();
			currentTurn = turnHeading[1];
			currentTitle = turnHeading[2].trim();
			currentPrompt = [];
			dSection = null;
			continue;
		}

		const dHeading = /^### (D-[123])\s*(.*)$/u.exec(line);
		if (dHeading) {
			flush();
			dSection = dHeading[1];
			currentTurn = dSection === "D-1" ? null : dSection;
			currentSession = dSection;
			currentTitle = dHeading[2].trim();
			currentPrompt = [];
			continue;
		}

		if (dSection === "D-1") {
			const item = /^\d+\.\s+([“"][\s\S]+[”"])\s*$/u.exec(line);
			if (item) {
				const index =
					turns.filter((turn) => turn.id.startsWith("D-1.")).length + 1;
				turns.push({
					id: `D-1.${index}`,
					sessionKey: `D-1.${index}`,
					title: `${currentTitle} ${index}`.trim(),
					prompt: normalizeQuote(item[1]),
				});
			}
			continue;
		}

		if (currentTurn && line.startsWith(">")) {
			currentPrompt.push(line.replace(/^>\s?/u, ""));
		}
	}
	flush();
	return turns;
}

export function acceptanceQuestionScriptFingerprint(markdown) {
	const bytes = Buffer.isBuffer(markdown)
		? markdown
		: Buffer.from(String(markdown), "utf8");
	return createHash("sha256").update(bytes).digest("hex");
}

export function acceptanceNormalizedTurnsFingerprint(turns) {
	return createHash("sha256")
		.update(
			turns
				.map(
					(turn) =>
						`${turn.id}\0${turn.sessionKey}\0${String(turn.prompt ?? "")}`,
				)
				.join("\n"),
		)
		.digest("hex");
}

export function assertFireAcceptancePlan(turns) {
	const ids = turns.map((turn) => turn.id);
	if (JSON.stringify(ids) !== JSON.stringify(FIRE_ACCEPTANCE_TURN_IDS)) {
		throw new Error(
			`01 script turn contract changed: expected=${JSON.stringify(FIRE_ACCEPTANCE_TURN_IDS)} actual=${JSON.stringify(ids)}`,
		);
	}
	const sessions = [...new Set(turns.map((turn) => turn.sessionKey))];
	if (
		JSON.stringify(sessions) !== JSON.stringify(FIRE_ACCEPTANCE_SESSION_KEYS)
	) {
		throw new Error(
			`01 script session contract changed: expected=${JSON.stringify(FIRE_ACCEPTANCE_SESSION_KEYS)} actual=${JSON.stringify(sessions)}`,
		);
	}
	for (const turn of turns) {
		if (!turn.prompt.trim())
			throw new Error(`01 script turn ${turn.id} has no prompt`);
	}
	const normalizedFingerprint = acceptanceNormalizedTurnsFingerprint(turns);
	if (normalizedFingerprint !== FIRE_ACCEPTANCE_NORMALIZED_TURNS_FINGERPRINT) {
		throw new Error(
			`01 script normalized 28-turn fingerprint changed: expected=${FIRE_ACCEPTANCE_NORMALIZED_TURNS_FINGERPRINT} actual=${normalizedFingerprint}`,
		);
	}
	return turns;
}

export function assertFireAcceptanceQuestionScript(markdown) {
	const turns = assertFireAcceptancePlan(parseFireAcceptanceScript(markdown));
	const fileFingerprint = acceptanceQuestionScriptFingerprint(markdown);
	if (fileFingerprint !== FIRE_ACCEPTANCE_QUESTION_SCRIPT_SHA256) {
		throw new Error(
			`01 script file SHA-256 changed: expected=${FIRE_ACCEPTANCE_QUESTION_SCRIPT_SHA256} actual=${fileFingerprint}`,
		);
	}
	return turns;
}

function walkFiles(rootDir) {
	const files = [];
	for (const entry of fs.readdirSync(rootDir, { withFileTypes: true })) {
		if (entry.name.startsWith(".")) continue;
		const fullPath = path.join(rootDir, entry.name);
		if (entry.isDirectory()) files.push(...walkFiles(fullPath));
		else if (entry.isFile()) files.push(fullPath);
	}
	return files;
}

function sha256File(filePath) {
	return createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

export function discoverFireAcceptanceSources(rootDir) {
	if (!fs.statSync(rootDir).isDirectory()) {
		throw new Error(`Knowledge fixture path is not a directory: ${rootDir}`);
	}
	const files = walkFiles(rootDir).filter((filePath) =>
		/\.(?:csv|md)$/iu.test(filePath),
	);
	const byName = new Map();
	for (const filePath of files) {
		const name = path.basename(filePath);
		if (byName.has(name)) {
			throw new Error(`Knowledge fixture contains duplicate basename: ${name}`);
		}
		byName.set(name, filePath);
	}
	const names = [...byName.keys()].sort((left, right) =>
		left.localeCompare(right, "zh-CN"),
	);
	if (JSON.stringify(names) !== JSON.stringify(FIRE_ACCEPTANCE_SOURCE_NAMES)) {
		throw new Error(
			`Knowledge fixture must contain only the required 14 sources: expected=${JSON.stringify(FIRE_ACCEPTANCE_SOURCE_NAMES)} actual=${JSON.stringify(names)}`,
		);
	}
	return names.map((name) => {
		const filePath = byName.get(name);
		const stat = fs.statSync(filePath);
		return {
			name,
			path: path.resolve(filePath),
			size: stat.size,
			sha256: sha256File(filePath),
		};
	});
}

export function acceptanceFixtureFingerprint(sources) {
	return createHash("sha256")
		.update(
			sources
				.map((source) => `${source.name}\0${source.size}\0${source.sha256}`)
				.join("\n"),
		)
		.digest("hex");
}

export function assertFireAcceptanceFixture(sources) {
	const fingerprint = acceptanceFixtureFingerprint(sources);
	if (fingerprint !== FIRE_ACCEPTANCE_FIXTURE_FINGERPRINT) {
		throw new Error(
			`Knowledge fixture 14-source content fingerprint changed: expected=${FIRE_ACCEPTANCE_FIXTURE_FINGERPRINT} actual=${fingerprint}`,
		);
	}
	return sources;
}

function normalizedSourceNames(sources) {
	return new Set(
		(sources ?? []).flatMap((source) => {
			const values = [
				source?.relativePath,
				source?.path,
				source?.title,
				source?.resource,
			].filter((value) => typeof value === "string" && value.trim());
			return values.map((value) => path.basename(value));
		}),
	);
}

function isExternalSearchTool(toolName) {
	const normalized = String(toolName ?? "")
		.trim()
		.toLowerCase()
		.replace(/[\s.-]+/gu, "_");
	if (!normalized || normalized.startsWith("knowledge_")) return false;
	if (normalized.includes("internshannon__knowledge_")) return false;
	return [
		"search",
		"web_search",
		"websearch",
		"browser_search",
		"search_browser",
		"browser",
	].includes(normalized);
}

function isSkillTool(toolName) {
	const normalized = String(toolName ?? "")
		.trim()
		.toLowerCase();
	return /^skill(?:$|[\s_(:.-])/u.test(normalized);
}

const RAW_SOURCE_HANDLE_PATTERN = /\[{1,2}\s*K\d+(?=[\s:#,\])）]|$)/iu;

const D1_ROUTE_CORE = ["F10-C", "F10-S1", "EXIT-W", "ASM-W"];
const D1_UNSAFE_ROUTE_TOKEN_PATTERN = /(?:\bS2\b|F10-S2|EXIT-E|ASM-E)/iu;
const D1_AFFIRMATIVE_ROUTE_PATTERN =
	/(?:默认(?:走|路线|路径)|优先(?:走|选择|经由)|首选(?:路线|路径)?|应当(?:走|选择|经由|前往)|建议(?:走|选择|经由)|改走|选择|进入|沿|经由?|前往|到达|出楼|撤离|路线|路径|→|->)/u;
const D1_NEGATED_ROUTE_PATTERN =
	/(?:不走|不采用|不能|不可|不得|不允许|严禁|禁用|避开|排除|封锁|被封|blocked|受阻|失效|未确认|无已确认|无法|不可通行|受烟(?:气)?影响|受影响)/iu;

function orderedRouteCoreProblem(answer) {
	const normalized = String(answer ?? "").toUpperCase();
	const missing = D1_ROUTE_CORE.filter((token) => !normalized.includes(token));
	if (missing.length > 0) return `missing=${missing.join(",")}`;
	let cursor = 0;
	for (const token of D1_ROUTE_CORE) {
		const position = normalized.indexOf(token, cursor);
		if (position < 0) return "route-core-out-of-order";
		cursor = position + token.length;
	}
	return null;
}

function affirmativeUnsafeRouteClauses(answer) {
	return String(answer ?? "")
		.split(/[\n。；！？]+/u)
		.map((clause) => clause.trim())
		.filter(
			(clause) =>
				D1_UNSAFE_ROUTE_TOKEN_PATTERN.test(clause) &&
				D1_AFFIRMATIVE_ROUTE_PATTERN.test(clause) &&
				!D1_NEGATED_ROUTE_PATTERN.test(clause),
		);
}

export function evaluateFireAcceptanceRound(input) {
	const checks = [];
	const add = (id, passed, detail, severity = "failure") => {
		checks.push({ id, passed: Boolean(passed), severity, detail });
	};
	const answer = String(input.answer ?? "");
	const toolNames = [...new Set(input.toolNames ?? [])];
	const sourceNames = normalizedSourceNames(input.sources);
	const expectation = HIGH_CONFIDENCE_EXPECTATIONS[input.turn.id] ?? {};
	const hasCoverageStatus =
		input.coverageStatus !== null && input.coverageStatus !== undefined;
	// The static list remains fail-closed when an expected grounding payload is
	// missing altogether. Runtime evidence also activates the same gate so a
	// grounded turn omitted from that list cannot silently pass with partial data.
	const observedKnowledgeGrounding =
		hasCoverageStatus ||
		(Number.isInteger(input.knowledgeLogCount) &&
			input.knowledgeLogCount > 0) ||
		sourceNames.size > 0;
	const requiresCompleteGrounding =
		COMPLETE_GROUNDING_TURNS.has(input.turn.id) || observedKnowledgeGrounding;

	add(
		"run-succeeded",
		input.resultStatus === "succeeded",
		input.resultStatus ?? "missing",
	);
	add(
		"answer-nonempty",
		answer.trim().length > 0,
		`${answer.trim().length} characters`,
	);
	add(
		"fixed-model-before",
		input.modelBefore === FIRE_ACCEPTANCE_MODEL,
		input.modelBefore ?? "missing",
	);
	add(
		"fixed-model-after",
		input.modelAfter === FIRE_ACCEPTANCE_MODEL,
		input.modelAfter ?? "missing",
	);
	add(
		"no-follow-default-before",
		input.followDefaultModelBefore === false,
		String(input.followDefaultModelBefore ?? "missing"),
	);
	add(
		"no-follow-default-after",
		input.followDefaultModelAfter === false,
		String(input.followDefaultModelAfter ?? "missing"),
	);
	add(
		"no-unverified-marker",
		!answer.includes("[来源引用未验证]") &&
			(input.unverifiedCitationCount ?? 0) === 0,
		`logged=${input.unverifiedCitationCount ?? "not-emitted"}`,
	);
	add("no-transport-uri", !answer.includes("asset://"), "assistant body");
	add(
		"no-raw-source-handle",
		!RAW_SOURCE_HANDLE_PATTERN.test(answer),
		"assistant body",
	);
	add(
		"no-external-search-tool",
		!toolNames.some(isExternalSearchTool),
		toolNames.join(", ") || "none",
	);
	if (!SESSION_INITIAL_TURNS.has(input.turn.id)) {
		add(
			"no-redundant-skill-subrun",
			!toolNames.some(isSkillTool),
			toolNames.join(", ") || "none",
		);
	}
	if (requiresCompleteGrounding) {
		add(
			"knowledge-finalization-log",
			input.knowledgeLogCount === 1,
			String(input.knowledgeLogCount ?? "missing"),
		);
		add(
			"verified-citation-log",
			input.unverifiedCitationCount === 0,
			String(input.unverifiedCitationCount ?? "missing"),
		);
		add(
			"structured-sources-present",
			sourceNames.size > 0,
			`${sourceNames.size} unique source files`,
		);
		add(
			"logged-source-count-matches",
			Number.isInteger(input.loggedSourceCount) &&
				input.loggedSourceCount === (input.sources ?? []).length,
			`${input.loggedSourceCount ?? "missing"}/${(input.sources ?? []).length}`,
		);
		add(
			"grounding-complete",
			input.coverageStatus === "complete",
			input.coverageStatus ?? "missing",
		);
	}
	if (Number.isFinite(input.durationMs)) {
		const hardTimeLimitMs =
			Number.isFinite(input.hardTimeLimitMs) && input.hardTimeLimitMs > 0
				? input.hardTimeLimitMs
				: 600_000;
		add(
			"turn-under-hard-time-limit",
			input.timedOut !== true && input.durationMs <= hardTimeLimitMs,
			`${input.durationMs}/${hardTimeLimitMs}ms; timedOut=${input.timedOut === true}`,
		);
		if (input.durationMs > 180_000) {
			add("turn-latency-warning", false, `${input.durationMs}ms`, "warning");
		}
	}

	for (const required of expectation.requiredText ?? []) {
		add(`answer-contains:${required}`, answer.includes(required), required);
	}
	if (expectation.requiredAny) {
		add(
			"answer-matches-required-alternative",
			expectation.requiredAny.some((pattern) => pattern.test(answer)),
			expectation.requiredAny.map(String).join(" | "),
		);
	}
	for (const required of expectation.requiredSources ?? []) {
		add(`source-card:${required}`, sourceNames.has(required), required);
	}
	if (Number.isFinite(expectation.maximumNonWhitespaceCharacters)) {
		const compactLength = answer.replace(/\s/gu, "").length;
		add(
			"answer-length",
			compactLength <= expectation.maximumNonWhitespaceCharacters,
			`${compactLength}/${expectation.maximumNonWhitespaceCharacters}`,
			"warning",
		);
	}

	return {
		checks,
		failures: checks.filter(
			(check) => !check.passed && check.severity === "failure",
		),
		warnings: checks.filter(
			(check) => !check.passed && check.severity === "warning",
		),
	};
}

export function evaluateD1Consistency(rounds, options = undefined) {
	const d1 = rounds.filter((round) => round.turnId.startsWith("D-1."));
	const selectedTurnIds = Array.isArray(options?.selectedTurnIds)
		? options.selectedTurnIds.filter((turnId) => /^D-1\.[123]$/u.test(turnId))
		: null;
	if (selectedTurnIds) {
		if (selectedTurnIds.length === 0) {
			return {
				status: "not_selected",
				passed: null,
				detail: "D-1 consistency was not selected for this run",
			};
		}
		if (selectedTurnIds.length !== 3) {
			return {
				status: "incomplete_selection",
				passed: null,
				detail: `D-1 consistency requires all 3 rounds, selected ${selectedTurnIds.length}`,
			};
		}
		const selected = new Set(selectedTurnIds);
		const executed = d1.filter((round) => selected.has(round.turnId));
		if (executed.length !== 3) {
			const pending = options?.executionComplete === false;
			const status = pending
				? "pending"
				: executed.length === 0
					? "not_executed"
					: "incomplete";
			return {
				status,
				passed: null,
				reason:
					options?.abortReason ??
					(pending
						? "execution_in_progress"
						: "execution_ended_before_d1_complete"),
				detail: `selected 3 D-1 rounds, executed ${executed.length}`,
			};
		}
	}
	if (d1.length !== 3) {
		return {
			passed: false,
			detail: `expected 3 D-1 rounds, received ${d1.length}`,
		};
	}
	const problems = d1.flatMap((round) => {
		const answer = String(round.answer ?? "");
		const routeCoreProblem = orderedRouteCoreProblem(answer);
		const unsafeClauses = affirmativeUnsafeRouteClauses(answer);
		return [
			...(routeCoreProblem ? [`${round.turnId}:${routeCoreProblem}`] : []),
			...unsafeClauses.map((clause) => {
				const compact = clause.replace(/\s+/gu, " ").slice(0, 96);
				return `${round.turnId}:affirmative-unsafe-route=${compact}`;
			}),
		];
	});
	const result = {
		passed: problems.length === 0,
		detail:
			problems.length === 0 ? "three route cores agree" : problems.join(", "),
	};
	return selectedTurnIds
		? {
				status: result.passed ? "passed" : "inconsistent",
				...result,
			}
		: result;
}
