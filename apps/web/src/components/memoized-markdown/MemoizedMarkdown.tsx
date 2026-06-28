import { marked } from "marked";
import { memo, useMemo } from "react";
import ReactMarkdown from "react-markdown";
import rehypeRaw from "rehype-raw";
import remarkGfm from "remark-gfm";
import CodeHighlight from "./code-highlight";
import { wasmSha1 } from "@/runtime/wasm/hash-wasm";
import { normalizeMarkdownContent as wasmNormalizeMarkdownContent } from "@/runtime/wasm/md-wasm";
import "./index.css";

// =============================================================================
// Stable plugin arrays — hoisted to module scope to avoid re-creating on render
// =============================================================================

const REMARK_PLUGINS = [remarkGfm];
const REHYPE_PLUGINS = [rehypeRaw];

function countOccurrences(input: string, pattern: RegExp): number {
	const matches = input.match(pattern);
	return matches ? matches.length : 0;
}

export function stripIncompleteTrailingFence(markdown: string): string {
	const normalized = markdown.replace(/\r\n/g, "\n");
	const fenceCount = countOccurrences(normalized, /^```/gm);
	if (fenceCount % 2 === 0) {
		return normalized;
	}

	const lastFenceIndex = normalized.lastIndexOf("```");
	if (lastFenceIndex < 0) {
		return normalized;
	}

	return normalized.slice(0, lastFenceIndex).trimEnd();
}

export function normalizeMarkdownContent(
	markdown: string,
	options?: { streaming?: boolean },
): string {
	return wasmNormalizeMarkdownContent(markdown, options);
}

// =============================================================================
// Custom components — stable reference to avoid ReactMarkdown re-init
// =============================================================================

const MARKDOWN_COMPONENTS = {
	code: CodeHighlight,
	// External links open in new tab
	a: ({
		href,
		children,
		...props
	}: React.AnchorHTMLAttributes<HTMLAnchorElement>) => {
		const isExternal =
			href && (href.startsWith("http://") || href.startsWith("https://"));
		return (
			<a
				href={href}
				{...(isExternal
					? { target: "_blank", rel: "noopener noreferrer" }
					: {})}
				{...props}
			>
				{children}
			</a>
		);
	},
} as const;

// =============================================================================
// Block parsing — split markdown into top-level blocks for granular memoization
// =============================================================================

function parseMarkdownIntoBlocks(markdown: string): string[] {
	try {
		const tokens = marked.lexer(markdown);
		const blocks = tokens
			.map((token) => token.raw)
			.filter(
				(token): token is string =>
					typeof token === "string" && token.length > 0,
			);
		return blocks.length > 0 ? blocks : markdown ? [markdown] : [];
	} catch {
		return markdown ? [markdown] : [];
	}
}

function blockKey(block: string, index: number): string {
	// Try WASM SHA-1 first
	const sha1 = wasmSha1(block);
	if (sha1 !== null) {
		// Truncate to 8 chars to match the original hash length
		return `${index}-${sha1.slice(0, 8)}`;
	}
	// Fallback to DJB2 hash
	let hash = 0;
	for (let i = 0; i < block.length; i += 1) {
		hash = (hash * 31 + block.charCodeAt(i)) >>> 0;
	}
	return `${index}-${hash.toString(36)}`;
}

// =============================================================================
// MemoizedMarkdownBlock — renders a single markdown block
// =============================================================================

const MemoizedMarkdownBlock = memo(
	({ content }: { content: string }) => {
		return (
			<ReactMarkdown
				remarkPlugins={REMARK_PLUGINS}
				rehypePlugins={REHYPE_PLUGINS}
				components={MARKDOWN_COMPONENTS}
			>
				{content}
			</ReactMarkdown>
		);
	},
	(prev, next) => prev.content === next.content,
);

MemoizedMarkdownBlock.displayName = "MemoizedMarkdownBlock";

// =============================================================================
// MemoizedMarkdown — top-level component with block-level memoization
// =============================================================================

export const MemoizedMarkdown = memo(
	({
		content,
		id,
		streaming = false,
	}: {
		content: string;
		id: string;
		streaming?: boolean;
	}) => {
		// Streaming: skip expensive normalization + block parsing, render raw
		if (streaming) {
			return (
				<article className="prose-chat" data-markdown-id={id}>
					<ReactMarkdown
						remarkPlugins={REMARK_PLUGINS}
						rehypePlugins={REHYPE_PLUGINS}
						components={MARKDOWN_COMPONENTS}
					>
						{content}
					</ReactMarkdown>
				</article>
			);
		}

		const normalizedContent = useMemo(
			() => normalizeMarkdownContent(content, { streaming }),
			[content, streaming],
		);
		const blocks = useMemo(
			() => parseMarkdownIntoBlocks(normalizedContent),
			[normalizedContent],
		);

		return (
			<article className="prose-chat" data-markdown-id={id}>
				{blocks.map((block, index) => (
					<MemoizedMarkdownBlock content={block} key={blockKey(block, index)} />
				))}
			</article>
		);
	},
);

MemoizedMarkdown.displayName = "MemoizedMarkdown";
