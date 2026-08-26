export interface AgentSlashCommandSuggestion {
	name: string;
	description: string;
}

export interface AgentSlashCommandDispatchInput {
	commandText: string;
	hasImages: boolean;
	runtimeCommands?: readonly string[] | null;
	showStatusBar: boolean;
	showModelSwitcher: boolean;
}

export type AgentSlashCommandDispatchAction =
	| { kind: "none" }
	| { kind: "clear-session" }
	| { kind: "focus-model"; toastMessage: string }
	| { kind: "show-help"; toastMessage: string }
	| {
			kind: "local-info";
			commandName:
				| "history"
				| "mcp"
				| "tools"
				| "skills"
				| "status"
				| "context";
	  }
	| {
			kind: "unavailable";
			actionError: { message: string; dismissLabel: string };
			toastMessage: string;
	  };

const LOCAL_COMMAND_DESCRIPTIONS: Record<string, string> = {
	model: "查看或切换当前模型",
	clear: "清空对话历史",
	help: "查看可用命令列表",
	history: "查看当前会话的消息历史与最近操作",
	mcp: "查看当前会话已连接的 MCP 工具服务",
	tools: "查看当前会话可以调用的工具及状态",
	skills: "查看当前会话已加载的技能",
	status: "查看模型、连接和运行时状态",
	context: "查看当前会话上下文占用比例",
};

const KNOWN_COMMAND_DESCRIPTIONS: Record<string, string> = {
	...LOCAL_COMMAND_DESCRIPTIONS,
	compact: "整理并压缩对话上下文",
	cost: "查看当前会话 Token 用量和费用",
	history: "查看当前会话的消息历史与最近操作",
	mcp: "查看当前会话已连接的 MCP 工具服务",
	tools: "查看当前会话可以调用的工具及状态",
	skills: "查看当前会话已加载的技能",
	status: "查看模型、连接和运行时状态",
};

const LOCAL_COMMANDS = Object.keys(LOCAL_COMMAND_DESCRIPTIONS);
const KNOWN_RUNTIME_BACKED_COMMANDS = new Set(["compact", "cost"]);

export function normalizeAgentSlashCommandName(command: string): string | null {
	const name = command.trim().replace(/^\/+/, "").split(/\s+/)[0]?.trim();
	if (!name || name === "btw") return null;
	return name;
}

export function resolveAgentSlashCommandSuggestions(
	runtimeCommands?: readonly string[] | null,
): AgentSlashCommandSuggestion[] {
	const normalizedRuntimeCommands = (runtimeCommands ?? [])
		.filter((command): command is string => typeof command === "string")
		.map(normalizeAgentSlashCommandName)
		.filter((command): command is string => Boolean(command));
	const commands = Array.from(
		new Set([...LOCAL_COMMANDS, ...normalizedRuntimeCommands]),
	);

	return commands.map((name) => ({
		name,
		description: KNOWN_COMMAND_DESCRIPTIONS[name] ?? "由当前内核提供的扩展命令",
	}));
}

export function resolveAgentSlashCommandDispatchAction(
	input: AgentSlashCommandDispatchInput,
): AgentSlashCommandDispatchAction {
	if (input.hasImages) return { kind: "none" };

	const commandText = input.commandText.trim();
	if (!commandText.startsWith("/")) return { kind: "none" };

	const commandName = normalizeAgentSlashCommandName(commandText);
	if (!commandName) return { kind: "none" };

	const hasArguments =
		commandText.replace(/^\/+/, "").trim().split(/\s+/).length > 1;
	const runtimeCommandSet = new Set(
		(input.runtimeCommands ?? [])
			.filter((command): command is string => typeof command === "string")
			.map(normalizeAgentSlashCommandName)
			.filter((command): command is string => Boolean(command)),
	);

	if (commandName === "clear") {
		if (!hasArguments) return { kind: "clear-session" };
		return unavailableSlashCommand(
			commandName,
			"命令不支持参数，请直接输入 /clear 清空当前会话。",
		);
	}

	if (commandName === "model") {
		return {
			kind: "focus-model",
			toastMessage:
				input.showStatusBar && input.showModelSwitcher
					? "已定位到模型选择器，可按 Enter 打开"
					: "当前视图未显示模型选择器，可在设置页调整默认模型",
		};
	}

	if (commandName === "help") {
		return {
			kind: "show-help",
			toastMessage: "已打开快捷键与命令帮助",
		};
	}

	if (
		["history", "mcp", "tools", "skills", "status", "context"].includes(
			commandName,
		)
	) {
		if (hasArguments)
			return unavailableSlashCommand(
				commandName,
				`/${commandName} 不支持参数，请直接输入命令。`,
			);
		return {
			kind: "local-info",
			commandName: commandName as
				| "history"
				| "mcp"
				| "tools"
				| "skills"
				| "status"
				| "context",
		};
	}

	if (
		KNOWN_RUNTIME_BACKED_COMMANDS.has(commandName) &&
		!runtimeCommandSet.has(commandName)
	) {
		return unavailableSlashCommand(
			commandName,
			`/${commandName} 需要当前内核提供运行时命令后才能使用。草稿已保留。`,
		);
	}

	return { kind: "none" };
}

export function formatAgentContextUsageMessage(input: {
	usedTokens?: number;
	maxTokens?: number;
	percent?: number;
	estimated?: boolean;
	pendingRefresh?: boolean;
}): string {
	const maxTokens = positiveFiniteNumber(input.maxTokens);
	const usedTokens = nonNegativeFiniteNumber(input.usedTokens);
	if (usedTokens !== undefined && maxTokens !== undefined) {
		const percent = (usedTokens / maxTokens) * 100;
		const source = input.estimated ? "预估" : "实测";
		return `上下文占用 ${formatPercent(percent)}（${formatTokens(usedTokens)} / ${formatTokens(maxTokens)} tokens，${source}）`;
	}

	if (input.pendingRefresh) {
		return maxTokens
			? `上下文已压缩，正在计算压缩后占用（当前上限 ${formatTokens(maxTokens)} tokens）`
			: "上下文已压缩，正在计算压缩后占用";
	}

	if (maxTokens !== undefined) {
		return `正在计算上下文占用（当前上限 ${formatTokens(maxTokens)} tokens）`;
	}
	return "正在计算上下文占用";
}

function formatPercent(value: number): string {
	return `${value.toFixed(1)}%`;
}

function formatTokens(value: number): string {
	return Math.floor(value).toLocaleString("en-US");
}

function positiveFiniteNumber(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value) && value > 0
		? value
		: undefined;
}

function nonNegativeFiniteNumber(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value) && value >= 0
		? value
		: undefined;
}

function unavailableSlashCommand(
	commandName: string,
	message: string,
): AgentSlashCommandDispatchAction {
	return {
		kind: "unavailable",
		actionError: {
			message,
			dismissLabel: `关闭 /${commandName} 命令提示`,
		},
		toastMessage: `当前会话暂不支持 /${commandName}`,
	};
}
