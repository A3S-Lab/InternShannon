/**
 * Shared Shiki highlighter singleton — used by both DiffViewer and FileViewer.
 */
import { createHighlighter, type Highlighter } from "shiki";

let _highlighter: Highlighter | null = null;
let _highlighterPromise: Promise<Highlighter> | null = null;

const PRELOAD_LANGS = [
	"javascript",
	"typescript",
	"jsx",
	"tsx",
	"json",
	"html",
	"css",
	"bash",
	"shell",
	"python",
	"rust",
	"toml",
	"yaml",
	"markdown",
	"sql",
	"diff",
];

export function getHighlighter(): Promise<Highlighter> {
	if (_highlighter) return Promise.resolve(_highlighter);
	if (_highlighterPromise) return _highlighterPromise;
	_highlighterPromise = createHighlighter({
		themes: ["github-light", "github-dark"],
		langs: PRELOAD_LANGS,
	}).then((h) => {
		_highlighter = h;
		return h;
	});
	return _highlighterPromise;
}
