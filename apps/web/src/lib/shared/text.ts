export function isMarkdown(text: string): boolean {
	const markdownPatterns = [
		/^(#{1,6})\s/,
		/^[-*+]\s|\d+\.\s/,
		/\[(.*?)\]\((.*?)\)/,
		/\*\*(.*?)\*\*|__(.*?)__/,
		// biome-ignore lint/correctness/noEmptyCharacterClassInRegex: markdown text can contain arbitrary blocks
		/```[^]*```|`[^`]*`/,
		/^> /,
		/!\[(.*?)\]\((.*?)\)/,
		/\|[^|]+/g,
		/([-*_]){3,}/,
	];

	return markdownPatterns.some((pattern) => pattern.test(text));
}
