export interface MarkdownSourceRange {
  startLineNumber: number;
  startColumn: number;
  endLineNumber: number;
  endColumn: number;
}

export interface MarkdownSourcePosition {
  lineNumber: number;
  column: number;
}

export interface MarkdownSourceWord {
  startColumn: number;
  endColumn: number;
}

export interface MarkdownSourceDocument {
  getLineContent(lineNumber: number): string;
  getLineMaxColumn(lineNumber: number): number;
  getWordAtPosition(position: MarkdownSourcePosition): MarkdownSourceWord | null;
  getValueInRange(range: MarkdownSourceRange): string;
}

export interface MarkdownFormattingEdit {
  range: MarkdownSourceRange;
  text: string;
  cursor?: MarkdownSourcePosition;
}

function getMarkerForCommand(commandId: string): [string, string] | null {
  switch (commandId) {
    case "editor.bold":
      return ["**", "**"];
    case "editor.italic":
      return ["*", "*"];
    case "editor.underline":
      return ["<u>", "</u>"];
    case "editor.strikethrough":
      return ["~~", "~~"];
    case "editor.code":
      return ["`", "`"];
    case "editor.codeBlock":
      return ["```\n", "\n```"];
    default:
      return null;
  }
}

function isEmptySelection(selection: MarkdownSourceRange): boolean {
  return selection.startLineNumber === selection.endLineNumber && selection.startColumn === selection.endColumn;
}

function createRange(
  startLineNumber: number,
  startColumn: number,
  endLineNumber: number,
  endColumn: number,
): MarkdownSourceRange {
  return {
    startLineNumber,
    startColumn,
    endLineNumber,
    endColumn,
  };
}

function selectedLineRange(selection: MarkdownSourceRange): { startLineNumber: number; endLineNumber: number } {
  const endsAtNextLineStart =
    selection.endColumn === 1 && selection.endLineNumber > selection.startLineNumber && !isEmptySelection(selection);
  return {
    startLineNumber: selection.startLineNumber,
    endLineNumber: endsAtNextLineStart ? selection.endLineNumber - 1 : selection.endLineNumber,
  };
}

function createSelectedLinesEdit(
  document: MarkdownSourceDocument,
  selection: MarkdownSourceRange,
  transform: (lines: string[]) => string[],
): MarkdownFormattingEdit {
  const { startLineNumber, endLineNumber } = selectedLineRange(selection);
  const lines: string[] = [];
  for (let lineNumber = startLineNumber; lineNumber <= endLineNumber; lineNumber++) {
    lines.push(document.getLineContent(lineNumber));
  }

  return {
    range: createRange(startLineNumber, 1, endLineNumber, document.getLineMaxColumn(endLineNumber)),
    text: transform(lines).join("\n"),
  };
}

function toggleHeadingLines(lines: string[]): string[] {
  const allHeading = lines.every((line) => line.trim() === "" || /^\s{0,3}#{1,6}\s+/.test(line));
  if (allHeading) {
    return lines.map((line) => line.replace(/^(\s{0,3})#{1,6}\s+/, "$1"));
  }

  return lines.map((line) => {
    if (line.trim() === "") return "# ";
    return line.replace(/^(\s{0,3})(?:#{1,6}\s+)?/, "$1# ");
  });
}

function toggleBulletLines(lines: string[]): string[] {
  const allBullet = lines.every((line) => line.trim() === "" || /^\s*[-*+]\s+/.test(line));
  if (allBullet) {
    return lines.map((line) => line.replace(/^(\s*)[-*+]\s+/, "$1"));
  }

  return lines.map((line) => {
    const indent = line.match(/^\s*/)?.[0] ?? "";
    const content = line.slice(indent.length).replace(/^[-*+]\s+/, "");
    return `${indent}- ${content}`;
  });
}

function toggleOrderedLines(lines: string[]): string[] {
  const allOrdered = lines.every((line) => line.trim() === "" || /^\s*\d+[.)]\s+/.test(line));
  if (allOrdered) {
    return lines.map((line) => line.replace(/^(\s*)\d+[.)]\s+/, "$1"));
  }

  let index = 1;
  return lines.map((line) => {
    const indent = line.match(/^\s*/)?.[0] ?? "";
    const content = line.slice(indent.length).replace(/^\d+[.)]\s+/, "");
    return `${indent}${index++}. ${content}`;
  });
}

function toggleBlockquoteLines(lines: string[]): string[] {
  const allQuoted = lines.every((line) => line.trim() === "" || /^\s{0,3}>\s?/.test(line));
  if (allQuoted) {
    return lines.map((line) => line.replace(/^(\s{0,3})>\s?/, "$1"));
  }

  return lines.map((line) => {
    if (line.trim() === "") return "> ";
    return line.replace(/^(\s{0,3})/, "$1> ");
  });
}

function toggleWrappedText(text: string, prefix: string, suffix: string): string {
  if (text.startsWith(prefix) && text.endsWith(suffix) && text.length >= prefix.length + suffix.length) {
    return text.slice(prefix.length, text.length - suffix.length);
  }
  return `${prefix}${text}${suffix}`;
}

function expandRangeToSurroundingMarkers(
  document: MarkdownSourceDocument,
  range: MarkdownSourceRange,
  prefix: string,
  suffix: string,
): MarkdownSourceRange {
  if (range.startLineNumber !== range.endLineNumber) {
    return range;
  }

  const line = document.getLineContent(range.startLineNumber);
  const beforeStart = range.startColumn - prefix.length - 1;
  const afterStart = range.endColumn - 1;
  if (beforeStart < 0 || afterStart + suffix.length > line.length) {
    return range;
  }

  const before = line.slice(beforeStart, range.startColumn - 1);
  const after = line.slice(afterStart, afterStart + suffix.length);
  if (before !== prefix || after !== suffix) {
    return range;
  }

  return createRange(
    range.startLineNumber,
    range.startColumn - prefix.length,
    range.endLineNumber,
    range.endColumn + suffix.length,
  );
}

export function getMarkdownFormattingEdit(
  commandId: string,
  document: MarkdownSourceDocument,
  selection: MarkdownSourceRange,
): MarkdownFormattingEdit | null {
  switch (commandId) {
    case "editor.heading":
      return createSelectedLinesEdit(document, selection, toggleHeadingLines);
    case "editor.bulletList":
      return createSelectedLinesEdit(document, selection, toggleBulletLines);
    case "editor.orderedList":
      return createSelectedLinesEdit(document, selection, toggleOrderedLines);
    case "editor.blockquote":
      return createSelectedLinesEdit(document, selection, toggleBlockquoteLines);
  }

  const marker = getMarkerForCommand(commandId);
  if (!marker) return null;
  const [prefix, suffix] = marker;

  let targetRange = createRange(
    selection.startLineNumber,
    selection.startColumn,
    selection.endLineNumber,
    selection.endColumn,
  );

  if (isEmptySelection(selection)) {
    const wordAtCursor = document.getWordAtPosition({
      lineNumber: selection.startLineNumber,
      column: selection.startColumn,
    });
    if (wordAtCursor) {
      targetRange = createRange(
        selection.startLineNumber,
        wordAtCursor.startColumn,
        selection.startLineNumber,
        wordAtCursor.endColumn,
      );
    } else {
      return {
        range: targetRange,
        text: `${prefix}${suffix}`,
        cursor: {
          lineNumber:
            commandId === "editor.codeBlock" ? selection.startLineNumber + 1 : selection.startLineNumber,
          column: commandId === "editor.codeBlock" ? 1 : selection.startColumn + prefix.length,
        },
      };
    }
  }

  const expandedRange = expandRangeToSurroundingMarkers(document, targetRange, prefix, suffix);
  const selectedText = document.getValueInRange(expandedRange);
  return {
    range: expandedRange,
    text: toggleWrappedText(selectedText, prefix, suffix),
  };
}
