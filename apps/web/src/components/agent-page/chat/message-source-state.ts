import { parseKnowledgeAssetCitation } from "../../../lib/knowledge-citation.ts";

export type MessageSourceSegment = {
	type: "text" | "file" | "citation";
	value: string;
	key: string;
};

const SOURCE_FIELD_LABEL =
	/(?:^|\n)\s*(?:[-*]\s*)?(?:resource|citations?)\s*:\s*$/i;

const CITATION_WRAPPERS = [
	{ open: "[", close: "]" },
	{ open: "(", close: ")" },
	{ open: "（", close: "）" },
	{ open: "【", close: "】" },
] as const;

function legacyCitationAliases(text: string): Map<string, string> {
	const candidates = new Map<string, Set<string>>();
	const add = (alias: string, resource: string) => {
		if (!alias) return;
		const values = candidates.get(alias) ?? new Set<string>();
		values.add(resource);
		candidates.set(alias, values);
	};
	for (const match of text.matchAll(
		/asset:\/{1,2}[^\s)\]}>{}"'`）】》〉，。；：！？“”‘’、]+/g,
	)) {
		const parsed = parseKnowledgeAssetCitation(match[0]);
		if (!parsed) continue;
		add(parsed.relativePath, match[0]);
		add(parsed.relativePath.replace(/^raw\/sources\//, ""), match[0]);
		add(parsed.relativePath.split("/").at(-1) ?? "", match[0]);
	}
	return new Map(
		Array.from(candidates.entries())
			.filter(([, values]) => values.size === 1)
			.map(([alias, values]) => [alias, Array.from(values)[0]!] as const),
	);
}

function resolveLegacyCitation(
	value: string,
	aliases: ReadonlyMap<string, string>,
): string {
	if (parseKnowledgeAssetCitation(value)) return value;
	const remainder = value.replace(/^asset:\/{1,2}/, "");
	const firstSlash = remainder.indexOf("/");
	const relativePath =
		value.startsWith("asset://") && firstSlash >= 0
			? remainder.slice(firstSlash + 1)
			: remainder;
	return (
		aliases.get(relativePath) ??
		aliases.get(relativePath.split("/").at(-1) ?? "") ??
		value
	);
}

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
	const citationAliases = legacyCitationAliases(text);
	// URI prose commonly uses full-width Chinese punctuation without a space.
	// Treat those delimiters (and Markdown backticks) as citation boundaries so
	// a source card never absorbs the sentence following the actual path.
	const re =
		/@(\/[^\s@]+)|(asset:\/{1,2}[^\s)\]}>"'`）】》〉，。；：！？“”‘’、]+)/g;
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

		const rawValue = match[1] || match[2];
		const type = match[1] ? "file" : "citation";
		const value =
			type === "citation"
				? resolveLegacyCitation(rawValue, citationAliases)
				: rawValue;
		let segmentEnd = match.index + match[0].length;
		if (type === "citation") {
			const preceding = segments.at(-1);
			if (preceding?.type === "text") {
				preceding.value = preceding.value.replace(SOURCE_FIELD_LABEL, "\n");
				segmentEnd = stripPairedCitationWrapper(preceding, text, segmentEnd);
			}
			const identity = citationIdentity(value);
			if (seenCitations.has(identity)) {
				last = segmentEnd;
				re.lastIndex = last;
				match = re.exec(text);
				continue;
			}
			seenCitations.add(identity);
		}

		segments.push({ type, value, key: `${type}:${match.index}:${value}` });
		last = segmentEnd;
		re.lastIndex = last;
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

export function groupMessageSources(text: string): {
	contentSegments: MessageSourceSegment[];
	citations: MessageSourceSegment[];
} {
	const contentSegments: MessageSourceSegment[] = [];
	const citations: MessageSourceSegment[] = [];
	for (const segment of splitUniqueFileMentions(text)) {
		if (segment.type === "citation") {
			citations.push(segment);
			continue;
		}
		const previous = contentSegments.at(-1);
		if (segment.type === "text" && previous?.type === "text") {
			previous.value += segment.value;
			continue;
		}
		contentSegments.push({ ...segment });
	}
	return { contentSegments, citations };
}

function stripPairedCitationWrapper(
	preceding: MessageSourceSegment,
	text: string,
	citationEnd: number,
): number {
	const wrapper = CITATION_WRAPPERS.find(
		(candidate) => candidate.close === text[citationEnd],
	);
	if (!wrapper) return citationEnd;

	const openIndex = preceding.value.lastIndexOf(wrapper.open);
	if (openIndex < 0 || openIndex < preceding.value.lastIndexOf(wrapper.close)) {
		return citationEnd;
	}

	const wrappedLabel = preceding.value.slice(openIndex + wrapper.open.length);
	if (wrappedLabel.includes("\n")) return citationEnd;

	preceding.value =
		preceding.value.slice(0, openIndex) +
		preceding.value.slice(openIndex + wrapper.open.length);
	return citationEnd + wrapper.close.length;
}
