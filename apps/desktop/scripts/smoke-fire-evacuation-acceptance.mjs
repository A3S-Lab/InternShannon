#!/usr/bin/env node

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { io } from "socket.io-client";
import {
	acceptanceFrameRunId,
	acceptanceLifecycleDiagnostics,
	classifyAcceptanceTurnFrame,
	detectAcceptanceLifecycleFailure,
	isAcceptanceLifecycleErrorCode,
	sanitizeAcceptanceSidecarLog,
	selectPersistedTurnMessages,
} from "./acceptance-turn-terminal.mjs";
import { resolveControlledA3sPackage } from "./controlled-a3s-package.mjs";
import {
	acceptanceFixtureFingerprint,
	acceptanceNormalizedTurnsFingerprint,
	acceptanceQuestionScriptFingerprint,
	assertFireAcceptanceFixture,
	assertFireAcceptanceQuestionScript,
	buildFireAcceptanceIsolatedConfig,
	discoverFireAcceptanceSources,
	evaluateD1Consistency,
	evaluateFireAcceptanceRound,
	FIRE_ACCEPTANCE_MODEL,
	FIRE_ACCEPTANCE_MODEL_ID,
	FIRE_ACCEPTANCE_PROVIDER,
	FIRE_ACCEPTANCE_SESSION_KEYS,
	FIRE_ACCEPTANCE_SOURCE_NAMES,
	FIRE_ACCEPTANCE_TURN_IDS,
	fireAcceptanceConfirmationDecision,
	parseFireAcceptanceKnowledgeLogLine,
	selectFireAcceptanceKnowledgeLog,
	updateFireAcceptanceFailureCategoryCounts,
} from "./fire-evacuation-acceptance-contract.mjs";
import { inspectBundledSdk } from "./verify-sdk-runtime.mjs";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, "../../..");
const WORKSPACE_ROOT = path.dirname(REPO_ROOT);
const DEFAULT_RESOURCES_DIR =
	process.platform === "darwin"
		? "/Applications/InternShannon.app/Contents/Resources"
		: path.join(REPO_ROOT, "apps/desktop/src-tauri/target/release/bundle");
const DEFAULT_DATA_DIR =
	process.env.INTERNSHANNON_DATA_DIR?.trim() ||
	path.join(os.homedir(), ".internshannon");
const DEFAULT_FIXTURE_ROOT = path.join(
	WORKSPACE_ROOT,
	"outputs/fire-simulation-20260728",
);
const DEFAULT_TIMEOUT_MS = 600_000;
const API_ORIGIN = "tauri://localhost";
const LOG_LIMIT = 2_000_000;
const DIAGNOSTIC_LOG_LIMIT = 262_144;
const SOURCE_CONFIG_FILE = "config.json";

function parseArgs(argv) {
	const args = {
		resourcesDir: DEFAULT_RESOURCES_DIR,
		sourceDataDir: DEFAULT_DATA_DIR,
		fixtureDir: path.join(DEFAULT_FIXTURE_ROOT, "导入知识库"),
		questionScript: path.join(
			DEFAULT_FIXTURE_ROOT,
			"测试控制-不要导入知识库/01-会话问题脚本.md",
		),
		skillRoot: path.join(DEFAULT_FIXTURE_ROOT, "导入技能"),
		reportPath: null,
		timeoutMs: DEFAULT_TIMEOUT_MS,
		canaryTurnIds: null,
		maxFailedRounds: 3,
		preflightOnly: false,
		runRealProvider: false,
	};
	for (let index = 0; index < argv.length; index += 1) {
		const token = argv[index];
		if (token === "--dir") {
			args.resourcesDir = argv[++index];
		} else if (token === "--source-data-dir") {
			args.sourceDataDir = argv[++index];
		} else if (token === "--fixture-dir") {
			args.fixtureDir = argv[++index];
		} else if (token === "--question-script") {
			args.questionScript = argv[++index];
		} else if (token === "--skill-root") {
			args.skillRoot = argv[++index];
		} else if (token === "--report") {
			args.reportPath = argv[++index];
		} else if (token === "--timeout-ms") {
			args.timeoutMs = Number(argv[++index]);
		} else if (token === "--canary-turn-ids") {
			args.canaryTurnIds = String(argv[++index] ?? "")
				.split(",")
				.map((value) => value.trim())
				.filter(Boolean);
		} else if (token === "--max-failed-rounds") {
			args.maxFailedRounds = Number(argv[++index]);
		} else if (token === "--preflight-only") {
			args.preflightOnly = true;
		} else if (token === "--yes-run-real-provider") {
			args.runRealProvider = true;
		} else if (token === "--help" || token === "-h") {
			args.help = true;
		} else {
			throw new Error(`Unknown argument: ${token}`);
		}
	}
	for (const key of [
		"resourcesDir",
		"sourceDataDir",
		"fixtureDir",
		"questionScript",
		"skillRoot",
	]) {
		args[key] = path.resolve(args[key]);
	}
	if (args.reportPath) args.reportPath = path.resolve(args.reportPath);
	if (!Number.isFinite(args.timeoutMs) || args.timeoutMs < 30_000) {
		throw new Error(
			`--timeout-ms must be at least 30000, received ${args.timeoutMs}`,
		);
	}
	if (
		!Number.isSafeInteger(args.maxFailedRounds) ||
		args.maxFailedRounds < 1 ||
		args.maxFailedRounds > 28
	) {
		throw new Error(
			`--max-failed-rounds must be an integer from 1 to 28, received ${args.maxFailedRounds}`,
		);
	}
	if (args.canaryTurnIds && args.canaryTurnIds.length === 0) {
		throw new Error("--canary-turn-ids must contain at least one turn id");
	}
	if (!args.preflightOnly && !args.runRealProvider) {
		throw new Error(
			"Refusing an accidental paid/provider run. Pass --preflight-only or explicitly pass --yes-run-real-provider.",
		);
	}
	if (args.runRealProvider && !args.reportPath) {
		throw new Error("--report is required for a real-provider acceptance run");
	}
	return args;
}

function printHelp() {
	console.log(
		[
			"Usage:",
			"  node scripts/smoke-fire-evacuation-acceptance.mjs --preflight-only [--report <json>]",
			"  node scripts/smoke-fire-evacuation-acceptance.mjs --yes-run-real-provider --report <json> [options]",
			"",
			`The gate is fixed to ${FIRE_ACCEPTANCE_MODEL}; it never changes the model or the user's live data.`,
			"It starts the packaged Sidecar on a random loopback port with a temporary data directory,",
			"writes a minimal boyue/gpt-5-only config, imports exactly the 14 fixtures, and runs 28 prompts in 9 sessions.",
			"Web search, external MCP, browser binaries, and inherited credential environment variables are disabled.",
			"",
			"Options:",
			"  --dir <resources>          Installed/built app Resources directory",
			"  --source-data-dir <dir>   Read-only source of config.json; only boyue/gpt-5 fields are copied",
			"  --fixture-dir <dir>       Directory containing exactly 6 Markdown + 8 CSV sources",
			"  --question-script <path>  01-会话问题脚本.md",
			"  --skill-root <dir>        Parent directory of fire-evacuation-simulation",
			"  --timeout-ms <ms>         Per-turn hard wait (default 600000)",
			"  --canary-turn-ids <ids>   Run an ordered comma-separated subset of original turn ids",
			"  --max-failed-rounds <n>   Stop when one failure category reaches n rounds (default 3)",
			"  --report <path>           Atomic JSON report; a Markdown companion is also written",
		].join("\n"),
	);
}

function isFile(filePath) {
	try {
		return fs.statSync(filePath).isFile();
	} catch {
		return false;
	}
}

function findSidecarDir(resourcesDir) {
	for (const candidate of [resourcesDir, path.join(resourcesDir, "sidecar")]) {
		if (isFile(path.join(candidate, "main.js"))) return candidate;
	}
	throw new Error(`Packaged sidecar main.js is missing under ${resourcesDir}`);
}

function findBundledNode(resourcesDir, sidecarDir) {
	const candidates = [
		path.join(resourcesDir, "node/bin/node"),
		path.join(resourcesDir, "node/node.exe"),
		path.join(sidecarDir, "node/bin/node"),
		path.join(sidecarDir, "node/node.exe"),
	];
	return candidates.find(isFile) ?? process.execPath;
}

function sha256File(filePath) {
	return createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function inspectRuntimeFingerprint(resourcesDir) {
	const expectedControlled = resolveControlledA3sPackage();
	const sdk = inspectBundledSdk(resourcesDir, {
		requireControlled: true,
		expectedControlled,
	});
	if (!sdk.ok) {
		throw new Error(
			`Controlled SDK fingerprint failed: ${sdk.issues.join("; ")}`,
		);
	}
	const sidecarDir = findSidecarDir(resourcesDir);
	const manifestPath = [
		path.join(resourcesDir, "sidecar-resource-manifest.json"),
		path.join(sidecarDir, "sidecar-resource-manifest.json"),
	].find(isFile);
	return {
		resourcesDir,
		sidecarMainSha256: sha256File(path.join(sidecarDir, "main.js")),
		resourceManifestSha256: manifestPath ? sha256File(manifestPath) : null,
		codeSdkVersion: sdk.codePackage?.version ?? null,
		controlledVersion: sdk.controlledLocalA3s?.version ?? null,
		controlledPackageSha256: sdk.controlledLocalA3s?.sha256 ?? null,
		controlledBinarySha256: sdk.controlledLocalA3s?.binarySha256 ?? null,
		controlledSourceRevision: sdk.controlledLocalA3s?.sourceRevision ?? null,
		controlledSourceTreeSha256:
			sdk.controlledLocalA3s?.sourceTreeSha256 ?? null,
		controlledSourceDirty: sdk.controlledLocalA3s?.sourceDirty ?? null,
		platform: sdk.controlledLocalA3s?.platform ?? process.platform,
		arch: sdk.controlledLocalA3s?.arch ?? process.arch,
	};
}

function safeReportPath(reportPath, sourceDataDir, resourcesDir) {
	if (!reportPath) return;
	const target = path.resolve(reportPath);
	for (const protectedRoot of [sourceDataDir, resourcesDir]) {
		const relative = path.relative(path.resolve(protectedRoot), target);
		if (
			relative === "" ||
			(!relative.startsWith("..") && !path.isAbsolute(relative))
		) {
			throw new Error(
				`Report path must not be inside protected runtime data: ${target}`,
			);
		}
	}
}

function preflight(args) {
	if (!isFile(args.questionScript)) {
		throw new Error(`Missing 01 question script: ${args.questionScript}`);
	}
	const questionScript = fs.readFileSync(args.questionScript);
	const questions = assertFireAcceptanceQuestionScript(questionScript);
	const sources = assertFireAcceptanceFixture(
		discoverFireAcceptanceSources(args.fixtureDir),
	);
	const skillFile = path.join(
		args.skillRoot,
		"fire-evacuation-simulation",
		"SKILL.md",
	);
	if (!isFile(skillFile))
		throw new Error(`Missing acceptance skill: ${skillFile}`);
	const sourceConfigPath = path.join(args.sourceDataDir, SOURCE_CONFIG_FILE);
	if (!isFile(sourceConfigPath)) {
		throw new Error(`Missing configured provider file: ${sourceConfigPath}`);
	}
	let sourceConfig;
	try {
		sourceConfig = JSON.parse(fs.readFileSync(sourceConfigPath, "utf8"));
	} catch {
		throw new Error(
			`Configured provider file is not valid JSON: ${sourceConfigPath}`,
		);
	}
	const isolatedConfig = buildFireAcceptanceIsolatedConfig(sourceConfig);
	const fingerprint = inspectRuntimeFingerprint(args.resourcesDir);
	safeReportPath(args.reportPath, args.sourceDataDir, args.resourcesDir);
	return {
		questions,
		sources,
		skillFile,
		isolatedConfig,
		fingerprint,
		fixtureFingerprint: acceptanceFixtureFingerprint(sources),
		questionScriptSha256: acceptanceQuestionScriptFingerprint(questionScript),
		normalizedTurnsFingerprint: acceptanceNormalizedTurnsFingerprint(questions),
	};
}

function appendLog(current, chunk) {
	const updated = `${current}${chunk.toString()}`;
	return updated.length <= LOG_LIMIT
		? updated
		: updated.slice(updated.length - LOG_LIMIT);
}

function appendSidecarLog(logs, stream, chunk) {
	const text = chunk.toString();
	logs[stream] = appendLog(logs[stream], text);
	const combined = `${logs.pending[stream]}${text}`;
	const lines = combined.split(/\r?\n/u);
	logs.pending[stream] = lines.pop() ?? "";
	for (const line of lines) {
		const parsed = parseFireAcceptanceKnowledgeLogLine(line);
		if (!parsed) continue;
		logs.knowledgeSequence += 1;
		logs.knowledgeEntries.push({
			sequence: logs.knowledgeSequence,
			...parsed,
		});
	}
}

function acceptanceDiagnosticLogPaths(reportPath) {
	if (!reportPath) return null;
	const jsonPath = reportPath.endsWith(".json")
		? reportPath
		: `${reportPath}.json`;
	const basePath = jsonPath.replace(/\.json$/u, "");
	return {
		stdoutPath: `${basePath}.sidecar.stdout.log`,
		stderrPath: `${basePath}.sidecar.stderr.log`,
	};
}

function atomicWritePrivateFile(target, content) {
	fs.mkdirSync(path.dirname(target), { recursive: true });
	const temporary = `${target}.tmp-${process.pid}`;
	fs.writeFileSync(temporary, content, { encoding: "utf8", mode: 0o600 });
	fs.renameSync(temporary, target);
}

function writeAcceptanceDiagnosticLogs(reportPath, logs) {
	const paths = acceptanceDiagnosticLogPaths(reportPath);
	if (!paths || !logs) return null;
	const stdout = sanitizeAcceptanceSidecarLog(
		logs.stdout,
		DIAGNOSTIC_LOG_LIMIT,
	);
	const stderr = sanitizeAcceptanceSidecarLog(
		logs.stderr,
		DIAGNOSTIC_LOG_LIMIT,
	);
	atomicWritePrivateFile(paths.stdoutPath, stdout);
	atomicWritePrivateFile(paths.stderrPath, stderr);
	return {
		...paths,
		redacted: true,
		maxBytesPerStream: DIAGNOSTIC_LOG_LIMIT,
		stdoutBytes: Buffer.byteLength(stdout, "utf8"),
		stderrBytes: Buffer.byteLength(stderr, "utf8"),
		stdoutSha256: createHash("sha256").update(stdout).digest("hex"),
		stderrSha256: createHash("sha256").update(stderr).digest("hex"),
	};
}

function aggregateErrorFingerprintCounts(rounds) {
	const counts = {};
	for (const round of rounds ?? []) {
		for (const [fingerprint, count] of Object.entries(
			round?.lifecycleDiagnostics?.errorFingerprintCounts ?? {},
		)) {
			if (!Number.isSafeInteger(count) || count < 1) continue;
			counts[fingerprint] = (counts[fingerprint] ?? 0) + count;
		}
	}
	return counts;
}

function acceptanceChildEnvironment(dataDir, temporaryDir, port, workspaceDir) {
	const env = {};
	for (const key of [
		"PATH",
		"LANG",
		"LC_ALL",
		"LC_CTYPE",
		"TZ",
		"SSL_CERT_FILE",
		"SSL_CERT_DIR",
		"NODE_EXTRA_CA_CERTS",
		"SYSTEMROOT",
		"WINDIR",
		"COMSPEC",
		"PATHEXT",
	]) {
		if (process.env[key]) env[key] = process.env[key];
	}
	return {
		...env,
		HOME: dataDir,
		USERPROFILE: dataDir,
		XDG_CONFIG_HOME: path.join(dataDir, "xdg-config"),
		XDG_CACHE_HOME: path.join(dataDir, "xdg-cache"),
		TMPDIR: temporaryDir,
		TEMP: temporaryDir,
		TMP: temporaryDir,
		APP_PORT: String(port),
		APP_HOST: "127.0.0.1",
		APP_MODE: "desktop",
		NODE_ENV: "production",
		INTERNSHANNON_DATA_DIR: dataDir,
		KERNEL_WORKSPACE_STORAGE_PROVIDER: "local",
		KERNEL_MODELS_CONFIG_TTL_MS: "0",
		INTERNSHANNON_ACCEPTANCE_WORKSPACE: workspaceDir,
		NO_PROXY: "127.0.0.1,localhost",
		no_proxy: "127.0.0.1,localhost",
		LIGHTPANDA: "",
		LIGHTPANDA_PATH: "",
		LIGHTPANDA_EXECUTABLE: "",
		CHROME: "",
		CHROME_BIN: "",
		GOOGLE_CHROME_BIN: "",
		BROWSER: "",
	};
}

function getFreePort() {
	return new Promise((resolve, reject) => {
		const server = net.createServer();
		server.unref();
		server.once("error", reject);
		server.listen(0, "127.0.0.1", () => {
			const address = server.address();
			if (!address || typeof address === "string") {
				server.close(() =>
					reject(new Error("Failed to allocate loopback port")),
				);
				return;
			}
			server.close(() => resolve(address.port));
		});
	});
}

function startSidecar({
	resourcesDir,
	sidecarDir,
	dataDir,
	temporaryDir,
	workspaceDir,
	port,
	logs,
}) {
	const executable = findBundledNode(resourcesDir, sidecarDir);
	const child = spawn(executable, [path.join(sidecarDir, "main.js")], {
		cwd: sidecarDir,
		env: acceptanceChildEnvironment(dataDir, temporaryDir, port, workspaceDir),
		stdio: ["ignore", "pipe", "pipe"],
	});
	child.stdout.on("data", (chunk) => {
		appendSidecarLog(logs, "stdout", chunk);
	});
	child.stderr.on("data", (chunk) => {
		appendSidecarLog(logs, "stderr", chunk);
	});
	child.on("error", (error) => {
		logs.spawnError = error instanceof Error ? error.message : String(error);
	});
	return child;
}

function terminateChild(child) {
	return new Promise((resolve) => {
		if (!child || child.exitCode !== null || child.signalCode !== null) {
			resolve();
			return;
		}
		const timer = setTimeout(() => child.kill("SIGKILL"), 3_000);
		child.once("exit", () => {
			clearTimeout(timer);
			resolve();
		});
		child.kill("SIGTERM");
	});
}

async function waitForHealth(apiBase, timeoutMs, child, logs) {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		if (logs.spawnError) {
			throw new Error(`Isolated Sidecar failed to spawn: ${logs.spawnError}`);
		}
		if (child.exitCode !== null || child.signalCode !== null) {
			throw new Error(
				`Isolated Sidecar exited before health: ${child.exitCode ?? child.signalCode}\n${logs.stderr.slice(-4000)}`,
			);
		}
		try {
			const response = await fetch(`${apiBase}/health`);
			if (response.ok) return;
		} catch {
			// Still starting.
		}
		await new Promise((resolve) => setTimeout(resolve, 200));
	}
	throw new Error(
		`Timed out waiting for isolated Sidecar health after ${timeoutMs}ms`,
	);
}

async function apiRequest(apiBase, pathname, init = {}) {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), init.timeoutMs ?? 120_000);
	const { timeoutMs: _timeoutMs, ...requestInit } = init;
	try {
		const response = await fetch(`${apiBase}${pathname}`, {
			...requestInit,
			signal: controller.signal,
			headers: {
				Origin: API_ORIGIN,
				...(requestInit.body ? { "Content-Type": "application/json" } : {}),
				...requestInit.headers,
			},
		});
		const text = await response.text();
		let value = text;
		try {
			value = text ? JSON.parse(text) : null;
		} catch {
			// Preserve a text error body.
		}
		if (!response.ok) {
			throw new Error(
				`${requestInit.method ?? "GET"} ${pathname} failed ${response.status}: ${JSON.stringify(value)}`,
			);
		}
		return value && typeof value === "object" && "data" in value
			? value.data
			: value;
	} finally {
		clearTimeout(timer);
	}
}

function assertConfiguredModel(config) {
	const providers = Array.isArray(config?.llm?.providers)
		? config.llm.providers
		: [];
	if (config?.llm?.defaultModel !== FIRE_ACCEPTANCE_MODEL) {
		throw new Error(
			`Isolated default model is ${config?.llm?.defaultModel ?? "missing"}, expected ${FIRE_ACCEPTANCE_MODEL}`,
		);
	}
	if (providers.length !== 1) {
		throw new Error(
			`Isolated config must expose exactly one provider, received ${providers.length}`,
		);
	}
	const provider = providers.find(
		(item) => item?.name === FIRE_ACCEPTANCE_PROVIDER,
	);
	if (!provider)
		throw new Error(
			`Isolated config does not contain exact provider ${FIRE_ACCEPTANCE_PROVIDER}`,
		);
	const models = Array.isArray(provider.models) ? provider.models : [];
	if (models.length !== 1 || models[0]?.id !== FIRE_ACCEPTANCE_MODEL_ID) {
		throw new Error(
			`Isolated config must contain only ${FIRE_ACCEPTANCE_MODEL}`,
		);
	}
	if (
		(!provider.apiKey || provider.apiKey === "[missing]") &&
		(!models[0]?.apiKey || models[0].apiKey === "[missing]")
	) {
		throw new Error(
			"boyue/gpt-5 has no configured credential in the isolated config",
		);
	}
	if ((config?.llm?.mcpServers ?? []).length !== 0) {
		throw new Error("Isolated LLM config unexpectedly enabled MCP servers");
	}
	if ((config?.search?.enabledEngines ?? []).length !== 0) {
		throw new Error("Isolated config unexpectedly enabled web search engines");
	}
	if (config?.assistant?.model !== FIRE_ACCEPTANCE_MODEL) {
		throw new Error("Isolated assistant override is not fixed to boyue/gpt-5");
	}
	if ((config?.assistant?.mcpServers ?? []).length !== 0) {
		throw new Error(
			"Isolated assistant config unexpectedly enabled MCP servers",
		);
	}
}

async function seedKnowledge(apiBase, sources, timeoutMs) {
	const asset = await apiRequest(apiBase, "/assets/me/knowledge", {
		timeoutMs,
	});
	if (!asset?.id)
		throw new Error("Personal knowledge bootstrap returned no asset id");
	for (let offset = 0; offset < sources.length; offset += 6) {
		await apiRequest(
			apiBase,
			`/assets/${encodeURIComponent(asset.id)}/wiki/sources`,
			{
				method: "POST",
				timeoutMs,
				body: JSON.stringify({
					sources: sources.slice(offset, offset + 6).map((source) => ({
						name: source.name,
						originalPath: source.path,
						contentBase64: fs.readFileSync(source.path).toString("base64"),
					})),
				}),
			},
		);
	}
	const reindex = await apiRequest(
		apiBase,
		`/assets/${encodeURIComponent(asset.id)}/wiki/reindex`,
		{ method: "POST", body: "{}", timeoutMs },
	);
	const listed = await apiRequest(
		apiBase,
		`/assets/${encodeURIComponent(asset.id)}/wiki/sources`,
		{ timeoutMs },
	);
	const names = (Array.isArray(listed) ? listed : [])
		.map((source) => path.basename(source.path ?? source.name ?? ""))
		.sort((left, right) => left.localeCompare(right, "zh-CN"));
	if (JSON.stringify(names) !== JSON.stringify(FIRE_ACCEPTANCE_SOURCE_NAMES)) {
		throw new Error(
			`Isolated source catalog is not exactly 14 sources: ${JSON.stringify(names)}`,
		);
	}
	const unhealthy = listed.filter((source) => source.status !== "indexed");
	if (unhealthy.length > 0) {
		throw new Error(
			`Isolated source indexing is incomplete: ${JSON.stringify(unhealthy.map((source) => ({ path: source.path, status: source.status, error: source.error })))}`,
		);
	}
	if (Number(reindex?.sourceCount) !== FIRE_ACCEPTANCE_SOURCE_NAMES.length) {
		throw new Error(
			`Reindex counted ${reindex?.sourceCount ?? "unknown"} sources instead of 14`,
		);
	}
	return {
		assetId: asset.id,
		sourceCount: names.length,
		chunkCount: reindex?.chunkCount ?? null,
		indexRevision: reindex?.revision ?? reindex?.indexRevision ?? null,
		sources: listed.map((source) => ({
			path: source.path,
			status: source.status,
			chunkCount: source.chunkCount,
		})),
	};
}

function waitForSocket(socket, eventName, predicate, timeoutMs = 10_000) {
	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => {
			cleanup();
			reject(new Error(`${eventName} timed out after ${timeoutMs}ms`));
		}, timeoutMs);
		const handler = (payload) => {
			if (!predicate(payload)) return;
			cleanup();
			resolve(payload);
		};
		const cleanup = () => {
			clearTimeout(timer);
			socket.off(eventName, handler);
		};
		socket.on(eventName, handler);
	});
}

async function connectSessionSocket(gatewayUrl, sessionId) {
	const socket = io(`${gatewayUrl}/ws/kernel`, {
		transports: ["websocket"],
		extraHeaders: { Origin: API_ORIGIN },
		reconnection: false,
		forceNew: true,
		timeout: 10_000,
	});
	await waitForSocket(socket, "connect", () => true, 10_000);
	if (socket.io.engine.transport.name !== "websocket") {
		socket.close();
		throw new Error(
			`Expected websocket transport, got ${socket.io.engine.transport.name}`,
		);
	}
	const subscribed = waitForSocket(
		socket,
		"subscribed",
		(payload) => payload?.sessionId === sessionId,
		10_000,
	);
	socket.emit("subscribe", { sessionId });
	await subscribed;
	return socket;
}

function textFromFrame(frame) {
	if (frame?.type === "stream_event" && typeof frame.event?.text === "string") {
		return frame.event.text;
	}
	if (frame?.type !== "assistant") return "";
	const content = frame.content ?? frame.message?.content;
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.map((block) => block?.text ?? block?.content ?? "")
		.filter((value) => typeof value === "string")
		.join("");
}

function acceptanceHarnessError(code, message) {
	const error = new Error(message);
	error.code = code;
	return error;
}

function runSocketTurn(
	socket,
	sessionId,
	prompt,
	timeoutMs,
	{ configuredSkills = [], approvedSkillNames = new Set() } = {},
) {
	return new Promise((resolve, reject) => {
		const frames = [];
		const confirmations = [];
		const errorFrames = [];
		let streamedText = "";
		let expectedRunId = null;
		let timedOut = false;
		let cancellationAcknowledged = false;
		let cancellationResultObserved = false;
		let statusPoll = null;
		let settlementTimer = null;
		const timeoutError = (settled) => {
			const error = new Error(
				`Turn timed out after ${timeoutMs}ms; cancel settlement ${settled ? "completed" : "failed"}; runId=${expectedRunId ?? "unknown"}; partial=${JSON.stringify(streamedText.slice(-1000))}`,
			);
			error.code = settled
				? "acceptance_turn_timeout"
				: "acceptance_cancel_settlement_failed";
			error.runId = expectedRunId;
			error.frames = frames;
			return error;
		};
		const lifecycleError = (failure) => {
			const error = new Error(
				`Acceptance lifecycle failure (${failure.code}): ${failure.detail}; runId=${expectedRunId ?? "unknown"}`,
			);
			error.code = failure.code;
			error.runId = expectedRunId;
			error.frames = frames;
			error.lifecycleFailure = failure;
			return error;
		};
		const rejectLifecycle = (failure) => {
			cleanup();
			reject(lifecycleError(failure));
		};
		const finishTimedOutTurn = (settled) => {
			cleanup();
			reject(timeoutError(settled));
		};
		const timer = setTimeout(() => {
			timedOut = true;
			if (!expectedRunId) {
				finishTimedOutTurn(false);
				return;
			}
			socket.emit("message", {
				sessionId,
				type: "cancel",
				runId: expectedRunId,
			});
			statusPoll = setInterval(() => {
				socket.emit("message", {
					sessionId,
					type: "session_status",
					requestId: `acceptance-timeout-${expectedRunId ?? Date.now()}`,
				});
			}, 250);
			settlementTimer = setTimeout(() => finishTimedOutTurn(false), 15_000);
		}, timeoutMs);
		const messageHandler = (frame) => {
			frames.push(frame);
			streamedText += textFromFrame(frame);
			const event = frame?.event ?? frame;
			if (
				!expectedRunId &&
				event?.type === "main_agent_activity" &&
				event?.phase === "intake" &&
				typeof event?.runId === "string"
			) {
				expectedRunId = event.runId;
			}
			const lifecycleFailure = detectAcceptanceLifecycleFailure({
				frames: [frame],
				expectedRunId,
				requireRunId: frame?.type === "result",
				answer: streamedText,
			});
			if (lifecycleFailure) {
				rejectLifecycle(lifecycleFailure);
				return;
			}
			const classified = classifyAcceptanceTurnFrame(frame, expectedRunId);
			if (classified.error) errorFrames.push(classified.error);
			if (timedOut) {
				const frameRunId = acceptanceFrameRunId(frame);
				if (
					frame?.type === "cancelled" &&
					frameRunId === expectedRunId &&
					frame.cancelled === true
				) {
					cancellationAcknowledged = true;
				}
				if (
					frame?.type === "result" &&
					frameRunId === expectedRunId &&
					frame?.data?.status === "cancelled" &&
					frame?.data?.stopReason === "user_cancelled"
				) {
					cancellationResultObserved = true;
				}
				if (
					frame?.type === "session_status" &&
					frame?.data?.runtimeBusy === false &&
					cancellationAcknowledged &&
					cancellationResultObserved
				) {
					finishTimedOutTurn(true);
				}
				return;
			}
			if (classified.terminal) {
				cleanup();
				resolve({
					frames,
					confirmations,
					errorFrames,
					streamedText,
					result: classified.result,
					runId: expectedRunId ?? classified.runId,
				});
			}
		};
		const disconnectHandler = (reason) => {
			rejectLifecycle({
				code: "acceptance_socket_disconnected",
				detail: `WebSocket disconnected before the current run settled (${String(reason ?? "unknown")})`,
			});
		};
		const connectErrorHandler = () => {
			rejectLifecycle({
				code: "acceptance_socket_disconnected",
				detail: "WebSocket transport failed before the current run settled",
			});
		};
		const confirmationHandler = (request) => {
			if (request?.sessionId !== sessionId) return;
			const decision = fireAcceptanceConfirmationDecision({
				toolName: request.toolName,
				toolInput:
					request.toolInput ??
					request.input ??
					request.tool?.input ??
					request.data,
				configuredSkills,
				approvedSkillNames,
			});
			const approved = decision.approved;
			confirmations.push({
				requestId: request.requestId,
				toolName: request.toolName,
				approved,
				kind: decision.kind,
				...(decision.skillName ? { skillName: decision.skillName } : {}),
			});
			socket.emit("tool_confirmation_response", {
				requestId: request.requestId,
				approved,
				scope: "once",
				toolName: request.toolName,
			});
		};
		const cleanup = () => {
			clearTimeout(timer);
			if (settlementTimer) clearTimeout(settlementTimer);
			if (statusPoll) clearInterval(statusPoll);
			socket.off("message", messageHandler);
			socket.off("tool_confirmation_request", confirmationHandler);
			socket.off("disconnect", disconnectHandler);
			socket.off("connect_error", connectErrorHandler);
		};
		socket.on("message", messageHandler);
		socket.on("tool_confirmation_request", confirmationHandler);
		socket.on("disconnect", disconnectHandler);
		socket.on("connect_error", connectErrorHandler);
		socket.emit("message", {
			sessionId,
			type: "user_message",
			content: prompt,
		});
	});
}

function waitForSessionRuntimeIdle(socket, sessionId, timeoutMs = 15_000) {
	return new Promise((resolve, reject) => {
		const prefix = `acceptance-idle-${Date.now()}-`;
		let sequence = 0;
		let retryTimer = null;
		const timeout = setTimeout(() => {
			cleanup();
			reject(
				acceptanceHarnessError(
					"acceptance_runtime_not_idle",
					"session did not report runtimeBusy=false with no activeRunId after terminal result",
				),
			);
		}, timeoutMs);
		const request = () => {
			socket.emit("message", {
				sessionId,
				type: "session_status",
				requestId: `${prefix}${sequence++}`,
			});
		};
		const handler = (frame) => {
			if (
				frame?.type !== "session_status" ||
				typeof frame.requestId !== "string" ||
				!frame.requestId.startsWith(prefix)
			) {
				return;
			}
			if (
				frame?.data?.runtimeBusy === false &&
				!(
					typeof frame?.data?.activeRunId === "string" && frame.data.activeRunId
				)
			) {
				cleanup();
				resolve(frame.data);
				return;
			}
			retryTimer = setTimeout(request, 50);
		};
		const cleanup = () => {
			clearTimeout(timeout);
			if (retryTimer) clearTimeout(retryTimer);
			socket.off("message", handler);
		};
		socket.on("message", handler);
		request();
	});
}

async function waitForTurnMessages(
	apiBase,
	sessionId,
	beforeMessageIds,
	emittedAssistantId,
	expectedRunId,
	timeoutMs,
) {
	const deadline = Date.now() + timeoutMs;
	let latest = null;
	while (Date.now() < deadline) {
		latest = await apiRequest(
			apiBase,
			`/kernel/sessions/${encodeURIComponent(sessionId)}/messages?limit=100`,
			{ timeoutMs: Math.min(timeoutMs, 30_000) },
		);
		const selected = selectPersistedTurnMessages(
			messageItems(latest),
			beforeMessageIds,
			emittedAssistantId,
			expectedRunId,
		);
		if (selected.complete) return latest;
		if (expectedRunId) {
			const currentUsers = selected.current.filter(
				(message) => message?.role === "user",
			);
			if (
				currentUsers.length > 0 &&
				!currentUsers.some((message) => message?.id === expectedRunId)
			) {
				throw acceptanceHarnessError(
					"acceptance_persistence_mismatch",
					"Persisted user message id did not match the current runId",
				);
			}
			const currentAssistants = selected.current.filter(
				(message) => message?.role === "assistant",
			);
			const mismatchedAssistant = currentAssistants.find((message) => {
				if (emittedAssistantId && message?.id !== emittedAssistantId)
					return false;
				return message?.metadata?.parentRunId !== expectedRunId;
			});
			if (mismatchedAssistant) {
				throw acceptanceHarnessError(
					"acceptance_persistence_mismatch",
					"Persisted assistant parentRunId did not match the current runId",
				);
			}
		}
		await new Promise((resolve) => setTimeout(resolve, 100));
	}
	throw acceptanceHarnessError(
		"acceptance_persistence_mismatch",
		`Message persistence timed out before the current user/assistant pair became visible; actual=${latest?.total ?? "unknown"}`,
	);
}

function sessionModel(sessionPayload) {
	const session = sessionPayload?.session ?? sessionPayload;
	return session?.model ?? session?.metadata?.model ?? null;
}

function assistantToolNames(message, frames) {
	const names = [];
	for (const block of message?.metadata?.contentBlocks ?? []) {
		if (block?.type === "tool_use" && block.name) names.push(block.name);
	}
	for (const frame of frames ?? []) {
		const event = frame?.event ?? frame;
		for (const candidate of [event?.toolName, event?.tool_name, event?.name]) {
			if (typeof candidate === "string" && candidate.trim())
				names.push(candidate.trim());
		}
		const frameBlocks = Array.isArray(frame?.message?.content)
			? frame.message.content
			: Array.isArray(frame?.content)
				? frame.content
				: [];
		for (const block of frameBlocks) {
			if (block?.type === "tool_use" && typeof block.name === "string") {
				names.push(block.name);
			}
		}
	}
	return [...new Set(names)];
}

function messageItems(payload) {
	if (Array.isArray(payload?.messages)) return payload.messages;
	if (Array.isArray(payload?.items)) return payload.items;
	return [];
}

function assistantFrameMessageId(frames) {
	for (let index = (frames ?? []).length - 1; index >= 0; index -= 1) {
		const frame = frames[index];
		if (frame?.type !== "assistant") continue;
		const id = frame?.message?.id ?? frame?.id;
		if (typeof id === "string" && id.trim()) return id;
	}
	return null;
}

function sanitizeSource(source) {
	return {
		ref: source?.ref ?? null,
		path: source?.relativePath ?? source?.path ?? null,
		title: source?.title ?? null,
		evidence: source?.evidence ?? null,
		locators: Array.isArray(source?.locators) ? source.locators : [],
	};
}

async function runAcceptanceSessions({
	apiBase,
	gatewayUrl,
	questions,
	sessionKeys = FIRE_ACCEPTANCE_SESSION_KEYS,
	skillRoot,
	workspaceDir,
	timeoutMs,
	logs,
	maxFailedRounds = 3,
	onProgress,
}) {
	const rounds = [];
	const sessions = [];
	let failureCategoryRoundCounts = {
		content: 0,
		coverage: 0,
		citation: 0,
	};
	for (const sessionKey of sessionKeys) {
		const created = await apiRequest(apiBase, "/kernel/sessions", {
			method: "POST",
			timeoutMs,
			body: JSON.stringify({
				agentId: "default",
				title: `01 real acceptance ${sessionKey}`,
				cwd: workspaceDir,
				model: FIRE_ACCEPTANCE_MODEL,
				maxExecutionTimeMs: Math.max(30_000, timeoutMs - 60_000),
				followDefaultModel: false,
				permissionMode: "default",
				builtinSkills: false,
				planningMode: "disabled",
				goalTracking: false,
				mcpServers: [],
				searchConfig: { enabledEngines: [] },
				skills: ["fire-evacuation-simulation"],
				skillDirs: [skillRoot],
				autoDelegation: { enabled: false },
				autoParallel: false,
			}),
		});
		const sessionId = created?.session?.sessionId;
		if (!sessionId)
			throw new Error(`Session ${sessionKey} creation returned no id`);
		const initialModel = sessionModel(created);
		if (initialModel !== FIRE_ACCEPTANCE_MODEL) {
			throw new Error(
				`Session ${sessionKey} was created with ${initialModel ?? "no model"}, expected ${FIRE_ACCEPTANCE_MODEL}`,
			);
		}
		if (created?.session?.followDefaultModel !== false) {
			throw new Error(
				`Session ${sessionKey} did not preserve followDefaultModel=false`,
			);
		}
		const sessionReport = {
			sessionKey,
			sessionId,
			model: initialModel,
			followDefaultModel: false,
		};
		sessions.push(sessionReport);
		const socket = await connectSessionSocket(gatewayUrl, sessionId);
		const configuredSkills = ["fire-evacuation-simulation"];
		const approvedSkillNames = new Set();
		try {
			for (const turn of questions.filter(
				(item) => item.sessionKey === sessionKey,
			)) {
				const beforeMessages = await apiRequest(
					apiBase,
					`/kernel/sessions/${encodeURIComponent(sessionId)}/messages?limit=100`,
					{ timeoutMs: 30_000 },
				);
				const beforeMessageIds = new Set(
					messageItems(beforeMessages)
						.map((message) => message?.id)
						.filter((id) => typeof id === "string"),
				);
				const beforeSession = await apiRequest(
					apiBase,
					`/kernel/sessions/${encodeURIComponent(sessionId)}`,
					{ timeoutMs: 30_000 },
				);
				const modelBefore = sessionModel(beforeSession);
				const followDefaultModelBefore = beforeSession?.followDefaultModel;
				const knowledgeSequenceBefore = logs.knowledgeSequence;
				const startedAt = Date.now();
				let socketRound = null;
				let roundError = null;
				let roundRunId = null;
				let roundFrames = [];
				let roundTimedOut = false;
				let abortSessionAfterRound = false;
				let roundLifecycleFailure = null;
				try {
					socketRound = await runSocketTurn(
						socket,
						sessionId,
						turn.prompt,
						timeoutMs,
						{ configuredSkills, approvedSkillNames },
					);
				} catch (error) {
					roundError = error instanceof Error ? error.message : String(error);
					roundRunId = typeof error?.runId === "string" ? error.runId : null;
					roundFrames = Array.isArray(error?.frames) ? error.frames : [];
					roundTimedOut =
						error?.code === "acceptance_turn_timeout" ||
						error?.code === "acceptance_cancel_settlement_failed";
					abortSessionAfterRound = isAcceptanceLifecycleErrorCode(error?.code);
					roundLifecycleFailure =
						error?.lifecycleFailure ??
						(abortSessionAfterRound
							? {
									code: error.code,
									detail:
										error instanceof Error ? error.message : String(error),
								}
							: null);
				}
				roundRunId ??= socketRound?.runId ?? null;
				if (socketRound?.frames) roundFrames = socketRound.frames;
				const durationMs = Date.now() - startedAt;
				const emittedAssistantId = assistantFrameMessageId(roundFrames);
				let persisted = null;
				try {
					persisted = abortSessionAfterRound
						? await apiRequest(
								apiBase,
								`/kernel/sessions/${encodeURIComponent(sessionId)}/messages?limit=100`,
								{ timeoutMs: 30_000 },
							)
						: await waitForTurnMessages(
								apiBase,
								sessionId,
								beforeMessageIds,
								emittedAssistantId,
								roundRunId,
								Math.min(timeoutMs, 30_000),
							);
				} catch (error) {
					roundError ??= error instanceof Error ? error.message : String(error);
					if (isAcceptanceLifecycleErrorCode(error?.code)) {
						abortSessionAfterRound = true;
						roundLifecycleFailure ??= {
							code: error.code,
							detail: error instanceof Error ? error.message : String(error),
						};
					}
				}
				const messages = messageItems(persisted);
				const currentMessages = messages.filter(
					(message) =>
						typeof message?.id === "string" &&
						!beforeMessageIds.has(message.id),
				);
				const assistant =
					(emittedAssistantId
						? currentMessages.find(
								(message) =>
									message?.id === emittedAssistantId &&
									message?.metadata?.parentRunId === roundRunId,
							)
						: null) ??
					currentMessages.find(
						(message) =>
							message?.role === "assistant" &&
							message?.metadata?.parentRunId === roundRunId,
					);
				await new Promise((resolve) => setTimeout(resolve, 25));
				const knowledgeLog = selectFireAcceptanceKnowledgeLog(
					logs.knowledgeEntries,
					sessionId,
					knowledgeSequenceBefore,
					roundRunId,
				);
				let runtimeIdle = null;
				if (!abortSessionAfterRound) {
					try {
						runtimeIdle = await waitForSessionRuntimeIdle(
							socket,
							sessionId,
							15_000,
						);
					} catch (error) {
						roundError ??=
							error instanceof Error ? error.message : String(error);
						abortSessionAfterRound = true;
						roundLifecycleFailure ??= {
							code: isAcceptanceLifecycleErrorCode(error?.code)
								? error.code
								: "acceptance_runtime_not_idle",
							detail: error instanceof Error ? error.message : String(error),
						};
					}
				}
				const current = await apiRequest(
					apiBase,
					`/kernel/sessions/${encodeURIComponent(sessionId)}`,
					{ timeoutMs: 30_000 },
				).catch(() => null);
				const answer = String(
					assistant?.content ?? socketRound?.streamedText ?? "",
				);
				const toolNames = assistantToolNames(assistant, roundFrames);
				const sources = (assistant?.metadata?.knowledgeSources ?? []).map(
					sanitizeSource,
				);
				const persistedPair = {
					userId:
						currentMessages.find(
							(message) =>
								message?.role === "user" && message?.id === roundRunId,
						)?.id ?? null,
					assistantId: assistant?.id ?? null,
					parentRunId: assistant?.metadata?.parentRunId ?? null,
					matched:
						Boolean(roundRunId) &&
						currentMessages.some(
							(message) =>
								message?.role === "user" && message?.id === roundRunId,
						) &&
						Boolean(assistant?.id) &&
						assistant?.metadata?.parentRunId === roundRunId,
				};
				const sessionIdle =
					runtimeIdle?.runtimeBusy === false && !runtimeIdle?.activeRunId;
				const lifecycleDiagnostics = acceptanceLifecycleDiagnostics(
					roundFrames,
					roundRunId,
				);
				roundLifecycleFailure ??= detectAcceptanceLifecycleFailure({
					frames: roundFrames,
					expectedRunId: roundRunId,
					requireRunId: true,
					errorMessage: roundError,
					answer,
					persistedPair,
					...(runtimeIdle ? { runtimeIdle } : {}),
				});
				if (roundLifecycleFailure) {
					abortSessionAfterRound = true;
					roundError ??= roundLifecycleFailure.detail;
				}
				const resultStatus = roundError
					? "failed"
					: (socketRound?.result?.status ?? "missing");
				const evaluation = evaluateFireAcceptanceRound({
					turn,
					answer,
					toolNames,
					sources,
					resultStatus,
					modelBefore,
					modelAfter: sessionModel(current),
					followDefaultModelBefore,
					followDefaultModelAfter: current?.followDefaultModel,
					durationMs,
					hardTimeLimitMs: timeoutMs,
					timedOut: roundTimedOut,
					knowledgeLogCount: knowledgeLog.count,
					loggedSourceCount: knowledgeLog.latest?.sourceCount ?? null,
					unverifiedCitationCount:
						knowledgeLog.latest?.unverifiedCitationCount ?? null,
					coverageStatus:
						assistant?.metadata?.knowledgeContinuation?.status ?? null,
				});
				const harnessChecks = [
					{
						id: "run-id-correlated",
						passed:
							Boolean(roundRunId) &&
							lifecycleDiagnostics.ignoredForeignRunFrames === 0,
						detail: `${roundRunId ?? "missing"}; foreign=${lifecycleDiagnostics.ignoredForeignRunFrames}`,
						severity: "failure",
					},
					{
						id: "persisted-run-pair",
						passed: persistedPair.matched === true,
						detail: `${persistedPair.userId ?? "missing"}/${persistedPair.parentRunId ?? "missing"}`,
						severity: "failure",
					},
					{
						id: "session-runtime-idle",
						passed: sessionIdle === true,
						detail: `runtimeBusy=${String(runtimeIdle?.runtimeBusy ?? "missing")}; activeRunId=${runtimeIdle?.activeRunId ?? "none"}`,
						severity: "failure",
					},
					{
						id: "no-lifecycle-error",
						passed: roundLifecycleFailure === null,
						detail: roundLifecycleFailure?.code ?? "none",
						severity: "failure",
					},
				];
				evaluation.checks.push(...harnessChecks);
				evaluation.failures.push(
					...harnessChecks.filter((check) => !check.passed),
				);
				const roundReport = {
					turnId: turn.id,
					sessionKey,
					sessionId,
					runId: roundRunId,
					prompt: turn.prompt,
					answer,
					resultStatus,
					error: roundError,
					transportErrors:
						socketRound?.errorFrames ??
						roundFrames
							.filter((frame) => frame?.type === "error")
							.map((frame) => String(frame?.message ?? "WebSocket run error")),
					lifecycleDiagnostics,
					lifecycleFailure: roundLifecycleFailure,
					durationMs,
					hardTimeLimitMs: timeoutMs,
					timedOut: roundTimedOut,
					modelBefore,
					modelAfter: sessionModel(current),
					followDefaultModelBefore,
					followDefaultModelAfter: current?.followDefaultModel,
					knowledgeLogCount: knowledgeLog.count,
					loggedSourceCount: knowledgeLog.latest?.sourceCount ?? null,
					unverifiedCitationCount:
						knowledgeLog.latest?.unverifiedCitationCount ?? null,
					citationRejectionReasons: knowledgeLog.latest?.rejectionReasons ?? {},
					citationRejectionSamples: knowledgeLog.latest?.rejectionSamples ?? [],
					toolNames,
					confirmations: socketRound?.confirmations ?? [],
					totalTokens: assistant?.metadata?.totalTokens ?? null,
					coverage: assistant?.metadata?.knowledgeContinuation ?? null,
					sources,
					checks: evaluation.checks,
					failureCount: evaluation.failures.length,
					failureCategories: [],
					warningCount: evaluation.warnings.length,
					persistedPair,
					sessionIdle,
				};
				const failureFuse = updateFireAcceptanceFailureCategoryCounts({
					counts: failureCategoryRoundCounts,
					failures: evaluation.failures,
					limit: maxFailedRounds,
				});
				roundReport.failureCategories = failureFuse.categories;
				failureCategoryRoundCounts = failureFuse.counts;
				rounds.push(roundReport);
				await onProgress?.({
					sessions,
					rounds,
					failureCategoryRoundCounts,
				});
				if (abortSessionAfterRound) {
					return {
						sessions,
						rounds,
						aborted: {
							reason:
								roundLifecycleFailure?.code ?? "lifecycle_integrity_failed",
							turnId: turn.id,
						},
					};
				}
				if (failureFuse.triggeredCategory) {
					return {
						sessions,
						rounds,
						aborted: {
							reason: "failed_round_limit",
							turnId: turn.id,
							failureCategory: failureFuse.triggeredCategory,
							failureCategoryRoundCounts,
						},
					};
				}
			}
		} finally {
			socket.close();
		}
	}
	return { sessions, rounds, aborted: null };
}

function reportMarkdown(report) {
	const automaticGate =
		report.mode === "preflight"
			? "未执行（仅预检）"
			: report.summary.automaticPassed
				? "通过"
				: "失败";
	const lines = [
		"# 书小安知识库 01 完整会话真实链路验收",
		"",
		`- 时间：${report.createdAt}`,
		`- 固定模型：\`${report.model}\``,
		`- 自动切换：禁止`,
		`- 受控 SDK：\`${report.runtimeFingerprint.controlledVersion}\``,
		`- 14 来源指纹：\`${report.fixture.fingerprint}\``,
		`- 会话/轮次：${report.summary.executedSessions}/${report.summary.executedTurns}`,
		`- 预检：${report.summary.preflightPassed ? "通过" : "失败"}`,
		`- 自动门禁：${automaticGate}`,
		`- 人工评分：待按 02-人工验收与参考答案.md 填写（需 >=90 且无一票否决）`,
		"",
		"| 轮次 | 状态 | 耗时 | Token | 来源 | 自动失败 | 警告 |",
		"|---|---|---:|---:|---:|---:|---:|",
	];
	for (const round of report.rounds ?? []) {
		lines.push(
			`| ${round.turnId} | ${round.resultStatus} | ${(round.durationMs / 1000).toFixed(1)}s | ${round.totalTokens ?? "-"} | ${round.sources.length} | ${round.failureCount} | ${round.warningCount} |`,
		);
	}
	for (const round of report.rounds ?? []) {
		lines.push(
			"",
			`## ${round.turnId}`,
			"",
			"### 问题",
			"",
			round.prompt,
			"",
			"### 回答",
			"",
			round.answer || "_(无回答)_",
		);
		const failed = round.checks.filter((check) => !check.passed);
		if (failed.length > 0) {
			lines.push("", "### 未通过的自动检查", "");
			for (const check of failed) {
				lines.push(`- [${check.severity}] ${check.id}: ${check.detail}`);
			}
		}
		const rejectionReasons = Object.entries(
			round.citationRejectionReasons ?? {},
		);
		if (rejectionReasons.length > 0) {
			lines.push(
				"",
				`引用拒绝原因（仅类型计数）：${rejectionReasons
					.map(([reason, count]) => `${reason}=${count}`)
					.join(", ")}`,
			);
		}
		if (round.sources.length > 0) {
			lines.push("", "### 结构化来源", "");
			for (const source of round.sources) {
				lines.push(
					`- ${source.path ?? source.title ?? "unknown"} (${source.evidence ?? "unknown"})${source.locators.length ? `: ${source.locators.join(", ")}` : ""}`,
				);
			}
		}
	}
	return `${lines.join("\n")}\n`;
}

function writeReport(reportPath, report) {
	if (!reportPath) return;
	fs.mkdirSync(path.dirname(reportPath), { recursive: true });
	const jsonPath = reportPath.endsWith(".json")
		? reportPath
		: `${reportPath}.json`;
	const markdownPath = jsonPath.replace(/\.json$/u, ".md");
	for (const [target, content] of [
		[jsonPath, `${JSON.stringify(report, null, 2)}\n`],
		[markdownPath, reportMarkdown(report)],
	]) {
		const temporary = `${target}.tmp-${process.pid}`;
		fs.writeFileSync(temporary, content, { encoding: "utf8", mode: 0o600 });
		fs.renameSync(temporary, target);
	}
}

async function main() {
	const args = parseArgs(process.argv.slice(2));
	if (args.help) {
		printHelp();
		return;
	}
	const verified = preflight(args);
	const requestedTurnIds = args.canaryTurnIds
		? Array.from(new Set(args.canaryTurnIds))
		: FIRE_ACCEPTANCE_TURN_IDS;
	const unknownTurnIds = requestedTurnIds.filter(
		(turnId) => !FIRE_ACCEPTANCE_TURN_IDS.includes(turnId),
	);
	if (unknownTurnIds.length > 0) {
		throw new Error(`Unknown --canary-turn-ids: ${unknownTurnIds.join(", ")}`);
	}
	const requestedTurnIdSet = new Set(requestedTurnIds);
	const executionQuestions = verified.questions.filter((turn) =>
		requestedTurnIdSet.has(turn.id),
	);
	if (executionQuestions.length !== requestedTurnIds.length) {
		throw new Error(
			`Canary turn selection mismatch: requested=${requestedTurnIds.length} selected=${executionQuestions.length}`,
		);
	}
	const executionSessionKeys = FIRE_ACCEPTANCE_SESSION_KEYS.filter(
		(sessionKey) =>
			executionQuestions.some((turn) => turn.sessionKey === sessionKey),
	);
	const selectedD1TurnIds = executionQuestions
		.map((turn) => turn.id)
		.filter((turnId) => /^D-1\./u.test(turnId));
	const isCanary = Boolean(args.canaryTurnIds);
	const report = {
		schemaVersion: 1,
		createdAt: new Date().toISOString(),
		mode: args.preflightOnly
			? "preflight"
			: isCanary
				? "real-provider-canary"
				: "real-provider",
		model: FIRE_ACCEPTANCE_MODEL,
		automaticModelSwitch: false,
		executionPolicy: {
			turnHardLimitMs: args.timeoutMs,
			cancelSettlementLimitMs: 15_000,
			maxFailedRounds: args.maxFailedRounds,
			failureFuseScope: "per-category-rounds",
		},
		runtimeFingerprint: verified.fingerprint,
		fixture: {
			fingerprint: verified.fixtureFingerprint,
			sourceCount: verified.sources.length,
			sources: verified.sources.map(({ name, size, sha256 }) => ({
				name,
				size,
				sha256,
			})),
		},
		questionContract: {
			questionScript: args.questionScript,
			questionScriptSha256: verified.questionScriptSha256,
			normalizedTurnsFingerprint: verified.normalizedTurnsFingerprint,
			turnCount: verified.questions.length,
			sessionCount: FIRE_ACCEPTANCE_SESSION_KEYS.length,
			turnIds: FIRE_ACCEPTANCE_TURN_IDS,
			executionTurnIds: executionQuestions.map((turn) => turn.id),
			executionSessionKeys,
		},
		isolatedKnowledge: null,
		executionAbort: null,
		sessions: [],
		rounds: [],
		errors: [],
		diagnostics: {
			sidecarLogs: args.preflightOnly
				? null
				: acceptanceDiagnosticLogPaths(args.reportPath),
		},
		summary: {
			preflightPassed: true,
			executedSessions: 0,
			executedTurns: 0,
			automaticFailureCount: 0,
			failureCategoryRoundCounts: {
				content: 0,
				coverage: 0,
				citation: 0,
			},
			warningCount: 0,
			errorFingerprintCounts: {},
			d1Consistency: null,
			automaticPassed: null,
			humanScore: null,
			vetoCount: null,
		},
	};
	if (args.preflightOnly) {
		writeReport(args.reportPath, report);
		console.log(
			`Fire acceptance preflight OK: model=${FIRE_ACCEPTANCE_MODEL} sources=14 turns=28 sessions=9 fixture=${verified.fixtureFingerprint} script=${verified.questionScriptSha256} normalizedTurns=${verified.normalizedTurnsFingerprint}`,
		);
		return;
	}

	let isolatedRoot = null;
	let child = null;
	let sidecarLogs = null;
	let runError = null;
	try {
		isolatedRoot = fs.mkdtempSync(
			path.join(os.tmpdir(), "internshannon-fire-acceptance."),
		);
		const dataDir = path.join(isolatedRoot, "data");
		const workspaceDir = path.join(isolatedRoot, "workspace");
		const temporaryDir = path.join(isolatedRoot, "tmp");
		for (const directory of [dataDir, workspaceDir, temporaryDir]) {
			fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
		}
		fs.writeFileSync(
			path.join(dataDir, SOURCE_CONFIG_FILE),
			`${JSON.stringify(verified.isolatedConfig, null, 2)}\n`,
			{ encoding: "utf8", mode: 0o600 },
		);
		const sidecarDir = findSidecarDir(args.resourcesDir);
		const port = await getFreePort();
		const gatewayUrl = `http://127.0.0.1:${port}`;
		const apiBase = `${gatewayUrl}/api/v1`;
		sidecarLogs = {
			stdout: "",
			stderr: "",
			pending: { stdout: "", stderr: "" },
			knowledgeEntries: [],
			knowledgeSequence: 0,
			spawnError: null,
		};
		child = startSidecar({
			resourcesDir: args.resourcesDir,
			sidecarDir,
			dataDir,
			temporaryDir,
			workspaceDir,
			port,
			logs: sidecarLogs,
		});
		await waitForHealth(
			apiBase,
			Math.min(args.timeoutMs, 120_000),
			child,
			sidecarLogs,
		);
		const config = await apiRequest(apiBase, "/config", { timeoutMs: 30_000 });
		assertConfiguredModel(config);
		report.isolatedKnowledge = await seedKnowledge(
			apiBase,
			verified.sources,
			args.timeoutMs,
		);
		const executed = await runAcceptanceSessions({
			apiBase,
			gatewayUrl,
			questions: executionQuestions,
			sessionKeys: executionSessionKeys,
			skillRoot: args.skillRoot,
			workspaceDir,
			timeoutMs: args.timeoutMs,
			logs: sidecarLogs,
			maxFailedRounds: args.maxFailedRounds,
			onProgress: async ({ sessions, rounds, failureCategoryRoundCounts }) => {
				report.sessions = [...sessions];
				report.rounds = [...rounds];
				report.summary = {
					...report.summary,
					executedSessions: sessions.length,
					executedTurns: rounds.length,
					automaticFailureCount: rounds.reduce(
						(total, round) => total + round.failureCount,
						0,
					),
					failureCategoryRoundCounts,
					warningCount: rounds.reduce(
						(total, round) => total + round.warningCount,
						0,
					),
					errorFingerprintCounts: aggregateErrorFingerprintCounts(rounds),
					d1Consistency: evaluateD1Consistency(rounds, {
						selectedTurnIds: selectedD1TurnIds,
						executionComplete: false,
					}),
					automaticPassed: false,
				};
				writeReport(args.reportPath, report);
			},
		});
		report.sessions = executed.sessions;
		report.rounds = executed.rounds;
		report.executionAbort = executed.aborted;
		const d1Consistency = evaluateD1Consistency(executed.rounds, {
			selectedTurnIds: selectedD1TurnIds,
			executionComplete: true,
			abortReason: executed.aborted?.reason,
		});
		const d1GatePassed =
			selectedD1TurnIds.length === 0 ||
			(selectedD1TurnIds.length === 3 && d1Consistency.passed === true);
		report.summary = {
			...report.summary,
			executedSessions: executed.sessions.length,
			executedTurns: executed.rounds.length,
			automaticFailureCount: executed.rounds.reduce(
				(total, round) => total + round.failureCount,
				0,
			),
			warningCount: executed.rounds.reduce(
				(total, round) => total + round.warningCount,
				0,
			),
			failureCategoryRoundCounts: executed.rounds.reduce(
				(counts, round) => {
					for (const category of round.failureCategories ?? []) {
						counts[category] += 1;
					}
					return counts;
				},
				{ content: 0, coverage: 0, citation: 0 },
			),
			errorFingerprintCounts: aggregateErrorFingerprintCounts(executed.rounds),
			d1Consistency,
			automaticPassed:
				!executed.aborted &&
				executed.sessions.length === executionSessionKeys.length &&
				executed.rounds.length === executionQuestions.length &&
				executed.rounds.every((round) => round.failureCount === 0) &&
				executed.rounds.every(
					(round) => round.persistedPair?.matched === true,
				) &&
				executed.rounds.every((round) => round.sessionIdle === true) &&
				executed.rounds.every((round) => !round.lifecycleFailure) &&
				d1GatePassed,
		};
		if (executed.aborted) {
			const failureCategory = executed.aborted.failureCategory
				? ` category=${executed.aborted.failureCategory}`
				: "";
			const message = `Acceptance fuse triggered: ${executed.aborted.reason} at ${executed.aborted.turnId}${failureCategory}`;
			report.errors.push(message);
			runError = new Error(message);
		}
	} catch (error) {
		report.errors.push(error instanceof Error ? error.message : String(error));
		runError = error;
	} finally {
		const cleanupErrors = [];
		try {
			await terminateChild(child);
		} catch (error) {
			cleanupErrors.push(
				`Failed to terminate isolated Sidecar: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
		try {
			report.diagnostics.sidecarLogs = writeAcceptanceDiagnosticLogs(
				args.reportPath,
				sidecarLogs,
			);
		} catch (error) {
			cleanupErrors.push(
				`Failed to write redacted Sidecar diagnostics: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
		if (isolatedRoot) {
			try {
				fs.rmSync(isolatedRoot, { recursive: true, force: true });
			} catch (error) {
				cleanupErrors.push(
					`Failed to remove isolated acceptance profile: ${error instanceof Error ? error.message : String(error)}`,
				);
			}
		}
		if (cleanupErrors.length > 0) {
			report.errors.push(...cleanupErrors);
			runError ??= new Error(cleanupErrors.join("; "));
		}
		try {
			writeReport(args.reportPath, report);
		} catch (error) {
			runError ??= error;
		}
	}
	if (runError) throw runError;
	if (!report.summary.automaticPassed) {
		throw new Error(
			`Fire acceptance automatic gate failed: failures=${report.summary.automaticFailureCount} turns=${report.summary.executedTurns}/${executionQuestions.length}`,
		);
	}
	console.log(
		`Fire acceptance automatic gate OK: mode=${report.mode} model=${FIRE_ACCEPTANCE_MODEL} sources=14 turns=${executionQuestions.length} sessions=${executionSessionKeys.length} report=${args.reportPath}`,
	);
}

main().catch((error) => {
	console.error(`smoke-fire-evacuation-acceptance: ${error.message}`);
	process.exit(1);
});
