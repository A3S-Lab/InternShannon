export interface KnowledgeAssetCitation {
	assetId: string;
	relativePath: string;
}

export interface KnowledgeSourceLocator {
	kind: "record" | "section" | "chunk";
	value: string;
	label?: string;
}

export interface KnowledgeSourceReference {
	protocolVersion: 1;
	ref: string;
	assetId: string;
	relativePath: string;
	title: string;
	resource: string;
	evidence: "read" | "search" | "catalog";
	locators: KnowledgeSourceLocator[];
}

function recordValue(value: unknown): Record<string, unknown> | null {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null;
}

/** Accept only server-issued, internally consistent source references. */
export function normalizeKnowledgeSourceReferences(
	value: unknown,
): KnowledgeSourceReference[] | undefined {
	if (!Array.isArray(value)) return undefined;
	const sources = new Map<string, KnowledgeSourceReference>();
	for (const item of value.slice(0, 24)) {
		const source = recordValue(item);
		if (!source || source.protocolVersion !== 1) continue;
		const ref = typeof source.ref === "string" ? source.ref.trim() : "";
		const assetId =
			typeof source.assetId === "string" ? source.assetId.trim() : "";
		const relativePath =
			typeof source.relativePath === "string" ? source.relativePath.trim() : "";
		const title = typeof source.title === "string" ? source.title.trim() : "";
		const resource =
			typeof source.resource === "string" ? source.resource.trim() : "";
		const evidence = source.evidence;
		const parsed = parseKnowledgeAssetCitation(resource);
		if (
			!/^K\d{1,2}$/u.test(ref) ||
			!assetId ||
			!relativePath ||
			!title ||
			!parsed ||
			parsed.assetId !== assetId ||
			parsed.relativePath !== relativePath ||
			!(["read", "search", "catalog"] as unknown[]).includes(evidence)
		) {
			continue;
		}
		const locators = Array.isArray(source.locators)
			? source.locators.slice(0, 32).flatMap((locatorValue) => {
					const locator = recordValue(locatorValue);
					if (!locator) return [];
					const kind = locator.kind;
					const locatorText =
						typeof locator.value === "string" ? locator.value.trim() : "";
					if (
						!(kind === "record" || kind === "section" || kind === "chunk") ||
						!locatorText ||
						locatorText.length > 160
					) {
						return [];
					}
					return [
						{
							kind,
							value: locatorText,
							...(typeof locator.label === "string" && locator.label.trim()
								? { label: locator.label.trim() }
								: {}),
						},
					] satisfies KnowledgeSourceLocator[];
				})
			: [];
		const existing = sources.get(resource);
		const mergedLocators = new Map(
			[...(existing?.locators ?? []), ...locators].map((locator) => [
				`${locator.kind}:${locator.value}`,
				locator,
			]),
		);
		sources.set(resource, {
			protocolVersion: 1,
			ref,
			assetId,
			relativePath,
			title,
			resource,
			evidence: evidence as KnowledgeSourceReference["evidence"],
			locators: Array.from(mergedLocators.values()),
		});
	}
	return sources.size > 0 ? Array.from(sources.values()) : undefined;
}

export function parseKnowledgeAssetCitation(
	value: string | null | undefined,
): KnowledgeAssetCitation | null {
	const normalized = String(value || "")
		.trim()
		.replace(/[),.;，。；：]+$/, "");
	if (!normalized.startsWith("asset://")) return null;
	const hasInvalidCharacter = Array.from(normalized).some((character) => {
		const code = character.charCodeAt(0);
		return character === "\\" || code <= 0x1f;
	});
	if (normalized.length > 2_048 || hasInvalidCharacter) return null;
	const segments = normalized.slice("asset://".length).split("/");
	if (segments.length < 2 || segments.some((segment) => !segment)) return null;
	try {
		const assetId = decodeURIComponent(segments[0]);
		const pathSegments = segments
			.slice(1)
			.map((part) => decodeURIComponent(part));
		if (
			!assetId ||
			assetId === "…" ||
			assetId === "..." ||
			pathSegments.some(
				(part) => !part || part === "." || part === ".." || part.includes("\\"),
			)
		) {
			return null;
		}
		return { assetId, relativePath: pathSegments.join("/") };
	} catch {
		return null;
	}
}
