/**
 * TipTap slash-command extension for triggering skills via "/"
 */
import { Extension } from "@tiptap/core";
import { PluginKey } from "@tiptap/pm/state";
import Suggestion, { type SuggestionOptions } from "@tiptap/suggestion";
import type { ReactNode } from "react";

export interface SlashCommandItem {
  id: string;
  label: string;
  description?: string;
  icon?: ReactNode;
}

export type SlashCommandOptions = {
  suggestion: Omit<SuggestionOptions<SlashCommandItem>, "editor">;
};

export const SlashCommandPluginKey = new PluginKey("slashCommand");

export const SlashCommand = Extension.create<SlashCommandOptions>({
  name: "slashCommandSuggestion",

  addOptions() {
    return {
      suggestion: {
        char: "/",
        pluginKey: SlashCommandPluginKey,
        command: ({ editor, range, props }) => {
          editor
            .chain()
            .focus()
            .deleteRange(range)
            .insertContent([
              {
                type: "slashCommand",
                attrs: {
                  id: props.id,
                  label: props.label ?? props.id,
                },
              },
              { type: "text", text: " " },
            ])
            .run();
        },
        allow: ({ state, range }) => {
          if (state.doc.resolve(range.from).parentOffset === 0) {
            return true;
          }
          const text = state.doc.textBetween(Math.max(0, range.from - 1), range.from, "\0", "\0");
          // Only trigger at start of line or after whitespace
          return text === "" || text === "\0" || /\s/.test(text);
        },
      },
    };
  },

  addProseMirrorPlugins() {
    return [
      Suggestion({
        editor: this.editor,
        ...this.options.suggestion,
      }),
    ];
  },
});
