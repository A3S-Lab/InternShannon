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
  | { kind: "unavailable"; actionError: { message: string; dismissLabel: string }; toastMessage: string };

const LOCAL_COMMAND_DESCRIPTIONS: Record<string, string> = {
  model: "查看或切换当前模型",
  clear: "清空对话历史",
  help: "查看可用命令列表",
};

const KNOWN_COMMAND_DESCRIPTIONS: Record<string, string> = {
  ...LOCAL_COMMAND_DESCRIPTIONS,
  compact: "整理并压缩对话上下文",
  cost: "查看当前会话 Token 用量和费用",
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
  const commands = Array.from(new Set([...LOCAL_COMMANDS, ...normalizedRuntimeCommands]));

  return commands.map((name) => ({
    name,
    description: KNOWN_COMMAND_DESCRIPTIONS[name] ?? "运行时命令",
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

  const hasArguments = commandText.replace(/^\/+/, "").trim().split(/\s+/).length > 1;
  const runtimeCommandSet = new Set(
    (input.runtimeCommands ?? [])
      .filter((command): command is string => typeof command === "string")
      .map(normalizeAgentSlashCommandName)
      .filter((command): command is string => Boolean(command)),
  );

  if (commandName === "clear") {
    if (!hasArguments) return { kind: "clear-session" };
    return unavailableSlashCommand(commandName, "命令不支持参数，请直接输入 /clear 清空当前会话。");
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

  if (KNOWN_RUNTIME_BACKED_COMMANDS.has(commandName) && !runtimeCommandSet.has(commandName)) {
    return unavailableSlashCommand(commandName, `/${commandName} 需要当前内核提供运行时命令后才能使用。草稿已保留。`);
  }

  return { kind: "none" };
}

function unavailableSlashCommand(commandName: string, message: string): AgentSlashCommandDispatchAction {
  return {
    kind: "unavailable",
    actionError: {
      message,
      dismissLabel: `关闭 /${commandName} 命令提示`,
    },
    toastMessage: `当前会话暂不支持 /${commandName}`,
  };
}
