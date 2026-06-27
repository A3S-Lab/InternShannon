import { createRequire } from "node:module";
import { appendFileSync } from "node:fs";
import {
	mkdtemp,
	mkdir,
	readFile,
	readdir,
	rm,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

type ReproMode = "hook-crash" | "send-only";

type ReproOptions = {
	agentConfigPath: string;
	cleanup: boolean;
	mode: ReproMode;
	prompt: string;
	repeat: number;
	workspaceRoot: string;
};

type HookTrace = {
	eventType: string;
	hook: string;
	now: string;
	payloadPreview?: string;
	tool?: string;
	turn?: number;
};

type CodeSdkModule = {
	Agent: {
		create: (configPath: string) => Promise<any>;
	};
	DefaultSecurityProvider: new () => any;
};

const REPRO_CONFIG: ReproOptions & {
	codePackagePath: string | null;
} = {
	agentConfigPath: "",
	cleanup: false,
	codePackagePath: null,
	mode: "hook-crash",
	prompt: [
		"请严格按顺序完成以下任务：",
		"1. 读取当前工作区中的 AGENTS.md。",
		'2. 用文件工具把 "hook crash repro" 写入 output/result.txt。',
		"3. 如果 output/result.txt 已存在，就覆盖它。",
		"4. 最后只返回一句中文，说明已完成写入。",
	].join("\n"),
	repeat: 1,
	workspaceRoot: tmpdir(),
};

async function pathExists(targetPath: string) {
	try {
		await readFile(targetPath);
		return true;
	} catch {
		return false;
	}
}

async function findProjectRoot(startDir: string) {
	let currentDir = resolve(startDir);

	while (true) {
		if (await pathExists(join(currentDir, ".a3s", "config.hcl"))) {
			return currentDir;
		}

		const parentDir = dirname(currentDir);
		if (parentDir === currentDir) {
			throw new Error(
				`未找到项目根目录，请显式传入 CODE_AGENT_CONFIG_PATH。起始目录: ${startDir}`,
			);
		}

		currentDir = parentDir;
	}
}

async function resolveAgentConfigPath() {
	const explicitPath = REPRO_CONFIG.agentConfigPath;
	if (explicitPath?.trim()) {
		return resolve(process.cwd(), explicitPath);
	}

	const projectRoot = await findProjectRoot(process.cwd());
	return join(projectRoot, ".a3s", "config.hcl");
}

async function loadCodeSdk(): Promise<CodeSdkModule> {
	const explicitPath = REPRO_CONFIG.codePackagePath;
	if (explicitPath?.trim()) {
		const requireFromCurrentFile = createRequire(__filename);
		return requireFromCurrentFile(
			resolve(process.cwd(), explicitPath),
		) as CodeSdkModule;
	}

	const projectRoot = await findProjectRoot(process.cwd());
	const pnpmStorePath = join(projectRoot, "node_modules", ".pnpm");
	const entries = await readdir(pnpmStorePath);
	const codeEntries = entries
		.filter((entry) => entry.startsWith("@a3s-lab+code@"))
		.sort((left, right) =>
			right.localeCompare(left, undefined, { numeric: true }),
		);

	const selectedEntry = codeEntries[0];
	if (!selectedEntry) {
		throw new Error(
			`未找到已安装的 @a3s-lab/code 包。查找目录: ${pnpmStorePath}`,
		);
	}

	const modulePath = join(
		pnpmStorePath,
		selectedEntry,
		"node_modules",
		"@a3s-lab",
		"code",
	);
	const requireFromCurrentFile = createRequire(__filename);
	return requireFromCurrentFile(modulePath) as CodeSdkModule;
}

function readOptions(agentConfigPath: string): ReproOptions {
	const repeat =
		Number.isFinite(REPRO_CONFIG.repeat) && REPRO_CONFIG.repeat > 0
			? Math.floor(REPRO_CONFIG.repeat)
			: 1;

	return {
		agentConfigPath,
		cleanup: REPRO_CONFIG.cleanup,
		mode: REPRO_CONFIG.mode,
		prompt: REPRO_CONFIG.prompt,
		repeat,
		workspaceRoot: REPRO_CONFIG.workspaceRoot,
	};
}

async function createWorkspace(workspaceRoot: string) {
	const workspace = await mkdtemp(
		join(resolve(workspaceRoot), "review-classifier-repro-"),
	);
	const outputDir = join(workspace, "output");
	const tracePath = join(workspace, "trace.log");
	const resultPath = join(outputDir, "result.txt");

	await mkdir(outputDir, { recursive: true });
	await writeFile(
		join(workspace, "AGENTS.md"),
		[
			"# Review Classifier Crash Repro",
			"",
			"- 这是一个专门用于复现 @a3s-lab/code native 崩溃的最小工作区。",
			"- 目标不是业务正确，而是稳定触发工具调用与 hook 回调。",
			"- 你必须读取本文件，并把固定文本写入 output/result.txt。",
			"- 不要解释过程，不要提问，不要跳过写文件步骤。",
		].join("\n"),
		"utf8",
	);
	await writeFile(tracePath, "", "utf8");

	return {
		outputDir,
		resultPath,
		tracePath,
		workspace,
	};
}

async function appendTrace(tracePath: string, event: HookTrace) {
	const line = JSON.stringify(event);
	await writeFile(tracePath, `${line}\n`, { encoding: "utf8", flag: "a" });
}

function appendTraceSync(tracePath: string, event: HookTrace) {
	const line = JSON.stringify(event);
	appendFileSync(tracePath, `${line}\n`, { encoding: "utf8", flag: "a" });
}

function toPreview(value: unknown) {
	if (value === null) {
		return "null";
	}

	if (value === undefined) {
		return "undefined";
	}

	if (typeof value === "string") {
		return value.slice(0, 400);
	}

	try {
		return JSON.stringify(value).slice(0, 400);
	} catch {
		return String(value);
	}
}

function registerCrashHook(session: any, tracePath: string) {
	session.registerHook?.(
		"repro-pre-write",
		"pre_tool_use",
		{ tool: "write" },
		{ priority: 1000 },
		(event: Record<string, unknown> | null) => {
			appendTraceSync(tracePath, {
				eventType: "pre_tool_use",
				hook: "repro-pre-write",
				now: new Date().toISOString(),
				payloadPreview: toPreview(event),
				tool: "write",
				turn: typeof event?.turn === "number" ? event.turn : undefined,
			});

			// 故意保留脆弱访问方式，用于最大化复现 native callback -> JS hook 的崩溃链路。
			const input = (event as Record<string, unknown>).input as Record<
				string,
				unknown
			>;
			const targetPath = input.path as string;

			appendTraceSync(tracePath, {
				eventType: "pre_tool_use-path",
				hook: "repro-pre-write",
				now: new Date().toISOString(),
				payloadPreview: targetPath,
				tool: "write",
				turn: typeof event?.turn === "number" ? event.turn : undefined,
			});

			return null;
		},
	);

	session.registerHook?.(
		"repro-pre-edit",
		"pre_tool_use",
		{ tool: "edit" },
		{ priority: 1000 },
		(event: Record<string, unknown> | null) => {
			appendTraceSync(tracePath, {
				eventType: "pre_tool_use",
				hook: "repro-pre-edit",
				now: new Date().toISOString(),
				payloadPreview: toPreview(event),
				tool: "edit",
				turn: typeof event?.turn === "number" ? event.turn : undefined,
			});

			const input = (event as Record<string, unknown>).input as Record<
				string,
				unknown
			>;
			const targetPath = (input.path ??
				input.file_path ??
				input.filePath) as string;

			appendTraceSync(tracePath, {
				eventType: "pre_tool_use-path",
				hook: "repro-pre-edit",
				now: new Date().toISOString(),
				payloadPreview: targetPath,
				tool: "edit",
				turn: typeof event?.turn === "number" ? event.turn : undefined,
			});

			return null;
		},
	);

	session.registerHook?.(
		"repro-pre-patch",
		"pre_tool_use",
		{ tool: "patch" },
		{ priority: 1000 },
		(event: Record<string, unknown> | null) => {
			appendTraceSync(tracePath, {
				eventType: "pre_tool_use",
				hook: "repro-pre-patch",
				now: new Date().toISOString(),
				payloadPreview: toPreview(event),
				tool: "patch",
				turn: typeof event?.turn === "number" ? event.turn : undefined,
			});

			const input = (event as Record<string, unknown>).input as Record<
				string,
				unknown
			>;
			const targetPath = (input.path ??
				input.file_path ??
				input.filePath) as string;

			appendTraceSync(tracePath, {
				eventType: "pre_tool_use-path",
				hook: "repro-pre-patch",
				now: new Date().toISOString(),
				payloadPreview: targetPath,
				tool: "patch",
				turn: typeof event?.turn === "number" ? event.turn : undefined,
			});

			return null;
		},
	);
}

async function runOnce(
	codeSdk: CodeSdkModule,
	agentConfigPath: string,
	options: ReproOptions,
	index: number,
) {
	const agent = await codeSdk.Agent.create(agentConfigPath);
	const artifacts = await createWorkspace(options.workspaceRoot);
	const startedAt = new Date().toISOString();

	const session = agent.session(artifacts.workspace, {
		autoCompact: true,
		continuationEnabled: true,
		maxToolRounds: 12,
		permissive: true,
		role: "你是一个用于触发本地工具调用的最小复现代理。",
		securityProvider: new codeSdk.DefaultSecurityProvider(),
		toolTimeoutMs: 120000,
	});

	if (options.mode === "hook-crash") {
		registerCrashHook(session, artifacts.tracePath);
	}

	await appendTrace(artifacts.tracePath, {
		eventType: "run-start",
		hook: options.mode,
		now: startedAt,
		payloadPreview: options.prompt,
	});

	try {
		const result = await session.send(options.prompt);
		const resultText = typeof result?.text === "string" ? result.text : "";

		await appendTrace(artifacts.tracePath, {
			eventType: "run-finish",
			hook: options.mode,
			now: new Date().toISOString(),
			payloadPreview: resultText,
		});

		return {
			index,
			mode: options.mode,
			resultPath: artifacts.resultPath,
			text: resultText,
			toolCallsCount: result?.toolCallsCount ?? null,
			totalTokens: result?.totalTokens ?? null,
			tracePath: artifacts.tracePath,
			workspace: artifacts.workspace,
		};
	} catch (error) {
		await appendTrace(artifacts.tracePath, {
			eventType: "run-error",
			hook: options.mode,
			now: new Date().toISOString(),
			payloadPreview:
				error instanceof Error ? error.stack || error.message : String(error),
		});
		throw Object.assign(
			error instanceof Error ? error : new Error(String(error)),
			{
				reproArtifacts: artifacts,
				reproIteration: index,
			},
		);
	} finally {
		if (options.cleanup) {
			await rm(artifacts.workspace, { force: true, recursive: true }).catch(
				() => undefined,
			);
		}
	}
}

async function main() {
	const agentConfigPath = await resolveAgentConfigPath();
	const codeSdk = await loadCodeSdk();
	const options = readOptions(agentConfigPath);
	const runs = [];

	for (let index = 1; index <= options.repeat; index += 1) {
		const run = await runOnce(codeSdk, agentConfigPath, options, index);
		runs.push(run);
	}

	// biome-ignore lint/suspicious/noConsole: repro script output
	console.log(
		JSON.stringify(
			{
				agentConfigPath,
				cleanup: options.cleanup,
				mode: options.mode,
				repeat: options.repeat,
				runs,
			},
			null,
			2,
		),
	);
}

main().catch(
	(
		error: Error & {
			reproArtifacts?: Record<string, string>;
			reproIteration?: number;
		},
	) => {
		// biome-ignore lint/suspicious/noConsole: repro script output
		console.error(
			JSON.stringify(
				{
					agentConfigPath: REPRO_CONFIG.agentConfigPath || ".a3s/config.hcl",
					cleanup: REPRO_CONFIG.cleanup,
					error: error?.stack || error?.message || String(error),
					iteration: error?.reproIteration ?? null,
					mode: REPRO_CONFIG.mode,
					reproArtifacts: error?.reproArtifacts ?? null,
					repeat: REPRO_CONFIG.repeat,
				},
				null,
				2,
			),
		);
		process.exitCode = 1;
	},
);
