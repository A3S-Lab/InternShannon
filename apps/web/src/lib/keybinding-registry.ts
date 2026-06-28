/**
 * Global keybinding registry.
 * Manages the mapping from keyboard shortcuts to command IDs,
 * with support for context expressions ("when" clauses).
 *
 * Inspired by VS Code's KeybindingsRegistry.
 */
import { parseWhenExpression, evaluateWhen } from "./keybinding/context-key-expr";
import { captureKeyCombo, normalizeKeyCombo } from "@/lib/key-combo";
import type { Monaco } from "@monaco-editor/react";
import type * as monacoEditor from "monaco-editor";

export interface KeybindingRule {
	commandId: string;
	key: string; // human-readable combo, e.g. "ctrl+shift+k"
	when?: string; // context expression
	weight?: number;
}

export type Context = Record<string, boolean | string>;

export interface ResolvedKeybinding {
	rule: KeybindingRule;
	commandId: string;
}

class KeybindingRegistryImpl {
	private _rules: KeybindingRule[] = [];
	private _changeListeners = new Set<() => void>();

	onDidChangeKeybindings(listener: () => void): { dispose: () => void } {
		this._changeListeners.add(listener);
		return { dispose: () => this._changeListeners.delete(listener) };
	}

	private _notifyChange() {
		this._changeListeners.forEach((l) => l());
	}

	registerKeybinding(rule: KeybindingRule): { dispose: () => void } {
		const ruleWithDefaults = {
			weight: 0,
			...rule,
			key: normalizeKeyCombo(rule.key),
		};
		this._rules.push(ruleWithDefaults);
		// Sort by weight descending (higher weight = higher priority)
		this._rules.sort((a, b) => (b.weight ?? 0) - (a.weight ?? 0));
		this._notifyChange();
		return {
			dispose: () => {
				const idx = this._rules.indexOf(ruleWithDefaults);
				if (idx !== -1) this._rules.splice(idx, 1);
				this._notifyChange();
			},
		};
	}

	registerKeybindings(rules: KeybindingRule[]): { dispose: () => void } {
		const disposables = rules.map((r) => this.registerKeybinding(r));
		return {
			dispose: () => disposables.forEach((d) => d.dispose()),
		};
	}

	/**
	 * Resolve a keyboard event against the current keybindings and context.
	 * Returns the first matching rule, or null if none match.
	 */
	resolveKeybinding(
		event: KeyboardEvent,
		context: Context,
	): ResolvedKeybinding | null {
		const combo = captureKeyCombo(event);
		if (!combo) return null;
		const normalizedCombo = normalizeKeyCombo(combo);

		for (const rule of this._rules) {
			if (rule.key !== normalizedCombo) continue;
			if (rule.when) {
				const ast = parseWhenExpression(rule.when);
				if (!ast) continue;
				if (!evaluateWhen(ast, context)) continue;
			}
			return { rule, commandId: rule.commandId };
		}
		return null;
	}

	/**
	 * Convert a human-readable combo string to Monaco numeric keybinding constants.
	 */
	parseKeybinding(monaco: Monaco, combo: string): number {
		const normalizedCombo = normalizeKeyCombo(combo);
		if (!normalizedCombo) return 0;
		const parts = normalizedCombo.split("+");
		let binding = 0;

		for (const part of parts) {
			switch (part) {
				case "ctrl":
				case "cmd":
				case "mod":
					binding |= monaco.KeyMod.CtrlCmd;
					break;
				case "shift":
					binding |= monaco.KeyMod.Shift;
					break;
				case "alt":
					binding |= monaco.KeyMod.Alt;
					break;
				case "up":
					binding |= monaco.KeyCode.UpArrow;
					break;
				case "down":
					binding |= monaco.KeyCode.DownArrow;
					break;
				case "left":
					binding |= monaco.KeyCode.LeftArrow;
					break;
				case "right":
					binding |= monaco.KeyCode.RightArrow;
					break;
				case "/":
					binding |= monaco.KeyCode.Slash;
					break;
				case "[":
					binding |= monaco.KeyCode.BracketLeft;
					break;
				case "]":
					binding |= monaco.KeyCode.BracketRight;
					break;
				case ";":
					binding |= monaco.KeyCode.Semicolon;
					break;
				case "'":
					binding |= monaco.KeyCode.Quote;
					break;
				case "`":
					binding |= monaco.KeyCode.Backquote;
					break;
				case "-":
					binding |= monaco.KeyCode.Minus;
					break;
				case "=":
					binding |= monaco.KeyCode.Equal;
					break;
				case ",":
					binding |= monaco.KeyCode.Comma;
					break;
				case ".":
					binding |= monaco.KeyCode.Period;
					break;
				case "tab":
					binding |= monaco.KeyCode.Tab;
					break;
				case "enter":
					binding |= monaco.KeyCode.Enter;
					break;
				case "backspace":
					binding |= monaco.KeyCode.Backspace;
					break;
				case "delete":
					binding |= monaco.KeyCode.Delete;
					break;
				case "escape":
					binding |= monaco.KeyCode.Escape;
					break;
				case "space":
					binding |= monaco.KeyCode.Space;
					break;
				default: {
					if (part.length === 1 && /[a-z]/.test(part)) {
						const kn =
							`Key${part.toUpperCase()}` as keyof typeof monaco.KeyCode;
						binding |= monaco.KeyCode[kn] as number;
					} else if (part.length === 1 && /[0-9]/.test(part)) {
						const kn = `Digit${part}` as keyof typeof monaco.KeyCode;
						binding |= monaco.KeyCode[kn] as number;
					} else if (/^f\d+$/.test(part)) {
						const kn = `F${part.slice(1)}` as keyof typeof monaco.KeyCode;
						binding |= monaco.KeyCode[kn] as number;
					} else if (/^numpad\d$/.test(part)) {
						const kn = part.toUpperCase() as keyof typeof monaco.KeyCode;
						binding |= monaco.KeyCode[kn] as number;
					} else if (part === "numpadadd" || part === "numpad+") {
						binding |= monaco.KeyCode.NumpadAdd as number;
					} else if (part === "numpadsubtract" || part === "numpad-") {
						binding |= monaco.KeyCode.NumpadSubtract as number;
					} else if (part === "numpadmultiply" || part === "numpad*") {
						binding |= monaco.KeyCode.NumpadMultiply as number;
					} else if (part === "numpaddivide" || part === "numpad/") {
						binding |= monaco.KeyCode.NumpadDivide as number;
					} else if (part === "numpaddecimal" || part === "numpad.") {
						binding |= monaco.KeyCode.NumpadDecimal as number;
					} else if (part === "numpadenter") {
						binding |= monaco.KeyCode.NumpadEnter as number;
					}
				}
			}
		}
		return binding;
	}

	/**
	 * Apply a keybinding to a Monaco editor instance.
	 * Returns the Monaco action ID that was created.
	 */
	applyToMonaco(
		editor: monacoEditor.editor.IStandaloneCodeEditor,
		monaco: Monaco,
		rule: KeybindingRule,
	): { dispose: () => void } {
		const kb = this.parseKeybinding(monaco, rule.key);
		if (!kb) return { dispose: () => {} };

		const disposable = editor.addAction({
			id: `kb.${rule.commandId}`,
			label: rule.commandId,
			keybindings: [kb],
			run: () => {
				// Dynamically import CommandRegistry to avoid circular deps
				void import("@/lib/command-registry").then(({ CommandRegistry }) => {
					void CommandRegistry.executeCommand(rule.commandId);
				});
			},
		});
		return disposable;
	}

	getKeybindings(): KeybindingRule[] {
		return [...this._rules];
	}

	getKeybindingForCommand(commandId: string): KeybindingRule | null {
		return this._rules.find((r) => r.commandId === commandId) ?? null;
	}

	getRulesForContext(context: Context): ResolvedKeybinding[] {
		const results: ResolvedKeybinding[] = [];
		for (const rule of this._rules) {
			if (rule.when) {
				const ast = parseWhenExpression(rule.when);
				if (ast && !evaluateWhen(ast, context)) continue;
			}
			results.push({ rule, commandId: rule.commandId });
		}
		return results;
	}

	/** Remove all registered keybindings */
	clear() {
		this._rules = [];
		this._notifyChange();
	}
}

export const KeybindingRegistry = new KeybindingRegistryImpl();
