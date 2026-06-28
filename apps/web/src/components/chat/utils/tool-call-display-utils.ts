import type { ReactNode } from "react";

export type ToolKind =
	| "read"
	| "write"
	| "edit"
	| "command"
	| "search"
	| "list"
	| "web"
	| "other";

export interface ToolDisplayMeta {
	label: string;
	icon: ReactNode;
	iconTone: string;
	textTone: string;
	lineTone: string;
	outputTone: string;
}

export function normalizeToolName(name: string): string {
	return name
		.trim()
		.toLowerCase()
		.replace(/[\s-]+/g, "_");
}

export function getToolKind(name: string): ToolKind {
	const n = normalizeToolName(name);
	if (n === "read" || n.includes("read_file")) return "read";
	if (n === "write" || n.includes("write_file")) return "write";
	if (n === "edit" || n === "patch" || n.includes("replace")) return "edit";
	if (n === "bash" || n.includes("shell") || n.includes("exec")) {
		return "command";
	}
	if (
		n === "grep" ||
		n === "glob" ||
		n.includes("search") ||
		n.includes("find")
	) {
		return "search";
	}
	if (n === "ls" || n.includes("list")) return "list";
	if (n.includes("web") || n.includes("fetch") || n.includes("http")) {
		return "web";
	}
	return "other";
}

export function parseToolInput(input?: string): Record<string, unknown> | null {
	if (!input?.trim()) return null;
	try {
		const parsed = JSON.parse(input);
		if (
			parsed &&
			typeof parsed === "object" &&
			"__raw" in (parsed as Record<string, unknown>) &&
			typeof (parsed as Record<string, unknown>).__raw === "string"
		) {
			return parseToolInput(
				(parsed as Record<string, unknown>).__raw as string,
			);
		}
		return parsed && typeof parsed === "object"
			? (parsed as Record<string, unknown>)
			: null;
	} catch {
		return null;
	}
}

export function stringifyShort(value: unknown, max = 120): string {
	const text =
		typeof value === "string"
			? value
			: value == null
				? ""
				: JSON.stringify(value);
	const collapsed = text.replace(/\s+/g, " ").trim();
	return collapsed.length > max ? `${collapsed.slice(0, max)}...` : collapsed;
}

export function extractToolPath(
	input?: string,
	explicitPath?: string,
): string | null {
	if (explicitPath) return explicitPath;
	const parsed = parseToolInput(input);
	const value = parsed?.filePath ?? parsed?.path ?? parsed?.filename;
	if (typeof value === "string" && value.trim()) return value;
	const command = parsed?.command;
	if (typeof command === "string") {
		const match = command.match(/(?:^|\s)([\w.\-/[\]@]+(?:\.[\w]+)?)(?:\s|$)/);
		return match?.[1] ?? null;
	}
	return null;
}

export function summarizeToolInput(
	toolName: string,
	input?: string,
	filePath?: string,
): string {
	const kind = getToolKind(toolName);
	const parsed = parseToolInput(input);
	if (
		parsed &&
		"__display" in parsed &&
		typeof parsed.__display === "string" &&
		parsed.__display.trim()
	) {
		return stringifyShort(parsed.__display, 140);
	}
	if (!parsed) return stringifyShort(input, 140);

	const command = parsed.command ?? parsed.script;
	const query = parsed.query ?? parsed.pattern ?? parsed.regex;
	const url = parsed.url ?? parsed.link;
	const content = parsed.content ?? parsed.text;

	if (kind === "command" && command) return stringifyShort(command, 140);
	if (kind === "search" && query) return stringifyShort(query, 120);
	if (kind === "web" && url) return stringifyShort(url, 140);

	const path = extractToolPath(input, filePath);
	if (path) return path;
	if (content) return stringifyShort(content, 90);

	for (const value of Object.values(parsed)) {
		if (typeof value === "string" && value.trim()) {
			return stringifyShort(value, 120);
		}
	}
	return "";
}

export function getTerminalVerb(
	kind: ToolKind,
	isRunning: boolean,
	isError?: boolean,
): string {
	if (isError) return "执行失败";
	if (isRunning) {
		const running: Record<ToolKind, string> = {
			read: "正在读取",
			write: "正在写入",
			edit: "正在修改",
			command: "正在执行",
			search: "正在搜索",
			list: "正在浏览",
			web: "正在访问",
			other: "正在使用",
		};
		return running[kind];
	}
	const done: Record<ToolKind, string> = {
		read: "已读取",
		write: "已写入",
		edit: "已修改",
		command: "已执行",
		search: "已搜索",
		list: "已浏览",
		web: "已访问",
		other: "已使用",
	};
	return done[kind];
}

export function getCanonicalToolName(kind: ToolKind): string {
	const names: Record<ToolKind, string> = {
		read: "Read",
		write: "Write",
		edit: "Edit",
		command: "Bash",
		search: "Search",
		list: "List",
		web: "Fetch",
		other: "Tool",
	};
	return names[kind];
}

export function formatToolInvocation(
	toolName: string,
	input?: string,
	filePath?: string,
): string {
	const kind = getToolKind(toolName);
	const name = getCanonicalToolName(kind);
	const summary = summarizeToolInput(toolName, input, filePath);
	return summary ? `${name}(${summary})` : name;
}

export function getToolInvocationParts(
	toolName: string,
	input?: string,
	filePath?: string,
): { name: string; args: string } {
	const kind = getToolKind(toolName);
	return {
		name: getCanonicalToolName(kind),
		args: summarizeToolInput(toolName, input, filePath),
	};
}

export function summarizeToolResult(
	kind: ToolKind,
	output?: string,
	isError?: boolean,
	active?: boolean,
): string {
	if (active && !output && !isError) return "运行中...";
	if (isError) return "出错";
	if (!output?.trim()) return "已完成";

	const lines = output.split("\n").filter((line) => line.trim().length > 0);
	if (kind === "read") return `读取 ${lines.length} 行`;
	if (kind === "list") return `${lines.length} 项`;
	if (kind === "search") return `${lines.length} 条匹配`;
	if (kind === "write") return "已写入文件";
	if (kind === "edit") return "已修改文件";

	const firstLine = stringifyShort(lines[0] ?? output, 96);
	return firstLine || "已完成";
}

export function shouldShowToolPreviewByDefault(
	kind: ToolKind,
	hasVisualOutput: boolean,
	isError?: boolean,
): boolean {
	if (!hasVisualOutput) return false;
	if (isError) return true;
	return (
		kind === "read" ||
		kind === "edit" ||
		kind === "command" ||
		kind === "search" ||
		kind === "list" ||
		kind === "web"
	);
}
