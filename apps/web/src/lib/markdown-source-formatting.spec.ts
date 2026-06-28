import * as assert from "node:assert/strict";
import { test } from "node:test";
import {
  getMarkdownFormattingEdit,
  type MarkdownSourceDocument,
  type MarkdownSourcePosition,
  type MarkdownSourceRange,
} from "./markdown-source-formatting.ts";

function createDocument(text: string): MarkdownSourceDocument {
  const lines = text.split("\n");

  const getLineContent = (lineNumber: number) => lines[lineNumber - 1] ?? "";

  return {
    getLineContent,
    getLineMaxColumn(lineNumber) {
      return getLineContent(lineNumber).length + 1;
    },
    getWordAtPosition(position: MarkdownSourcePosition) {
      const line = getLineContent(position.lineNumber);
      const index = Math.max(0, Math.min(line.length, position.column - 1));
      for (const match of line.matchAll(/[A-Za-z0-9_]+/g)) {
        const start = match.index ?? 0;
        const end = start + match[0].length;
        if (index >= start && index <= end) {
          return {
            startColumn: start + 1,
            endColumn: end + 1,
          };
        }
      }
      return null;
    },
    getValueInRange(range: MarkdownSourceRange) {
      if (range.startLineNumber === range.endLineNumber) {
        return getLineContent(range.startLineNumber).slice(range.startColumn - 1, range.endColumn - 1);
      }

      const result: string[] = [];
      result.push(getLineContent(range.startLineNumber).slice(range.startColumn - 1));
      for (let lineNumber = range.startLineNumber + 1; lineNumber < range.endLineNumber; lineNumber++) {
        result.push(getLineContent(lineNumber));
      }
      result.push(getLineContent(range.endLineNumber).slice(0, range.endColumn - 1));
      return result.join("\n");
    },
  };
}

test("wraps selected inline markdown text", () => {
  const edit = getMarkdownFormattingEdit("editor.bold", createDocument("alpha beta"), {
    startLineNumber: 1,
    startColumn: 1,
    endLineNumber: 1,
    endColumn: 6,
  });

  assert.deepEqual(edit, {
    range: {
      startLineNumber: 1,
      startColumn: 1,
      endLineNumber: 1,
      endColumn: 6,
    },
    text: "**alpha**",
  });
});

test("unwraps inline markdown text when selection is inside markers", () => {
  const edit = getMarkdownFormattingEdit("editor.bold", createDocument("**alpha**"), {
    startLineNumber: 1,
    startColumn: 3,
    endLineNumber: 1,
    endColumn: 8,
  });

  assert.deepEqual(edit, {
    range: {
      startLineNumber: 1,
      startColumn: 1,
      endLineNumber: 1,
      endColumn: 10,
    },
    text: "alpha",
  });
});

test("formats the word at the cursor for empty inline selections", () => {
  const edit = getMarkdownFormattingEdit("editor.code", createDocument("alpha beta"), {
    startLineNumber: 1,
    startColumn: 3,
    endLineNumber: 1,
    endColumn: 3,
  });

  assert.deepEqual(edit, {
    range: {
      startLineNumber: 1,
      startColumn: 1,
      endLineNumber: 1,
      endColumn: 6,
    },
    text: "`alpha`",
  });
});

test("inserts empty inline markers and returns cursor placement", () => {
  const edit = getMarkdownFormattingEdit("editor.italic", createDocument(""), {
    startLineNumber: 1,
    startColumn: 1,
    endLineNumber: 1,
    endColumn: 1,
  });

  assert.deepEqual(edit, {
    range: {
      startLineNumber: 1,
      startColumn: 1,
      endLineNumber: 1,
      endColumn: 1,
    },
    text: "**",
    cursor: { lineNumber: 1, column: 2 },
  });
});

test("toggles multi-line bullet lists", () => {
  const document = createDocument("alpha\nbeta\ngamma");
  const edit = getMarkdownFormattingEdit("editor.bulletList", document, {
    startLineNumber: 1,
    startColumn: 1,
    endLineNumber: 3,
    endColumn: 6,
  });

  assert.equal(edit?.text, "- alpha\n- beta\n- gamma");

  const unwrapped = getMarkdownFormattingEdit("editor.bulletList", createDocument(edit?.text ?? ""), {
    startLineNumber: 1,
    startColumn: 1,
    endLineNumber: 3,
    endColumn: 8,
  });
  assert.equal(unwrapped?.text, "alpha\nbeta\ngamma");
});

test("line formatting excludes the next line when selection ends at column one", () => {
  const edit = getMarkdownFormattingEdit("editor.blockquote", createDocument("alpha\nbeta\ngamma"), {
    startLineNumber: 1,
    startColumn: 1,
    endLineNumber: 3,
    endColumn: 1,
  });

  assert.deepEqual(edit, {
    range: {
      startLineNumber: 1,
      startColumn: 1,
      endLineNumber: 2,
      endColumn: 5,
    },
    text: "> alpha\n> beta",
  });
});
