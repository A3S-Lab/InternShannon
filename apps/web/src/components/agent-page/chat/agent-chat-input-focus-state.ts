export interface AgentChatInputFocusShortcutInput {
  key?: string;
  code?: string;
  metaKey?: boolean;
  ctrlKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
  isComposing?: boolean;
  targetTagName?: string | null;
  targetRole?: string | null;
  targetIsContentEditable?: boolean;
  targetInsideDialog?: boolean;
  readOnly?: boolean;
  disableSlash?: boolean;
  hasInput?: boolean;
}

const EDITABLE_TAG_NAMES = new Set(["INPUT", "TEXTAREA", "SELECT"]);
const EDITABLE_ROLES = new Set(["textbox", "searchbox", "combobox"]);

export function shouldFocusAgentInputFromSlashShortcut(input: AgentChatInputFocusShortcutInput): boolean {
  if (input.readOnly || input.disableSlash || !input.hasInput) return false;
  if (input.isComposing) return false;
  if (input.metaKey || input.ctrlKey || input.altKey || input.shiftKey) return false;
  if (input.targetInsideDialog) return false;
  if (input.targetIsContentEditable) return false;

  const targetTagName = input.targetTagName?.toUpperCase();
  if (targetTagName && EDITABLE_TAG_NAMES.has(targetTagName)) return false;

  const targetRole = input.targetRole?.toLowerCase();
  if (targetRole && EDITABLE_ROLES.has(targetRole)) return false;

  return input.key === "/" || input.code === "Slash";
}
