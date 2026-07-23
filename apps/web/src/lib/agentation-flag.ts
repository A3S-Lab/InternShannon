const ENABLED_AGENTATION_VALUES = new Set(["1", "true", "on", "yes", "enabled"]);

export function isAgentationEnabled(value?: string | null): boolean {
	if (value == null) return false;
	return ENABLED_AGENTATION_VALUES.has(value.trim().toLowerCase());
}
