const DISABLED_AGENTATION_VALUES = new Set(["0", "false", "off", "no"]);

export function isAgentationEnabled(value?: string | null): boolean {
	if (value == null) return true;
	return !DISABLED_AGENTATION_VALUES.has(value.trim().toLowerCase());
}
