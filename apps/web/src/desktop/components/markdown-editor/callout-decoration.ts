/**
 * Live callout styling for the WYSIWYG markdown editor.
 *
 * Detects blockquotes whose first line is an Obsidian `> [!TYPE]` marker and
 * decorates the blockquote node with `md-callout md-callout-<type>`, so it
 * renders as the same styled box the reading-mode viewer produces — Obsidian's
 * "live preview" feel. The marker text stays in the document (it is what makes
 * the blockquote round-trip to `> [!TYPE]` markdown); only the box styling is
 * added. Shares one stylesheet with the viewer.
 *
 * Perf: the DecorationSet is held in plugin STATE and rebuilt only when the doc
 * changes (`tr.docChanged`); on selection / focus / plain re-render transactions
 * it is cheaply mapped forward instead of re-walking the whole document. (The
 * naive `props.decorations(state)` form re-scans the entire doc on every view
 * update — O(doc) per cursor move / keystroke / render.)
 */
import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import "@/components/custom/callouts.css";

const CALLOUT_MARKER_RE = /^\[!([\w-]+)\]/;
const calloutPluginKey = new PluginKey<DecorationSet>("calloutDecoration");

function buildCalloutDecorations(doc: ProseMirrorNode): DecorationSet {
  const decorations: Decoration[] = [];
  doc.forEach((node, offset) => {
    if (node.type.name !== "blockquote") return;
    const firstLine = (node.firstChild?.textContent ?? "").trimStart();
    const match = CALLOUT_MARKER_RE.exec(firstLine);
    if (!match) return;
    decorations.push(
      Decoration.node(offset, offset + node.nodeSize, {
        class: `md-callout md-callout-${match[1].toLowerCase()}`,
      }),
    );
  });
  return DecorationSet.create(doc, decorations);
}

export const CalloutDecoration = Extension.create({
  name: "calloutDecoration",
  addProseMirrorPlugins() {
    return [
      new Plugin<DecorationSet>({
        key: calloutPluginKey,
        state: {
          init: (_config, state) => buildCalloutDecorations(state.doc),
          apply: (tr, value) => (tr.docChanged ? buildCalloutDecorations(tr.doc) : value.map(tr.mapping, tr.doc)),
        },
        props: {
          decorations(state) {
            return calloutPluginKey.getState(state);
          },
        },
      }),
    ];
  },
});
