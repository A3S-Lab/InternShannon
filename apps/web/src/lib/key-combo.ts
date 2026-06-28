export interface KeyComboEventLike {
  key?: string;
  code?: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
}

const MODIFIER_KEYS = new Set(["Control", "Shift", "Alt", "Meta"]);
const MODIFIER_CODES = new Set([
  "ControlLeft",
  "ControlRight",
  "ShiftLeft",
  "ShiftRight",
  "AltLeft",
  "AltRight",
  "MetaLeft",
  "MetaRight",
]);

const CODE_TO_KEY: Record<string, string> = {
  ArrowUp: "up",
  ArrowDown: "down",
  ArrowLeft: "left",
  ArrowRight: "right",
  Space: "space",
  Enter: "enter",
  NumpadEnter: "numpadenter",
  Tab: "tab",
  Backspace: "backspace",
  Delete: "delete",
  Escape: "escape",
  Backquote: "`",
  Minus: "-",
  Equal: "=",
  BracketLeft: "[",
  BracketRight: "]",
  Backslash: "\\",
  Semicolon: ";",
  Quote: "'",
  Comma: ",",
  Period: ".",
  Slash: "/",
  NumpadAdd: "numpadadd",
  NumpadSubtract: "numpadsubtract",
  NumpadMultiply: "numpadmultiply",
  NumpadDivide: "numpaddivide",
  NumpadDecimal: "numpaddecimal",
};

const SHIFTED_KEY_TO_BASE_KEY: Record<string, string> = {
  "~": "`",
  "!": "1",
  "@": "2",
  "#": "3",
  "$": "4",
  "%": "5",
  "^": "6",
  "&": "7",
  "*": "8",
  "(": "9",
  ")": "0",
  "_": "-",
  "+": "=",
  "{": "[",
  "}": "]",
  "|": "\\",
  ":": ";",
  '"': "'",
  "<": ",",
  ">": ".",
  "?": "/",
};

const MODIFIER_ALIASES: Record<string, "ctrl" | "shift" | "alt"> = {
  cmd: "ctrl",
  command: "ctrl",
  control: "ctrl",
  ctrl: "ctrl",
  meta: "ctrl",
  mod: "ctrl",
  option: "alt",
  alt: "alt",
  shift: "shift",
  "⌘": "ctrl",
  "⇧": "shift",
  "⌥": "alt",
};

const KEY_ALIASES: Record<string, string> = {
  arrowup: "up",
  arrowdown: "down",
  arrowleft: "left",
  arrowright: "right",
  " ": "space",
  del: "delete",
  esc: "escape",
  return: "enter",
};

function keyFromCode(code: string | undefined): string | null {
  if (!code) return null;
  if (CODE_TO_KEY[code]) return CODE_TO_KEY[code];

  if (/^Key[A-Z]$/.test(code)) {
    return code.slice(3).toLowerCase();
  }
  if (/^Digit\d$/.test(code)) {
    return code.slice(5);
  }
  if (/^Numpad\d$/.test(code)) {
    return `numpad${code.slice(6)}`;
  }
  if (/^F\d{1,2}$/.test(code)) {
    return code.toLowerCase();
  }

  return null;
}

function normalizeKeyToken(token: string): { key: string; impliedShift: boolean } {
  if (SHIFTED_KEY_TO_BASE_KEY[token]) {
    return {
      key: SHIFTED_KEY_TO_BASE_KEY[token],
      impliedShift: true,
    };
  }
  return {
    key: KEY_ALIASES[token] ?? token,
    impliedShift: false,
  };
}

function keyFromValue(key: string | undefined): string | null {
  if (!key) return null;
  const normalized = key.toLowerCase();
  switch (normalized) {
    case "arrowup":
      return "up";
    case "arrowdown":
      return "down";
    case "arrowleft":
      return "left";
    case "arrowright":
      return "right";
    case " ":
      return "space";
    case "esc":
      return "escape";
    default:
      if (key.length === 1 && SHIFTED_KEY_TO_BASE_KEY[key]) {
        return SHIFTED_KEY_TO_BASE_KEY[key];
      }
      return normalized;
  }
}

export function normalizeKeyCombo(combo: string): string {
  const parts = combo
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "")
    .split("+")
    .filter(Boolean);
  if (parts.length === 0) return "";

  const modifiers = new Set<"ctrl" | "shift" | "alt">();
  let key = "";

  for (const part of parts) {
    const modifier = MODIFIER_ALIASES[part];
    if (modifier) {
      modifiers.add(modifier);
      continue;
    }

    const normalized = normalizeKeyToken(part);
    key = normalized.key;
    if (normalized.impliedShift) {
      modifiers.add("shift");
    }
  }

  if (!key) return "";

  return [
    modifiers.has("ctrl") ? "ctrl" : "",
    modifiers.has("shift") ? "shift" : "",
    modifiers.has("alt") ? "alt" : "",
    key,
  ]
    .filter(Boolean)
    .join("+");
}

export function captureKeyCombo(event: KeyComboEventLike): string | null {
  if (!event?.key) return null;
  if (MODIFIER_KEYS.has(event.key) || (event.code && MODIFIER_CODES.has(event.code))) {
    return null;
  }

  const parts: string[] = [];
  if (event.ctrlKey || event.metaKey) parts.push("ctrl");
  if (event.shiftKey) parts.push("shift");
  if (event.altKey) parts.push("alt");

  const key = keyFromCode(event.code) ?? keyFromValue(event.key);
  if (!key) return null;
  parts.push(key);

  return parts.join("+");
}
