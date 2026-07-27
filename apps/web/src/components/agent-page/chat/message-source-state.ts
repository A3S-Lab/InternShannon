export type MessageSourceSegment = {
	type: "text" | "file" | "citation";
	value: string;
	key: string;
};

const SOURCE_FIELD_LABEL =
	/(?:^|\n)\s*(?:[-*]\s*)?(?:resource|citations?)\s*:\s*$/i;

function citationIdentity(value: string): string {
	const normalized = value.trim().replace(/[),.;，。；：]+$/, "");
	try {
		return decodeURIComponent(normalized);
	} catch {
		return normalized;
	}
}

/** Split message text and keep at most one open-source card per knowledge file. */
export function splitUniqueFileMentions(text: string): MessageSourceSegment[] {
	if (!text) return [];
	const segments: MessageSourceSegment[] = [];
	const seenCitations = new Set<string>();
	const re = /@(\/[^\s@]+)|(asset:\/\/[^\s)\]}>"']+)/g;
	let last = 0;
	let match = re.exec(text);

	while (match !== null) {
		if (match.index > last) {
			segments.push({
				type: "text",
				value: text.slice(last, match.index),
				key: `text:${last}:${match.index}`,
			});
		}

		const value = match[1] || match[2];
		const type = match[1] ? "file" : "citation";
		if (type === "citation") {
			const preceding = segments.at(-1);
			if (preceding?.type === "text") {
				preceding.value = preceding.value.replace(SOURCE_FIELD_LABEL, "\n");
			}
			const identity = citationIdentity(value);
			if (seenCitations.has(identity)) {
				last = match.index + match[0].length;
				match = re.exec(text);
				continue;
			}
			seenCitations.add(identity);
		}

		segments.push({ type, value, key: `${type}:${match.index}:${value}` });
		last = match.index + match[0].length;
		match = re.exec(text);
	}

	if (last < text.length) {
		segments.push({
			type: "text",
			value: text.slice(last),
			key: `text:${last}:${text.length}`,
		});
	}
	return segments.filter(
		(segment) => segment.type !== "text" || segment.value.length > 0,
	);
}
