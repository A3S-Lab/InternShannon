export function shouldRunStartupUpdateCheck(input: {
	isDev: boolean;
	startupCheckedValue: string | null;
}): boolean {
	if (input.isDev) return false;
	return input.startupCheckedValue !== "true";
}
