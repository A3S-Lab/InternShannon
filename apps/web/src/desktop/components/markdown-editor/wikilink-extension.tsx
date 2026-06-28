/**
 * WikiLink extension for the markdown editor (Obsidian-style `[[wikilink]]`).
 *
 * Three behaviors, all gated on an `assetId` being supplied:
 *   (a) Autocomplete  — typing `[[` opens a Suggestion popup sourced from the
 *       asset's wiki page list; selecting inserts literal `[[Title]]` text.
 *   (b) Highlight      — `[[...]]` spans are rendered as distinguishable inline
 *       text via ProseMirror decorations. Crucially these are *decorations*,
 *       not schema marks/nodes, so the document text stays the literal string
 *       `[[Title]]`. tiptap-markdown therefore serializes it back verbatim and
 *       the saved `.md` is never corrupted.
 *   (c) Click-through  — clicking inside a `[[...]]` span resolves the target
 *       against the page list (title → basename → path, mirroring the backend
 *       resolver) and calls `onOpenWikiLink(repoRelativePath)`.
 *
 * The page list is fetched lazily (once per editor instance, refreshable) and
 * shared between the Suggestion source and the click resolver via a small
 * mutable store object.
 */
import { createSuggestionRenderer } from "@/components/tiptap-editor/suggestion-renderer";
import type { SuggestionItem } from "@/components/tiptap-editor/mention-list";
import { assetsApi, type WikiPageEntry } from "@/lib/api/assets";
import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import Suggestion from "@tiptap/suggestion";

/** Matches `[[target]]` / `[[target|alias]]` / `[[target#anchor]]`. */
const WIKILINK_RE = /\[\[([^\]\n]+)\]\]/g;

/** Reverses the markdown serializer's bracket escaping for `[[wikilink]]`.
 *
 * tiptap-markdown serializes plain text through prosemirror-markdown's `esc()`,
 * which backslash-escapes `[` and `]` — so a literal `[[Title]]` in the document
 * comes out as `\[\[Title\]\]`, corrupting the wiki syntax in the saved `.md`.
 * This restores exactly the `\[\[ ... \]\]` sequences (including any escaped
 * inner brackets) back to `[[ ... ]]`, while leaving every other escape (e.g. a
 * standalone `\[`, `\_`, `\\`) untouched. Verified against alias / anchor /
 * multi-byte / non-wikilink samples. */
export function restoreWikiLinkBrackets(markdown: string): string {
  if (!markdown.includes("\\[\\[")) return markdown;
  return markdown.replace(
    /\\\[\\\[([^\]]*?(?:\\\][^\]]*?)*?)\\\]\\\]/g,
    (_match, inner: string) => `[[${inner.replace(/\\([[\]])/g, "$1")}]]`,
  );
}

export interface WikiLinkOptions {
  /** Asset whose wiki pages drive autocomplete + click resolution. */
  assetId: string | null;
  /** Opens the resolved page. `target` is the repo-relative wiki path. */
  onOpenWikiLink?: (target: string) => void;
}

/** Mutable, per-editor store of the loaded wiki page list. */
interface WikiPageStore {
  pages: WikiPageEntry[];
  loaded: boolean;
  loading: boolean;
}

function basename(path: string): string {
  const seg = path.split("/").pop() ?? path;
  return seg.replace(/\.md$/i, "");
}

/** Resolve a `[[target]]` string to a repo-relative wiki page path, mirroring
 * the backend resolver: try exact title, then basename, then path (all
 * case-insensitively). Strips any `#anchor` / `|alias` first. */
function resolveTarget(rawTarget: string, pages: WikiPageEntry[]): WikiPageEntry | null {
  const target = rawTarget.split("|")[0].split("#")[0].trim();
  if (!target) return null;
  const lower = target.toLowerCase();
  return (
    pages.find((p) => p.title.toLowerCase() === lower) ??
    pages.find((p) => basename(p.path).toLowerCase() === lower) ??
    pages.find((p) => p.path.toLowerCase() === lower) ??
    null
  );
}

/** Build suggestion items from the page list, filtered by the typed query. */
function pagesToItems(pages: WikiPageEntry[], query: string): SuggestionItem[] {
  const q = query.trim().toLowerCase();
  const matched = q
    ? pages.filter(
        (p) => p.title.toLowerCase().includes(q) || basename(p.path).toLowerCase().includes(q),
      )
    : pages;
  return matched.slice(0, 50).map((p) => ({
    id: `wiki:${p.path}`,
    label: p.title || basename(p.path),
    description: p.path,
    group: "知识页面",
  }));
}

const WikiLinkPluginKey = new PluginKey("wikiLinkHighlight");
const WikiLinkSuggestionKey = new PluginKey("wikiLinkSuggestion");

export const WikiLink = Extension.create<WikiLinkOptions>({
  name: "wikiLink",

  addOptions() {
    return {
      assetId: null,
      onOpenWikiLink: undefined,
    };
  },

  addProseMirrorPlugins() {
    const assetId = this.options.assetId;
    // No asset → register nothing. The editor behaves exactly as before.
    if (!assetId) return [];

    const onOpenWikiLink = this.options.onOpenWikiLink;
    const editor = this.editor;
    const store: WikiPageStore = { pages: [], loaded: false, loading: false };

    const ensurePages = () => {
      if (store.loaded || store.loading) return;
      store.loading = true;
      assetsApi
        .wikiListPages(assetId)
        .then((pages) => {
          store.pages = Array.isArray(pages) ? pages : [];
          store.loaded = true;
        })
        .catch(() => {
          // Leave loaded=false so a later trigger can retry. Autocomplete just
          // shows "no results" until the fetch lands; nothing breaks.
          store.pages = [];
        })
        .finally(() => {
          store.loading = false;
        });
    };

    // ── (b) Decoration-based highlight ──────────────────────────────────────
    const buildDecorations = (doc: typeof editor.state.doc): DecorationSet => {
      const decorations: Decoration[] = [];
      doc.descendants((node, pos) => {
        if (!node.isText || typeof node.text !== "string") return;
        const text = node.text;
        WIKILINK_RE.lastIndex = 0;
        let match: RegExpExecArray | null = WIKILINK_RE.exec(text);
        while (match !== null) {
          const from = pos + match.index;
          const to = from + match[0].length;
          decorations.push(
            Decoration.inline(from, to, {
              class: "md-wikilink",
              "data-wikilink": match[1],
            }),
          );
          match = WIKILINK_RE.exec(text);
        }
      });
      return DecorationSet.create(doc, decorations);
    };

    const highlightPlugin = new Plugin({
      key: WikiLinkPluginKey,
      state: {
        init: (_config, instanceState) => buildDecorations(instanceState.doc),
        apply: (tr, old) => (tr.docChanged ? buildDecorations(tr.doc) : old),
      },
      props: {
        decorations(stateInstance) {
          return this.getState(stateInstance);
        },
        // ── (c) Click-through ───────────────────────────────────────────────
        handleClick(view, pos) {
          if (!onOpenWikiLink) return false;
          const { doc } = view.state;
          const $pos = doc.resolve(pos);
          const parent = $pos.parent;
          const textContent = parent.textContent;
          // Find a [[...]] span in the clicked text block that contains pos.
          const blockStart = $pos.start();
          WIKILINK_RE.lastIndex = 0;
          let match: RegExpExecArray | null = WIKILINK_RE.exec(textContent);
          while (match !== null) {
            const from = blockStart + match.index;
            const to = from + match[0].length;
            if (pos >= from && pos <= to) {
              ensurePages();
              const resolved = resolveTarget(match[1], store.pages);
              if (resolved) {
                onOpenWikiLink(resolved.path);
                return true;
              }
              // Unresolved/dangling link: swallow the click so we don't drop a
              // caret in the middle of the literal text, but do nothing else.
              return false;
            }
            match = WIKILINK_RE.exec(textContent);
          }
          return false;
        },
      },
    });

    // ── (a) Autocomplete ────────────────────────────────────────────────────
    const renderer = createSuggestionRenderer((query) => pagesToItems(store.pages, query));

    const suggestionPlugin = Suggestion<SuggestionItem>({
      editor,
      pluginKey: WikiLinkSuggestionKey,
      char: "[[",
      // Default startOfLine=false; allowSpaces lets multi-word titles filter.
      allowSpaces: true,
      // null = allow `[[` to trigger anywhere (default [" "] would require a
      // preceding space, breaking `word[[`).
      allowedPrefixes: null,
      items: ({ query }) => {
        ensurePages();
        return pagesToItems(store.pages, query);
      },
      render: renderer.render,
      command: ({ editor: ed, range, props }) => {
        const item = props as SuggestionItem;
        // item.label is the page title; insert literal `[[Title]]` text so the
        // markdown serializer round-trips it verbatim.
        ed.chain().focus().deleteRange(range).insertContent(`[[${item.label}]]`).run();
      },
    });

    return [highlightPlugin, suggestionPlugin];
  },
});
