export interface AnsiTextSegment {
	offset: number;
	text: string;
	className: string;
}

const FOREGROUND_CLASSES: Record<number, string> = {
	30: "text-gray-800",
	31: "text-red-600",
	32: "text-green-600",
	33: "text-yellow-600",
	34: "text-blue-600",
	35: "text-purple-600",
	36: "text-cyan-600",
	37: "text-gray-100",
	90: "text-gray-500",
	91: "text-red-400",
	92: "text-green-400",
	93: "text-yellow-400",
	94: "text-blue-400",
	95: "text-pink-400",
	96: "text-cyan-400",
	97: "text-gray-100",
};

const BACKGROUND_CLASSES: Record<number, string> = {
	40: "bg-gray-800",
	41: "bg-red-600",
	42: "bg-green-600",
	43: "bg-yellow-600",
	44: "bg-blue-600",
	45: "bg-purple-600",
	46: "bg-cyan-600",
	47: "bg-gray-100",
	100: "bg-gray-600",
	101: "bg-red-300",
	102: "bg-green-300",
	103: "bg-yellow-300",
	104: "bg-blue-300",
	105: "bg-pink-300",
	106: "bg-cyan-300",
	107: "bg-white",
};

interface AnsiStyleState {
	bold: boolean;
	dim: boolean;
	italic: boolean;
	underline: boolean;
	strike: boolean;
	foreground: string;
	background: string;
}

function styleClassName(state: AnsiStyleState): string {
	return [
		state.dim ? "opacity-75" : "",
		state.bold ? "font-bold" : "",
		state.italic ? "italic" : "",
		state.underline ? "underline" : "",
		state.strike ? "line-through" : "",
		state.foreground,
		state.background,
	]
		.filter(Boolean)
		.join(" ");
}

function applySgrCode(state: AnsiStyleState, code: number): void {
	if (code === 0) {
		state.bold = false;
		state.dim = false;
		state.italic = false;
		state.underline = false;
		state.strike = false;
		state.foreground = "";
		state.background = "";
	} else if (code === 1) {
		state.bold = true;
	} else if (code === 2) {
		state.dim = true;
	} else if (code === 3) {
		state.italic = true;
	} else if (code === 4) {
		state.underline = true;
	} else if (code === 9) {
		state.strike = true;
	} else if (code === 22) {
		state.bold = false;
		state.dim = false;
	} else if (code === 23) {
		state.italic = false;
	} else if (code === 24) {
		state.underline = false;
	} else if (code === 29) {
		state.strike = false;
	} else if (code === 39) {
		state.foreground = "";
	} else if (code === 49) {
		state.background = "";
	} else if (FOREGROUND_CLASSES[code]) {
		state.foreground = FOREGROUND_CLASSES[code];
	} else if (BACKGROUND_CLASSES[code]) {
		state.background = BACKGROUND_CLASSES[code];
	}
}

function parseSgrCodes(value: string): number[] | null {
	const parts = value.split(";");
	if (!parts.every((part) => part === "" || /^\d+$/.test(part))) {
		return null;
	}
	return parts.map((part) => (part === "" ? 0 : Number(part)));
}

/**
 * Convert ANSI SGR text to React-safe text segments.
 *
 * Text remains text rather than HTML, so terminal output cannot inject markup.
 */
export function parseAnsiText(text: string): AnsiTextSegment[] {
	const segments: AnsiTextSegment[] = [];
	const state: AnsiStyleState = {
		bold: false,
		dim: false,
		italic: false,
		underline: false,
		strike: false,
		foreground: "",
		background: "",
	};

	let cursor = 0;
	let textStart = 0;
	const flushText = (end: number) => {
		if (end <= textStart) return;
		segments.push({
			offset: textStart,
			text: text.slice(textStart, end),
			className: styleClassName(state),
		});
	};

	while (cursor < text.length) {
		if (text.charCodeAt(cursor) !== 27 || text[cursor + 1] !== "[") {
			cursor += 1;
			continue;
		}

		const sequenceEnd = text.indexOf("m", cursor + 2);
		if (sequenceEnd === -1) {
			cursor += 1;
			continue;
		}

		const codes = parseSgrCodes(text.slice(cursor + 2, sequenceEnd));
		if (!codes) {
			cursor += 1;
			continue;
		}

		flushText(cursor);
		for (const code of codes) applySgrCode(state, code);
		cursor = sequenceEnd + 1;
		textStart = cursor;
	}

	flushText(text.length);
	return segments;
}
