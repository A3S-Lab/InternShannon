export interface HistoryBackspaceEventLike {
	key: string;
	altKey?: boolean;
	ctrlKey?: boolean;
	metaKey?: boolean;
	shiftKey?: boolean;
	isComposing?: boolean;
	defaultPrevented?: boolean;
	target?: EventTarget | null;
	composedPath?: () => EventTarget[];
}

type EditableTargetLike = EventTarget & {
	tagName?: string;
	isContentEditable?: boolean;
	closest?: (selector: string) => unknown;
};

const EDITABLE_SELECTOR = [
	"input",
	"textarea",
	"select",
	"[contenteditable]:not([contenteditable='false'])",
	"[role='textbox']",
	"[role='searchbox']",
	".ProseMirror",
	".monaco-editor",
	"[data-slate-editor='true']",
].join(",");

function eventTarget(
	event: HistoryBackspaceEventLike,
): EditableTargetLike | null {
	const pathTarget = event.composedPath?.()[0];
	const target = pathTarget ?? event.target;
	return target && typeof target === "object"
		? (target as EditableTargetLike)
		: null;
}

export function isEditableHistoryTarget(
	target: EditableTargetLike | null,
): boolean {
	if (!target) return false;
	if (target.isContentEditable === true) return true;
	const tagName = target.tagName?.toLowerCase();
	if (tagName === "input" || tagName === "textarea" || tagName === "select") {
		return true;
	}
	if (typeof target.closest !== "function") return false;
	try {
		return Boolean(target.closest(EDITABLE_SELECTOR));
	} catch {
		return false;
	}
}

/** Prevent WebView history navigation without interfering with text deletion. */
export function shouldPreventHistoryBackspace(
	event: HistoryBackspaceEventLike,
): boolean {
	if (
		event.key !== "Backspace" ||
		event.defaultPrevented ||
		event.isComposing
	) {
		return false;
	}
	if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) {
		return false;
	}
	return !isEditableHistoryTarget(eventTarget(event));
}
