/**
 * BashText TipTap mark + extension.
 * Applies purple text color when the editor content starts with "!".
 */
import { Mark, mergeAttributes } from "@tiptap/core";
import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";

export const BashTextMark = Mark.create({
	name: "bashText",
	addAttributes() {
		return {
			class: {
				default: "bash-text",
			},
		};
	},

	parseHTML() {
		return [{ tag: "span.bash-text" }];
	},

	renderHTML({ HTMLAttributes }) {
		return ["span", mergeAttributes(HTMLAttributes, { class: "bash-text" }), 0];
	},
});

const BASH_PLUGIN_KEY = new PluginKey("bashColor");

export const BashColorExtension = Extension.create({
	name: "bashColor",

	addProseMirrorPlugins() {
		return [
			new Plugin({
				key: BASH_PLUGIN_KEY,
				appendTransaction: (transactions, _oldState, newState) => {
					const docChanged = transactions.some((tr) => tr.docChanged);
					if (!docChanged) return null;

					const markType = newState.schema.marks.bashText;
					if (!markType) return null;

					const text = newState.doc.textContent;
					const hasBashPrefix = text.startsWith("!");

					const tr = newState.tr;
					let hasChanges = false;

					try {
						newState.doc.descendants((node, pos) => {
							if (node.type.name !== "text") return;

							const currentMark = node.marks.find(
								(m) => m.type.name === "bashText",
							);
							const shouldHaveMark =
								hasBashPrefix && (node.text?.length ?? 0) > 0;

							if (shouldHaveMark && !currentMark) {
								tr.addMark(pos, pos + node.nodeSize, markType.create());
								hasChanges = true;
							} else if (!shouldHaveMark && currentMark) {
								tr.removeMark(pos, pos + node.nodeSize, markType);
								hasChanges = true;
							}
						});
					} catch {
						return null;
					}

					return hasChanges ? tr : null;
				},
			}),
		];
	},
});
