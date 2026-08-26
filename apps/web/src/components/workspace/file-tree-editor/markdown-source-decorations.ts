export interface MarkdownSourceDecoration {
	startLineNumber: number;
	startColumn: number;
	endLineNumber: number;
	endColumn: number;
	className: string;
}

/**
 * Stable Markdown colour cues for packaged WebViews.
 *
 * Monaco's Monarch tokens remain the primary syntax highlighter. These small
 * decorations cover the structural Markdown users rely on when a WebKit build
 * fails to paint the dynamically generated token-theme stylesheet.
 */
export function buildMarkdownSourceDecorations(
	content: string,
): MarkdownSourceDecoration[] {
	const decorations: MarkdownSourceDecoration[] = [];
	const lines = content.split("\n");
	let insideFence = false;

	const addRange = (
		line: number,
		startColumn: number,
		endColumn: number,
		className: string,
	) => {
		if (endColumn <= startColumn) return;
		decorations.push({
			startLineNumber: line,
			startColumn,
			endLineNumber: line,
			endColumn,
			className,
		});
	};

	for (let index = 0; index < lines.length; index++) {
		const lineNumber = index + 1;
		const line = lines[index] ?? "";
		const fence = /^\s*(```+|~~~+)/.exec(line);
		if (fence) {
			addRange(
				lineNumber,
				1,
				line.length + 1,
				"file-tree-editor-md-code",
			);
			insideFence = !insideFence;
			continue;
		}
		if (insideFence) {
			addRange(
				lineNumber,
				1,
				line.length + 1,
				"file-tree-editor-md-code",
			);
			continue;
		}

		if (/^\s{0,3}#{1,6}(?:\s|$)/.test(line)) {
			addRange(
				lineNumber,
				1,
				line.length + 1,
				"file-tree-editor-md-heading",
			);
		}

		const listMarker = /^(\s*)([-+*]|\d+[.)])\s+/.exec(line);
		if (listMarker) {
			const start = (listMarker[1]?.length ?? 0) + 1;
			addRange(
				lineNumber,
				start,
				start + (listMarker[2]?.length ?? 0),
				"file-tree-editor-md-marker",
			);
		}

		const quoteMarker = /^(\s*>+)/.exec(line);
		if (quoteMarker) {
			addRange(
				lineNumber,
				1,
				(quoteMarker[1]?.length ?? 0) + 1,
				"file-tree-editor-md-marker",
			);
		}

		for (const match of line.matchAll(/`[^`\n]+`/g)) {
			const start = (match.index ?? 0) + 1;
			addRange(
				lineNumber,
				start,
				start + match[0].length,
				"file-tree-editor-md-code",
			);
		}
		for (const match of line.matchAll(/(?:\*\*|__)[^\n]+?(?:\*\*|__)/g)) {
			const start = (match.index ?? 0) + 1;
			addRange(
				lineNumber,
				start,
				start + match[0].length,
				"file-tree-editor-md-strong",
			);
		}
		for (const match of line.matchAll(/!?\[[^\]\n]+\]\([^\s)]+(?:\s+"[^"]*")?\)/g)) {
			const start = (match.index ?? 0) + 1;
			addRange(
				lineNumber,
				start,
				start + match[0].length,
				"file-tree-editor-md-link",
			);
		}
	}

	return decorations;
}
